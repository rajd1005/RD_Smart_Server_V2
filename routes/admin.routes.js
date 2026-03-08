const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const webpush = require('web-push');
const { Queue } = require('bullmq');
const { pool } = require('../config/database');
const { redisClient, redisConnection } = require('../config/redis');
const { authenticateToken, isAdmin, isManagerOrAdmin } = require('../middlewares/auth.middleware');
const pushRoutes = require('./push.routes');

const upload = multer({ dest: 'uploads/' });
const videoQueue = new Queue('video-encoding', { connection: redisConnection });
const pushQueue = new Queue('push-notifications', { connection: redisConnection });

const hlsDir = path.join(__dirname, '../public', 'hls');
const thumbDir = path.join(__dirname, '../public', 'hls', 'thumbnails'); 
const DELETE_PASSWORD = (process.env.DELETE_PASSWORD || "admin123").trim(); 

// --- SETTINGS ---
router.put('/settings', authenticateToken, isAdmin, async (req, res) => {
    const { 
        accordion_state, hide_trade_tab, show_gallery, show_call_widget, homepage_layout,
        show_sticky_footer, sticky_btn1_text, sticky_btn1_link, sticky_btn1_icon,
        sticky_btn2_text, sticky_btn2_link, sticky_btn2_icon,
        show_disclaimer, register_link, push_trade_alerts, manager_emails,
        show_channel_tab // <--- NEW
    } = req.body;
    
    try {
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('show_channel_tab', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [show_channel_tab || 'true']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('accordion_state', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [accordion_state || 'first']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('hide_trade_tab', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [hide_trade_tab || 'false']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('show_gallery', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [show_gallery || 'true']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('show_call_widget', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [show_call_widget || 'true']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('push_trade_alerts', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [push_trade_alerts || 'true']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('show_sticky_footer', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [show_sticky_footer || 'false']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn1_text', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn1_text || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn1_link', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn1_link || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn1_icon', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn1_icon || 'chat']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn2_text', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn2_text || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn2_link', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn2_link || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('sticky_btn2_icon', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [sticky_btn2_icon || 'send']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('show_disclaimer', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [show_disclaimer || 'true']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('register_link', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [register_link || '']);
        
        // --- NEW: THIS IS THE FIX! Correctly saves manager emails to the database ---
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('manager_emails', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [manager_emails || '']);
        
        if (homepage_layout) await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('homepage_layout', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [homepage_layout]);
        
        await redisClient.del('system_settings').catch(()=>{});
        req.app.get('io').emit('settings_updated');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.put('/settings/symbols', authenticateToken, isAdmin, async (req, res) => {
    const { cat_forex_crypto, cat_stock, cat_index, cat_mcx } = req.body;
    try {
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('cat_forex_crypto', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [cat_forex_crypto || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('cat_stock', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [cat_stock || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('cat_index', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [cat_index || '']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('cat_mcx', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [cat_mcx || '']);
        
        await redisClient.del('system_settings').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.get('/video/progress', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`SELECT vp.email, vp.watched_seconds, vp.last_watched, lv.title FROM video_progress vp JOIN lesson_videos lv ON vp.lesson_id = lv.id ORDER BY vp.last_watched DESC LIMIT 100`);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- MODULES ---
router.post('/modules', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, display_order, lock_notice, show_on_home, dashboard_visibility } = req.body;
    try {
        await pool.query("INSERT INTO learning_modules (title, description, required_level, display_order, lock_notice, show_on_home, dashboard_visibility) VALUES ($1, $2, $3, $4, $5, $6, $7)", [title, description, required_level, display_order || 0, lock_notice || '', show_on_home, dashboard_visibility || 'all']);
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.put('/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, lock_notice, display_order, show_on_home, dashboard_visibility } = req.body;
    try {
        await pool.query("UPDATE learning_modules SET title = $1, description = $2, required_level = $3, lock_notice = $4, display_order = $5, show_on_home = $6, dashboard_visibility = $7 WHERE id = $8", [title, description, required_level, lock_notice || '', display_order || 0, show_on_home, dashboard_visibility || 'all', req.params.id]);
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.delete('/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    const { password } = req.body;
    if (password !== DELETE_PASSWORD) return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" });
    try { 
        const videos = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE module_id = $1", [req.params.id]);
        videos.rows.forEach(row => {
            if (row.hls_manifest_url && row.hls_manifest_url !== 'PROCESSING') {
                const parts = row.hls_manifest_url.split('/');
                if (parts.length >= 3) {
                    const folderPath = path.join(hlsDir, parts[2]);
                    if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
                }
            }
        });
        await pool.query("DELETE FROM learning_modules WHERE id = $1", [req.params.id]); 
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.post('/modules/reorder', authenticateToken, isAdmin, async (req, res) => {
    const { orderedIds } = req.body;
    try {
        if (orderedIds && Array.isArray(orderedIds)) {
            for (let i = 0; i < orderedIds.length; i++) await pool.query("UPDATE learning_modules SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
        }
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- LESSONS ---
router.post('/lessons', authenticateToken, isAdmin, upload.fields([{ name: 'video_file', maxCount: 1 }, { name: 'thumbnail_file', maxCount: 1 }]), async (req, res) => {
    const { module_id, title, description, display_order } = req.body;
    if (!req.files || !req.files['video_file']) {
        try {
            await pool.query("INSERT INTO lesson_videos (module_id, title, description, hls_manifest_url, display_order, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6)", [module_id, title, description || '', '', display_order || 0, '']);
            await redisClient.del('public_courses').catch(()=>{});
            return res.json({ success: true, msg: "Text Document Lesson Added Successfully." });
        } catch(e) { return res.status(500).json({ success: false, msg: e.message }); }
    }

    const videoFile = req.files['video_file'][0];
    let thumbUrl = '';
    
    if (req.files['thumbnail_file']) {
        const thumbFile = req.files['thumbnail_file'][0];
        const ext = path.extname(thumbFile.originalname) || '.jpg';
        const thumbName = crypto.randomUUID() + ext;
        const destPath = path.join(thumbDir, thumbName);
        fs.copyFileSync(thumbFile.path, destPath);
        fs.unlinkSync(thumbFile.path); 
        thumbUrl = '/hls/thumbnails/' + thumbName;
    } else {
        const thumbName = crypto.randomUUID() + '.jpg';
        try {
            await new Promise((resolve, reject) => { ffmpeg(videoFile.path).screenshots({ timestamps: ['00:00:01.000'], filename: thumbName, folder: thumbDir }).on('end', resolve).on('error', reject); });
            thumbUrl = '/hls/thumbnails/' + thumbName;
        } catch (err) { console.error("Auto-thumbnail failed, skipping."); }
    }

    try {
        const dbResult = await pool.query("INSERT INTO lesson_videos (module_id, title, description, hls_manifest_url, display_order, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [module_id, title, description || '', 'PROCESSING', display_order || 0, thumbUrl]);
        const newLessonId = dbResult.rows[0].id;
        await redisClient.del('public_courses').catch(()=>{});

        await videoQueue.add('encode', { lessonDbId: newLessonId, videoPath: videoFile.path, hlsDirStr: hlsDir });
        res.json({ success: true, msg: "Video Uploaded. System is now converting it in the background." });
    } catch (e) {
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        res.status(500).json({ success: false, msg: e.message });
    }
});

router.put('/lessons/:id', authenticateToken, isAdmin, upload.single('thumbnail_file'), async (req, res) => {
    const { title, description, display_order } = req.body;
    try {
        if (req.file) {
            const ext = path.extname(req.file.originalname) || '.jpg';
            const thumbName = crypto.randomUUID() + ext;
            const destPath = path.join(thumbDir, thumbName);
            fs.copyFileSync(req.file.path, destPath);
            fs.unlinkSync(req.file.path); 
            const thumbUrl = '/hls/thumbnails/' + thumbName;
            await pool.query("UPDATE lesson_videos SET title = $1, description = $2, display_order = $3, thumbnail_url = $4 WHERE id = $5", [title, description || '', display_order || 0, thumbUrl, req.params.id]);
        } else {
            await pool.query("UPDATE lesson_videos SET title = $1, description = $2, display_order = $3 WHERE id = $4", [title, description || '', display_order || 0, req.params.id]);
        }
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.delete('/lessons/:id', authenticateToken, isAdmin, async (req, res) => {
    const { password } = req.body;
    if (password !== DELETE_PASSWORD) return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" });
    try { 
        const result = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE id = $1", [req.params.id]);
        if (result.rows.length > 0 && result.rows[0].hls_manifest_url && result.rows[0].hls_manifest_url !== 'PROCESSING') {
            const parts = result.rows[0].hls_manifest_url.split('/');
            if (parts.length >= 3) {
                const folderPath = path.join(hlsDir, parts[2]);
                if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true, force: true });
            }
        }
        await pool.query("DELETE FROM lesson_videos WHERE id = $1", [req.params.id]); 
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.post('/lessons/reorder', authenticateToken, isAdmin, async (req, res) => {
    const { orderedIds } = req.body;
    try {
        if (orderedIds && Array.isArray(orderedIds)) {
            for (let i = 0; i < orderedIds.length; i++) await pool.query("UPDATE lesson_videos SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
        }
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- ADMIN NOTIFICATIONS ---
router.get('/notifications', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 15;
        const offset = parseInt(req.query.offset) || 0;
        
        // --- NEW LOGIC: Filter Admin Push History ---
        const settingRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'push_trade_alerts'");
        const pushTradeAlerts = settingRes.rows.length > 0 ? settingRes.rows[0].setting_value : 'true';

        let query = "SELECT * FROM scheduled_notifications";
        
        if (pushTradeAlerts === 'false' || pushTradeAlerts === '0') {
            query += " WHERE title NOT LIKE '✅ SETUP%' AND title NOT LIKE '⚡ %'";
        }
        
        query += " ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT $1 OFFSET $2";

        const result = await pool.query(query, [limit, offset]);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.get('/notifications/scheduled', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM scheduled_notifications WHERE status = 'pending' OR recurrence != 'none' ORDER BY created_at DESC");
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.post('/notifications', authenticateToken, isManagerOrAdmin, upload.single('push_image'), async (req, res) => {
    const { title, body, url, schedule_time, target_audience, recurrence } = req.body;
    let imagePath = req.file ? `/uploads/${req.file.filename}` : null;
    let absoluteImagePath = req.file ? req.file.path : null;

    try {
        let parsedScheduleTime = null;
        if (schedule_time && schedule_time.trim() !== '') {
            if (!schedule_time.includes('+') && !schedule_time.endsWith('Z')) {
                const istString = schedule_time.length === 16 ? schedule_time + ":00+05:30" : schedule_time + "+05:30";
                parsedScheduleTime = new Date(istString).toISOString(); 
            } else {
                parsedScheduleTime = new Date(schedule_time).toISOString();
            }
        }

        const result = await pool.query(
            "INSERT INTO scheduled_notifications (title, body, url, scheduled_for, status, target_audience, recurrence, image_path) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
            [title, body, url || '/', parsedScheduleTime || null, parsedScheduleTime ? 'pending' : 'sent', target_audience || 'both', recurrence || 'none', imagePath]
        );
        const notificationId = result.rows[0].id;

        if (!parsedScheduleTime) {
            const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience || 'both');
            const payload = { title, body, url: url || '/', image: imagePath };
            
            // 🔥 FAIL-SAFE ADDED: Try/Catch wrapper to prevent sync crash on bad subs
            uniqueSubs.forEach(sub => { 
                try {
                    webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                        if(e.statusCode === 410) pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{});
                    }); 
                } catch(pushErr) { console.error("Bad Subscription Object Skipped"); }
            });
            req.app.get('io').emit('new_notification');

            // 🔥 FAIL-SAFE ADDED: Safe file deletion 
            if (absoluteImagePath && fs.existsSync(absoluteImagePath)) {
                try {
                    fs.unlinkSync(absoluteImagePath);
                    await pool.query("UPDATE scheduled_notifications SET image_path = NULL WHERE id = $1", [notificationId]);
                } catch(fsErr) { console.error("FS Unlink Error:", fsErr.message); }
            }
        } else {
            const delay = new Date(parsedScheduleTime).getTime() - Date.now();
            await pushQueue.add('send-push', { notificationId }, { delay: Math.max(delay, 0), jobId: `push_${notificationId}_${Date.now()}` });
        }
        res.json({ success: true, msg: "Notification saved!" });
    } catch (err) { 
        console.error("Push Error:", err);
        res.status(500).json({ success: false, msg: err.message }); 
    }
});

// Replace the top line of the route:
router.put('/notifications/:id', authenticateToken, isManagerOrAdmin, upload.single('push_image'), async (req, res) => {
    const { title, body, url, schedule_time, target_audience, recurrence, silent_edit } = req.body;
    let newImagePath = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        let parsedScheduleTime = null;
        if (schedule_time && schedule_time.trim() !== '') {
            if (!schedule_time.includes('+') && !schedule_time.endsWith('Z')) {
                const istString = schedule_time.length === 16 ? schedule_time + ":00+05:30" : schedule_time + "+05:30";
                parsedScheduleTime = new Date(istString).toISOString(); 
            } else {
                parsedScheduleTime = new Date(schedule_time).toISOString();
            }
        }

        if (newImagePath) {
            const { rows } = await pool.query("SELECT image_path FROM scheduled_notifications WHERE id = $1", [req.params.id]);
            if (rows.length > 0 && rows[0].image_path) {
                const oldPath = path.join(__dirname, '..', rows[0].image_path.replace(/^\//, ''));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            await pool.query("UPDATE scheduled_notifications SET title = $1, body = $2, url = $3, scheduled_for = $4, target_audience = $5, recurrence = $6, status = $7, image_path = $8 WHERE id = $9", [title, body, url || '/', parsedScheduleTime || null, target_audience || 'both', recurrence || 'none', parsedScheduleTime ? 'pending' : 'sent', newImagePath, req.params.id]);
        } else {
            await pool.query("UPDATE scheduled_notifications SET title = $1, body = $2, url = $3, scheduled_for = $4, target_audience = $5, recurrence = $6, status = $7 WHERE id = $8", [title, body, url || '/', parsedScheduleTime || null, target_audience || 'both', recurrence || 'none', parsedScheduleTime ? 'pending' : 'sent', req.params.id]);
        }

        const jobs = await pushQueue.getDelayed();
        for (let job of jobs) if (job.data.notificationId === parseInt(req.params.id)) await job.remove();

        // Replace the else block at the end of the PUT route with this:
        if (parsedScheduleTime) {
            const delay = new Date(parsedScheduleTime).getTime() - Date.now();
            await pushQueue.add('send-push', { notificationId: parseInt(req.params.id) }, { delay: Math.max(delay, 0), jobId: `push_${req.params.id}_${Date.now()}` });
        } else {
            const { rows } = await pool.query("SELECT image_path FROM scheduled_notifications WHERE id = $1", [req.params.id]);
            const currentImagePath = rows.length > 0 ? rows[0].image_path : null;

            // Only resend the push to users if it's NOT a silent edit
            if (silent_edit !== 'true') {
                const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience || 'both');
                const payload = { title, body, url: url || '/', image: currentImagePath };
                uniqueSubs.forEach(sub => { 
                    try { webpush.sendNotification(sub, JSON.stringify(payload)).catch(e=>{}); } catch(e){} 
                });
                
                // Clear the image path after physical send, as per original logic
                if (currentImagePath) {
                    const filePath = path.join(__dirname, '..', currentImagePath.replace(/^\//, ''));
                    try {
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        await pool.query("UPDATE scheduled_notifications SET image_path = NULL WHERE id = $1", [req.params.id]);
                    } catch(e) {}
                }
            }
            
            // This emits to socket.io instantly updating the UI for everyone without a reload
            req.app.get('io').emit('new_notification');
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.delete('/notifications/:id', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT image_path FROM scheduled_notifications WHERE id = $1", [req.params.id]);
        if (rows.length > 0 && rows[0].image_path) {
            const filePath = path.join(__dirname, '..', rows[0].image_path.replace(/^\//, ''));
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){}
        }

        await pool.query("DELETE FROM scheduled_notifications WHERE id = $1", [req.params.id]);
        const jobs = await pushQueue.getDelayed();
        for (let job of jobs) if (job.data.notificationId === parseInt(req.params.id)) await job.remove();

        // --- NEW: Emit to everyone that a notification was deleted ---
        req.app.get('io').emit('new_notification');

        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- NEW: QUICK TEMPLATES ROUTES ---
router.get('/push-templates', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        // We save templates per user email so each manager gets their own list
        const result = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = $1", [`templates_${req.user.email}`]);
        let templates = [];
        if (result.rows.length > 0) {
            templates = JSON.parse(result.rows[0].setting_value);
        }
        res.json({ success: true, templates });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

router.post('/push-templates', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { templates } = req.body;
        await pool.query(
            "INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", 
            [`templates_${req.user.email}`, JSON.stringify(templates)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

module.exports = router;
