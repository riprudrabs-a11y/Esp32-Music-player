const express = require('express');
const ytpl = require('ytpl');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

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

async function fetchPlaylist(playlistUrl, limit) {
  // Use cache to avoid repeated calls
  const cacheKey = `playlist:${playlistUrl}:limit:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const playlist = await ytpl(playlistUrl, { limit });
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
      // If ytpl provides additional properties, include them under details (non-sensitive)
      details: err && err.info ? err.info : undefined
    }
  };
}

// POST-based API (keeps compatibility with existing clients)
app.post('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.body && req.body.playlistUrl;
  let limit = Number(req.body && req.body.limit) || 50;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in request body.' } });
  }

  try {
    console.log(`Attempting to load playlist: ${playlistUrl} (limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    // Log full error stack and debugId to server logs for investigation
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST:`, err && err.stack ? err.stack : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

// GET-based API for simple clients (e.g., IoT boards that prefer GET)
// Example: /api/load-playlist?playlistUrl=...&limit=20
app.get('/api/load-playlist', async (req, res) => {
  const playlistUrl = req.query && req.query.playlistUrl;
  let limit = Number(req.query && req.query.limit) || 50;

  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  if (!isNonEmptyString(playlistUrl)) {
    return res.status(400).json({ success: false, error: { message: 'Missing or invalid playlistUrl in query string.' } });
  }

  try {
    console.log(`Attempting to load playlist (GET): ${playlistUrl} (limit=${limit})`);
    const data = await fetchPlaylist(playlistUrl, limit);
    res.json(successResponse(data));
  } catch (err) {
    const debugId = generateDebugId();
    console.error(`[${debugId}] CRITICAL ERROR IN LOAD-PLAYLIST (GET):`, err && err.stack ? err.stack : err);
    res.status(500).json(errorResponse(err, debugId));
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
