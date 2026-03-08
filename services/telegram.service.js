const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
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
    
    // Function to download TG images
    async function downloadTgImage(fileId) {
        try {
            const link = await bot.getFileLink(fileId);
            const ext = path.extname(link) || '.jpg';
            const filename = crypto.randomUUID() + ext;
            const dest = path.join(__dirname, '..', 'public', 'uploads', filename);
            
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(dest);
                https.get(link, (response) => {
                    response.pipe(file);
                    file.on('finish', () => { file.close(); resolve(`/uploads/${filename}`); });
                }).on('error', (err) => { fs.unlink(dest, ()=>{}); reject(err); });
            });
        } catch(e) { return null; }
    }

    // 1. Listen for new messages
    bot.on('message', async (msg) => {
        try {
            const chat_id = msg.chat.id.toString();
            const { rows: channels } = await pool.query("SELECT id FROM channels WHERE telegram_chat_id = $1", [chat_id]);
            if (channels.length === 0) return; // Unlinked channel
            const channelId = channels[0].id;

            // Detect Pin Event
            if (msg.pinned_message) {
                 await pool.query("UPDATE channel_messages SET is_pinned = true WHERE telegram_msg_id = $1", [msg.pinned_message.message_id]);
                 io.emit('channel_msg_update', { channel_id: channelId });
                 return;
            }

            if (!msg.text && !msg.caption && !msg.photo) return;
            
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
            if (msg.photo && msg.photo.length > 0) {
                const fileId = msg.photo[msg.photo.length - 1].file_id; // Get highest resolution
                image_url = await downloadTgImage(fileId);
            }

            await pool.query(
                "INSERT INTO channel_messages (channel_id, sender_email, title, body, telegram_msg_id, reply_to_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
                [channelId, 'Telegram', title, body, msg.message_id, reply_to_id, image_url]
            );

            io.emit('new_channel_msg', { channel_id: channelId });
        } catch(e) { console.error("TG->Web Sync Error (New Msg):", e); }
    });

    // 2. Listen for edited messages
    bot.on('edited_message', async (msg) => {
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
    });
}

module.exports = {
    bot,
    CHAT_ID,
    toMarkdown,
    initTelegramChannelsSync
};
