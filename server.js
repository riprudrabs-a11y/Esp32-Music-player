const express = require('express');
const path = require('path');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let masterPlaylistTracks = [];
let activeTrackIndex = 0;

function getPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

// Custom highly-stable network request function
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                } else {
                    reject(new Error(`HTTP Status ${res.statusCode}`));
                }
            });
        }).on('error', reject);
    });
}

// The Auto-Fallback Playlist Loader
app.post('/api/load-playlist', async (req, res) => {
    const playlistId = getPlaylistId(req.body.playlistUrl);
    if (!playlistId) return res.status(400).json({ success: false, error: "Invalid Playlist URL" });

    // Array of stable API mirrors. It tests them sequentially until one works.
    const apiMirrors = [
        `https://pipedapi.kavin.rocks/playlists/${playlistId}`,
        `https://pipedapi.adminforge.de/playlists/${playlistId}`,
        `https://pipedapi.smnz.de/playlists/${playlistId}`,
        `https://pipedapi.moomoo.me/playlists/${playlistId}`
    ];

    let parsedData = null;
    let lastError = "";

    for (let apiUrl of apiMirrors) {
        try {
            console.log("Attempting API pipeline:", apiUrl);
            parsedData = await fetchJson(apiUrl);
            
            if (parsedData && parsedData.relatedStreams && parsedData.relatedStreams.length > 0) {
                console.log("SUCCESS! Connected via:", apiUrl);
                break; // We got the data, stop looking
            }
        } catch (err) {
            console.log("Pipeline failed, trying next. Error:", err.message);
            lastError = err.message;
        }
    }

    if (!parsedData || !parsedData.relatedStreams) {
        return res.status(500).json({ 
            success: false, 
            error: `All proxy APIs rejected the connection. Last error: ${lastError}` 
        });
    }

    // Map the successfully retrieved tracks
    masterPlaylistTracks = parsedData.relatedStreams.map(video => {
        const videoId = video.url.split('v=')[1];
        return {
            title: video.title,
            mp4Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=22`,
            mp3Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=140`
        };
    });

    activeTrackIndex = 0;
    res.json({ success: true, tracks: masterPlaylistTracks });
});

// State Syncing
app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

// MICROCONTROLLER ENDPOINT
app.get('/api/micro-view', (req, res) => {
    if (masterPlaylistTracks.length === 0 || activeTrackIndex >= masterPlaylistTracks.length) {
        return res.json({ status: "idle", currentTrackTitle: "None", mp3Url: "" });
    }
    
    res.json({
        status: "playing",
        currentTrackTitle: masterPlaylistTracks[activeTrackIndex].title,
        mp3Url: masterPlaylistTracks[activeTrackIndex].mp3Url
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server live on port ${PORT}`);
});
