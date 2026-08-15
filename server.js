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

// CENTRAL PLAYLIST CONFIGURATION LOCK (SOURCE OF TRUTH)
const PLAYLIST_SOURCES = {
    pawan: { key: "pawan", name: "Pawan Singh", playlistId: "PLHoEe5Zf1FIc" },
    khesari: { key: "khesari", name: "Khesari Lal Yadav", playlistId: "PLFgOISmN8jwf4bBX_VSZLEK-_6Xh8e5fb" },
    nirahua: { key: "nirahua", name: "Nirahua (Dinesh Lal Yadav)", playlistId: "PLpj9eyegyBetvUcSUE0Df8BdxsbObHIYi" },
    kallu: { key: "kallu", name: "Arvind Akela Kallu", playlistId: "PLxxkl-pkbhGaAHAdjz7bXVG2Ug25Bac-Y" },
    hits: { key: "hits", name: "Bhojpuri Top Hits", playlistId: "PLE47nOrXysyE" },
    allHits: { key: "hits", name: "Bhojpuri Top Hits", playlistId: "PLE47nOrXysyE" }
};

// Dynamic Playlist Endpoint: GET /api/playlists/:artist
app.get('/api/playlists/:artist', (req, res) => {
    const artistKey = req.params.artist;
    const source = PLAYLIST_SOURCES[artistKey];

    if (!source) {
        return res.status(404).json({ error: "Unknown artist category", artistKey });
    }

    const playlistId = source.playlistId;
    if (playlistCache.has(playlistId)) {
        const cached = playlistCache.get(playlistId);
        return res.json({
            artist: source,
            items: cached.items,
            totalItems: cached.items.length,
            pagesFetched: cached.pagesFetched || 1
        });
    }

    fetchYouTubePlaylistFeed(playlistId, (items, pagesFetched) => {
        if (items && items.length > 0) {
            const payload = { items, pagesFetched: pagesFetched || 1 };
            setBoundedCache(playlistCache, playlistId, payload);
            return res.json({
                artist: source,
                items,
                totalItems: items.length,
                pagesFetched: pagesFetched || 1
            });
        }
        res.json({ artist: source, items: [], totalItems: 0, pagesFetched: 0 });
    });
});

// YouTube Playlist Items Proxy Endpoint
app.get('/api/playlist-items', (req, res) => {
    const playlistId = req.query.id;
    if (!playlistId) return res.status(400).json({ error: "Missing playlist ID" });

    if (playlistCache.has(playlistId)) {
        const cached = playlistCache.get(playlistId);
        return res.json({
            items: cached.items,
            totalItems: cached.items.length,
            pagesFetched: cached.pagesFetched || 1
        });
    }

    fetchYouTubePlaylistFeed(playlistId, (items, pagesFetched) => {
        if (items && items.length > 0) {
            const payload = { items, pagesFetched: pagesFetched || 1 };
            setBoundedCache(playlistCache, playlistId, payload);
            return res.json({
                items,
                totalItems: items.length,
                pagesFetched: pagesFetched || 1
            });
        }
        res.json({ items: [], totalItems: 0, pagesFetched: 0 });
    });
});

function fetchYouTubePlaylistFeed(playlistId, callback) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
        return fetchYouTubePlaylistViaAPI(playlistId, apiKey, callback);
    }
    fetchYouTubePlaylistViaScraper(playlistId, callback);
}

