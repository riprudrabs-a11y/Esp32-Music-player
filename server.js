const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let masterPlaylistTracks = [];
let activeTrackIndex = 0;

// Helper to isolate the playlist ID
function getPlaylistId(url) {
    const match = url.match(/[&?]list=([^&]+)/);
    return match ? match[1] : null;
}

// 1. Endpoint that dynamically grabs the songs using a stable API
app.post('/api/load-playlist', async (req, res) => {
    const { playlistUrl } = req.body;
    const playlistId = getPlaylistId(playlistUrl);
    
    if (!playlistId) {
        return res.status(400).json({ success: false, error: "Invalid Playlist URL" });
    }

    try {
        // Using Piped API - highly stable for fetching YouTube metadata
        const apiUrl = `https://pipedapi.kavin.rocks/playlists/${playlistId}`;
        
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        if (!response.ok) throw new Error("Playlist API rejected the request");

        const parsedData = await response.json();
        
        // Check if the data has the video array
        if (parsedData && parsedData.relatedStreams) {
            masterPlaylistTracks = parsedData.relatedStreams.map(video => {
                // Piped returns URLs like "/watch?v=12345678901", we just need the ID part
                const videoId = video.url.split('v=')[1];
                
                return {
                    title: video.title,
                    // Highly stable stream proxies for MP4 (Video) and MP3 (Audio)
                    mp4Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=22`,
                    mp3Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=140`
                };
            });

            activeTrackIndex = 0;
            console.log(`Successfully loaded ${masterPlaylistTracks.length} tracks!`);
            return res.json({ success: true, tracks: masterPlaylistTracks });
        }
        
        res.status(500).json({ success: false, error: "No videos found. Is the playlist Private?" });
        
    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ success: false, error: "Failed to pull playlist from YouTube." });
    }
});

// 2. Syncs up the dashboard player state
app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

// 3. MICROCONTROLLER ENDPOINT: ESP32 grabs the raw MP3 link here
app.get('/api/micro-view', (req, res) => {
    if (masterPlaylistTracks.length === 0 || activeTrackIndex >= masterPlaylistTracks.length) {
        return res.json({ status: "idle", currentTrackTitle: "None", mp3Url: "" });
    }
    
    const current = masterPlaylistTracks[activeTrackIndex];
    res.json({
        status: "playing",
        currentTrackTitle: current.title,
        mp3Url: current.mp3Url
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server live on port ${PORT}`);
});
