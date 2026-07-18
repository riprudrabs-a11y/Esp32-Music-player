const express = require('express');
const ytpl = require('ytpl');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { execFile, spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

let settings = {
  playlistUrl: '',
  volume: 50,
  bluetoothDevice: ''
};

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

// ---------- Helpers ----------
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function generateDebugId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }

// ---------- Playlist fetching with start & limit ----------
function getPlaylistWithYtDlp(playlistUrl, start = 1, limit = 50) {
  return new Promise((resolve, reject) => {
    const end = start + limit - 1;
    const args = ['-J', '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), playlistUrl];
    execFile('yt-dlp', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr ? String(stderr).slice(0, 2000) : undefined;
        return reject(err);
      }
      try {
        const j = JSON.parse(stdout);
        const items = Array.isArray(j.entries) ? j.entries : [];
        const playlist = {
          title: j.title || null,
          items: items.map(it => ({ id: it.id, title: it.title || it.title_placeholder || it.id, url: it.url || null }))
        };
        resolve(playlist);
      } catch (e) {
        e.stdout = stdout ? String(stdout).slice(0, 2000) : undefined;
        return reject(e);
      }
    });
  });
}

async function fetchPlaylist(playlistUrl, start = 1, limit = 50) {
  const cacheKey = `playlist:${playlistUrl}:start:${start}:limit:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let playlist;
  try {
    // ytpl doesn't support start, so we fetch more and slice manually
    const total = start + limit - 1;
    const raw = await ytpl(playlistUrl, { limit: total });
    // Slice the items from start-1 to start-1+limit
    const sliced = raw.items.slice(start - 1, start - 1 + limit);
    playlist = {
      title: raw.title,
      items: sliced
    };
  } catch (err) {
    console.warn('ytpl failed, trying yt-dlp fallback:', err.message);
    playlist = await getPlaylistWithYtDlp(playlistUrl, start, limit);
  }

  const tracks = (playlist.items || [])
    .filter(item => item && item.id)
    .map(item => ({
      title: item.title || 'Unknown title',
      mp3Url: `/api/stream?id=${item.id}`,
      id: item.id,
      url: item.url || null,
    }));

  const result = { title: playlist.title || null, tracks };
  cache.set(cacheKey, result);
  return result;
}

function successResponse(data) {
  return {
    success: true,
    playlist: data,
    contents: data,
    tracks: Array.isArray(data?.tracks) ? data.tracks : []
  };
}

function errorResponse(err, debugId) {
  return {
    success: false,
    error: {
      message: err?.message || 'Unknown error',
      name: err?.name || 'Error',
      debugId: debugId,
      details: err?.stderr || undefined
    }
  };
}

// ---------- API endpoints ----------
app.post('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.body?.playlistUrl;
  let start = Number(req.body?.start) || 1;
  let limit = Number(req.body?.limit) || 50;
  if (!Number.isFinite(start) || start < 1) start = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl.' } });
  }

  try {
    const data = await fetchPlaylist(playlistUrl, start, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}]`, err?.stack || err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

app.get('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.query?.playlistUrl;
  let start = Number(req.query?.start) || 1;
  let limit = Number(req.query?.limit) || 50;
  if (!Number.isFinite(start) || start < 1) start = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl.' } });
  }

  try {
    const data = await fetchPlaylist(playlistUrl, start, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}]`, err?.stack || err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

// /api/stream (unchanged)
app.get('/api/stream', (req, res) => {
  const id = req.query?.id;
  if (!id) return res.status(400).send('Missing video id');
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  console.log(`Streaming video ${id}`);
  const proc = spawn('yt-dlp', ['-o', '-', '-f', 'bestaudio', '--no-playlist', videoUrl], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.on('error', (err) => {
    console.error('yt-dlp spawn error:', err);
    if (!res.headersSent) res.status(500).send('Streaming error: yt-dlp not available');
  });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');
  proc.stdout.pipe(res);
  proc.stderr.on('data', (d) => console.error('yt-dlp stderr:', d.toString().slice(0, 200)));
  req.on('close', () => { if (!proc.killed) proc.kill('SIGKILL'); });
});

// Settings endpoints (unchanged)
app.get('/api/settings', (req, res) => res.json({ success: true, settings }));
app.post('/api/settings', (req, res) => {
  const { playlistUrl, volume, bluetoothDevice } = req.body || {};
  if (playlistUrl !== undefined) settings.playlistUrl = playlistUrl;
  if (volume !== undefined && !isNaN(volume)) {
    settings.volume = Math.min(100, Math.max(0, Number(volume)));
  }
  if (bluetoothDevice !== undefined) settings.bluetoothDevice = bluetoothDevice;
  console.log('Settings updated:', settings);
  res.json({ success: true, settings });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
