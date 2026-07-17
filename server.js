const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Temporary database storage in server memory
let savedPlaylist = { tracks: [] };

// Endpoint where the webpage saves the ordered track rules
app.post('/api/save-playlist', (req, res) => {
    savedPlaylist = req.body;
    res.json({ success: true });
});

// Endpoint where your iOS App or Microcontroller reads the playlist in order
app.get('/api/current-playlist', (req, res) => {
    res.json(savedPlaylist);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server live on port ${PORT}`);
});
