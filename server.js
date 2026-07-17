const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let masterPlaylistTracks = [];
let activeTrackIndex = 0;

// Website sends the playlist URL here
app.post('/api/load-playlist', (req, res) => {
    const { playlistUrl } = req.body;
    
    // Sample automated stream track links (Web gets MP4, ESP32 gets MP3)
    masterPlaylistTracks = [
        { title: "Track One", mp4Url: "https://www.w3schools.com/html/mov_bbb.mp4", mp3Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { title: "Track Two", mp4Url: "https://www.w3schools.com/html/movie.mp4", mp3Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
        { title: "Track Three", mp4Url: "https://www.w3schools.com/html/mov_bbb.mp4", mp3Url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }
    ];
    
    activeTrackIndex = 0;
    res.json({ success: true, tracks: masterPlaylistTracks });
});

// Syncs up what song the browser video player is currently on
app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

// MICROCONTROLLER PIPELINE: The screenless ESP32 hits this exact clean endpoint
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
    console.log(`Server running on port ${PORT}`);
});
