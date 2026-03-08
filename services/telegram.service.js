const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const webpush = require('web-push');
const pushRoutes = require('../routes/push.routes');
require('dotenv').config();

// Enable polling to listen to incoming TG messages
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TG_CHAT_ID;

// Helper function to escape characters for Telegram MarkdownV2
function toMarkdown(text) { 
    if (text === undefined || text === null) return ""; 
    return String(text)
        .replace(/_/g, "\\_")
        .replace(/\*/g, "\\*")
        .replace(/\[/g, "\\[")
        .replace(/`/g, "\\`"); 
}

// TG -> Web Sync Setup
function initTelegramChannelsSync(pool, io) {
    
    // Function to download TG images/videos
    async function downloadTgImage(fileId) {
        try {
            const link = await bot.getFileLink(fileId);
            const ext = path.extname(link) || '.jpg';
            const filename = crypto.randomUUID() + ext;
            // FIXED PATH: Pointing to the root uploads folder, not public/uploads
            const dest = path.join(__dirname, '..', 'uploads', filename); 
            
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(dest);
                https.get(link, (response) => {
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve(`/uploads/${filename}`); });
                }).on('error', (err) => { fs.unlink(dest, ()=>{}); reject(err); });
            });
        } catch(e) { return null; }
    }

    // 1. Shared logic for incoming messages (Supports both Groups and Channels)
    const handleIncomingMessage = async (msg) => {
        try {
            const chat_id = msg.chat.id.toString();
            const { rows: channels } = await pool.query("SELECT id, name, access_level FROM channels WHERE telegram_chat_id = $1", [chat_id]);
            if (channels.length === 0) return; // Unlinked channel
            const channel = channels[0];
            const channelId = channel.id;

            // Detect Pin Event
            if (msg.pinned_message) {
                 await pool.query("UPDATE channel_messages SET is_pinned = true WHERE telegram_msg_id = $1", [msg.pinned_message.message_id]);
                 io.emit('channel_msg_update', { channel_id: channelId });
                 return;
            }

            // ALLOW VIDEOS NOW
            if (!msg.text && !msg.caption && !msg.photo && !msg.video) return;
            
            let text = msg.text || msg.caption || '';
            let title = 'Telegram Update';
            let body = text;
            
            if (text.includes('\n')) {
                const parts = text.split('\n');
                title = parts[0].replace(/[\*\_]/g, '').trim(); // Remove bold/italic markdown from title
                body = parts.slice(1).join('\n').trim();
            }

            let reply_to_id = null;
            if (msg.reply_to_message) {
                 const { rows: parentMsg } = await pool.query("SELECT id FROM channel_messages WHERE telegram_msg_id = $1", [msg.reply_to_message.message_id]);
                 if (parentMsg.length > 0) reply_to_id = parentMsg[0].id;
            }

            let image_url = null;
            let fileIdToDownload = null;
            
            // Extract file ID for Photo OR Video
            if (msg.photo && msg.photo.length > 0) {
                fileIdToDownload = msg.photo[msg.photo.length - 1].file_id;
            } else if (msg.video) {
                fileIdToDownload = msg.video.file_id;
            }

            if (fileIdToDownload) {
                image_url = await downloadTgImage(fileIdToDownload); // Downloads media (photo/video up to 20MB limit)
            }

            // Insert into Database
            await pool.query(
                "INSERT INTO channel_messages (channel_id, sender_email, title, body, telegram_msg_id, reply_to_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
                [channelId, 'Telegram', title, body, msg.message_id, reply_to_id, image_url]
            );

            // Update real-time UI
            io.emit('new_channel_msg', { channel_id: channelId });

            // Trigger Push Notifications to App Users
            let target_audience = 'logged_in';
            if (channel.access_level === 'demo') target_audience = 'non_logged_in'; 
            else if (channel.access_level === 'level_2_status') target_audience = 'login_with_level_2';
            else if (channel.access_level === 'level_3_status') target_audience = 'login_with_level_3';
            else if (channel.access_level === 'level_4_status') target_audience = 'login_with_level_4';
            
            const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience);
            const targetUrl = (target_audience === 'non_logged_in') ? `/?tab=channels&id=${channelId}` : `/index.html?tab=channels&id=${channelId}`;
            
            const payload = { 
                title: `${channel.name}: ${title}`, 
                body: body, 
                url: targetUrl, 
                image: image_url 
            };

            uniqueSubs.forEach(sub => { 
                try { webpush.sendNotification(sub, JSON.stringify(payload)).catch(e=>{}); } catch(e){} 
            });

        } catch(e) { console.error("TG->Web Sync Error (New Msg):", e); }
    };

    // Attach listeners for both standard groups AND broadcast channels
    bot.on('message', handleIncomingMessage);
    bot.on('channel_post', handleIncomingMessage);

    // 2. Shared logic for edited messages
    const handleEditedMessage = async (msg) => {
        try {
            let text = msg.text || msg.caption || '';
            let title = 'Telegram Update';
            let body = text;
            if (text.includes('\n')) {
                const parts = text.split('\n');
                title = parts[0].replace(/[\*\_]/g, '').trim();
                body = parts.slice(1).join('\n').trim();
            }

            const { rows } = await pool.query("UPDATE channel_messages SET title = $1, body = $2 WHERE telegram_msg_id = $3 RETURNING channel_id", [title, body, msg.message_id]);
            if (rows.length > 0) io.emit('channel_msg_update', { channel_id: rows[0].channel_id });
        } catch(e) { console.error("TG->Web Sync Error (Edit Msg):", e); }
    };

    // Attach listeners for editing in both groups AND broadcast channels
    bot.on('edited_message', handleEditedMessage);
    bot.on('edited_channel_post', handleEditedMessage);
}

module.exports = {
    bot,
    CHAT_ID,
    toMarkdown,
    initTelegramChannelsSync
};
