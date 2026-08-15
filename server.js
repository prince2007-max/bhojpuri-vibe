const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json());

// Parse .env file if available
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length > 0) {
            process.env[key.trim()] = vals.join('=').trim();
        }
    });
}

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID || "PLFgOISmN8jwf4bBX_VSZLEK-_6Xh8e5fb";
const BG_VIDEO = process.env.BACKGROUND_ANIMATION || "/video/bhojpuri-bg.mp4";

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use('/video', express.static(path.join(__dirname, 'video')));

// REAL-TIME VISITOR PRESENCE REGISTRY
const activeSessions = new Map(); // sessionId -> lastSeenTimestamp
const SESSION_TTL = 10000; // 10 seconds TTL

// In-Memory oEmbed Metadata Cache
const metadataCache = new Map();

// Clean expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, lastSeen] of activeSessions.entries()) {
        if (now - lastSeen > SESSION_TTL) {
            activeSessions.delete(id);
        }
    }
}, 3000);

// Heartbeat Endpoint
app.post('/api/heartbeat', (req, res) => {
    const { sessionId } = req.body || {};
    if (sessionId) {
        activeSessions.set(sessionId, Date.now());
    }
    res.json({ count: Math.max(1, activeSessions.size) });
});

// Live Visitor Count Endpoint
app.get('/api/live-count', (req, res) => {
    res.json({ count: Math.max(1, activeSessions.size) });
});

// Config API endpoint
app.get('/api/config', (req, res) => {
    let currentPlaylistId = "PLFgOISmN8jwf4bBX_VSZLEK-_6Xh8e5fb";
    let currentBgVideo = "/video/bhojpuri-bg.mp4";
    if (fs.existsSync(envPath)) {
        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            envContent.split(/\r?\n/).forEach(line => {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    const k = parts[0].trim();
                    const v = parts.slice(1).join('=').trim();
                    if (k === 'YOUTUBE_PLAYLIST_ID' && v) currentPlaylistId = v;
                    if (k === 'BACKGROUND_ANIMATION' && v) currentBgVideo = v;
                }
            });
        } catch (e) {}
    }
    res.json({
        playlistId: currentPlaylistId,
        bgVideo: currentBgVideo
    });
});

// YouTube oEmbed Metadata Proxy Endpoint with Lightning-Fast Cache
app.get('/api/yt-metadata', (req, res) => {
    const videoId = req.query.id;
    if (!videoId) return res.status(400).json({ error: "Missing video ID" });

    if (metadataCache.has(videoId)) {
        return res.json(metadataCache.get(videoId));
    }

    const targetUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    https.get(targetUrl, (ytRes) => {
        let body = "";
        ytRes.on('data', chunk => body += chunk);
        ytRes.on('end', () => {
            try {
                const data = JSON.parse(body);
                const result = {
                    title: data.title || "YouTube Track",
                    author: data.author_name || "Bhojpuri Vibe",
                    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                };
                metadataCache.set(videoId, result);
                res.json(result);
            } catch (err) {
                res.json({
                    title: "YouTube Track",
                    author: "Bhojpuri Vibe",
                    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                });
            }
        });
    }).on('error', (e) => {
        res.json({
            title: "YouTube Track",
            author: "Bhojpuri Vibe",
            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        });
    });
});

// Route all other requests to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`====================================================`);
        console.log(`🎬 BHOJPURI VIBE SERVER RUNNING`);
        console.log(`🎵 YouTube Playlist ID: ${PLAYLIST_ID}`);
        console.log(`🔊 Listening at: http://localhost:${port}`);
        console.log(`====================================================`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} is in use, retrying on port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

startServer(DEFAULT_PORT);
