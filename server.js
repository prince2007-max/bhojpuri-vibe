const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable Gzip/Brotli Compression for text assets
app.use(compression());
app.use(express.json());

// Enable CORS for API responses
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Parse .env file if available locally
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split(/\r?\n/).forEach(line => {
            const [key, ...vals] = line.split('=');
            if (key && vals.length > 0) {
                process.env[key.trim()] = vals.join('=').trim();
            }
        });
    } catch (e) {}
}

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID || "PLFgOISmN8jwf4bBX_VSZLEK-_6Xh8e5fb";
const BG_VIDEO = process.env.BACKGROUND_ANIMATION || "/video/bhojpuri-bg.mp4";

// Static asset caching options (1 day browser cache for static files)
const staticOptions = {
    maxAge: '1d',
    etag: true
};

// Serve static files from root directory & static folders with caching
app.use(express.static(path.join(__dirname), staticOptions));
app.use('/video', express.static(path.join(__dirname, 'video'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticOptions));

// Explicit homepage route to guarantee root index.html is served on Render
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// REAL-TIME VISITOR PRESENCE REGISTRY
const activeSessions = new Map(); // sessionId -> lastSeenTimestamp
const SESSION_TTL = 10000; // 10 seconds TTL

// In-Memory Caches with size limit (max 200 items)
const metadataCache = new Map();
const playlistCache = new Map();

function setBoundedCache(map, key, val, maxSize = 200) {
    if (map.size >= maxSize) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, val);
}

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
    res.json({
        playlistId: process.env.YOUTUBE_PLAYLIST_ID || PLAYLIST_ID,
        bgVideo: process.env.BACKGROUND_ANIMATION || BG_VIDEO
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
                setBoundedCache(metadataCache, videoId, result);
                res.json(result);
            } catch (err) {
                res.json({
                    title: "YouTube Track",
                    author: "Bhojpuri Vibe",
                    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                });
            }
        });
    }).on('error', () => {
        res.json({
            title: "YouTube Track",
            author: "Bhojpuri Vibe",
            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
        });
    });
});

// YouTube Playlist Items Proxy Endpoint (Fetches full list of track video IDs, titles & authors)
app.get('/api/playlist-items', (req, res) => {
    const playlistId = req.query.id;
    if (!playlistId) return res.status(400).json({ error: "Missing playlist ID" });

    if (playlistCache.has(playlistId)) {
        return res.json(playlistCache.get(playlistId));
    }

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
    https.get(feedUrl, (ytRes) => {
        let body = "";
        ytRes.on('data', chunk => body += chunk);
        ytRes.on('end', () => {
            try {
                const items = [];
                const entries = body.split('<entry>');
                entries.slice(1).forEach((entry, idx) => {
                    const idMatch = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
                    const titleMatch = entry.match(/<title>(.*?)<\/title>/);
                    const authorMatch = entry.match(/<name>(.*?)<\/name>/);

                    if (idMatch && idMatch[1]) {
                        const videoId = idMatch[1];
                        const rawTitle = titleMatch ? titleMatch[1] : `Track ${idx + 1}`;
                        const title = rawTitle.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                        const author = authorMatch ? authorMatch[1] : "Bhojpuri Vibe";

                        items.push({
                            id: idx + 1,
                            videoId: videoId,
                            title: title,
                            artist: author,
                            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                        });
                    }
                });

                if (items.length > 0) {
                    const payload = { items };
                    setBoundedCache(playlistCache, playlistId, payload);
                    return res.json(payload);
                }
                res.json({ items: [] });
            } catch (err) {
                res.json({ items: [] });
            }
        });
    }).on('error', () => {
        res.json({ items: [] });
    });
});

// Catch-all fallback route for client-side navigation
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Global Process Crash Prevention
process.on('uncaughtException', (err) => {
    console.error('[SERVER WARN] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[SERVER WARN] Unhandled Rejection:', reason);
});

// Start Express Server bound to 0.0.0.0 for Render/Cloud compatibility
app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🎬 BHOJPURI VIBE SERVER RUNNING ON RENDER / CLOUD`);
    console.log(`🎵 YouTube Playlist ID: ${PLAYLIST_ID}`);
    console.log(`🔊 Listening at: http://0.0.0.0:${PORT}`);
    console.log(`====================================================`);
});
