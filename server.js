const express = require('express');
const ytpl = require('ytpl');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.post('/api/load-playlist', async (req, res) => {
    try {
        console.log("Attempting to load:", req.body.playlistUrl);
        const playlist = await ytpl(req.body.playlistUrl, { limit: 50 });
        const tracks = playlist.items.map(item => ({
            title: item.title,
            mp3Url: `https://inv.tux.pizza/latest_version?id=${item.id}&itag=140`
        }));
        res.json({ success: true, tracks: tracks });
    } catch (err) {
        // This line will print the specific error to your Render Logs
        console.error("CRITICAL ERROR IN LOAD-PLAYLIST:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log("Server is running.");
});
