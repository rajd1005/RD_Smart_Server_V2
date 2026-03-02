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

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath); 

const { pool, initDb } = require('./database');
const authPool = require('./authDb'); 
require('dotenv').config();

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

const debugLog = (msg) => console.log(`[AUTH DEBUG] ${msg}`);

const authenticateToken = async (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) {
        debugLog(`API Blocked (No Cookie): ${req.path}`);
        return res.status(401).json({ success: false, msg: "Not authenticated" });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
        
        if (rows.length > 0 && rows[0].session_id !== decoded.sessionId) { 
            debugLog(`API Blocked (Session Mismatch): ${req.path} for ${decoded.email}`);
            res.clearCookie('authToken', { path: '/' }); 
            return res.status(403).json({ success: false, msg: "Logged in from another device. Session expired." }); 
        }
        req.user = decoded;
        next();
    } catch (err) {
        debugLog(`API Blocked (JWT Error): ${req.path} - ${err.message}`);
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
        
        if (!token) {
            debugLog(`Redirecting to /home.html (No Cookie present)`);
            return res.redirect('/home.html');
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
            
            if (rows.length > 0 && rows[0].session_id !== decoded.sessionId) { 
                debugLog(`Redirecting to /home.html (Session Mismatch for ${decoded.email})`);
                res.clearCookie('authToken', { path: '/' }); 
                return res.redirect('/home.html'); 
            }
            debugLog(`✅ Dashboard Access Granted for: ${decoded.email}`);
            next(); 
        } catch (err) { 
            debugLog(`Redirecting to /home.html (JWT Failed): ${err.message}`);
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
                if (rows.length > 0 && rows[0].session_id === decoded.sessionId) {
                    debugLog(`User already logged in. Auto-redirecting /home.html back to Dashboard!`);
                    return res.redirect('/');
                }
            } catch(err) {}
        }
        next();
    } else { 
        next(); 
    }
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

