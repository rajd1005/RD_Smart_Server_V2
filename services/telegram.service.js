const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = process.env.TG_BOT_TOKEN;
let bot = null;

if (token) {
    bot = new TelegramBot(token, { polling: true });
    console.log("✅ Telegram Bot initialized for 2-Way Channel Sync.");

    // --- LISTENER: Catch messages sent natively in Telegram ---
    bot.on('channel_post', async (msg) => {
        try {
            // 1. Check if 2-Way Sync is ON
            const syncSet = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tg_2way_sync'");
            if (!syncSet.rows.length || syncSet.rows[0].setting_value !== 'true') return;

            const tgChatId = msg.chat.id.toString();
            const tgMsgId = msg.message_id;

            // 2. Check if this Telegram Channel is linked to a Website Channel
            const chRes = await pool.query("SELECT id FROM channels WHERE telegram_chat_id = $1", [tgChatId]);
            if (chRes.rows.length === 0) return; // Not linked, ignore.
            
            const channelId = chRes.rows[0].id;
            let messageText = msg.text || msg.caption || '';
            let mediaUrl = null;

            // 3. Handle Media (Download image from Telegram to Website server)
            if (msg.photo && msg.photo.length > 0) {
                // Get highest resolution photo
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await bot.getFileLink(photo.file_id);
                
                const ext = path.extname(fileLink) || '.jpg';
                const filename = `${photo.file_id}${ext}`;
                const destPath = path.join(__dirname, '../uploads', filename);
                
                // Download file locally
                await new Promise((resolve, reject) => {
                    const file = fs.createWriteStream(destPath);
                    https.get(fileLink, (response) => {
                        response.pipe(file);
                        file.on('finish', () => { file.close(); resolve(); });
                    }).on('error', (err) => { fs.unlink(destPath); reject(err); });
                });
                
                mediaUrl = `/uploads/${filename}`;
            }

            // 4. Save to Database
            const dbRes = await pool.query(
                "INSERT INTO channel_messages (channel_id, telegram_msg_id, sender_email, sender_name, message_text, media_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                [channelId, tgMsgId, 'telegram_sync', 'Telegram Admin', messageText, mediaUrl]
            );

            // 5. We cannot easily access req.app.get('io') here without a bit of a workaround.
            // Since this runs globally, the easiest way to trigger a dashboard update is via a Redis Pub/Sub 
            // OR just let the frontend auto-refresh if they have the channel open.
            console.log(`🔄 2-Way Sync: Received message from TG Channel and saved to Web Channel ID: ${channelId}`);
            
        } catch (error) {
            console.error("❌ Error syncing Telegram -> Web:", error);
        }
    });
}

// --- FUNCTION: Send message from Web Dashboard to Telegram ---
const sendChannelMessage = async (chatId, text, imagePath) => {
    if (!bot) return null;
    try {
        const opts = { parse_mode: 'HTML' }; // Allow bold/italics
        let sentMsg;
        
        if (imagePath && fs.existsSync(imagePath)) {
            sentMsg = await bot.sendPhoto(chatId, imagePath, { caption: text, ...opts });
        } else if (text) {
            sentMsg = await bot.sendMessage(chatId, text, opts);
        }
        return sentMsg ? sentMsg.message_id : null;
    } catch (err) {
        console.error("❌ Telegram Send Failed:", err.message);
        return null;
    }
};

module.exports = {
    bot,
    sendChannelMessage
};
