const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../config/database');
const authPool = require('../config/authDb');
const { transporter } = require('../services/email.service');
const { authenticateToken } = require('../middlewares/auth.middleware');

// Fetch User Profile
router.get('/profile', authenticateToken, async (req, res) => {
    const email = req.user.email;
    try {
        let profile = { email: email, name: '', phone: '', accessLevels: req.user.accessLevels, expiryDate: 'Lifetime / N/A' };

        // Check if local student
        const localCheck = await pool.query("SELECT * FROM local_students WHERE email = $1", [email]);
        if (localCheck.rows.length > 0) {
            const user = localCheck.rows[0];
            profile.phone = user.phone;
            profile.expiryDate = user.is_lifetime ? 'Lifetime' : (user.expiry_date ? new Date(user.expiry_date).toLocaleDateString('en-GB') : 'N/A');
        } else {
            // Check WP DB
            const [rows] = await authPool.query("SELECT * FROM wp_gf_student_registrations WHERE student_email = ?", [email]);
            if (rows.length > 0) {
                const wpUser = rows[0];
                profile.phone = wpUser.student_phone;
                profile.name = wpUser.student_name || ''; 
                // Assuming wp DB has a field for level 2 expiry date, replace 'level_2_expiry' with your actual column name
                profile.expiryDate = wpUser.level_2_expiry ? new Date(wpUser.level_2_expiry).toLocaleDateString('en-GB') : 'Lifetime / Check WP';
            }
        }
        res.json({ success: true, profile });
    } catch (err) {
        res.status(500).json({ success: false, msg: "Failed to fetch profile." });
    }
});

// Send OTP for Profile Update
router.post('/send-update-otp', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
        await pool.query("INSERT INTO password_resets (email, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL '15 minutes') ON CONFLICT (email) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at", [email, otp]);

        const mailOptions = {
            from: `"RD Algo Security" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Profile Update OTP - RD Algo`,
            html: `<h3>Your OTP for profile update is: <b>${otp}</b></h3><p>Valid for 15 minutes.</p>`
        };
        await transporter.sendMail(mailOptions);
        res.json({ success: true, msg: "OTP sent to your email." });
    } catch (err) {
        res.status(500).json({ success: false, msg: "Failed to send OTP." });
    }
});

// Verify OTP & Update Profile
router.post('/update-profile', authenticateToken, async (req, res) => {
    const { otp, newName, newPhone, newEmail, newPassword } = req.body;
    const currentEmail = req.user.email;

    try {
        const otpCheck = await pool.query("SELECT * FROM password_resets WHERE email = $1 AND otp = $2 AND expires_at > NOW()", [currentEmail, otp]);
        if (otpCheck.rows.length === 0) return res.status(400).json({ success: false, msg: "Invalid or expired OTP." });

        // Update Local DB (Credentials)
        if (newPassword) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(newPassword, salt, 1000, 64, 'sha512').toString('hex');
            await pool.query("UPDATE user_credentials SET salt = $1, hash = $2 WHERE email = $3", [salt, hash, currentEmail]);
        }

        // Update Local Students Table
        await pool.query("UPDATE local_students SET phone = COALESCE($1, phone), email = COALESCE($2, email) WHERE email = $3", [newPhone || null, newEmail || null, currentEmail]);
        
        // Update User Credentials Table Email if changed
        if (newEmail && newEmail !== currentEmail) {
            await pool.query("UPDATE user_credentials SET email = $1 WHERE email = $2", [newEmail, currentEmail]);
            // You may need to update `login_logs`, `video_progress`, etc., cascading based on your schema.
        }

        // Update WordPress DB
        let wpUpdateQuery = "UPDATE wp_gf_student_registrations SET ";
        let wpParams = [];
        if (newName) { wpUpdateQuery += "student_name = ?, "; wpParams.push(newName); }
        if (newPhone) { wpUpdateQuery += "student_phone = ?, "; wpParams.push(newPhone); }
        if (newEmail) { wpUpdateQuery += "student_email = ?, "; wpParams.push(newEmail); }
        
        if (wpParams.length > 0) {
            wpUpdateQuery = wpUpdateQuery.slice(0, -2) + " WHERE student_email = ?";
            wpParams.push(currentEmail);
            await authPool.query(wpUpdateQuery, wpParams);
        }

        // Clear OTP
        await pool.query("DELETE FROM password_resets WHERE email = $1", [currentEmail]);

        res.json({ success: true, msg: "Profile updated successfully. Please login again if email/password changed.", emailChanged: !!newEmail, passChanged: !!newPassword });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: "Update failed." });
    }
});

module.exports = router;
