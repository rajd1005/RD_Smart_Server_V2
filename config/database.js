const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDb = async () => {
    // --- EXISTING TABLES ---
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
        required_level VARCHAR(20) NOT NULL, display_order INT DEFAULT 0, lock_notice TEXT,
        show_on_home BOOLEAN DEFAULT TRUE, dashboard_visibility VARCHAR(20) DEFAULT 'all'
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
        setting_value TEXT
    );`;

    const queryUserCreds = `
    CREATE TABLE IF NOT EXISTS user_credentials (
        email VARCHAR(255) PRIMARY KEY, salt VARCHAR(255) NOT NULL, hash VARCHAR(255) NOT NULL
    );`;

    const queryPasswordResets = `
    CREATE TABLE IF NOT EXISTS password_resets (
        email VARCHAR(255) PRIMARY KEY, otp VARCHAR(10) NOT NULL, expires_at TIMESTAMP NOT NULL
    );`;

    const queryProgress = `
    CREATE TABLE IF NOT EXISTS video_progress (
        email VARCHAR(255) NOT NULL, lesson_id INT REFERENCES lesson_videos(id) ON DELETE CASCADE,
        watched_seconds INT DEFAULT 0, last_watched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (email, lesson_id)
    );`;

    const queryPushSubscriptions = `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, sub_data JSON NOT NULL
    );`;

    const queryScheduledNotifications = `
    CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, url VARCHAR(255),
        scheduled_for TIMESTAMP, status VARCHAR(20) DEFAULT 'pending', target_audience VARCHAR(50) DEFAULT 'both',
        recurrence VARCHAR(20) DEFAULT 'none', image_path TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    // --- NEW CHANNELS TABLES ---
    
    // 1. Stores the broadcast channels (like "General", "Pro Signals")
    const queryChannels = `
    CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        required_level VARCHAR(20) DEFAULT 'demo',
        telegram_chat_id VARCHAR(100),
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    // 2. Stores the actual messages sent in the channels
    const queryChannelMessages = `
    CREATE TABLE IF NOT EXISTS channel_messages (
        id SERIAL PRIMARY KEY,
        channel_id INT REFERENCES channels(id) ON DELETE CASCADE,
        telegram_msg_id BIGINT,
        sender_email VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        message_text TEXT,
        media_url TEXT,
        is_pinned BOOLEAN DEFAULT FALSE,
        reply_to_id INT REFERENCES channel_messages(id) ON DELETE SET NULL,
        scheduled_for TIMESTAMP,
        status VARCHAR(20) DEFAULT 'sent',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    // 3. Tracks when a user last checked a channel to show the "Unread Dot"
    const queryUserChannelReads = `
    CREATE TABLE IF NOT EXISTS user_channel_reads (
        email VARCHAR(255) NOT NULL,
        channel_id INT REFERENCES channels(id) ON DELETE CASCADE,
        last_read_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (email, channel_id)
    );`;

    const populateDefaultSettings = `
    INSERT INTO system_settings (setting_key, setting_value) VALUES 
    ('accordion_state', 'first'),
    ('hide_trade_tab', 'false'),
    ('show_gallery', 'true'),
    ('show_call_widget', 'true'),
    ('show_sticky_footer', 'true'),
    ('sticky_btn1_text', 'WhatsAppUs'),
    ('sticky_btn1_link', 'https://wa.me/'),
    ('sticky_btn1_icon', 'chat'),
    ('sticky_btn2_text', 'JoinTelegram'),
    ('sticky_btn2_link', 'https://t.me/'),
    ('sticky_btn2_icon', 'send'),
    ('show_disclaimer', 'true'),
    ('register_link', '#'),
    ('cat_forex_crypto', ''),
    ('cat_stock', ''),
    ('cat_index', ''),
    ('cat_mcx', ''),
    ('push_trade_alerts', 'true'),
    ('show_channels_tab', 'true'), 
    ('tg_2way_sync', 'true') 
    ON CONFLICT (setting_key) DO NOTHING;`;

    try {
        await pool.query(queryTrades);
        await pool.query(queryLogs); 
        await pool.query(queryLearningModules); 
        await pool.query(queryLessonVideos); 
        await pool.query(querySettings);
        await pool.query(queryUserCreds);
        await pool.query(queryPasswordResets);
        await pool.query(queryProgress);
        await pool.query(queryPushSubscriptions);
        await pool.query(queryScheduledNotifications);
        
        // Execute new Channels tables
        await pool.query(queryChannels);
        await pool.query(queryChannelMessages);
        await pool.query(queryUserChannelReads);
        
        await pool.query(populateDefaultSettings);

        // Run ALTER statements safely to update existing tables
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS lock_notice TEXT;`); } catch(e){}
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT TRUE;`); } catch(e){}
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS dashboard_visibility VARCHAR(20) DEFAULT 'all';`); } catch(e){}
        try { await pool.query(`ALTER TABLE lesson_videos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS target_audience VARCHAR(50) DEFAULT 'both';`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) DEFAULT 'none';`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS image_path TEXT;`); } catch(e){}

        // --- NEW: 7-DAY RETENTION CLEANUP ---
        // Every time the server starts, it deletes messages older than 7 days to keep the database light
        const deletedRows = await pool.query(`DELETE FROM channel_messages WHERE created_at < NOW() - INTERVAL '7 days'`);
        if (deletedRows.rowCount > 0) {
            console.log(`🧹 Auto-Cleanup: Deleted ${deletedRows.rowCount} channel messages older than 7 days.`);
        }

        console.log("✅ Database Tables Verified/Created (Trades + LMS + Auth + Settings + Calls + Progress + Push + Notifications + Channels)");
    } catch (err) {
        console.error("❌ Database Error:", err);
    }
};

module.exports = { pool, initDb };
