const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/database');
const authPool = require('../config/authDb');
const { transporter, ADMIN_EMAIL } = require('../services/email.service');
const { authenticateToken } = require('../middlewares/auth.middleware');

const JWT_SECRET = (process.env.JWT_SECRET || "super_secret_key_123").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin123").trim();
const DEMO_USERS = [
    { email: (process.env.DEMO_EMAIL || "demo@rdalgo.in").trim().toLowerCase(), password: (process.env.DEMO_PASSWORD || "demo123").trim() },
    { email: "demo2@rdalgo.in", password: "demo123" },
    { email: "demo3@rdalgo.in", password: "demo123" },
    { email: "demo4@rdalgo.in", password: "demo123" },
    { email: "demo5@rdalgo.in", password: "demo123" },
    { email: "demo6@rdalgo.in", password: "demo123" }
];

function getClientIp(req) {
    let ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '';
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0]; 
    return ip.trim().replace('::ffff:', '');
}

function getISTTime() { 
    return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }); 
}

router.post('/login', async (req, res) => {
    const { password, rememberMe } = req.body;
    const email = req.body.email.trim().toLowerCase();
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
            const getISTDate = () => { const d = new Date(); const utc = d.getTime() + (d.getTimezoneOffset() * 60000); return new Date(utc + (3600000 * 5.5)); };
            if (!isNaN(expiryDate.getTime()) && expiryDate < getISTDate()) { 
                return res.status(403).json({ success: false, msg: "Account Expired. Please contact admin." }); 
            }
            
            userEmail = String(studentRecord.student_email).toLowerCase().trim();
            userPhone = studentRecord.student_phone; 
            accessLevels = { level_1_status: 'Yes', level_2_status: studentRecord.level_2_status || 'No', level_3_status: studentRecord.level_3_status || 'No', level_4_status: studentRecord.level_4_status || 'No' };
        }

        const sessionId = crypto.randomUUID();
        await pool.query("INSERT INTO login_logs (email, session_id, ip_address) VALUES ($1, $2, $3)", [userEmail, sessionId, clientIp]);
        await pool.query("DELETE FROM login_logs WHERE login_time < NOW() - INTERVAL '30 days'");

        const token = jwt.sign({ email: userEmail, phone: userPhone, sessionId: sessionId, role: userRole, accessLevels: accessLevels }, JWT_SECRET, { expiresIn: rememberMe ? '30d' : '1d' });
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('authToken', token, { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/', maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 });
        
        req.app.get('io').emit('force_logout', { email: userEmail, newSessionId: sessionId });
        res.json({ success: true, msg: "Login successful", email: userEmail, phone: userPhone, role: userRole, accessLevels: accessLevels, sessionId: sessionId });
    } catch (error) { res.status(500).json({ success: false, msg: "Database connection error" }); }
});

router.post('/set_password', async (req, res) => {
    const { setupToken, newPassword } = req.body;
    try {
        const decoded = jwt.verify(setupToken, JWT_SECRET);
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
        await pool.query("INSERT INTO user_credentials (email, salt, hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash", [String(decoded.email).toLowerCase(), salt, hash]);
        res.json({ success: true, email: decoded.email }); 
    } catch (err) { res.status(401).json({ success: false, msg: "Setup session expired. Please log in again." }); }
});

router.post('/forgot_password', async (req, res) => {
    const email = req.body.email.trim().toLowerCase();
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

router.post('/reset_password', async (req, res) => {
    const { otp, newPassword } = req.body;
    const email = req.body.email.trim().toLowerCase();
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

router.post('/logout', (req, res) => { 
    res.clearCookie('authToken', { path: '/' }); 
    res.json({ success: true }); 
});

router.post('/accept_terms', authenticateToken, async (req, res) => {
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

module.exports = router;
