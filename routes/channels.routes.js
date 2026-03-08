const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, isManagerOrAdmin, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const pushRoutes = require('./push.routes');
const webpush = require('web-push');

// Added for Telegram integration
const { bot, toMarkdown } = require('../services/telegram.service');
const path = require('path');

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
        const { rows } = await pool.query(`
            SELECT m.*, r.title as reply_title, SUBSTRING(r.body, 1, 60) as reply_body_snippet 
            FROM channel_messages m 
            LEFT JOIN channel_messages r ON m.reply_to_id = r.id 
            WHERE m.channel_id = $1 ORDER BY m.created_at ASC
        `, [req.params.id]);
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
        const { rows } = await pool.query(`
            SELECT m.*, r.title as reply_title, SUBSTRING(r.body, 1, 60) as reply_body_snippet 
            FROM channel_messages m 
            LEFT JOIN channel_messages r ON m.reply_to_id = r.id 
            WHERE m.channel_id = $1 ORDER BY m.created_at ASC
        `, [req.params.id]);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// 3. Post a message to a channel (Manager/Admin Only) & Send Push!
router.post('/:id/messages', authenticateToken, isManagerOrAdmin, upload.single('image'), async (req, res) => {
    const { title, body, link_url, reply_to_id } = req.body;
    const channel_id = req.params.id;
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    try {
        const dbResult = await pool.query(
            "INSERT INTO channel_messages (channel_id, sender_email, title, body, image_url, link_url, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [channel_id, req.user.email, title, body, image_url, link_url, reply_to_id || null]
        );
        const msgId = dbResult.rows[0].id;

        const { rows } = await pool.query("SELECT name, access_level, telegram_chat_id FROM channels WHERE id = $1", [channel_id]);
        if (rows.length > 0) {
            const channel = rows[0];
            let target_audience = 'logged_in';
            // Send exclusively to non-logged users if it's a demo channel
            if (channel.access_level === 'demo') target_audience = 'non_logged_in'; 
            else if (channel.access_level === 'level_2_status') target_audience = 'login_with_level_2';
            else if (channel.access_level === 'level_3_status') target_audience = 'login_with_level_3';
            else if (channel.access_level === 'level_4_status') target_audience = 'login_with_level_4';
            
            const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience);
            
            // Send public users strictly to the root URL so the Channel ID doesn't get stripped by login redirects
            const targetUrl = (target_audience === 'non_logged_in') 
                ? `/?tab=channels&id=${channel_id}` 
                : `/index.html?tab=channels&id=${channel_id}`;
                
            const payload = { title: `${channel.name}: ${title}`, body, url: targetUrl, image: image_url };
            uniqueSubs.forEach(sub => { 
                try { webpush.sendNotification(sub, JSON.stringify(payload)).catch(e=>{}); } catch(e){} 
            });

            // ---> NEW: Send to Linked Telegram Channel <---
            if (channel.telegram_chat_id) {
                try {
                    let tgMsg = `*${toMarkdown(title)}*\n\n${toMarkdown(body)}`;
                    if (link_url) tgMsg += `\n\n🔗 [Link](${toMarkdown(link_url)})`;
                    
                    let opts = { parse_mode: 'Markdown' };

                    if (reply_to_id) {
                        const { rows: parentRows } = await pool.query("SELECT telegram_msg_id FROM channel_messages WHERE id = $1", [reply_to_id]);
                        if (parentRows.length > 0 && parentRows[0].telegram_msg_id) {
                            opts.reply_to_message_id = parentRows[0].telegram_msg_id;
                        }
                    }

                    let sentTgMsg;
                    if (image_url) {
                        const imgPath = path.join(__dirname, '..', 'public', image_url);
                        sentTgMsg = await bot.sendPhoto(channel.telegram_chat_id, imgPath, { ...opts, caption: tgMsg });
                    } else {
                        sentTgMsg = await bot.sendMessage(channel.telegram_chat_id, tgMsg, opts);
                    }
                    
                    await pool.query("UPDATE channel_messages SET telegram_msg_id = $1 WHERE id = $2", [sentTgMsg.message_id, msgId]);
                } catch (tgErr) { console.error("Web->TG Post Error:", tgErr.message); }
            }
        }

        req.app.get('io').emit('new_channel_msg', { channel_id });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Admin CRUD for managing the actual channels
router.post('/admin', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, access_level, show_on_home, dashboard_visibility, display_order, telegram_chat_id } = req.body;
    try {
        await pool.query(
            "INSERT INTO channels (name, description, access_level, show_on_home, dashboard_visibility, display_order, telegram_chat_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
            [name, description, access_level, show_on_home !== false, dashboard_visibility || 'all', display_order || 0, telegram_chat_id || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Edit an existing channel
router.put('/admin/:id', authenticateToken, isAdmin, async (req, res) => {
    const { name, description, access_level, show_on_home, dashboard_visibility, display_order, telegram_chat_id } = req.body;
    try {
        await pool.query(
            "UPDATE channels SET name = $1, description = $2, access_level = $3, show_on_home = $4, dashboard_visibility = $5, display_order = $6, telegram_chat_id = $7 WHERE id = $8", 
            [name, description, access_level, show_on_home !== false, dashboard_visibility || 'all', display_order || 0, telegram_chat_id || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Edit Message (Syncs to TG)
router.put('/messages/:msgId', authenticateToken, isManagerOrAdmin, async (req, res) => {
    const { title, body, link_url } = req.body;
    try {
        const { rows } = await pool.query("UPDATE channel_messages SET title = $1, body = $2, link_url = $3 WHERE id = $4 RETURNING channel_id, telegram_msg_id", [title, body, link_url, req.params.msgId]);
        
        if (rows.length > 0) {
            const msgInfo = rows[0];
            req.app.get('io').emit('channel_msg_update', { channel_id: msgInfo.channel_id });

            if (msgInfo.telegram_msg_id) {
                const { rows: chanRows } = await pool.query("SELECT telegram_chat_id FROM channels WHERE id = $1", [msgInfo.channel_id]);
                if (chanRows.length > 0 && chanRows[0].telegram_chat_id) {
                    try {
                        let tgMsg = `*${toMarkdown(title)}*\n\n${toMarkdown(body)}`;
                        if (link_url) tgMsg += `\n\n🔗 [Link](${toMarkdown(link_url)})`;
                        await bot.editMessageText(tgMsg, { chat_id: chanRows[0].telegram_chat_id, message_id: msgInfo.telegram_msg_id, parse_mode: 'Markdown' });
                    } catch(e) { console.error("Web->TG Edit Failed", e.message); }
                }
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Delete Message (Syncs to TG)
router.delete('/messages/:msgId', authenticateToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { rows: msgRows } = await pool.query("SELECT channel_id, telegram_msg_id FROM channel_messages WHERE id = $1", [req.params.msgId]);
        const { rows } = await pool.query("DELETE FROM channel_messages WHERE id = $1 RETURNING channel_id", [req.params.msgId]);
        
        if (rows.length > 0) {
            req.app.get('io').emit('channel_msg_update', { channel_id: rows[0].channel_id });
            
            if (msgRows.length > 0 && msgRows[0].telegram_msg_id) {
                const { rows: chanRows } = await pool.query("SELECT telegram_chat_id FROM channels WHERE id = $1", [msgRows[0].channel_id]);
                if (chanRows.length > 0 && chanRows[0].telegram_chat_id) {
                    try { await bot.deleteMessage(chanRows[0].telegram_chat_id, msgRows[0].telegram_msg_id); } catch(e) {}
                }
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// Pin/Unpin Message (Syncs to TG)
router.put('/messages/:msgId/pin', authenticateToken, isManagerOrAdmin, async (req, res) => {
    const { is_pinned } = req.body;
    try {
        const { rows } = await pool.query("UPDATE channel_messages SET is_pinned = $1 WHERE id = $2 RETURNING channel_id, telegram_msg_id", [is_pinned, req.params.msgId]);
        
        if (rows.length > 0) {
            const msgInfo = rows[0];
            req.app.get('io').emit('channel_msg_update', { channel_id: msgInfo.channel_id });

            if (msgInfo.telegram_msg_id) {
                const { rows: chanRows } = await pool.query("SELECT telegram_chat_id FROM channels WHERE id = $1", [msgInfo.channel_id]);
                if (chanRows.length > 0 && chanRows[0].telegram_chat_id) {
                    try { 
                        if (is_pinned) await bot.pinChatMessage(chanRows[0].telegram_chat_id, msgInfo.telegram_msg_id); 
                        else await bot.unpinChatMessage(chanRows[0].telegram_chat_id, msgInfo.telegram_msg_id);
                    } catch(e) { console.error("Web->TG Pin Failed", e.message); }
                }
            }
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});
// Delete a Channel completely (Admin Only)
router.delete('/admin/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        // Because database.js uses ON DELETE CASCADE, this will also automatically 
        // delete all messages associated with this channel in the channel_messages table.
        await pool.query("DELETE FROM channels WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ success: false, msg: err.message }); 
    }
});

module.exports = router;
