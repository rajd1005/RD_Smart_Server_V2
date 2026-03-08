const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, isManagerOrAdmin, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const pushRoutes = require('./push.routes');
const webpush = require('web-push');

// --- PUBLIC ROUTES FOR HOME PAGE ---
router.get('/public', async (req, res) => {
    try {
        // Fetch ALL channels meant for the home page (we'll filter and lock non-demo ones in frontend)
        const { rows } = await pool.query("SELECT * FROM channels WHERE show_on_home = true ORDER BY display_order ASC, id ASC");
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.get('/public/:id/messages', async (req, res) => {
    try {
        // Ensure channel is actually demo
        const channelCheck = await pool.query("SELECT access_level FROM channels WHERE id = $1", [req.params.id]);
        if(channelCheck.rows.length === 0 || channelCheck.rows[0].access_level !== 'demo') {
            return res.status(403).json({ success: false, msg: "Access Denied." });
        }
        const { rows } = await pool.query("SELECT * FROM channel_messages WHERE channel_id = $1 ORDER BY created_at ASC", [req.params.id]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 1. Get channels available to the user based on access levels
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Send all channels to the dashboard. The frontend handles "accessible only/hidden/all" & lock icons
        const { rows } = await pool.query("SELECT * FROM channels ORDER BY display_order ASC, id ASC");
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 2. Get messages for a specific channel
router.get('/:id/messages', authenticateToken, async (req, res) => {
    try {
        // Access Protection
        const channelRes = await pool.query("SELECT access_level FROM channels WHERE id = $1", [req.params.id]);
        if (channelRes.rows.length > 0) {
            const level = channelRes.rows[0].access_level;
            const levels = req.user.accessLevels || {};
            if (req.user.role !== 'admin' && req.user.role !== 'manager' && level !== 'demo' && levels[level] !== 'Yes') {
                return res.status(403).json({ success: false, msg: "Access Denied. Please upgrade." });
            }
        }
        const { rows } = await pool.query("SELECT * FROM channel_messages WHERE channel_id = $1 ORDER BY created_at ASC", [req.params.id]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 3. Post a message to a channel (Manager/Admin Only) & Send Push!
router.post('/:id/messages', authenticateToken, isManagerOrAdmin, upload.single('image'), async (req, res) => {
    const { title, body, link_url } = req.body;
    const channel_id = req.params.id;
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    try {
        await pool.query(
            "INSERT INTO channel_messages (channel_id, sender_email, title, body, image_url, link_url) VALUES ($1, $2, $3, $4, $5, $6)",
            [channel_id, req.user.email, title, body, image_url, link_url]
        );

        const { rows } = await pool.query("SELECT name, access_level FROM channels WHERE id = $1", [channel_id]);
        if (rows.length > 0) {
            const channel = rows[0];
            let target_audience = 'logged_in';
            // Send exclusively to non-logged users if it's a demo channel
            if (channel.access_level === 'demo') target_audience = 'non_logged_in'; 
            else if (channel.access_level === 'level_2_status') target_audience = 'login_with_level_2';
            else if (channel.access_level === 'level_3_status') target_audience = 'login_with_level_3';
            else if (channel.access_level === 'level_4_status') target_audience = 'login_with_level_4';
            
const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience);
            
            // NEW: Send public users strictly to the root URL so the Channel ID doesn't get stripped by login redirects
            const targetUrl = (target_audience === 'non_logged_in') 
                ? `/?tab=channels&id=${channel_id}` 
                : `/index.html?tab=channels&id=${channel_id}`;
                
            const payload = { title: `${channel.name}: ${title}`, body, url: targetUrl, image: image_url };
            uniqueSubs.forEach(sub => { 
                try { webpush.sendNotification(sub, JSON.stringify(payload)).catch(e=>{}); } catch(e){} 
            });
        }

        req.app.get('io').emit('new_channel_msg', { channel_id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Admin CRUD for managing the actual channels
router.post('/admin', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, access_level, show_on_home, dashboard_visibility, display_order } = req.body;
    try {
        await pool.query(
            "INSERT INTO channels (name, description, access_level, show_on_home, dashboard_visibility, display_order) VALUES ($1, $2, $3, $4, $5, $6)", 
            [name, description, access_level, show_on_home !== false, dashboard_visibility || 'all', display_order || 0]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Edit an existing channel
router.put('/admin/:id', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, access_level, show_on_home, dashboard_visibility, display_order } = req.body;
    try {
        await pool.query(
            "UPDATE channels SET name = $1, description = $2, access_level = $3, show_on_home = $4, dashboard_visibility = $5, display_order = $6 WHERE id = $7", 
            [name, description, access_level, show_on_home !== false, dashboard_visibility || 'all', display_order || 0, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

module.exports = router;
