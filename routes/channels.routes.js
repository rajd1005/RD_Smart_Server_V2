const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authenticateToken, isAdmin, isManagerOrAdmin } = require('../middlewares/auth.middleware');
const tgService = require('../services/telegram.service');

const upload = multer({ dest: 'uploads/' });

// --- 1. GET ALL CHANNELS (Filter by Access Level) ---
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { rows: channels } = await pool.query("SELECT * FROM channels ORDER BY display_order ASC");
        
        // Filter channels based on user's access level unless they are Admin/Manager
        const role = req.user.role;
        const levels = req.user.accessLevels;
        
        let visibleChannels = channels;
        if (role === 'student') {
            visibleChannels = channels.filter(ch => {
                if (ch.required_level === 'demo') return true;
                if (ch.required_level === 'level_2' && levels.level_2_status === 'Yes') return true;
                if (ch.required_level === 'level_3' && levels.level_3_status === 'Yes') return true;
                if (ch.required_level === 'level_4' && levels.level_4_status === 'Yes') return true;
                return false;
            });
        }

        // Get Unread Counts
        const { rows: reads } = await pool.query("SELECT channel_id, last_read_timestamp FROM user_channel_reads WHERE email = $1", [req.user.email]);
        const readMap = {};
        reads.forEach(r => readMap[r.channel_id] = r.last_read_timestamp);

        for (let ch of visibleChannels) {
            const lastRead = readMap[ch.id] || new Date(0);
            const { rows: unreadMsgs } = await pool.query("SELECT COUNT(*) FROM channel_messages WHERE channel_id = $1 AND created_at > $2", [ch.id, lastRead]);
            ch.unread_count = parseInt(unreadMsgs[0].count);
        }

        res.json({ success: true, data: visibleChannels });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- 2. CREATE A CHANNEL (Admin Only) ---
router.post('/', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, required_level, telegram_chat_id, display_order } = req.body;
    try {
        await pool.query(
            "INSERT INTO channels (name, description, required_level, telegram_chat_id, display_order) VALUES ($1, $2, $3, $4, $5)",
            [name, description || '', required_level || 'demo', telegram_chat_id || null, display_order || 0]
        );
        res.json({ success: true, msg: "Channel created successfully!" });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- 3. GET MESSAGES FOR A CHANNEL ---
router.get('/:id/messages', authenticateToken, async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    try {
        const { rows } = await pool.query("SELECT * FROM channel_messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2", [req.params.id, limit]);
        // Update Read Receipt
        await pool.query("INSERT INTO user_channel_reads (email, channel_id, last_read_timestamp) VALUES ($1, $2, NOW()) ON CONFLICT (email, channel_id) DO UPDATE SET last_read_timestamp = NOW()", [req.user.email, req.params.id]);
        
        res.json({ success: true, data: rows.reverse() });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- 4. POST A MESSAGE TO A CHANNEL (Manager/Admin) ---
router.post('/:id/messages', authenticateToken, isManagerOrAdmin, upload.single('media'), async (req, res) => {
    const { message_text } = req.body;
    const channelId = req.params.id;
    let mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
    let absoluteMediaPath = req.file ? req.file.path : null;

    try {
        // 1. Save to Database
        const dbRes = await pool.query(
            "INSERT INTO channel_messages (channel_id, sender_email, sender_name, message_text, media_url) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [channelId, req.user.email, req.user.role === 'admin' ? 'Admin' : 'Manager', message_text || '', mediaUrl]
        );
        const newMessage = dbRes.rows[0];

        // 2. Broadcast to Website Users via Socket.io
        req.app.get('io').emit('new_channel_message', newMessage);

        // 3. 2-Way Sync: Send to Telegram if enabled
        const syncSet = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tg_2way_sync'");
        if (syncSet.rows.length > 0 && syncSet.rows[0].setting_value === 'true') {
            const chRes = await pool.query("SELECT telegram_chat_id FROM channels WHERE id = $1", [channelId]);
            if (chRes.rows.length > 0 && chRes.rows[0].telegram_chat_id) {
                const tgMsgId = await tgService.sendChannelMessage(chRes.rows[0].telegram_chat_id, message_text, absoluteMediaPath);
                if (tgMsgId) {
                    await pool.query("UPDATE channel_messages SET telegram_msg_id = $1 WHERE id = $2", [tgMsgId, newMessage.id]);
                }
            }
        }

        res.json({ success: true, data: newMessage });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- 5. PIN / UNPIN MESSAGE ---
router.put('/messages/:msgId/pin', authenticateToken, isManagerOrAdmin, async (req, res) => {
    const { is_pinned } = req.body;
    try {
        await pool.query("UPDATE channel_messages SET is_pinned = $1 WHERE id = $2", [is_pinned, req.params.msgId]);
        req.app.get('io').emit('channel_message_updated', { id: req.params.msgId, is_pinned });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// --- 6. DELETE MESSAGE ---
router.delete('/messages/:msgId', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT media_url FROM channel_messages WHERE id = $1", [req.params.msgId]);
        if (rows.length > 0 && rows[0].media_url) {
            const filePath = path.join(__dirname, '..', rows[0].media_url.replace(/^\//, ''));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query("DELETE FROM channel_messages WHERE id = $1", [req.params.msgId]);
        req.app.get('io').emit('channel_message_deleted', { id: req.params.msgId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

module.exports = router;
