const { Pool } = require('pg');
require('dotenv').config();

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

    const queryProgress = `
    CREATE TABLE IF NOT EXISTS video_progress (
        email VARCHAR(255) NOT NULL,
        lesson_id INT REFERENCES lesson_videos(id) ON DELETE CASCADE,
        watched_seconds INT DEFAULT 0,
        last_watched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (email, lesson_id)
    );`;

    const queryPushSubscriptions = `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY, 
        email VARCHAR(255) NOT NULL, 
        sub_data JSON NOT NULL
    );`;

    const queryScheduledNotifications = `
    CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        url VARCHAR(255),
        scheduled_for TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        target_audience VARCHAR(50) DEFAULT 'both',
        recurrence VARCHAR(20) DEFAULT 'none',
        image_path TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    ('show_channel_tab', 'true')
    ON CONFLICT (setting_key) DO NOTHING;`;

    const queryChannels = `
    CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        access_level VARCHAR(50) DEFAULT 'demo',
        show_on_home BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

    const queryChannelMessages = `
    CREATE TABLE IF NOT EXISTS channel_messages (
        id SERIAL PRIMARY KEY,
        channel_id INT REFERENCES channels(id) ON DELETE CASCADE,
        sender_email VARCHAR(255),
        title VARCHAR(255),
        body TEXT,
        image_url VARCHAR(255),
        link_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;

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
        await pool.query(queryChannels);
        await pool.query(queryChannelMessages);
        await pool.query(populateDefaultSettings);

        // Run ALTER statements safely to update existing tables
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS lock_notice TEXT;`); } catch(e){}
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT TRUE;`); } catch(e){}
        try { await pool.query(`ALTER TABLE learning_modules ADD COLUMN IF NOT EXISTS dashboard_visibility VARCHAR(20) DEFAULT 'all';`); } catch(e){}
        try { await pool.query(`ALTER TABLE lesson_videos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS target_audience VARCHAR(50) DEFAULT 'both';`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) DEFAULT 'none';`); } catch(e){}
        try { await pool.query(`ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS image_path TEXT;`); } catch(e){}
        
        // Channels updates
        try { await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT TRUE;`); } catch(e){}
        try { await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS dashboard_visibility VARCHAR(20) DEFAULT 'all';`); } catch(e){}
        try { await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;`); } catch(e){}
        try { await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(255);`); } catch(e){}

        // Channel Messages updates (Reply and Pin features)
        try { await pool.query(`ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS reply_to_id INT REFERENCES channel_messages(id) ON DELETE SET NULL;`); } catch(e){}
        try { await pool.query(`ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;`); } catch(e){}
        try { await pool.query(`ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS telegram_msg_id BIGINT;`); } catch(e){}

        console.log("✅ Database Tables Verified/Created (Trades + LMS + Auth + Settings + Calls + Progress + Push + Notifications + Channels)");
    } catch (err) {
        console.error("❌ Database Error:", err);
    }
};

module.exports = { pool, initDb };
