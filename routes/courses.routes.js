const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { redisClient } = require('../config/redis');
const { authenticateToken } = require('../middlewares/auth.middleware');

const JWT_SECRET = (process.env.JWT_SECRET || "super_secret_key_123").trim();

router.get('/public/courses', async (req, res) => {
    try {
        const cachedCourses = await redisClient.get('public_courses').catch(()=>null);
        if (cachedCourses) return res.json(JSON.parse(cachedCourses));

        const modulesResult = await pool.query("SELECT id, title, description, required_level, display_order, lock_notice, show_on_home, dashboard_visibility FROM learning_modules ORDER BY display_order ASC");
        const lessonsResult = await pool.query("SELECT id, module_id, title, description, display_order, thumbnail_url, hls_manifest_url FROM lesson_videos ORDER BY display_order ASC");
        
        const coursesStructure = modulesResult.rows.map(mod => { 
            const isLocked = mod.required_level !== 'demo';
            const safeLessons = lessonsResult.rows.filter(l => l.module_id === mod.id).map(l => {
                if (isLocked) {
                    const hasVideo = l.hls_manifest_url && l.hls_manifest_url.length > 5;
                    return { 
                        ...l, 
                        hls_manifest_url: hasVideo ? 'locked_video_link' : null, 
                        description: hasVideo ? '' : '🔒 This text content is protected. Please login to view.' 
                    };
                }
                return l;
            });
            return { ...mod, lessons: safeLessons }; 
        });

        await redisClient.setEx('public_courses', 600, JSON.stringify(coursesStructure)).catch(()=>{}); 
        res.json(coursesStructure);
    } catch (err) { res.status(500).json({ error: "Server Error fetching public courses." }); }
});

router.get('/public/lesson/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT lv.*, lm.required_level FROM lesson_videos lv JOIN learning_modules lm ON lv.module_id = lm.id WHERE lv.id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, msg: "Lesson not found." });
        const lesson = result.rows[0];
        if (lesson.required_level !== 'demo') { return res.status(403).json({ success: false, msg: "🔒 LOGIN REQUIRED" }); }
        res.json({ success: true, title: lesson.title, hlsUrl: lesson.hls_manifest_url });
    } catch (err) { res.status(500).json({ error: "Server Error fetching stream." }); }
});

router.get('/hls-key/:lessonId/enc.key', async (req, res) => {
    try {
        const lessonId = req.params.lessonId;
        const result = await pool.query("SELECT lm.required_level FROM lesson_videos lv JOIN learning_modules lm ON lv.module_id = lm.id WHERE lv.hls_manifest_url LIKE $1 LIMIT 1", [`%${lessonId}%`]);
        const isDemo = result.rows.length > 0 && result.rows[0].required_level === 'demo';

        if (!isDemo) {
            const token = req.cookies.authToken;
            if (!token) return res.status(401).send('Auth Required');
            jwt.verify(token, JWT_SECRET); 
        }

        const keyPath = path.join(__dirname, '../public', 'hls', lessonId, 'enc.key');
        if (fs.existsSync(keyPath)) { res.sendFile(keyPath); } else { res.status(404).send('Key not found'); }
    } catch (err) { res.status(403).send('Forbidden'); }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const modulesResult = await pool.query("SELECT * FROM learning_modules ORDER BY display_order ASC");
        const lessonsResult = await pool.query("SELECT id, module_id, title, description, display_order, thumbnail_url, hls_manifest_url FROM lesson_videos ORDER BY display_order ASC");
        
        const coursesStructure = modulesResult.rows.map(mod => { 
            const isLocked = req.user.role !== 'admin' && mod.required_level !== 'demo' && req.user.accessLevels[mod.required_level] !== 'Yes';
            const safeLessons = lessonsResult.rows.filter(l => l.module_id === mod.id).map(l => {
                if (isLocked) {
                    const hasVideo = l.hls_manifest_url && l.hls_manifest_url.length > 5;
                    return { 
                        ...l, 
                        hls_manifest_url: hasVideo ? 'locked_video_link' : null, 
                        description: hasVideo ? '' : '🔒 This text content is restricted to your access level.' 
                    };
                }
                return l;
            });
            return { ...mod, lessons: safeLessons }; 
        });
        res.json(coursesStructure);
    } catch (err) { res.status(500).json({ error: "Server Error fetching courses." }); }
});

router.get('/lesson/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT lv.*, lm.required_level FROM lesson_videos lv JOIN learning_modules lm ON lv.module_id = lm.id WHERE lv.id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, msg: "Lesson not found." });
        const lesson = result.rows[0];
        if (req.user.role !== 'admin' && lesson.required_level !== 'demo' && req.user.accessLevels[lesson.required_level] !== 'Yes') {
            return res.status(403).json({ success: false, msg: "🔒 ACCESS DENIED" });
        }
        res.json({ success: true, title: lesson.title, hlsUrl: lesson.hls_manifest_url });
    } catch (err) { res.status(500).json({ error: "Server Error fetching stream." }); }
});

router.post('/video/progress', authenticateToken, async (req, res) => {
    const { lessonId, currentTime } = req.body;
    try {
        await pool.query(
            "INSERT INTO video_progress (email, lesson_id, watched_seconds, last_watched) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email, lesson_id) DO UPDATE SET watched_seconds = GREATEST(video_progress.watched_seconds, EXCLUDED.watched_seconds), last_watched = NOW()",
            [req.user.email, lessonId, Math.floor(currentTime)]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
