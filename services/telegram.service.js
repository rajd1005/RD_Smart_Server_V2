const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const webpush = require('web-push');
const pushRoutes = require('../routes/push.routes');
require('dotenv').config();

const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: true });
const CHAT_ID = process.env.TG_CHAT_ID;

function toMarkdown(text) { 
    if (text === undefined || text === null) return ""; 
    return String(text)
        .replace(/_/g, "\\_")
        .replace(/\*/g, "\\*")
        .replace(/\[/g, "\\[")
        .replace(/`/g, "\\`"); 
}

function parseTelegramEntitiesToMarkdown(text, entities) {
    if (!text) return '';
    if (!entities || entities.length === 0) return text;
    let result = '';
    let lastIndex = 0;
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
    if (lastIndex < text.length) result += text.substring(lastIndex);
    return result;
}

function initTelegramChannelsSync(pool, io) {
    
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

    const handleIncomingMessage = async (msg) => {
        try {
            const chat_id = msg.chat.id.toString();
            const { rows: channels } = await pool.query("SELECT id, name, access_level FROM channels WHERE telegram_chat_id = $1", [chat_id]);
            if (channels.length === 0) return;
            const channel = channels[0];
            const channelId = channel.id;

            if (msg.pinned_message) {
                 await pool.query("UPDATE channel_messages SET is_pinned = true WHERE telegram_msg_id = $1", [msg.pinned_message.message_id]);
                 io.emit('channel_msg_update', { channel_id: channelId });
                 return;
            }

            if (!msg.text && !msg.caption && !msg.photo && !msg.video) return;
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
            if (fileIdToDownload) image_url = await downloadTgImage(fileIdToDownload);

            await pool.query(
                "INSERT INTO channel_messages (channel_id, sender_email, title, body, telegram_msg_id, reply_to_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
                [channelId, 'Telegram', title, body, msg.message_id, reply_to_id, image_url]
            );
            io.emit('new_channel_msg', { channel_id: channelId });

            let target_audience = channel.access_level === 'demo' ? 'non_logged_in' : (channel.access_level.includes('level') ? 'login_with_' + channel.access_level.replace('_status','') : 'logged_in');
            const uniqueSubs = await pushRoutes.getValidPushSubscribers(target_audience);
            const targetUrl = (target_audience === 'non_logged_in') ? `/?tab=channels&id=${channelId}` : `/index.html?tab=channels&id=${channelId}`;
            const payload = { title: `${channel.name}: ${title}`.substring(0, 60), body: body.substring(0, 200), url: targetUrl, image: image_url };
            uniqueSubs.forEach(async (sub) => { try { await webpush.sendNotification(sub, JSON.stringify(payload)); } catch(e) {} });
        } catch(e) { console.error("TG->Web New Msg Error:", e); }
    };

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
            }
            const { rows } = await pool.query("UPDATE channel_messages SET title = $1, body = $2 WHERE telegram_msg_id = $3 RETURNING channel_id", [title, body, msg.message_id]);
            if (rows.length > 0) io.emit('channel_msg_update', { channel_id: rows[0].channel_id });
        } catch(e) { console.error("TG->Web Edit Error:", e); }
    };

    // --- NEW: SYNC DELETION FROM TELEGRAM TO WEB ---
    const handleDeletedMessage = async (msg) => {
        try {
            // Note: msg.message_id is what was deleted
            const { rows } = await pool.query("DELETE FROM channel_messages WHERE telegram_msg_id = $1 RETURNING channel_id", [msg.message_id]);
            if (rows.length > 0) {
                console.log(`[TG Sync] Message ${msg.message_id} deleted in Telegram, removed from Web.`);
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

module.exports = { bot, CHAT_ID, toMarkdown, initTelegramChannelsSync };
