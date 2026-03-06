const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');
const { authenticateToken, isAdmin, isManagerOrAdmin } = require('../middlewares/auth.middleware');
const tgService = require('../services/telegram.service');
const { pushQueue } = require('../workers/push.worker'); // <-- Import the Push Notification Queue

const upload = multer({ dest: 'uploads/' });

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { rows: channels } = await pool.query("SELECT * FROM channels ORDER BY display_order ASC");
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

        const { rows: reads } = await pool.query("SELECT channel_id, last_read_timestamp FROM user_channel_reads WHERE email = $1", [req.user.email]);
        const readMap = {};
        reads.forEach(r => readMap[r.channel_id] = r.last_read_timestamp);

        for (let ch of visibleChannels) {
            const lastRead = readMap[ch.id] || new Date(0);
            const { rows: unreadMsgs } = await pool.query("SELECT COUNT(*) FROM channel_messages WHERE channel_id = $1 AND created_at > $2 AND status = 'sent'", [ch.id, lastRead]);
            ch.unread_count = parseInt(unreadMsgs[0].count);
        }

        res.json({ success: true, data: visibleChannels });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

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

// GET MESSAGES WITH REPLY TEXT JOIN
router.get('/:id/messages', authenticateToken, async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    try {
        const query = `
            SELECT c1.*, c2.message_text AS reply_text, c2.sender_name AS reply_sender 
            FROM channel_messages c1 
            LEFT JOIN channel_messages c2 ON c1.reply_to_id = c2.id 
            WHERE c1.channel_id = $1 AND c1.status = 'sent'
            ORDER BY c1.created_at DESC LIMIT $2`;
            
        const { rows } = await pool.query(query, [req.params.id, limit]);
        await pool.query("INSERT INTO user_channel_reads (email, channel_id, last_read_timestamp) VALUES ($1, $2, NOW()) ON CONFLICT (email, channel_id) DO UPDATE SET last_read_timestamp = NOW()", [req.user.email, req.params.id]);
        
        res.json({ success: true, data: rows.reverse() });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// POST A NEW MESSAGE (With Reply, Schedule, and Push Notifications)
router.post('/:id/messages', authenticateToken, isManagerOrAdmin, upload.single('media'), async (req, res) => {
    const { message_text, reply_to_id, scheduled_for, recurrence } = req.body;
    const channelId = req.params.id;
    let mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
    let absoluteMediaPath = req.file ? req.file.path : null;
    let status = scheduled_for ? 'scheduled' : 'sent';

    try {
        // Fetch Channel Details for Notification Targets
        const chRes = await pool.query("SELECT * FROM channels WHERE id = $1", [channelId]);
        if (chRes.rows.length === 0) throw new Error("Channel not found");
        const channel = chRes.rows[0];

        // Save Message
        const dbRes = await pool.query(
            "INSERT INTO channel_messages (channel_id, sender_email, sender_name, message_text, media_url, reply_to_id, scheduled_for, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *",
            [channelId, req.user.email, req.user.role === 'admin' ? 'Admin' : 'Manager', message_text || '', mediaUrl, reply_to_id || null, scheduled_for || null, status]
        );
        let newMessage = dbRes.rows[0];

        // Fetch Reply Info for Realtime broadcast
        if (reply_to_id) {
            const replyRes = await pool.query("SELECT message_text, sender_name FROM channel_messages WHERE id = $1", [reply_to_id]);
            if (replyRes.rows.length > 0) {
                newMessage.reply_text = replyRes.rows[0].message_text;
                newMessage.reply_sender = replyRes.rows[0].sender_name;
            }
        }

        if (status === 'sent') {
            // 1. Broadcast to Website via Socket
            req.app.get('io').emit('new_channel_message', newMessage);

            // 2. Telegram 2-Way Sync
            const syncSet = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tg_2way_sync'");
            if (syncSet.rows.length > 0 && syncSet.rows[0].setting_value === 'true' && channel.telegram_chat_id) {
                const tgMsgId = await tgService.sendChannelMessage(channel.telegram_chat_id, message_text, absoluteMediaPath, reply_to_id);
                if (tgMsgId) await pool.query("UPDATE channel_messages SET telegram_msg_id = $1 WHERE id = $2", [tgMsgId, newMessage.id]);
            }

            // 3. Trigger Automatic Push Notification to Users based on Channel Access
            let pushTarget = 'both';
            if (channel.required_level === 'level_2') pushTarget = 'login_with_level_2';
            else if (channel.required_level === 'level_3') pushTarget = 'login_with_level_3';
            else if (channel.required_level === 'level_4') pushTarget = 'login_with_level_4';

            const pushTitle = `New post in ${channel.name}`;
            const pushBody = message_text ? (message_text.length > 50 ? message_text.substring(0, 50) + '...' : message_text) : 'Media attachment uploaded.';
            
            await pushQueue.add('send-push', { 
                title: pushTitle, 
                body: pushBody, 
                targetAudience: pushTarget, 
                url: `${process.env.BASE_URL || ''}/home.html` 
            });
        } 
        else if (status === 'scheduled') {
            // If recurring, we inject into the standard scheduled_notifications logic via cron later
            if (recurrence && recurrence !== 'none') {
                 await pool.query("UPDATE channel_messages SET status = $1 WHERE id = $2", [recurrence, newMessage.id]);
            }
        }

        res.json({ success: true, data: newMessage });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// EDIT A MESSAGE
router.put('/messages/:msgId', authenticateToken, isManagerOrAdmin, async (req, res) => {
    const { message_text } = req.body;
    try {
        const { rows } = await pool.query(
            "UPDATE channel_messages SET message_text = $1, created_at = NOW() WHERE id = $2 RETURNING *",
            [message_text, req.params.msgId]
        );
        if (rows.length > 0) {
            rows[0].is_edited = true;
            req.app.get('io').emit('channel_message_updated', rows[0]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// PIN / UNPIN
router.put('/messages/:msgId/pin', authenticateToken, isManagerOrAdmin, async (req, res) => {
    const { is_pinned } = req.body;
    try {
        const { rows } = await pool.query("UPDATE channel_messages SET is_pinned = $1 WHERE id = $2 RETURNING channel_id, message_text", [is_pinned, req.params.msgId]);
        req.app.get('io').emit('channel_message_updated', { id: req.params.msgId, channel_id: rows[0].channel_id, is_pinned, message_text: rows[0].message_text });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// DELETE
router.delete('/messages/:msgId', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT media_url, channel_id FROM channel_messages WHERE id = $1", [req.params.msgId]);
        if (rows.length > 0 && rows[0].media_url) {
            const filePath = path.join(__dirname, '..', rows[0].media_url.replace(/^\//, ''));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query("DELETE FROM channel_messages WHERE id = $1", [req.params.msgId]);
        req.app.get('io').emit('channel_message_deleted', { id: req.params.msgId, channel_id: rows[0].channel_id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

module.exports = router;
