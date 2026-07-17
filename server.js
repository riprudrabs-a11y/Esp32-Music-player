const express = require('express');
const ytpl = require('ytpl');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { spawn, execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory cache (TTL seconds)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // cache playlists 5 minutes

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// Enable CORS for development. Restrict origin in production by setting CORS_ORIGIN
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));

// Basic rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function generateDebugId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
}

function getPlaylistWithYtDlp(playlistUrl, limit = 50) {
  // Call the yt-dlp CLI (must be installed on the host) and return parsed JSON
  return new Promise((resolve, reject) => {
    const args = ['-J', '--flat-playlist', '--playlist-end', String(limit), playlistUrl];
    // Increase maxBuffer in case playlist JSON is large
    execFile('yt-dlp', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // include stderr in the error for debugging
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

async function fetchPlaylist(playlistUrl, limit) {
  // Use cache to avoid repeated calls
  const cacheKey = `playlist:${playlistUrl}:limit:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let playlist;
  try {
    playlist = await ytpl(playlistUrl, { limit });
  } catch (err) {
    console.warn('ytpl failed, trying yt-dlp fallback:', err && err.message ? err.message : err);
    // fallback to yt-dlp
    playlist = await getPlaylistWithYtDlp(playlistUrl, limit);
  }

  const tracks = (playlist.items || [])
    .filter(item => item && item.id)
    .map(item => ({
      title: item.title || 'Unknown title',
      mp3Url: `https://inv.tux.pizza/latest_version?id=${item.id}&itag=140`,
      id: item.id,
      url: item.url || null,
    }));

  const result = { title: playlist.title || null, tracks };
  cache.set(cacheKey, result);
  return result;
}

function successResponse(data) {
  // Provide multiple keys so different clients (old/new) work: playlist, contents, tracks
  return {
    success: true,
    playlist: data,
    contents: data,
    tracks: Array.isArray(data && data.tracks) ? data.tracks : []
  };
}

function errorResponse(err, debugId) {
  // Avoid leaking full stack to clients; include a debugId to find logs
  return {
    success: false,
    error: {
      message: err && err.message ? err.message : 'Unknown error',
      name: err && err.name ? err.name : 'Error',
      debugId: debugId,
      details: err && err.stderr ? err.stderr : undefined
    }
  };
}

// POST-based API (keeps compatibility with existing clients)
app.post('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.body && req.body.playlistUrl;
  let limit = Number(req.body && req.body.limit) || 50;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500; // allow larger requests but cap them

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in request body.' } });
  }

  try {
    console.log(`Attempting to load playlist: ${playlistUrl} (limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST:`, err && (err.stack || err.stderr) ? (err.stack || err.stderr) : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

// GET-based API for simple clients (e.g., IoT boards that prefer GET)
// Example: /api/load-playlist?playlistUrl=...&limit=20
app.get('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.query && req.query.playlistUrl;
  let limit = Number(req.query && req.query.limit) || 50;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in query string.' } });
  }

  try {
    console.log(`Attempting to load playlist (GET): ${playlistUrl} (limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST (GET):`, err && (err.stack || err.stderr) ? (err.stack || err.stderr) : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

// Stream endpoint: proxy audio via yt-dlp for a given video id
// Example: /api/stream?id=VIDEO_ID
app.get('/api/stream', (req, res) => {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).send('Missing id');

  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  console.log(`Streaming video ${id}`);

  // Spawn yt-dlp binary (must be available in the environment). This pipes raw audio to the response.
  const proc = spawn('yt-dlp', ['-o', '-', '-f', 'bestaudio', '--no-playlist', videoUrl], { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.on('error', (err) => {
    console.error('yt-dlp spawn error:', err);
    if (!res.headersSent) res.status(500).send('Server streaming error: yt-dlp not available');
  });

  // Header: best-effort audio content type
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');

  proc.stdout.pipe(res);

  proc.stderr.on('data', (d) => {
    console.error('yt-dlp stderr:', d.toString().slice(0,200));
  });

  req.on('close', () => {
    if (!proc.killed) proc.kill('SIGKILL');
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
