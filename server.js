const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const webpush = require('web-push');
const mysql = require('mysql2/promise');
const { Queue } = require('bullmq');

require('dotenv').config();

// === IMPORT CONFIGURATIONS ===
const { pool, initDb } = require('./config/database');
const { redisClient, redisConnection } = require('./config/redis');

// === INITIALIZE EXPRESS APP ===
const app = express();
app.set('trust proxy', true); 
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// === DIRECTORY SETUP ===
const uploadDir = path.join(__dirname, 'uploads');
const hlsDir = path.join(__dirname, 'public', 'hls');
const thumbDir = path.join(__dirname, 'public', 'hls', 'thumbnails'); 

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(hlsDir)) fs.mkdirSync(hlsDir, { recursive: true });
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

const JWT_SECRET = (process.env.JWT_SECRET || "super_secret_key_123").trim();

// === VIEW PROTECTION MIDDLEWARE ===
app.use(async (req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        const token = req.cookies.authToken;
        if (!token) return res.redirect('/home.html');
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
            if (rows.length > 0 && rows[0].session_id !== decoded.sessionId) { 
                res.clearCookie('authToken', { path: '/' }); 
                return res.redirect('/home.html'); 
            }
            next(); 
        } catch (err) { 
            res.clearCookie('authToken', { path: '/' }); 
            return res.redirect('/home.html'); 
        }
    } 
    else if (req.path === '/home.html') {
        const token = req.cookies.authToken;
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
                if (rows.length > 0 && rows[0].session_id === decoded.sessionId) return res.redirect('/');
            } catch(err) {}
        }
        next();
    } else { next(); }
});

// === STATIC FILES ===
app.use(express.static(path.join(__dirname, 'public'))); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === SERVER & SOCKET IO SETUP ===
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });
app.set('io', io); // Attach io so route files can access it via req.app.get('io')

// === QUEUES & BACKGROUND WORKERS ===
const pushQueue = new Queue('push-notifications', { connection: redisConnection });
require('./workers/video.worker'); // Starts listening to video encoding jobs
const initPushWorker = require('./workers/push.worker');
initPushWorker(io, pushQueue); // Starts listening to scheduled push jobs

