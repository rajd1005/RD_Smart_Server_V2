const { Pool } = require('pg');
require('dotenv').config();

// Connect to Railway PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
    // 1. Trading Table (Untouched)
    const queryTrades = `
    CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY, trade_id VARCHAR(50) UNIQUE NOT NULL, symbol VARCHAR(20) NOT NULL, type VARCHAR(10) NOT NULL,
        entry_price DECIMAL DEFAULT 0, sl_price DECIMAL DEFAULT 0, tp1_price DECIMAL DEFAULT 0, tp2_price DECIMAL DEFAULT 0,
        tp3_price DECIMAL DEFAULT 0, status VARCHAR(20) DEFAULT 'SIGNAL', points_gained DECIMAL DEFAULT 0,
        telegram_msg_id BIGINT, created_at VARCHAR(50), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    // 2. Login Tracking Table (Untouched)
    const queryLogs = `
    CREATE TABLE IF NOT EXISTS login_logs (
        id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, session_id VARCHAR(255) NOT NULL,
        ip_address VARCHAR(255), login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    // 3. NEW: Learning Modules (Course Categories)
    const queryLearningModules = `
    CREATE TABLE IF NOT EXISTS learning_modules (
        id SERIAL PRIMARY KEY, title VARCHAR(255) UNIQUE NOT NULL, description TEXT,
        required_level VARCHAR(20) NOT NULL, display_order INT DEFAULT 0
    );`;

    // 4. NEW: Individual Lesson Videos
    const queryLessonVideos = `
    CREATE TABLE IF NOT EXISTS lesson_videos (
        id SERIAL PRIMARY KEY, module_id INT REFERENCES learning_modules(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, description TEXT, hls_manifest_url TEXT NOT NULL,
        display_order INT DEFAULT 0
    );`;

    // 5. NEW: Auto-populate default levels
    const populateDefaultModules = `
    INSERT INTO learning_modules (title, description, required_level, display_order) VALUES 
    ('Level 1: Foundations', 'Basic trading concepts.', 'level_1_status', 1),
    ('Level 2: Advanced Strategy', 'Mastering the RD system.', 'level_2_status', 2),
    ('Level 3: Pro Risk Management', 'Protecting your capital.', 'level_3_status', 3),
    ('Level 4: Mastering Psychology', 'The trader''s mindset.', 'level_4_status', 4)
    ON CONFLICT (title) DO NOTHING;`;

    try {
        await pool.query(queryTrades);
        await pool.query(queryLogs); 
        await pool.query(queryLearningModules); 
        await pool.query(queryLessonVideos); 
        await pool.query(populateDefaultModules); 
        console.log("✅ Database Tables Verified/Created (Trades + LMS)");
    } catch (err) {
        console.error("❌ Database Error:", err);
    }
};

module.exports = { pool, initDb };
