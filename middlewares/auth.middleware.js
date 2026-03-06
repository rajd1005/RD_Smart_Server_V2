const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_key_123";

const authenticateToken = async (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) return res.status(401).json({ success: false, msg: "Not authenticated" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { rows } = await pool.query("SELECT session_id FROM login_logs WHERE email = $1 ORDER BY id DESC LIMIT 1", [decoded.email]);
        if (rows.length > 0 && rows[0].session_id !== decoded.sessionId) { 
            res.clearCookie('authToken', { path: '/' }); 
            return res.status(403).json({ success: false, msg: "Session expired." }); 
        }
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('authToken', { path: '/' });
        return res.status(403).json({ success: false, msg: "Session expired" });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, msg: "Admin access required." });
    next();
};

// NEW: Allows both Manager and Admin
const isManagerOrAdmin = (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') return res.status(403).json({ success: false, msg: "Manager access required." });
    next();
};

module.exports = { authenticateToken, isAdmin, isManagerOrAdmin };
