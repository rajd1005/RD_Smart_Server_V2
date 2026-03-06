const { Worker } = require('bullmq');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const authPool = require('../config/authDb'); 
const { redisConnection } = require('../config/redis');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@rdalgo.in").trim().toLowerCase();
const DEMO_USERS = [
    { email: (process.env.DEMO_EMAIL || "demo@rdalgo.in").trim().toLowerCase(), password: (process.env.DEMO_PASSWORD || "demo123").trim() },
    { email: "demo2@rdalgo.in", password: "demo123" },
    { email: "demo3@rdalgo.in", password: "demo123" },
    { email: "demo4@rdalgo.in", password: "demo123" },
    { email: "demo5@rdalgo.in", password: "demo123" },
    { email: "demo6@rdalgo.in", password: "demo123" }
];

function initPushWorker(io, pushQueue) {
    
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

    // --- NEW: FETCH MANAGERS SO THEY RECEIVE ALL TEST PUSHES ---
    try {
        const mgrRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'manager_emails'");
        if (mgrRes.rows.length > 0 && mgrRes.rows[0].setting_value) {
            const managers = mgrRes.rows[0].setting_value.split(',').map(e => e.trim().toLowerCase());
            managers.forEach(mgrEmail => {
                if (mgrEmail) {
                    actuallyValidEmails.add(mgrEmail);
                    userLevels.set(mgrEmail, { level_2_status: 'Yes', level_3_status: 'Yes', level_4_status: 'Yes' });
                }
            });
        }
    } catch(e) {}
    // -------------------------------------------------------------

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
            } catch(e) { emailsToCheck.forEach(email => actuallyValidEmails.add(email)); }
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

    const pushWorker = new Worker('push-notifications', async job => {
        const { notificationId } = job.data;
        const { rows } = await pool.query("SELECT * FROM scheduled_notifications WHERE id = $1 AND status = 'pending'", [notificationId]);
        
        if (rows.length > 0) {
            const notification = rows[0];
            try {
                const uniqueSubs = await getValidPushSubscribers(notification.target_audience || 'both');
                const payload = { title: notification.title, body: notification.body, url: notification.url || '/', image: notification.image_path };

                for (let sub of uniqueSubs) {
                    // 🔥 FAIL-SAFE ADDED:
                    try {
                        await webpush.sendNotification(sub, JSON.stringify(payload)).catch(e => {
                            if (e.statusCode === 410) pool.query("DELETE FROM push_subscriptions WHERE sub_data->>'endpoint' = $1", [sub.endpoint]).catch(()=>{});
                        });
                    } catch(err) {}
                }
                
                if (notification.recurrence && notification.recurrence !== 'none') {
                    let nextTime = new Date(notification.scheduled_for || new Date());
                    if (notification.recurrence === 'daily') nextTime.setDate(nextTime.getDate() + 1);
                    else if (notification.recurrence === 'weekly') nextTime.setDate(nextTime.getDate() + 7);
                    
                    await pool.query("UPDATE scheduled_notifications SET scheduled_for = $1 WHERE id = $2", [nextTime, notificationId]);
                    
                    const delay = nextTime.getTime() - Date.now();
                    await pushQueue.add('send-push', { notificationId }, { delay: Math.max(delay, 0), jobId: `push_${notificationId}_${nextTime.getTime()}` });
                    console.log(`🔁 Notification ${notificationId} sent and rescheduled for ${nextTime}`);
                } else {
                    await pool.query("UPDATE scheduled_notifications SET status = 'sent' WHERE id = $1", [notificationId]);
                    io.emit('new_notification');
                    console.log(`✅ Scheduled push notification sent: ${notification.title}`);

                    if (notification.image_path) {
                        const safePath = notification.image_path.replace(/^\//, ''); // Strip leading slash
                        const filePath = path.join(__dirname, '..', safePath);
                        try {
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                            await pool.query("UPDATE scheduled_notifications SET image_path = NULL WHERE id = $1", [notificationId]);
                        } catch(e){}
                    }
                }
            } catch (e) { console.error("❌ Scheduled push failed:", e); }
        }
    }, { connection: redisConnection });

    return pushWorker;
}

module.exports = initPushWorker;
