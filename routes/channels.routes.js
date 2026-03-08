const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, isManagerOrAdmin, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const pushRoutes = require('./push.routes');
const webpush = require('web-push');

// 1. Get channels available to the user based on access levels
router.get('/', authenticateToken, async (req, res) => {
    try {
        let levels = req.user.accessLevels || {};
        let allowedLevels = ['demo', 'level_1_status'];
        if (levels.level_2_status === 'Yes') allowedLevels.push('level_2_status');
        if (levels.level_3_status === 'Yes') allowedLevels.push('level_3_status');
        if (levels.level_4_status === 'Yes') allowedLevels.push('level_4_status');
        
        if (req.user.role === 'admin' || req.user.role === 'manager') {
            const { rows } = await pool.query("SELECT * FROM channels ORDER BY id ASC");
            return res.json({ success: true, data: rows });
        }

        const { rows } = await pool.query("SELECT * FROM channels WHERE access_level = ANY($1) ORDER BY id ASC", [allowedLevels]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 2. Get messages for a specific channel
router.get('/:id/messages', authenticateToken, async (req, res) => {
    try {
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
            if (channel.access_level === 'level_2_status') target_audience = 'login_with_level_2';
            else if (channel.access_level === 'level_3_status') target_audience = 'login_with_level_3';
            else if (channel.access_level === 'level_4_status') target_audience = 'login_with_level_4';
            
            const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience);
            const payload = { title: `${channel.name}: ${title}`, body, url: `/index.html?tab=channels&id=${channel_id}`, image: image_url };
            uniqueSubs.forEach(sub => { 
                try { webpush.sendNotification(sub, JSON.stringify(payload)).catch(e=>{}); } catch(e){} 
            });
        }

        req.app.get('io').emit('new_channel_msg', { channel_id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 4. Admin CRUD for managing the actual channels
router.post('/admin', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, access_level } = req.body;
    try {
        await pool.query("INSERT INTO channels (name, description, access_level) VALUES ($1, $2, $3)", [name, description, access_level]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

router.delete('/admin/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM channels WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

module.exports = router;
