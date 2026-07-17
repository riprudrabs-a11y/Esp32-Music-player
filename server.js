const express = require('express');
const ytpl = require('ytpl');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

let masterPlaylistTracks = [];
let activeTrackIndex = 0;

app.post('/api/load-playlist', async (req, res) => {
    try {
        const playlist = await ytpl(req.body.playlistUrl, { limit: 50 });
        masterPlaylistTracks = playlist.items.map(item => ({
            title: item.title,
            mp4Url: `https://inv.tux.pizza/latest_version?id=${item.id}&itag=22`,
            mp3Url: `https://inv.tux.pizza/latest_version?id=${item.id}&itag=140`
        }));
        activeTrackIndex = 0;
        res.json({ success: true, tracks: masterPlaylistTracks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/update-state', (req, res) => {
    activeTrackIndex = req.body.currentTrackIndex;
    res.json({ success: true });
});

app.get('/api/micro-view', (req, res) => {
    if (masterPlaylistTracks.length === 0 || activeTrackIndex >= masterPlaylistTracks.length) {
        return res.json({ status: "idle", currentTrackTitle: "None", mp3Url: "" });
    }
    const current = masterPlaylistTracks[activeTrackIndex];
    res.json({ status: "playing", currentTrackTitle: current.title, mp3Url: current.mp3Url });
});

app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
