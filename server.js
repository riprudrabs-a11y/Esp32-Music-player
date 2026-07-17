const express = require('express');
const path = require('path');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let masterPlaylistTracks = [];
let activeTrackIndex = 0;

// Helper function to extract the Playlist ID from a URL
function getPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

// 1. Endpoint that dynamically grabs the songs from the YouTube playlist
app.post('/api/load-playlist', (req, res) => {
    const { playlistUrl } = req.body;
    const playlistId = getPlaylistId(playlistUrl);
    
    if (!playlistId) {
        return res.status(400).json({ success: false, error: "Invalid Playlist URL" });
    }

    // We use a free, open-source YouTube scraper pipeline to read the playlist items
    const apiUrl = `https://invidious.io.lol/api/v1/playlists/${playlistId}`;

    https.get(apiUrl, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => { data += chunk; });
        apiRes.on('end', () => {
            try {
                const parsedData = JSON.parse(data);
                
                if (parsedData && parsedData.videos) {
                    // Map the real YouTube video elements into your system format
                    masterPlaylistTracks = parsedData.videos.map(video => {
                        return {
                            title: video.title,
                            // Generate direct video streams for the web dashboard (MP4)
                            mp4Url: `https://invidious.io.lol/latest_version?id=${video.videoId}&itag=22`,
                            // Generate lightweight audio-only streams for your screenless ESP32 (MP3/AAC audio)
                            mp3Url: `https://invidious.io.lol/latest_version?id=${video.videoId}&itag=140`
                        };
                    });

                    activeTrackIndex = 0;
                    console.log(`Successfully imported ${masterPlaylistTracks.length} tracks from playlist!`);
                    return res.json({ success: true, tracks: masterPlaylistTracks });
                }
                
                res.status(500).json({ success: false, error: "No videos found in response" });
            } catch (e) {
                res.status(500).json({ success: false, error: "Failed to parse stream data" });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ success: false, error: err.message });
    });
});

// 2. Tracks which song index the web automation player is currently on
app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

// 3. MICROCONTROLLER ENDPOINT: Your screenless ESP32 asks for audio data here
app.get('/api/micro-view', (req, res) => {
    if (masterPlaylistTracks.length === 0 || activeTrackIndex >= masterPlaylistTracks.length) {
        return res.json({ status: "idle", currentTrackTitle: "None", mp3Url: "" });
    }
    
    const current = masterPlaylistTracks[activeTrackIndex];
    res.json({
        status: "playing",
        currentTrackTitle: current.title,
        mp3Url: current.mp3Url // The lightweight direct audio-only stream address
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Live playlist automation engine processing on port ${PORT}`);
});
