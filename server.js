const express = require('express');
const ytpl = require('ytpl');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { execFile } = require('child_process');

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

function getPlaylistWithYtDlp(playlistUrl, limit = 50, start = 1) {
  // Call the yt-dlp CLI (must be installed on the host) and return parsed JSON
  return new Promise((resolve, reject) => {
    const end = start + limit - 1;
    const args = ['-J', '--flat-playlist', '--playlist-start', String(start), '--playlist-end', String(end), playlistUrl];
    // Increase maxBuffer in case playlist JSON is large
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

async function fetchPlaylist(playlistUrl, limit, start = 1) {
  // Use cache to avoid repeated calls
  const cacheKey = `playlist:${playlistUrl}:start:${start}:limit:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let playlist;
  try {
    // ytpl doesn't support start/end, so adjust limit if start > 1
    const adjustedLimit = start + limit - 1;
    playlist = await ytpl(playlistUrl, { limit: adjustedLimit });
  } catch (err) {
    console.warn('ytpl failed, trying yt-dlp fallback:', err && err.message ? err.message : err);
    // fallback to yt-dlp with start/end support
    playlist = await getPlaylistWithYtDlp(playlistUrl, limit, start);
  }

  const items = playlist.items || [];
  // Slice to requested range if needed (when using ytpl we got extra items)
  const sliced = items.slice(start - 1, start - 1 + limit);
  
  const tracks = sliced
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
  let start = Number(req.body && req.body.start) || 1;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;
  if (!Number.isFinite(start) || start < 1) start = 1;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in request body.' } });
  }

  try {
    console.log(`Attempting to load playlist: ${playlistUrl} (start=${start}, limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit, start);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST:`, err && (err.stack || err.stderr) ? (err.stack || err.stderr) : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

// GET-based API for simple clients (e.g., IoT boards that prefer GET)
// Example: /api/load-playlist?playlistUrl=...&start=1&limit=50
app.get('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.query && req.query.playlistUrl;
  let limit = Number(req.query && req.query.limit) || 50;
  let start = Number(req.query && req.query.start) || 1;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;
  if (!Number.isFinite(start) || start < 1) start = 1;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in query string.' } });
  }

  try {
    console.log(`Attempting to load playlist (GET): ${playlistUrl} (start=${start}, limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit, start);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST (GET):`, err && (err.stack || err.stderr) ? (err.stack || err.stderr) : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});