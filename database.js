const { Pool } = require('pg');
require('dotenv').config();

// Connect to Railway PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
    const queryTrades = `
    CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY, trade_id VARCHAR(50) UNIQUE NOT NULL, symbol VARCHAR(20) NOT NULL, type VARCHAR(10) NOT NULL,
        entry_price DECIMAL DEFAULT 0, sl_price DECIMAL DEFAULT 0, tp1_price DECIMAL DEFAULT 0, tp2_price DECIMAL DEFAULT 0,
        tp3_price DECIMAL DEFAULT 0, status VARCHAR(20) DEFAULT 'SIGNAL', points_gained DECIMAL DEFAULT 0,
        telegram_msg_id BIGINT, created_at VARCHAR(50), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    const queryLogs = `
    CREATE TABLE IF NOT EXISTS login_logs (
        id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, session_id VARCHAR(255) NOT NULL,
        ip_address VARCHAR(255), login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    const queryLearningModules = `
    CREATE TABLE IF NOT EXISTS learning_modules (
        id SERIAL PRIMARY KEY, title VARCHAR(255) UNIQUE NOT NULL, description TEXT,
        required_level VARCHAR(20) NOT NULL, display_order INT DEFAULT 0, lock_notice TEXT
    );`;

    const queryLessonVideos = `
    CREATE TABLE IF NOT EXISTS lesson_videos (
        id SERIAL PRIMARY KEY, module_id INT REFERENCES learning_modules(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, description TEXT, hls_manifest_url TEXT NOT NULL,
        display_order INT DEFAULT 0, thumbnail_url TEXT
    );`;

    const querySettings = `
    CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value VARCHAR(255)
    );`;

    const queryUserCreds = `
    CREATE TABLE IF NOT EXISTS user_credentials (
        email VARCHAR(255) PRIMARY KEY,
        salt VARCHAR(255) NOT NULL,
        hash VARCHAR(255) NOT NULL
    );`;

    const queryPasswordResets = `
    CREATE TABLE IF NOT EXISTS password_resets (
        email VARCHAR(255) PRIMARY KEY,
        otp VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP NOT NULL
    );`;

    // UPDATED: Added hide_trade_tab default to database setup
    const populateDefaultSettings = `
    INSERT INTO system_settings (setting_key, setting_value) VALUES 
    ('accordion_state', 'first'),
    ('hide_trade_tab', 'false')
    ON CONFLICT (setting_key) DO NOTHING;`;

    const upgradeModulesTable = `ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS lock_notice TEXT;`;
    const upgradeLessonsTable = `ALTER TABLE lesson_videos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;`;

    try {
        await pool.query(queryTrades);
        await pool.query(queryLogs); 
        await pool.query(queryLearningModules); 
        await pool.query(upgradeModulesTable); 
        await pool.query(queryLessonVideos); 
        await pool.query(upgradeLessonsTable); 
        await pool.query(querySettings);
        await pool.query(queryUserCreds);
        await pool.query(queryPasswordResets);
        await pool.query(populateDefaultSettings);
        console.log("✅ Database Tables Verified/Created (Trades + LMS + Auth + Settings)");
    } catch (err) {
        console.error("❌ Database Error:", err);
    }
};

module.exports = { pool, initDb };
