const express = require('express');
const path = require('path');
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

// 1. EXTENSIVE DEBUG PLAYLIST LOADER
app.post('/api/load-playlist', async (req, res) => {
    console.log("\n=== NEW PLAYLIST REQUEST INITIATED ===");
    const { playlistUrl } = req.body;
    console.log("Step 1: Received URL -", playlistUrl);
    
    const playlistId = getPlaylistId(playlistUrl);
    console.log("Step 2: Extracted ID -", playlistId);
    
    if (!playlistId) {
        console.log("FAIL: Invalid URL formatting.");
        return res.status(400).json({ success: false, error: "Cannot find 'list=' in your URL." });
    }

    try {
        // Using a highly stable Piped instance
        const apiUrl = `https://pipedapi.tokhmi.xyz/playlists/${playlistId}`;
        console.log("Step 3: Contacting API -", apiUrl);
        
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        console.log(`Step 4: API Responded with Status Code: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log("FAIL: API Rejected Request. Reason:", errorText);
            throw new Error(`API returned HTTP ${response.status}: ${errorText}`);
        }

        const parsedData = await response.json();
        console.log("Step 5: Data parsed successfully.");
        console.log(" -> Playlist Name:", parsedData.name || "Unknown");
        console.log(" -> Videos Found:", parsedData.relatedStreams ? parsedData.relatedStreams.length : 0);
        
        if (parsedData && parsedData.relatedStreams && parsedData.relatedStreams.length > 0) {
            masterPlaylistTracks = parsedData.relatedStreams.map(video => {
                const videoId = video.url.split('v=')[1];
                return {
                    title: video.title,
                    mp4Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=22`,
                    mp3Url: `https://inv.tux.pizza/latest_version?id=${videoId}&itag=140`
                };
            });

            activeTrackIndex = 0;
            console.log(`Step 6: SUCCESS! Loaded ${masterPlaylistTracks.length} tracks into memory.`);
            return res.json({ success: true, tracks: masterPlaylistTracks });
        }
        
        console.log("FAIL: API connection worked, but video array was empty.");
        res.status(500).json({ success: false, error: "Playlist data returned empty. API might be blocking large playlists." });
        
    } catch (error) {
        console.error("=== CRITICAL SERVER ERROR ===");
        console.error(error.message);
        res.status(500).json({ success: false, error: `Debug Log: ${error.message}` });
    }
});

// 2. State Tracker
app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

// 3. MICROCONTROLLER ENDPOINT
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
    console.log(`Server live on port ${PORT} - DEBUG MODE ACTIVE`);
});
