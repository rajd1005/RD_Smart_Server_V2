const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto'); 
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
const cron = require('node-cron');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath); 

// --- ADVANCED FEATURE IMPORTS ---
const { createClient } = require('redis');
const { Queue, Worker } = require('bullmq');
const webpush = require('web-push');
// ------------------------------------

const { pool, initDb } = require('./database');
const authPool = require('./authDb'); 
require('dotenv').config();

// --- REDIS SETUP ---
const redisClient = createClient({ 
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});
redisClient.on('error', (err) => console.log('Redis Client Error', err.message));
redisClient.connect().then(() => console.log('✅ Connected to Redis')).catch(console.error);

// --- BULLMQ QUEUE SETUP ---
const redisConnection = { 
    host: process.env.REDISHOST || process.env.REDIS_HOST || '127.0.0.1', 
    port: parseInt(process.env.REDISPORT || process.env.REDIS_PORT || '6379'),
    password: process.env.REDISPASSWORD || process.env.REDIS_PASSWORD || undefined
};
const videoQueue = new Queue('video-encoding', { connection: redisConnection });

// --- PUSH NOTIFICATION QUEUE ---
const pushQueue = new Queue('push-notifications', { connection: redisConnection });

// === INITIALIZE EXPRESS APP FIRST ===
const app = express();

app.set('trust proxy', true); 
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const uploadDir = path.join(__dirname, 'uploads');
const hlsDir = path.join(__dirname, 'public', 'hls');
const thumbDir = path.join(__dirname, 'public', 'hls', 'thumbnails'); 

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(hlsDir)) fs.mkdirSync(hlsDir, { recursive: true });
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

const upload = multer({ dest: 'uploads/' });

const DELETE_PASSWORD = (process.env.DELETE_PASSWORD || "admin123").trim(); 
const JWT_SECRET = (process.env.JWT_SECRET || "super_secret_key_123").trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@rdalgo.in").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin123").trim();
const DEMO_USERS = [
    { email: (process.env.DEMO_EMAIL || "demo@rdalgo.in").trim(), password: (process.env.DEMO_PASSWORD || "demo123").trim() },
    { email: "demo2@rdalgo.in", password: "demo123" },
    { email: "demo3@rdalgo.in", password: "demo123" },
    { email: "demo4@rdalgo.in", password: "demo123" },
    { email: "demo5@rdalgo.in", password: "demo123" },
    { email: "demo6@rdalgo.in", password: "demo123" }
];

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', 
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const galleryPool = mysql.createPool({
    host: process.env.GALLERY_DB_HOST,
    user: process.env.GALLERY_DB_USER,
    password: process.env.GALLERY_DB_PASSWORD,
    database: process.env.GALLERY_DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

function getClientIp(req) {
    let ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '';
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0]; 
    return ip.trim().replace('::ffff:', '');
}

const authenticateToken = async (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) return res.status(401).json({ success: false, msg: "Not authenticated" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
        if (rows.length > 0 && rows[0].session_id !== decoded.sessionId) { 
            res.clearCookie('authToken', { path: '/' }); 
            return res.status(403).json({ success: false, msg: "Logged in from another device. Session expired." }); 
        }
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('authToken', { path: '/' });
        return res.status(403).json({ success: false, msg: "Session expired" });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') { return res.status(403).json({ success: false, msg: "Admin access required." }); }
    next();
};

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

app.use(express.static(path.join(__dirname, 'public'))); 

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.TG_CHAT_ID;

function getISTTime() { return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }); }
function getDBTime() { return new Date().toISOString(); }
function calculatePoints(type, entry, currentPrice) { if (!entry || !currentPrice) return 0; return (type === 'BUY') ? (currentPrice - entry) : (entry - currentPrice); }
function toMarkdown(text) { if (text === undefined || text === null) return ""; return String(text).replace(/_/g, "\\_").replace(/\*/g, "\\*").replace(/\[/g, "\\[").replace(/`/g, "\\`"); }

async function sendPushNotification(payload) {
    try {
        const subs = await pool.query("SELECT sub_data FROM push_subscriptions");
        const uniqueSubs = [];
        const endpoints = new Set();
        
        for (let row of subs.rows) {
            if (!endpoints.has(row.sub_data.endpoint)) {
                endpoints.add(row.sub_data.endpoint);
                uniqueSubs.push(row.sub_data);
            }
        }
        
        uniqueSubs.forEach(sub => {
            webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                if (e.statusCode === 410) { pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{}); }
            });
        });
    } catch (err) { console.error("Error fetching subscriptions", err); }
}

