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
        .replace(/`/g, "\\`")
        .replace(/~/g, "\\~"); 
}

// Convert Telegram Entities (Bold, Italic, Links) into Markdown
function parseTelegramEntitiesToMarkdown(text, entities) {
    if (!text) return '';
    if (!entities || entities.length === 0) return text;

    let result = '';
    let lastIndex = 0;
    // Sort entities to process them left-to-right
    let sortedEntities = [...entities].sort((a, b) => a.offset - b.offset);

    for (let i = 0; i < sortedEntities.length; i++) {
        const entity = sortedEntities[i];
        if (entity.offset < lastIndex) continue;

        result += text.substring(lastIndex, entity.offset);
        const entityText = text.substring(entity.offset, entity.offset + entity.length);

        if (entity.type === 'bold') result += `*${entityText}*`;
        else if (entity.type === 'italic') result += `_${entityText}_`;
        else if (entity.type === 'strikethrough') result += `~${entityText}~`;
        else if (entity.type === 'code' || entity.type === 'pre') result += `\`${entityText}\``;
        else if (entity.type === 'text_link') result += `[${entityText}](${entity.url})`;
        else result += entityText;

        lastIndex = entity.offset + entity.length;
    }

    if (lastIndex < text.length) {
        result += text.substring(lastIndex);
    }

    return result;
}

// TG -> Web Sync Setup
function initTelegramChannelsSync(pool, io) {
    
    // Function to download TG images/videos
    async function downloadTgImage(fileId) {
        try {
            const link = await bot.getFileLink(fileId);
            const ext = path.extname(link) || '.jpg';
            const filename = crypto.randomUUID() + ext;
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

            if (!msg.text && !msg.caption && !msg.photo && !msg.video) return;
            
            let rawText = msg.text || msg.caption || '';
            // INJECT MARKDOWN STYLING AND LINKS
            let formattedText = parseTelegramEntitiesToMarkdown(rawText, msg.entities || msg.caption_entities);
            
            let title = 'Telegram Update';
            let body = formattedText;
            
            // Generate clean title & body, with fallbacks for empty media
            if (formattedText.includes('\n')) {
                const parts = formattedText.split('\n');
                title = parts[0].replace(/[\*\_~`]/g, '').trim(); 
                body = parts.slice(1).join('\n').trim();
            } else if (formattedText) {
                title = rawText.length > 35 ? rawText.substring(0, 35).replace(/[\*\_~`]/g, '') + '...' : rawText.replace(/[\*\_~`]/g, '');
                body = formattedText;
            } else if (msg.photo) {
                title = 'New Image Alert';
                body = '📷 Attached image';
            } else if (msg.video) {
                title = 'New Video Alert';
                body = '🎥 Attached video';
            }

            let reply_to_id = null;
            if (msg.reply_to_message) {
                 const { rows: parentMsg } = await pool.query("SELECT id FROM channel_messages WHERE telegram_msg_id = $1", [msg.reply_to_message.message_id]);
                 if (parentMsg.length > 0) reply_to_id = parentMsg[0].id;
            }

            let image_url = null;
            let fileIdToDownload = (msg.photo && msg.photo.length > 0) ? msg.photo[msg.photo.length - 1].file_id : (msg.video ? msg.video.file_id : null);
            
            if (fileIdToDownload) {
                image_url = await downloadTgImage(fileIdToDownload);
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
                title: `${channel.name}: ${title}`.substring(0, 60), 
                body: body.substring(0, 200), 
                url: targetUrl, 
                image: image_url 
            };

            uniqueSubs.forEach(async (sub) => { 
                try { 
                    await webpush.sendNotification(sub, JSON.stringify(payload));
                } catch(e) {} 
            });

        } catch(e) { console.error("TG->Web Sync Error (New Msg):", e); }
    };

    // 2. Shared logic for edited messages
    const handleEditedMessage = async (msg) => {
        try {
            let rawText = msg.text || msg.caption || '';
            let formattedText = parseTelegramEntitiesToMarkdown(rawText, msg.entities || msg.caption_entities);
            
            let title = 'Telegram Update';
            let body = formattedText;
            
            if (formattedText.includes('\n')) {
                const parts = formattedText.split('\n');
                title = parts[0].replace(/[\*\_~`]/g, '').trim();
                body = parts.slice(1).join('\n').trim();
            } else if (formattedText) {
                title = rawText.length > 35 ? rawText.substring(0, 35).replace(/[\*\_~`]/g, '') + '...' : rawText.replace(/[\*\_~`]/g, '');
            }

            const { rows } = await pool.query("UPDATE channel_messages SET title = $1, body = $2 WHERE telegram_msg_id = $3 RETURNING channel_id", [title, body, msg.message_id]);
            if (rows.length > 0) io.emit('channel_msg_update', { channel_id: rows[0].channel_id });
        } catch(e) { console.error("TG->Web Sync Error (Edit Msg):", e); }
    };

    // 3. Sync deletion from Telegram to Web
    const handleDeletedMessage = async (msg) => {
        try {
            const { rows } = await pool.query("DELETE FROM channel_messages WHERE telegram_msg_id = $1 RETURNING channel_id", [msg.message_id]);
            if (rows.length > 0) {
                io.emit('channel_msg_update', { channel_id: rows[0].channel_id });
            }
        } catch(e) { console.error("TG->Web Delete Error:", e); }
    };

    bot.on('message', handleIncomingMessage);
    bot.on('channel_post', handleIncomingMessage);
    bot.on('edited_message', handleEditedMessage);
    bot.on('edited_channel_post', handleEditedMessage);
    
    // Listen for deletions (Requires Bot to be Admin)
    bot.on('delete_chat_message', handleDeletedMessage);
    bot.on('delete_channel_post', handleDeletedMessage);
}

module.exports = {
    bot,
    CHAT_ID,
    toMarkdown,
    initTelegramChannelsSync
};
