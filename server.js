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

// Bypasses proxy APIs entirely and scrapes the raw YouTube playlist page directly
function fetchPlaylistDirectly(playlistId) {
    return new Promise((resolve, reject) => {
        const url = `https://www.youtube.com/playlist?list=${playlistId}`;
        
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const regex = /ytInitialData\s*=\s*({.+?});/s;
                    const match = data.match(regex);
                    if (!match) throw new Error("Could not extract playlist data from YouTube.");
                    
                    const jsonData = JSON.parse(match[1]);
                    const items = jsonData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;
                    
                    const tracks = [];
                    for (let item of items) {
                        if (item.playlistVideoRenderer) {
                            const vid = item.playlistVideoRenderer;
                            tracks.push({
                                title: vid.title.runs[0].text,
                                mp4Url: `https://inv.tux.pizza/latest_version?id=${vid.videoId}&itag=22`,
                                mp3Url: `https://inv.tux.pizza/latest_version?id=${vid.videoId}&itag=140`
                            });
                        }
                    }
                    resolve(tracks);
                } catch (e) {
                    reject(new Error("Direct extraction failed."));
                }
            });
        }).on('error', reject);
    });
}

app.post('/api/load-playlist', async (req, res) => {
    const playlistId = getPlaylistId(req.body.playlistUrl);
    if (!playlistId) return res.status(400).json({ success: false, error: "Invalid Playlist URL" });

    try {
        masterPlaylistTracks = await fetchPlaylistDirectly(playlistId);
        if (masterPlaylistTracks.length > 0) {
            activeTrackIndex = 0;
            return res.json({ success: true, tracks: masterPlaylistTracks });
        }
        throw new Error("No tracks found in playlist.");
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