// Check if Trade Pushes are enabled in DB
async function checkTradePushEnabled() {
    try {
        const cachedSettings = await redisClient.get('system_settings').catch(()=>null);
        if (cachedSettings) {
            const settings = JSON.parse(cachedSettings);
            if (settings.push_trade_alerts === 'false') return false;
            return true;
        }
        const res = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'push_trade_alerts'");
        if (res.rows.length > 0 && res.rows[0].setting_value === 'false') return false;
        return true;
    } catch(e) { return true; }
}

app.get('/api/push/public_key', (req, res) => {
    if (app.locals.vapidPublicKey) {
        res.json({ success: true, publicKey: app.locals.vapidPublicKey });
    } else {
        res.status(500).json({ success: false, msg: "VAPID key not initialized." });
    }
});

app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
    const subscription = req.body;
    const endpoint = subscription.endpoint;
    try {
        const existing = await pool.query("SELECT id FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [endpoint]);
        if (existing.rows.length === 0) {
            await pool.query("INSERT INTO push_subscriptions (email, sub_data) VALUES ($1, $2)", [req.user.email, subscription]);
        } else {
            await pool.query("UPDATE push_subscriptions SET email = $1, sub_data = $2 WHERE id = $3", [req.user.email, subscription, existing.rows[0].id]);
        }
        res.status(201).json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

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

app.put('/api/admin/settings', authenticateToken, isAdmin, async (req, res) => {
    const { 
        accordion_state, hide_trade_tab, show_gallery, show_call_widget, homepage_layout,
        show_sticky_footer, sticky_btn1_text, sticky_btn1_link, sticky_btn1_icon,
        sticky_btn2_text, sticky_btn2_link, sticky_btn2_icon,
        show_disclaimer, register_link, push_trade_alerts
    } = req.body;
    try {
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

        if (homepage_layout) {
            await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('homepage_layout', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [homepage_layout]);
        }
        
        await redisClient.del('system_settings').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.put('/api/admin/settings/symbols', authenticateToken, isAdmin, async (req, res) => {
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

app.get('/api/public/courses', async (req, res) => {
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

app.get('/api/public/lesson/:id', async (req, res) => {
    try {
        const result = await pool.query("SELECT lv.*, lm.required_level FROM lesson_videos lv JOIN learning_modules lm ON lv.module_id = lm.id WHERE lv.id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, msg: "Lesson not found." });
        const lesson = result.rows[0];
        if (lesson.required_level !== 'demo') { return res.status(403).json({ success: false, msg: "🔒 LOGIN REQUIRED" }); }
        res.json({ success: true, title: lesson.title, hlsUrl: lesson.hls_manifest_url });
    } catch (err) { res.status(500).json({ error: "Server Error fetching stream." }); }
});

app.post('/api/login', async (req, res) => {
    const { password, rememberMe } = req.body;
    const email = req.body.email.trim();
    const clientIp = getClientIp(req);
    
    try {
        let userEmail = ""; let userRole = "student"; let userPhone = "";
        let accessLevels = { level_1_status: 'No', level_2_status: 'No', level_3_status: 'No', level_4_status: 'No' };
        let studentRecord = null;

        const matchedDemo = DEMO_USERS.find(user => user.email === email && user.password === password);

        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            userEmail = ADMIN_EMAIL; userRole = "admin"; userPhone = "Admin";
            accessLevels = { level_1_status: 'Yes', level_2_status: 'Yes', level_3_status: 'Yes', level_4_status: 'Yes' };
            
        } else if (matchedDemo) {
            userEmail = matchedDemo.email; 
            userRole = "student"; 
            userPhone = "Demo Account";
            accessLevels = { level_1_status: 'Yes', level_2_status: 'Yes', level_3_status: 'Yes', level_4_status: 'Yes' };
            
        } else {
            const localCreds = await pool.query("SELECT * FROM user_credentials WHERE email = $1", [email]);
            if (localCreds.rows.length > 0) {
                const { salt, hash } = localCreds.rows[0];
                const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
                if (verifyHash !== hash) return res.status(401).json({ success: false, msg: "Invalid Email or Password" });
                const [rows] = await authPool.query("SELECT student_email, student_phone, student_expiry_date, level_2_status, level_3_status, level_4_status FROM wp_gf_student_registrations WHERE student_email = ?", [email]);
                if (rows.length === 0) return res.status(401).json({ success: false, msg: "Account not found in registry." });
                studentRecord = rows[0];
            } else {
                const [rows] = await authPool.query("SELECT student_email, student_phone, student_expiry_date, level_2_status, level_3_status, level_4_status FROM wp_gf_student_registrations WHERE student_email = ? AND student_phone = ?", [email, password]);
                if (rows.length === 0) return res.status(401).json({ success: false, msg: "Invalid Email or Password" });
                const setupToken = jwt.sign({ email: rows[0].student_email, phone: rows[0].student_phone }, JWT_SECRET, { expiresIn: '15m' });
                return res.json({ success: true, requires_setup: true, setupToken: setupToken, msg: "First login detected. Please create a secure password." });
            }
            const expiryDate = new Date(studentRecord.student_expiry_date);
            if (expiryDate < new Date()) { return res.status(403).json({ success: false, msg: "Account Expired. Please contact admin." }); }
            userEmail = studentRecord.student_email; userPhone = studentRecord.student_phone; 
            accessLevels = { level_1_status: 'Yes', level_2_status: studentRecord.level_2_status || 'No', level_3_status: studentRecord.level_3_status || 'No', level_4_status: studentRecord.level_4_status || 'No' };
        }

        const sessionId = crypto.randomUUID();
        await pool.query("INSERT INTO login_logs (email, session_id, ip_address) VALUES ($1, $2, $3)", [userEmail, sessionId, clientIp]);
        await pool.query("DELETE FROM login_logs WHERE login_time < NOW() - INTERVAL '30 days'");

        const token = jwt.sign({ email: userEmail, phone: userPhone, sessionId: sessionId, role: userRole, accessLevels: accessLevels }, JWT_SECRET, { expiresIn: rememberMe ? '30d' : '1d' });
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('authToken', token, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 });
        
        io.emit('force_logout', { email: userEmail, newSessionId: sessionId });
        res.json({ success: true, msg: "Login successful", email: userEmail, phone: userPhone, role: userRole, accessLevels: accessLevels, sessionId: sessionId });
    } catch (error) { res.status(500).json({ success: false, msg: "Database connection error" }); }
});

app.post('/api/set_password', async (req, res) => {
    const { setupToken, newPassword } = req.body;
    try {
        const decoded = jwt.verify(setupToken, JWT_SECRET);
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
        await pool.query("INSERT INTO user_credentials (email, salt, hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash", [decoded.email, salt, hash]);
        res.json({ success: true, email: decoded.email }); 
    } catch (err) { res.status(401).json({ success: false, msg: "Setup session expired. Please log in again." }); }
});

app.post('/api/forgot_password', async (req, res) => {
    const { email } = req.body;
    try {
        const isDemoEmail = DEMO_USERS.some(user => user.email === email);
        if (email === ADMIN_EMAIL || isDemoEmail) return res.status(400).json({ success: false, msg: "This account password cannot be reset here." });
        const [rows] = await authPool.query("SELECT student_email FROM wp_gf_student_registrations WHERE student_email = ?", [email]);
        if (rows.length === 0) return res.status(404).json({ success: false, msg: "Email not found in registry." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        await pool.query("INSERT INTO password_resets (email, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL '15 minutes') ON CONFLICT (email) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at", [email, otp]);

        const mailOptions = {
            from: `"RD Algo Security" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Password Reset OTP - RD Algo`,
            html: `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #0056b3;">Password Reset</h2>
                    <p>You requested to reset your password. Use the OTP below to set a new password. This code is valid for 15 minutes.</p>
                    <div style="font-size: 24px; font-weight: bold; background: #f8f9fa; padding: 15px; text-align: center; letter-spacing: 5px; color: #000; border-radius: 8px;">${otp}</div>
                   </div>`
        };
        transporter.sendMail(mailOptions).catch(e => console.error(e));
        res.json({ success: true, msg: "OTP sent to your email." });
    } catch (err) { res.status(500).json({ success: false, msg: "Server error generating OTP." }); }
});

app.post('/api/reset_password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        const result = await pool.query("SELECT * FROM password_resets WHERE email = $1 AND otp = $2 AND expires_at > NOW()", [email, otp]);
        if (result.rows.length === 0) return res.status(400).json({ success: false, msg: "Invalid or expired OTP." });

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
        await pool.query("INSERT INTO user_credentials (email, salt, hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash", [email, salt, hash]);
        await pool.query("DELETE FROM password_resets WHERE email = $1", [email]); 
        res.json({ success: true, msg: "Password changed successfully. You can now login." });
    } catch (err) { res.status(500).json({ success: false, msg: "Server error resetting password." }); }
});

app.post('/api/logout', (req, res) => { res.clearCookie('authToken', { path: '/' }); res.json({ success: true }); });

app.post('/api/accept_terms', authenticateToken, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const clientIp = getClientIp(req);
        const istTime = getISTTime();

        const mailOptions = {
            from: `"RD Algo Compliance" <${process.env.SMTP_USER}>`,
            to: userEmail,
            cc: ADMIN_EMAIL, 
            subject: `Legal Disclaimer Accepted - ${userEmail}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <h2 style="color: #0056b3; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">Official Agreement Record</h2>
                    <p>Dear User,</p>
                    <p>This email serves as a digital signature and official record that you have explicitly read, understood, and agreed to the RD Algo Mandatory Legal Disclaimer to access the platform.</p>
                    
                    <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 8px; border: 1px solid #ffeeba; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #856404;">⚠️ CRITICAL WARNING: NO REAL MONEY TRADING</h4>
                        <p style="margin-bottom: 0;">Do not trade with real money. All indicators, strategies, and signals provided by RD Algo are strictly for paper trading, educational evaluation, and forward-testing only. You are strictly advised to practice on virtual/paper trading platforms.</p>
                    </div>

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #ddd;">
                        <h4 style="margin-top: 0;">Agreed Terms & Conditions:</h4>
                        <ul style="padding-left: 20px; font-size: 13px; color: #555;">
                            <li style="margin-bottom: 8px;"><strong>Educational Purposes Only:</strong> All content, indicators, signals, and strategies provided by RD Algo are strictly for educational and informational purposes. They do not constitute financial, investment, or trading advice.</li>
                            <li style="margin-bottom: 8px;"><strong>No SEBI Registration:</strong> RD Algo, its founders, and its team members are <strong>NOT registered with SEBI</strong> (Securities and Exchange Board of India) as financial advisors or research analysts.</li>
                            <li style="margin-bottom: 8px;"><strong>High Risk Warning:</strong> Trading in financial markets involves a high degree of risk. You may lose some or all of your initial capital.</li>
                            <li style="margin-bottom: 8px;"><strong>Your Sole Responsibility:</strong> You are 100% responsible for your own trading decisions. RD Algo will not be held liable for any financial losses, damages, or consequences resulting from the use of our platform.</li>
                            <li style="margin-bottom: 0;"><strong>Past Performance:</strong> Past performance, whether actual or indicated by historical backtests, is no guarantee of future results.</li>
                        </ul>
                    </div>

                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007aff;">
                        <h4 style="margin-top: 0; color: #0056b3;">Digital Footprint & Signature:</h4>
                        <ul style="list-style: none; padding: 0; margin: 0; font-size: 14px;">
                            <li style="margin-bottom: 5px;"><strong>User Account:</strong> ${userEmail}</li>
                            <li style="margin-bottom: 5px;"><strong>Date & Time (IST):</strong> ${istTime}</li>
                            <li style="margin-bottom: 0;"><strong>IP Address:</strong> ${clientIp}</li>
                        </ul>
                    </div>
                    
                    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 30px;">This is an automated legal compliance email generated by the RD Algo System.</p>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        res.json({ success: true });
    } catch (err) { 
        console.error("Mail Error:", err);
        res.json({ success: true, msg: "Agreement recorded locally, but email failed to send." }); 
    }
});

app.get('/api/hls-key/:lessonId/enc.key', async (req, res) => {
    try {
        const lessonId = req.params.lessonId;
        const result = await pool.query("SELECT lm.required_level FROM lesson_videos lv JOIN learning_modules lm ON lv.module_id = lm.id WHERE lv.hls_manifest_url LIKE $1 LIMIT 1", [`%${lessonId}%`]);
        const isDemo = result.rows.length > 0 && result.rows[0].required_level === 'demo';

        if (!isDemo) {
            const token = req.cookies.authToken;
            if (!token) return res.status(401).send('Auth Required');
            jwt.verify(token, JWT_SECRET); 
        }

        const keyPath = path.join(__dirname, 'public', 'hls', lessonId, 'enc.key');
        if (fs.existsSync(keyPath)) { res.sendFile(keyPath); } else { res.status(404).send('Key not found'); }
    } catch (err) { res.status(403).send('Forbidden'); }
});

app.get('/api/courses', authenticateToken, async (req, res) => {
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

app.get('/api/lesson/:id', authenticateToken, async (req, res) => {
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

app.post('/api/video/progress', authenticateToken, async (req, res) => {
    const { lessonId, currentTime } = req.body;
    try {
        await pool.query(
            "INSERT INTO video_progress (email, lesson_id, watched_seconds, last_watched) VALUES ($1, $2, $3, NOW()) ON CONFLICT (email, lesson_id) DO UPDATE SET watched_seconds = GREATEST(video_progress.watched_seconds, EXCLUDED.watched_seconds), last_watched = NOW()",
            [req.user.email, lessonId, Math.floor(currentTime)]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/video/progress', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT vp.email, vp.watched_seconds, vp.last_watched, lv.title 
            FROM video_progress vp 
            JOIN lesson_videos lv ON vp.lesson_id = lv.id 
            ORDER BY vp.last_watched DESC LIMIT 100
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/modules', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, display_order, lock_notice, show_on_home, dashboard_visibility } = req.body;
    try {
        await pool.query(
            "INSERT INTO learning_modules (title, description, required_level, display_order, lock_notice, show_on_home, dashboard_visibility) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
            [title, description, required_level, display_order || 0, lock_notice || '', show_on_home, dashboard_visibility || 'all']
        );
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.put('/api/admin/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, lock_notice, display_order, show_on_home, dashboard_visibility } = req.body;
    try {
        await pool.query(
            "UPDATE learning_modules SET title = $1, description = $2, required_level = $3, lock_notice = $4, display_order = $5, show_on_home = $6, dashboard_visibility = $7 WHERE id = $8", 
            [title, description, required_level, lock_notice || '', display_order || 0, show_on_home, dashboard_visibility || 'all', req.params.id]
        );
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.delete('/api/admin/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    const { password } = req.body;
    if (password !== DELETE_PASSWORD) { return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" }); }
    
    try { 
        const videos = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE module_id = $1", [req.params.id]);
        videos.rows.forEach(row => {
            if (row.hls_manifest_url && row.hls_manifest_url !== 'PROCESSING') {
                const parts = row.hls_manifest_url.split('/');
                if (parts.length >= 3) {
                    const folderPath = path.join(hlsDir, parts[2]);
                    if (fs.existsSync(folderPath)) { fs.rmSync(folderPath, { recursive: true, force: true }); }
                }
            }
        });
        await pool.query("DELETE FROM learning_modules WHERE id = $1", [req.params.id]); 
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.post('/api/admin/modules/reorder', authenticateToken, isAdmin, async (req, res) => {
    const { orderedIds } = req.body;
    try {
        if (orderedIds && Array.isArray(orderedIds)) {
            for (let i = 0; i < orderedIds.length; i++) {
                await pool.query("UPDATE learning_modules SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
            }
        }
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.post('/api/admin/lessons', authenticateToken, isAdmin, upload.fields([{ name: 'video_file', maxCount: 1 }, { name: 'thumbnail_file', maxCount: 1 }]), async (req, res) => {
    const { module_id, title, description, display_order } = req.body;
    
    if (!req.files || !req.files['video_file']) {
        try {
            await pool.query(
                "INSERT INTO lesson_videos (module_id, title, description, hls_manifest_url, display_order, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6)", 
                [module_id, title, description || '', '', display_order || 0, '']
            );
            await redisClient.del('public_courses').catch(()=>{});
            return res.json({ success: true, msg: "Text Document Lesson Added Successfully." });
        } catch(e) {
            return res.status(500).json({ success: false, msg: e.message });
        }
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
            await new Promise((resolve, reject) => {
                ffmpeg(videoFile.path)
                    .screenshots({ timestamps: ['00:00:01.000'], filename: thumbName, folder: thumbDir })
                    .on('end', resolve).on('error', reject);
            });
            thumbUrl = '/hls/thumbnails/' + thumbName;
        } catch (err) { console.error("Auto-thumbnail failed, skipping."); }
    }

    try {
        const dbResult = await pool.query(
            "INSERT INTO lesson_videos (module_id, title, description, hls_manifest_url, display_order, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", 
            [module_id, title, description || '', 'PROCESSING', display_order || 0, thumbUrl]
        );
        const newLessonId = dbResult.rows[0].id;
        await redisClient.del('public_courses').catch(()=>{});

        // Queue for Background Worker
        await videoQueue.add('encode', {
            lessonDbId: newLessonId,
            videoPath: videoFile.path,
            hlsDirStr: hlsDir
        });

        res.json({ success: true, msg: "Video Uploaded. System is now converting it in the background. It will be available shortly." });
    } catch (e) {
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        res.status(500).json({ success: false, msg: e.message });
    }
});

// --- BULLMQ BACKGROUND WORKER DEFINITION ---
const worker = new Worker('video-encoding', async job => {
    const { lessonDbId, videoPath, hlsDirStr } = job.data;
    const lessonId = crypto.randomUUID();
    const lessonHlsDir = path.join(hlsDirStr, lessonId);
    if (!fs.existsSync(lessonHlsDir)) fs.mkdirSync(lessonHlsDir, { recursive: true });

    const key = crypto.randomBytes(16);
    const keyPath = path.join(lessonHlsDir, 'enc.key');
    fs.writeFileSync(keyPath, key);

    const keyUrl = `/api/hls-key/${lessonId}/enc.key`; 
    const keyInfoPath = path.join(lessonHlsDir, 'enc.keyinfo');
    fs.writeFileSync(keyInfoPath, `${keyUrl}\n${keyPath}`);

    const m3u8Path = `/hls/${lessonId}/output.m3u8`;

    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .outputOptions([
                '-profile:v baseline', 
                '-level 3.0', 
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-start_number 0', 
                '-hls_time 10', 
                '-hls_list_size 0', 
                '-f hls', 
                `-hls_key_info_file ${keyInfoPath}`
            ])
            .output(path.join(lessonHlsDir, 'output.m3u8'))
            .on('end', async () => {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                await pool.query("UPDATE lesson_videos SET hls_manifest_url = $1 WHERE id = $2", [m3u8Path, lessonDbId]);
                await redisClient.del('public_courses').catch(()=>{});
                console.log(`✅ Background processing complete for Lesson ID: ${lessonDbId}`);
                resolve();
            })
            .on('error', (err) => { 
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); 
                reject(err); 
            })
            .run();
    });
}, { connection: redisConnection });
// --------------------------------------------

// --- DEDUPLICATED PUSH WORKER ---
const pushWorker = new Worker('push-notifications', async job => {
    const { notificationId } = job.data;
    const { rows } = await pool.query("SELECT * FROM scheduled_notifications WHERE id = $1 AND status = 'pending'", [notificationId]);
    
    if (rows.length > 0) {
        const notification = rows[0];
        try {
            const subs = await pool.query("SELECT sub_data FROM push_subscriptions");
            const payload = { title: notification.title, body: notification.body, url: notification.url || '/' };
            
            const uniqueSubs = [];
            const endpoints = new Set();
            for (let row of subs.rows) {
                if (!endpoints.has(row.sub_data.endpoint)) {
                    endpoints.add(row.sub_data.endpoint);
                    uniqueSubs.push(row.sub_data);
                }
            }

            for (let sub of uniqueSubs) {
                await webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                    if (e.statusCode === 410) pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{});
                });
            }
            
            await pool.query("UPDATE scheduled_notifications SET status = 'sent' WHERE id = $1", [notificationId]);
            console.log(`✅ Scheduled push notification sent: ${notification.title}`);
        } catch (e) {
            console.error("❌ Scheduled push failed:", e);
        }
    }
}, { connection: redisConnection });
// --------------------------------

app.put('/api/admin/lessons/:id', authenticateToken, isAdmin, upload.single('thumbnail_file'), async (req, res) => {
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

app.delete('/api/admin/lessons/:id', authenticateToken, isAdmin, async (req, res) => {
    const { password } = req.body;
    if (password !== DELETE_PASSWORD) { return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" }); }

    try { 
        const result = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE id = $1", [req.params.id]);
        if (result.rows.length > 0 && result.rows[0].hls_manifest_url && result.rows[0].hls_manifest_url !== 'PROCESSING') {
            const parts = result.rows[0].hls_manifest_url.split('/');
            if (parts.length >= 3) {
                const folderPath = path.join(hlsDir, parts[2]);
                if (fs.existsSync(folderPath)) { fs.rmSync(folderPath, { recursive: true, force: true }); }
            }
        }
        await pool.query("DELETE FROM lesson_videos WHERE id = $1", [req.params.id]); 
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.post('/api/admin/lessons/reorder', authenticateToken, isAdmin, async (req, res) => {
    const { orderedIds } = req.body;
    try {
        if (orderedIds && Array.isArray(orderedIds)) {
            for (let i = 0; i < orderedIds.length; i++) {
                await pool.query("UPDATE lesson_videos SET display_order = $1 WHERE id = $2", [i, orderedIds[i]]);
            }
        }
        await redisClient.del('public_courses').catch(()=>{});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// ==========================================
// PUSH NOTIFICATION ADMIN ROUTES (WITH IST FIX)
// ==========================================
app.get('/api/admin/notifications', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM scheduled_notifications ORDER BY created_at DESC LIMIT 50");
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.post('/api/admin/notifications', authenticateToken, isAdmin, async (req, res) => {
    const { title, body, url, schedule_time } = req.body;
    try {
        let parsedScheduleTime = null;
        if (schedule_time) {
            // Frontend string lacks timezone (e.g., "YYYY-MM-DDTHH:mm"). Explicitly assign IST (+05:30).
            if (!schedule_time.includes('+') && !schedule_time.endsWith('Z')) {
                const istString = schedule_time.length === 16 ? schedule_time + ":00+05:30" : schedule_time + "+05:30";
                parsedScheduleTime = new Date(istString).toISOString(); 
            } else {
                parsedScheduleTime = new Date(schedule_time).toISOString();
            }
        }

        const result = await pool.query(
            "INSERT INTO scheduled_notifications (title, body, url, scheduled_for, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [title, body, url || '/', parsedScheduleTime || null, parsedScheduleTime ? 'pending' : 'sent']
        );
        const notificationId = result.rows[0].id;

        if (!parsedScheduleTime) {
            const subs = await pool.query("SELECT sub_data FROM push_subscriptions");
            const payload = { title, body, url: url || '/' };
            
            const uniqueSubs = [];
            const endpoints = new Set();
            for (let row of subs.rows) {
                if (!endpoints.has(row.sub_data.endpoint)) {
                    endpoints.add(row.sub_data.endpoint);
                    uniqueSubs.push(row.sub_data);
                }
            }
            
            uniqueSubs.forEach(sub => { 
                webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                    if(e.statusCode === 410) pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{});
                }); 
            });
        } else {
            // Evaluates exact milliseconds remaining until explicit IST time
            const delay = new Date(parsedScheduleTime).getTime() - Date.now();
            await pushQueue.add('send-push', { notificationId }, { delay: Math.max(delay, 0), jobId: `push_${notificationId}` });
        }
        res.json({ success: true, msg: "Notification saved!" });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.put('/api/admin/notifications/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, body, url, schedule_time } = req.body;
    try {
        let parsedScheduleTime = null;
        if (schedule_time) {
            if (!schedule_time.includes('+') && !schedule_time.endsWith('Z')) {
                const istString = schedule_time.length === 16 ? schedule_time + ":00+05:30" : schedule_time + "+05:30";
                parsedScheduleTime = new Date(istString).toISOString(); 
            } else {
                parsedScheduleTime = new Date(schedule_time).toISOString();
            }
        }

        await pool.query(
            "UPDATE scheduled_notifications SET title = $1, body = $2, url = $3, scheduled_for = $4 WHERE id = $5 AND status = 'pending'",
            [title, body, url || '/', parsedScheduleTime, req.params.id]
        );
        const jobId = `push_${req.params.id}`;
        const existingJob = await pushQueue.getJob(jobId);
        if (existingJob) await existingJob.remove();
        
        const delay = new Date(parsedScheduleTime).getTime() - Date.now();
        await pushQueue.add('send-push', { notificationId: req.params.id }, { delay: Math.max(delay, 0), jobId });
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.delete('/api/admin/notifications/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM scheduled_notifications WHERE id = $1", [req.params.id]);
        const existingJob = await pushQueue.getJob(`push_${req.params.id}`);
        if (existingJob) await existingJob.remove();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});
// ==========================================

app.get('/api/trades', authenticateToken, async (req, res) => {
    try { res.json((await pool.query(`SELECT * FROM trades WHERE CAST(created_at AS TIMESTAMP) >= NOW() - INTERVAL '30 days' ORDER BY id DESC`)).rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/signal_detected', async (req, res) => {
    const { trade_id, symbol, type } = req.body;
    try {
        const sentMsg = await bot.sendMessage(CHAT_ID, `🚨 *NEW SIGNAL DETECTED*\n\n💎 *Symbol:* #${toMarkdown(symbol)}\n📊 *Type:* ${toMarkdown(type)}\n🕒 *Time:* ${toMarkdown(getISTTime())}`, { parse_mode: 'Markdown' });
        await pool.query(`INSERT INTO trades (trade_id, symbol, type, telegram_msg_id, created_at, status) VALUES ($1, $2, $3, $4, $5, 'SIGNAL') ON CONFLICT (trade_id) DO NOTHING;`, [trade_id, symbol, type, sentMsg.message_id, getDBTime()]);
        await pool.query("DELETE FROM trades WHERE CAST(created_at AS TIMESTAMP) < NOW() - INTERVAL '30 days'");
        
        io.emit('trade_update'); 
        if (await checkTradePushEnabled()) sendPushNotification({ title: '🚨 NEW SIGNAL', body: `${symbol} - ${type}` }); 
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/setup_confirmed', async (req, res) => {
    const { trade_id, symbol, type, entry, sl, tp1, tp2, tp3 } = req.body;
    try {
        const oldTrades = await pool.query("SELECT * FROM trades WHERE symbol = $1 AND status IN ('SIGNAL', 'SETUP', 'ACTIVE') AND trade_id != $2", [symbol, trade_id]);
        for (const t of oldTrades.rows) {
            await pool.query("UPDATE trades SET status = 'CLOSED (Reversal)' WHERE trade_id = $1", [t.trade_id]);
            if(t.telegram_msg_id) { bot.sendMessage(CHAT_ID, `🔄 *Trade Reversed*\n❌ Closed by new signal.`, { reply_to_message_id: t.telegram_msg_id, parse_mode: 'Markdown' }); }
        }
        const check = await pool.query("SELECT telegram_msg_id FROM trades WHERE trade_id = $1", [trade_id]);
        await pool.query(`INSERT INTO trades (trade_id, symbol, type, entry_price, sl_price, tp1_price, tp2_price, tp3_price, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SETUP', $9) ON CONFLICT (trade_id) DO UPDATE SET entry_price = EXCLUDED.entry_price, sl_price = EXCLUDED.sl_price, tp1_price = EXCLUDED.tp1_price, tp2_price = EXCLUDED.tp2_price, tp3_price = EXCLUDED.tp3_price, status = 'SETUP';`, [trade_id, symbol, type, entry, sl, tp1, tp2, tp3, getDBTime()]);
        const opts = { parse_mode: 'Markdown' }; if (check.rows[0]?.telegram_msg_id) opts.reply_to_message_id = check.rows[0].telegram_msg_id;
        await bot.sendMessage(CHAT_ID, `✅ *SETUP CONFIRMED*\n\n💎 *Symbol:* #${toMarkdown(symbol)}\n🚀 *Type:* ${toMarkdown(type)}\n🚪 *Entry:* ${toMarkdown(entry)}\n🛑 *SL:* ${toMarkdown(sl)}\n\n🎯 *TP1:* ${toMarkdown(tp1)}\n🎯 *TP2:* ${toMarkdown(tp2)}\n🎯 *TP3:* ${toMarkdown(tp3)}`, opts);
        
        io.emit('trade_update'); 
        if (await checkTradePushEnabled()) sendPushNotification({ title: '✅ SETUP CONFIRMED', body: `${symbol} - Entry: ${entry}` }); 
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/price_update', async (req, res) => {
    const { symbol, bid, ask } = req.body;
    try {
        const trades = await pool.query("SELECT * FROM trades WHERE symbol = $1 AND status = 'ACTIVE'", [symbol]);
        for (const t of trades.rows) { await pool.query("UPDATE trades SET points_gained = $1 WHERE id = $2", [calculatePoints(t.type, t.entry_price, (t.type === 'BUY') ? bid : ask), t.id]); }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/log_event', async (req, res) => {
    const { trade_id, new_status, price } = req.body;
    try {
        const result = await pool.query("SELECT * FROM trades WHERE trade_id = $1", [trade_id]);
        if (result.rows.length === 0) return res.json({ success: false, msg: "Trade not found" });
        const trade = result.rows[0];
        if (trade.status.includes('TP') && new_status === 'SL HIT') { return res.json({ success: true, msg: "Profit Locked: SL Ignored" }); }
        if (trade.status === 'TP3 HIT' && (new_status === 'TP2 HIT' || new_status === 'TP1 HIT')) return res.json({ success: true });
        if (trade.status === 'TP2 HIT' && new_status === 'TP1 HIT') return res.json({ success: true });
        if (trade.status === new_status) return res.json({ success: true }); 
        await pool.query("UPDATE trades SET status = $1, points_gained = $2 WHERE trade_id = $3", [new_status, calculatePoints(trade.type, trade.entry_price, price), trade_id]);
        const opts = { parse_mode: 'Markdown' }; if (trade.telegram_msg_id) opts.reply_to_message_id = trade.telegram_msg_id;
        await bot.sendMessage(CHAT_ID, `⚡ *UPDATE: ${toMarkdown(new_status)}*\n\n💎 *Symbol:* #${toMarkdown(trade.symbol)}\n📉 *Price:* ${toMarkdown(price)}`, opts);
        
        io.emit('trade_update'); 
        if (await checkTradePushEnabled()) sendPushNotification({ title: `⚡ ${new_status}`, body: `${trade.symbol} @ ${price}` }); 
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delete_trades', authenticateToken, async (req, res) => {
    const { trade_ids, password } = req.body; 
    if (password !== DELETE_PASSWORD) { return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" }); }
    if (!trade_ids || !Array.isArray(trade_ids) || trade_ids.length === 0) { return res.status(400).json({ success: false, msg: "No IDs provided" }); }
    try { await pool.query("DELETE FROM trades WHERE trade_id = ANY($1)", [trade_ids]); io.emit('trade_update'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================
// DAILY AUTOMATED LOGOUT (6:30 AM)
// =========================================================
cron.schedule('30 6 * * *', async () => {
    try {
        await pool.query("DELETE FROM login_logs");
        console.log("✅ Daily Reset: All user sessions cleared at 6:30 AM.");
    } catch (err) {
        console.error("❌ Error clearing daily sessions:", err);
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

const PORT = process.env.PORT || 3000;

// === SERVER INITIALIZATION & AUTO-GENERATE VAPID KEYS ===
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
        
        // Save globally so the frontend API can fetch it
        app.locals.vapidPublicKey = vapidPublicKey.trim();
        console.log("✅ Web Push VAPID configured successfully.");

    } catch (e) {
        console.error("❌ Failed to setup VAPID keys:", e.message);
    }

    server.listen(PORT, () => console.log(`🚀 RD Broker Server running on ${PORT}`)); 
});