// === GALLERY DB CONNECTION ===
const galleryPool = mysql.createPool({
    host: process.env.GALLERY_DB_HOST,
    user: process.env.GALLERY_DB_USER,
    password: process.env.GALLERY_DB_PASSWORD,
    database: process.env.GALLERY_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// === IMPORT MODULAR ROUTES ===
const authRoutes = require('./routes/auth.routes');
const tradeRoutes = require('./routes/trades.routes');
const courseRoutes = require('./routes/courses.routes');
const adminRoutes = require('./routes/admin.routes');
const pushRoutes = require('./routes/push.routes');
const channelsRoutes = require('./routes/channels.routes');
const { authenticateToken } = require('./middlewares/auth.middleware');

// === MOUNT MODULAR ROUTES ===
app.use('/api', authRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api', courseRoutes); // Map for public courses backward compatibility
app.use('/api/admin', adminRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/channels', channelsRoutes);

// === REMAINING PUBLIC / EXTERNAL INTEGRATION APIs ===
app.get('/api/public/call-report', async (req, res) => {
    const { start, end } = req.query;
    try {
        const settingRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'show_call_widget'");
        const showWidget = settingRes.rows.length > 0 ? settingRes.rows[0].setting_value : 'true';
        if (showWidget !== 'true') return res.json({ success: true, show_widget: false, data: [] });

        const url = `https://crm.rdalgo.in/wp-admin/admin-ajax.php?action=get_call_data&token=secure123&start=${start}&end=${end}`;
        const response = await fetch(url);
        const data = await response.json();
        res.json({ success: true, show_widget: true, data: data.data || [] });
    } catch (err) {
        console.error("Call Report Proxy Error:", err);
        res.status(500).json({ success: false, msg: "Failed to fetch call report." });
    }
});

app.get('/api/public/gallery', async (req, res) => {
    try {
        const settingRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'show_gallery'");
        const showGallery = settingRes.rows.length > 0 ? settingRes.rows[0].setting_value : 'true';
        if (showGallery !== 'true') return res.json({ success: true, show_gallery: false, images: [] });

        const [rows] = await galleryPool.query(`SELECT id, image_url, trade_date, name FROM wp_central_image_gallery WHERE trade_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) ORDER BY trade_date DESC, id DESC LIMIT 50`);
        res.json({ success: true, show_gallery: true, images: rows });
    } catch (err) { res.status(500).json({ success: false, msg: "Failed to fetch gallery images." }); }
});

app.get('/api/settings', async (req, res) => {
    try {
        const cachedSettings = await redisClient.get('system_settings').catch(()=>null);
        if (cachedSettings) return res.json(JSON.parse(cachedSettings));

        const result = await pool.query("SELECT * FROM system_settings");
        const settings = {};
        result.rows.forEach(r => settings[r.setting_key] = r.setting_value);

        await redisClient.setEx('system_settings', 3600, JSON.stringify(settings)).catch(()=>{}); 
        res.json(settings);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/api/user/notifications', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 15;
        const offset = parseInt(req.query.offset) || 0;
        
        let allowedAudiences = ['both', 'logged_in'];
        
        if (req.user && req.user.accessLevels) {
            const levels = req.user.accessLevels;
            if (levels.level_2_status === 'Yes') allowedAudiences.push('login_with_level_2');
            else allowedAudiences.push('login_no_level_2');
            
            if (levels.level_3_status === 'Yes') allowedAudiences.push('login_with_level_3');
            else allowedAudiences.push('login_no_level_3');
            
            if (levels.level_4_status === 'Yes') allowedAudiences.push('login_with_level_4');
            else allowedAudiences.push('login_no_level_4');
        }

        const result = await pool.query(
            "SELECT * FROM scheduled_notifications WHERE status = 'sent' AND target_audience = ANY($1) ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT $2 OFFSET $3", 
            [allowedAudiences, limit, offset]
        );
        
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// === MINUTE-BY-MINUTE SCHEDULER (Channels) ===
cron.schedule('* * * * *', async () => {
    try {
        const { rows: pendingChanMsgs } = await pool.query("SELECT * FROM channel_messages WHERE (status = 'scheduled' OR status IN ('daily', 'weekly')) AND scheduled_for <= NOW()");
        
        for (const msg of pendingChanMsgs) {
            // Mark as sent
            await pool.query("UPDATE channel_messages SET status = 'sent', created_at = NOW() WHERE id = $1", [msg.id]);
            
            // Broadcast live to connected users
            io.emit('new_channel_message', msg);
            
            // Fetch channel to trigger telegram sync & push notification
            const chRes = await pool.query("SELECT * FROM channels WHERE id = $1", [msg.channel_id]);
            if (chRes.rows.length > 0) {
                const channel = chRes.rows[0];
                const syncSet = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tg_2way_sync'");
                
                if (syncSet.rows.length > 0 && syncSet.rows[0].setting_value === 'true' && channel.telegram_chat_id) {
                    const tgService = require('./services/telegram.service');
                    let absPath = msg.media_url ? path.join(__dirname, msg.media_url) : null;
                    const tgMsgId = await tgService.sendChannelMessage(channel.telegram_chat_id, msg.message_text, absPath, msg.reply_to_id);
                    if (tgMsgId) await pool.query("UPDATE channel_messages SET telegram_msg_id = $1 WHERE id = $2", [tgMsgId, msg.id]);
                }

                // Send Push Notification
                const { pushQueue } = require('./workers/push.worker');
                let pushTarget = 'both';
                if (channel.required_level === 'level_2') pushTarget = 'login_with_level_2';
                else if (channel.required_level === 'level_3') pushTarget = 'login_with_level_3';
                else if (channel.required_level === 'level_4') pushTarget = 'login_with_level_4';

                const pushTitle = `New post in ${channel.name}`;
                const pushBody = msg.message_text ? (msg.message_text.length > 50 ? msg.message_text.substring(0, 50) + '...' : msg.message_text) : 'Media attachment uploaded.';
                await pushQueue.add('send-push', { title: pushTitle, body: pushBody, targetAudience: pushTarget, url: `/home.html` });
            }

            // Handle Recurring (Reschedule for tomorrow/next week)
            if (msg.status === 'daily' || msg.status === 'weekly') {
                const interval = msg.status === 'daily' ? "INTERVAL '1 day'" : "INTERVAL '1 week'";
                await pool.query(`INSERT INTO channel_messages (channel_id, sender_email, sender_name, message_text, media_url, reply_to_id, scheduled_for, status) 
                                  VALUES ($1, $2, $3, $4, $5, $6, NOW() + ${interval}, $7)`, 
                                  [msg.channel_id, msg.sender_email, msg.sender_name, msg.message_text, msg.media_url, msg.reply_to_id, msg.status]);
            }
        }
    } catch (err) {
        console.error("Scheduler Error:", err);
    }
});

// === DAILY AUTOMATED LOGOUT, NOTIFICATION & CHANNELS CLEANUP ===
cron.schedule('30 6 * * *', async () => {
    try {
        await pool.query("DELETE FROM login_logs");
        await pool.query("DELETE FROM scheduled_notifications WHERE created_at < NOW() - INTERVAL '30 days' AND (recurrence = 'none' OR recurrence IS NULL) AND status = 'sent'");
        
        // --- NEW: 7-DAY CHANNELS CLEANUP ---
        const deletedChannels = await pool.query("DELETE FROM channel_messages WHERE created_at < NOW() - INTERVAL '7 days'");
        
        console.log(`✅ Daily Reset (6:30 AM): Sessions cleared, old notifications deleted, and ${deletedChannels.rowCount} old channel messages removed.`);
    } catch (err) {
        console.error("❌ Error clearing daily sessions/notifications/channels:", err);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// === SERVER INITIALIZATION & VAPID SETUP ===
const PORT = process.env.PORT || 3000;

initDb().then(async () => { 
    let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

    try {
        if (!vapidPublicKey || !vapidPrivateKey) {
            const pubRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'vapid_public'");
            const privRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'vapid_private'");
            
            if (pubRes.rows.length > 0 && privRes.rows.length > 0) {
                vapidPublicKey = pubRes.rows[0].setting_value;
                vapidPrivateKey = privRes.rows[0].setting_value;
            } else {
                console.log("⚠️ No VAPID keys found in env or DB. Generating new ones automatically...");
                const vapidKeys = webpush.generateVAPIDKeys();
                vapidPublicKey = vapidKeys.publicKey;
                vapidPrivateKey = vapidKeys.privateKey;
                
                await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('vapid_public', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [vapidPublicKey]);
                await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('vapid_private', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [vapidPrivateKey]);
                console.log("✅ New VAPID keys generated and saved to PostgreSQL.");
            }
        }

        webpush.setVapidDetails(
            'mailto:' + (process.env.ADMIN_EMAIL || 'admin@rdalgo.in'),
            vapidPublicKey.trim(),
            vapidPrivateKey.trim()
        );
        
        app.locals.vapidPublicKey = vapidPublicKey.trim();
        console.log("✅ Web Push VAPID configured successfully.");

    } catch (e) {
        console.error("❌ Failed to setup VAPID keys:", e.message);
    }

    server.listen(PORT, () => console.log(`🚀 RD Broker Server running on ${PORT}`)); 
});
