require('dotenv').config();
const { pool } = require('./config/database');

async function deleteExtraTables() {
    const dropQuery = `
        DROP TABLE IF EXISTS channel_messages CASCADE;
        DROP TABLE IF EXISTS channels CASCADE;
        DROP TABLE IF EXISTS chat_channels CASCADE;
        DROP TABLE IF EXISTS chat_messages CASCADE;
        DROP TABLE IF EXISTS chat_moderators CASCADE;
        DROP TABLE IF EXISTS user_channel_reads CASCADE;
    `;

    try {
        console.log("⏳ Deleting extra tables...");
        await pool.query(dropQuery);
        console.log("✅ Extra tables deleted successfully!");
    } catch (err) {
        console.error("❌ Error deleting tables:", err.message);
    } finally {
        process.exit(0);
    }
}

deleteExtraTables();
