const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const { pool } = require('../config/database');
const authPool = require('../config/authDb');

const JWT_SECRET = (process.env.JWT_SECRET || "super_secret_key_123").trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@rdalgo.in").trim().toLowerCase();
const DEMO_USERS = [
    { email: (process.env.DEMO_EMAIL || "demo@rdalgo.in").trim().toLowerCase(), password: (process.env.DEMO_PASSWORD || "demo123").trim() },
    { email: "demo2@rdalgo.in", password: "demo123" },
    { email: "demo3@rdalgo.in", password: "demo123" },
    { email: "demo4@rdalgo.in", password: "demo123" },
    { email: "demo5@rdalgo.in", password: "demo123" },
    { email: "demo6@rdalgo.in", password: "demo123" }
];

async function getValidPushSubscribers(audienceType) {
    let query = "SELECT id, email, sub_data FROM push_subscriptions";
    if (audienceType === 'non_logged_in') query += " WHERE email = 'public'";
    else if (audienceType !== 'both') query += " WHERE email != 'public'";
    
    const subs = await pool.query(query);
    if (audienceType === 'non_logged_in') {
        const unique = []; const eps = new Set();
        for (let r of subs.rows) { if (!eps.has(r.sub_data.endpoint)) { eps.add(r.sub_data.endpoint); unique.push(r.sub_data); } }
        return unique;
    }

    const emailsToCheck = [...new Set(subs.rows.filter(r => r.email !== 'public').map(r => String(r.email).toLowerCase().trim()))];
    const actuallyValidEmails = new Set([ADMIN_EMAIL, ...DEMO_USERS.map(u => u.email), 'public']);
    const expiredEmails = new Set();
    const userLevels = new Map();

    userLevels.set(ADMIN_EMAIL, { level_2_status: 'Yes', level_3_status: 'Yes', level_4_status: 'Yes' });
    DEMO_USERS.forEach(u => userLevels.set(u.email, { level_2_status: 'Yes', level_3_status: 'Yes', level_4_status: 'Yes' }));

    if (emailsToCheck.length > 0) {
        const placeholders = emailsToCheck.map(() => '?').join(',');
        try {
            const [wpRows] = await authPool.query(`SELECT student_email, student_expiry_date, level_2_status, level_3_status, level_4_status FROM wp_gf_student_registrations WHERE student_email IN (${placeholders})`, emailsToCheck);
            const d = new Date(); const utc = d.getTime() + (d.getTimezoneOffset() * 60000); const nowIST = new Date(utc + (3600000 * 5.5));

            wpRows.forEach(row => {
                const expiry = new Date(row.student_expiry_date);
                if (isNaN(expiry.getTime()) || expiry >= nowIST) {
                    if (row.student_email) {
                        const email = String(row.student_email).toLowerCase().trim();
                        actuallyValidEmails.add(email);
                        userLevels.set(email, { level_2_status: row.level_2_status || 'No', level_3_status: row.level_3_status || 'No', level_4_status: row.level_4_status || 'No' });
                    }
                }
            });
            emailsToCheck.forEach(email => { if (!actuallyValidEmails.has(email)) expiredEmails.add(email); });
        } catch(e) {
            console.error("Auth DB Error during push sync (Failsafe activated)", e.message);
            emailsToCheck.forEach(email => actuallyValidEmails.add(email)); 
        }
    }

    if (expiredEmails.size > 0) {
        const expiredArray = Array.from(expiredEmails);
        await pool.query("UPDATE push_subscriptions SET email = 'public' WHERE LOWER(email) = ANY($1)", [expiredArray]).catch(()=>{});
    }

    const uniqueSubs = []; const endpoints = new Set();
    for (let row of subs.rows) {
        let rowEmail = String(row.email).toLowerCase().trim();
        let isValidAudience = false;
        
        if (audienceType === 'both') {
            if (rowEmail === 'public' || actuallyValidEmails.has(rowEmail)) isValidAudience = true;
        } else if (audienceType === 'logged_in') {
            if (rowEmail !== 'public' && actuallyValidEmails.has(rowEmail)) isValidAudience = true;
        } else {
            if (rowEmail !== 'public' && actuallyValidEmails.has(rowEmail)) {
                const levels = userLevels.get(rowEmail) || { level_2_status: 'No', level_3_status: 'No', level_4_status: 'No' };
                if (audienceType === 'login_no_level_2' && levels.level_2_status !== 'Yes') isValidAudience = true;
                else if (audienceType === 'login_no_level_3' && levels.level_3_status !== 'Yes') isValidAudience = true;
                else if (audienceType === 'login_no_level_4' && levels.level_4_status !== 'Yes') isValidAudience = true;
                else if (audienceType === 'login_with_level_2' && levels.level_2_status === 'Yes') isValidAudience = true;
                else if (audienceType === 'login_with_level_3' && levels.level_3_status === 'Yes') isValidAudience = true;
                else if (audienceType === 'login_with_level_4' && levels.level_4_status === 'Yes') isValidAudience = true;
            }
        }

        if (isValidAudience && !endpoints.has(row.sub_data.endpoint)) {
            endpoints.add(row.sub_data.endpoint);
            uniqueSubs.push(row.sub_data);
        }
    }
    return uniqueSubs;
}

async function sendPushNotification(payload, io) {
    try {
        console.log(`\n🔔 --- PREPARING TRADE PUSH ---`);
        const uniqueSubs = await getValidPushSubscribers('logged_in');
        
        for (let sub of uniqueSubs) {
            // 🔥 FAIL-SAFE ADDED:
            try {
                await webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                    if (e.statusCode === 410) { pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{}); }
                });
            } catch (err) {}
        }

        await pool.query(
            "INSERT INTO scheduled_notifications (title, body, url, status, target_audience, recurrence) VALUES ($1, $2, $3, 'sent', 'logged_in', 'none')",
            [payload.title, payload.body, payload.url || '/']
        );
        if (io) io.emit('new_notification');
        console.log(`✅ Trade Push Successfully Saved to Dashboard History!\n`);
    } catch (err) { console.error("❌ Error sending trade push:", err); }
}

async function checkTradePushEnabled() {
    try {
        const res = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'push_trade_alerts'");
        if (res.rows.length > 0) {
            const val = res.rows[0].setting_value;
            if (val === 'false' || val === false || val === '0') return false;
        }
        return true;
    } catch(e) { return true; }
}

router.get('/public_key', (req, res) => {
    if (req.app.locals.vapidPublicKey) res.json({ success: true, publicKey: req.app.locals.vapidPublicKey });
    else res.status(500).json({ success: false, msg: "VAPID key not initialized." });
});

router.post('/subscribe', async (req, res) => {
    const subscription = req.body;
    const endpoint = subscription.endpoint;
    let email = 'public'; 
    const token = req.cookies.authToken;
    if (token) { try { const decoded = jwt.verify(token, JWT_SECRET); email = String(decoded.email).toLowerCase().trim(); } catch(e) {} }

    try {
        const existing = await pool.query("SELECT id FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [endpoint]);
        if (existing.rows.length === 0) await pool.query("INSERT INTO push_subscriptions (email, sub_data) VALUES ($1, $2)", [email, subscription]);
        else await pool.query("UPDATE push_subscriptions SET email = $1, sub_data = $2 WHERE id = $3", [email, subscription, existing.rows[0].id]);
        res.status(201).json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.getValidPushSubscribers = getValidPushSubscribers;
router.sendPushNotification = sendPushNotification;
router.checkTradePushEnabled = checkTradePushEnabled;

module.exports = router;