function fetchYouTubePlaylistViaAPI(playlistId, apiKey, callback) {
    let allItems = [];
    let pageCount = 0;
    const seenVideoIds = new Set();

    function fetchPage(pageToken = "") {
        pageCount++;
        const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}${pageToken ? '&pageToken=' + pageToken : ''}`;

        https.get(apiUrl, (ytRes) => {
            let body = "";
            ytRes.on('data', chunk => body += chunk);
            ytRes.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const items = data.items || [];
                    const hasNextPage = !!data.nextPageToken;

                    console.log(`[PLAYLIST FETCH] Playlist: ${playlistId} | Page: ${pageCount} | Items: ${items.length} | Next page: ${hasNextPage ? 'YES' : 'NO'}`);

                    items.forEach((item) => {
                        const snippet = item.snippet || {};
                        const videoId = (item.contentDetails && item.contentDetails.videoId) || (snippet.resourceId && snippet.resourceId.videoId);

                        if (videoId && snippet.title !== 'Private video' && snippet.title !== 'Deleted video' && !seenVideoIds.has(videoId)) {
                            seenVideoIds.add(videoId);
                            allItems.push({
                                id: allItems.length + 1,
                                videoId: videoId,
                                title: snippet.title || "Bhojpuri Track",
                                artist: snippet.videoOwnerChannelTitle || snippet.channelTitle || "Bhojpuri Vibe",
                                thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                            });
                        }
                    });

                    if (data.nextPageToken && allItems.length < 500) {
                        fetchPage(data.nextPageToken);
                    } else {
                        console.log(`[PLAYLIST FETCH COMPLETE] Playlist: ${playlistId} | Total: ${allItems.length} | Pages: ${pageCount}`);
                        callback(allItems, pageCount);
                    }
                } catch (e) {
                    console.error(`[PLAYLIST FETCH ERROR] API parse error on page ${pageCount}:`, e.message);
                    if (allItems.length > 0) {
                        callback(allItems, pageCount);
                    } else {
                        fetchYouTubePlaylistViaScraper(playlistId, callback);
                    }
                }
            });
        }).on('error', (err) => {
            console.error(`[PLAYLIST FETCH ERROR] HTTP error on page ${pageCount}:`, err.message);
            if (allItems.length > 0) {
                callback(allItems, pageCount);
            } else {
                fetchYouTubePlaylistViaScraper(playlistId, callback);
            }
        });
    }

    fetchPage();
}

function fetchYouTubePlaylistViaScraper(playlistId, callback) {
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const reqOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    };

    console.log(`[PLAYLIST FETCH] Playlist: ${playlistId} | Fetching full HTML page items...`);

    https.get(url, reqOptions, (res) => {
        let body = "";
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const allItems = [];
                const seenVideoIds = new Set();

                const videoBlockRegex = /"playlistVideoRenderer":\{"videoId":"([^"]+)","title":\{"runs":\[\{"text":"([^"]+)"\}\]/g;
                let match;
                while ((match = videoBlockRegex.exec(body)) !== null) {
                    const videoId = match[1];
                    const rawTitle = match[2];

                    if (videoId && !seenVideoIds.has(videoId) && rawTitle !== 'Private video' && rawTitle !== 'Deleted video') {
                        seenVideoIds.add(videoId);
                        const title = rawTitle.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

                        allItems.push({
                            id: allItems.length + 1,
                            videoId: videoId,
                            title: title,
                            artist: "Bhojpuri Vibe",
                            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                        });
                    }
                }

                if (allItems.length === 0) {
                    const idRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
                    while ((match = idRegex.exec(body)) !== null) {
                        const videoId = match[1];
                        if (videoId && !seenVideoIds.has(videoId)) {
                            seenVideoIds.add(videoId);
                            allItems.push({
                                id: allItems.length + 1,
                                videoId: videoId,
                                title: `Track ${allItems.length + 1}`,
                                artist: "Bhojpuri Vibe",
                                thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                            });
                        }
                    }
                }

                console.log(`[PLAYLIST FETCH COMPLETE] Playlist: ${playlistId} | Total: ${allItems.length} | Pages: 1 (Full HTML Scraped)`);
                callback(allItems, 1);
            } catch (err) {
                console.error(`[PLAYLIST FETCH ERROR] Scraper error for ${playlistId}:`, err.message);
                fetchYouTubePlaylistViaRSS(playlistId, callback);
            }
        });
    }).on('error', (err) => {
        console.error(`[PLAYLIST FETCH ERROR] Scraper network error for ${playlistId}:`, err.message);
        fetchYouTubePlaylistViaRSS(playlistId, callback);
    });
}

function fetchYouTubePlaylistViaRSS(playlistId, callback, redirectCount = 0) {
    if (redirectCount > 3) return callback([], 1);

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
    const reqOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/xml, text/xml, */*'
        }
    };

    https.get(feedUrl, reqOptions, (ytRes) => {
        if (ytRes.statusCode >= 300 && ytRes.statusCode < 400 && ytRes.headers.location) {
            return fetchYouTubePlaylistViaRSS(playlistId, callback, redirectCount + 1);
        }

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

                callback(items, 1);
            } catch (err) {
                callback([], 1);
            }
        });
    }).on('error', () => {
        callback([], 1);
    });
}

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