// --- EXACT DB MATCH: FETCH GALLERY API ---
app.get('/api/public/gallery', async (req, res) => {
    try {
        const [rows] = await galleryPool.query("SELECT id, image_url, trade_date, name FROM wp_central_image_gallery ORDER BY id DESC LIMIT 15");
        res.json({ success: true, images: rows });
    } catch (err) {
        console.error("Gallery DB Error:", err);
        res.status(500).json({ success: false, msg: "Failed to fetch gallery images." });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM system_settings");
        const settings = {};
        result.rows.forEach(r => settings[r.setting_key] = r.setting_value);
        res.json(settings);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

app.put('/api/admin/settings', authenticateToken, isAdmin, async (req, res) => {
    const { accordion_state, hide_trade_tab } = req.body;
    try {
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('accordion_state', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [accordion_state || 'first']);
        await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES ('hide_trade_tab', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value", [hide_trade_tab || 'false']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.get('/api/public/courses', async (req, res) => {
    try {
        const modulesResult = await pool.query("SELECT id, title, description, required_level, display_order FROM learning_modules ORDER BY display_order ASC");
        const lessonsResult = await pool.query("SELECT id, module_id, title, description, display_order, thumbnail_url FROM lesson_videos ORDER BY display_order ASC");
        const coursesStructure = modulesResult.rows.map(mod => { return { ...mod, lessons: lessonsResult.rows.filter(l => l.module_id === mod.id) }; });
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
    
    debugLog(`Login Attempt Initiated for: ${email}`);

    try {
        let userEmail = ""; let userRole = "student"; let userPhone = "";
        let accessLevels = { level_1_status: 'No', level_2_status: 'No', level_3_status: 'No', level_4_status: 'No' };
        let studentRecord = null;

        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            userEmail = ADMIN_EMAIL; userRole = "admin"; userPhone = "Admin";
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
                debugLog(`First Time Setup Required for: ${email}`);
                return res.json({ success: true, requires_setup: true, setupToken: setupToken, msg: "First login detected. Please create a secure password." });
            }

            const expiryDate = new Date(studentRecord.student_expiry_date);
            if (expiryDate < new Date()) {
                debugLog(`Account Expired for: ${email}`);
                return res.status(403).json({ success: false, msg: "Account Expired. Please contact admin." });
            }

            userEmail = studentRecord.student_email; userPhone = studentRecord.student_phone; 
            accessLevels = { level_1_status: 'Yes', level_2_status: studentRecord.level_2_status || 'No', level_3_status: studentRecord.level_3_status || 'No', level_4_status: studentRecord.level_4_status || 'No' };
        }

        const sessionId = crypto.randomUUID();
        await pool.query("INSERT INTO login_logs (email, session_id, ip_address) VALUES ($1, $2, $3)", [userEmail, sessionId, clientIp]);
        await pool.query("DELETE FROM login_logs WHERE login_time < NOW() - INTERVAL '30 days'");

        const token = jwt.sign({ email: userEmail, phone: userPhone, sessionId: sessionId, role: userRole, accessLevels: accessLevels }, JWT_SECRET, { expiresIn: rememberMe ? '30d' : '1d' });
        
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        debugLog(`Issuing JWT Cookie -> Secure: ${isSecure}, Session: ${sessionId}`);

        res.cookie('authToken', token, { 
            httpOnly: true, 
            secure: isSecure, 
            sameSite: 'lax', 
            path: '/', 
            maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 
        });

        res.json({ success: true, msg: "Login successful", email: userEmail, phone: userPhone, role: userRole, accessLevels: accessLevels });
    } catch (error) { 
        debugLog(`Login DB Error: ${error.message}`);
        res.status(500).json({ success: false, msg: "Database connection error" }); 
    }
});

app.post('/api/set_password', async (req, res) => {
    const { setupToken, newPassword } = req.body;
    try {
        const decoded = jwt.verify(setupToken, JWT_SECRET);
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
        await pool.query("INSERT INTO user_credentials (email, salt, hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash", [decoded.email, salt, hash]);
        debugLog(`Password securely setup for: ${decoded.email}`);
        res.json({ success: true, email: decoded.email }); 
    } catch (err) {
        res.status(401).json({ success: false, msg: "Setup session expired. Please log in again." });
    }
});

app.post('/api/forgot_password', async (req, res) => {
    const { email } = req.body;
    try {
        if (email === ADMIN_EMAIL) return res.status(400).json({ success: false, msg: "Admin password cannot be reset here." });
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
                    <p style="font-size: 11px; color: #888; margin-top: 20px;">If you didn't request this, please ignore this email.</p>
                   </div>`
        };
        transporter.sendMail(mailOptions).catch(e => console.error(e));
        debugLog(`OTP Sent to: ${email}`);
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
        
        debugLog(`Password successfully reset via OTP for: ${email}`);
        res.json({ success: true, msg: "Password changed successfully. You can now login." });
    } catch (err) { res.status(500).json({ success: false, msg: "Server error resetting password." }); }
});

app.post('/api/logout', (req, res) => { 
    res.clearCookie('authToken', { path: '/' }); 
    res.json({ success: true }); 
});

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
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007aff;">
                        <h4 style="margin-top: 0;">Digital Footprint:</h4>
                        <ul style="list-style: none; padding: 0; margin: 0;">
                            <li style="margin-bottom: 5px;"><strong>User Account:</strong> ${userEmail}</li>
                            <li style="margin-bottom: 5px;"><strong>Date & Time (IST):</strong> ${istTime}</li>
                            <li style="margin-bottom: 5px;"><strong>IP Address:</strong> ${clientIp}</li>
                        </ul>
                    </div>

                    <h4 style="color: #ff3b30;">Accepted Terms & Conditions:</h4>
                    <div style="background:#fff3cd; color: #856404; padding:15px; border: 1px solid #ffeeba; border-radius: 8px; font-size: 13px;">
                        <p style="margin-top:0;"><strong>1. Not SEBI Registered:</strong> We are NOT registered with SEBI or any regulatory body. We are not financial advisors.</p>
                        <p><strong>2. Educational Only:</strong> All content, signals, and setups are strictly for educational and learning purposes.</p>
                        <p><strong>3. Paper Trading:</strong> Do NOT take live real-money trades. Use virtual money (paper trading) only to test and learn.</p>
                        <p style="margin-bottom:0;"><strong>4. Your Responsibility:</strong> Trading carries massive risk. You are 100% responsible for your own actions. We accept NO liability for any financial losses.</p>
                    </div>
                    
                    <p style="font-size: 11px; color: #888; margin-top: 30px;">This is an automated legal compliance email. If you did not authorize this agreement, please log out of your account immediately and contact support.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions).catch(err => console.error("SMTP Mail Error:", err));
        debugLog(`Legal Agreement Recorded & Emailed for: ${userEmail}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: "Failed to record agreement." }); }
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
        const lessonsResult = await pool.query("SELECT id, module_id, title, description, display_order, thumbnail_url FROM lesson_videos ORDER BY display_order ASC");
        const coursesStructure = modulesResult.rows.map(mod => { return { ...mod, lessons: lessonsResult.rows.filter(l => l.module_id === mod.id) }; });
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

app.post('/api/admin/modules', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, display_order, lock_notice } = req.body;
    try {
        await pool.query("INSERT INTO learning_modules (title, description, required_level, display_order, lock_notice) VALUES ($1, $2, $3, $4, $5)", [title, description, required_level, display_order || 0, lock_notice || '']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.put('/api/admin/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    const { title, description, required_level, lock_notice, display_order } = req.body;
    try {
        await pool.query("UPDATE learning_modules SET title = $1, description = $2, required_level = $3, lock_notice = $4, display_order = $5 WHERE id = $6", [title, description, required_level, lock_notice || '', display_order || 0, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.delete('/api/admin/modules/:id', authenticateToken, isAdmin, async (req, res) => {
    try { 
        const videos = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE module_id = $1", [req.params.id]);
        videos.rows.forEach(row => {
            const parts = row.hls_manifest_url.split('/');
            if (parts.length >= 3) {
                const folderPath = path.join(hlsDir, parts[2]);
                if (fs.existsSync(folderPath)) { fs.rmSync(folderPath, { recursive: true, force: true }); }
            }
        });
        await pool.query("DELETE FROM learning_modules WHERE id = $1", [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.post('/api/admin/lessons', authenticateToken, isAdmin, upload.fields([{ name: 'video_file', maxCount: 1 }, { name: 'thumbnail_file', maxCount: 1 }]), async (req, res) => {
    const { module_id, title, description, display_order } = req.body;
    if (!req.files || !req.files['video_file']) return res.status(400).json({ success: false, msg: "Video file is required." });
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
    }

    const lessonId = crypto.randomUUID();
    const lessonHlsDir = path.join(hlsDir, lessonId);
    fs.mkdirSync(lessonHlsDir, { recursive: true });

    const key = crypto.randomBytes(16);
    const keyPath = path.join(lessonHlsDir, 'enc.key');
    fs.writeFileSync(keyPath, key);

    const keyUrl = `/api/hls-key/${lessonId}/enc.key`; 
    const keyInfoPath = path.join(lessonHlsDir, 'enc.keyinfo');
    fs.writeFileSync(keyInfoPath, `${keyUrl}\n${keyPath}`);

    const m3u8Path = `/hls/${lessonId}/output.m3u8`;

    ffmpeg(videoFile.path)
        .outputOptions(['-profile:v baseline', '-level 3.0', '-s 1280x720', '-start_number 0', '-hls_time 10', '-hls_list_size 0', '-f hls', `-hls_key_info_file ${keyInfoPath}`])
        .output(path.join(lessonHlsDir, 'output.m3u8'))
        .on('end', async () => {
            if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
            try { await pool.query("INSERT INTO lesson_videos (module_id, title, description, hls_manifest_url, display_order, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6)", [module_id, title, description, m3u8Path, display_order || 0, thumbUrl]); } catch(e) {}
        })
        .on('error', (err) => { if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path); })
        .run();

    res.json({ success: true, msg: "Video Uploaded. System is now converting and encrypting it in the background." });
});

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
            await pool.query("UPDATE lesson_videos SET title = $1, description = $2, display_order = $3, thumbnail_url = $4 WHERE id = $5", [title, description, display_order || 0, thumbUrl, req.params.id]);
        } else {
            await pool.query("UPDATE lesson_videos SET title = $1, description = $2, display_order = $3 WHERE id = $4", [title, description, display_order || 0, req.params.id]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.delete('/api/admin/lessons/:id', authenticateToken, isAdmin, async (req, res) => {
    try { 
        const result = await pool.query("SELECT hls_manifest_url FROM lesson_videos WHERE id = $1", [req.params.id]);
        if (result.rows.length > 0) {
            const parts = result.rows[0].hls_manifest_url.split('/');
            if (parts.length >= 3) {
                const folderPath = path.join(hlsDir, parts[2]);
                if (fs.existsSync(folderPath)) { fs.rmSync(folderPath, { recursive: true, force: true }); }
            }
        }
        await pool.query("DELETE FROM lesson_videos WHERE id = $1", [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.get('/api/trades', authenticateToken, async (req, res) => {
    try { res.json((await pool.query(`SELECT * FROM trades WHERE CAST(created_at AS TIMESTAMP) >= NOW() - INTERVAL '30 days' ORDER BY id DESC`)).rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/signal_detected', async (req, res) => {
    const { trade_id, symbol, type } = req.body;
    try {
        const sentMsg = await bot.sendMessage(CHAT_ID, `🚨 *NEW SIGNAL DETECTED*\n\n💎 *Symbol:* #${toMarkdown(symbol)}\n📊 *Type:* ${toMarkdown(type)}\n🕒 *Time:* ${toMarkdown(getISTTime())}`, { parse_mode: 'Markdown' });
        await pool.query(`INSERT INTO trades (trade_id, symbol, type, telegram_msg_id, created_at, status) VALUES ($1, $2, $3, $4, $5, 'SIGNAL') ON CONFLICT (trade_id) DO NOTHING;`, [trade_id, symbol, type, sentMsg.message_id, getDBTime()]);
        await pool.query("DELETE FROM trades WHERE CAST(created_at AS TIMESTAMP) < NOW() - INTERVAL '30 days'");
        io.emit('trade_update'); res.json({ success: true });
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
        io.emit('trade_update'); res.json({ success: true });
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
        io.emit('trade_update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delete_trades', authenticateToken, async (req, res) => {
    const { trade_ids, password } = req.body; 
    if (password !== DELETE_PASSWORD) { return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" }); }
    if (!trade_ids || !Array.isArray(trade_ids) || trade_ids.length === 0) { return res.status(400).json({ success: false, msg: "No IDs provided" }); }
    try { await pool.query("DELETE FROM trades WHERE trade_id = ANY($1)", [trade_ids]); io.emit('trade_update'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
initDb().then(() => { server.listen(PORT, () => console.log(`🚀 RD Broker Server running on ${PORT}`)); });
