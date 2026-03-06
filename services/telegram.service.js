const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pushQueue } = require('../workers/push.worker');

const token = process.env.TG_BOT_TOKEN;
let bot = null;

if (token) {
    bot = new TelegramBot(token, { polling: true });
    console.log("✅ Telegram Bot initialized for 2-Way Channel Sync.");

    bot.on('channel_post', async (msg) => {
        try {
            const syncSet = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tg_2way_sync'");
            if (!syncSet.rows.length || syncSet.rows[0].setting_value !== 'true') return;

            const tgChatId = msg.chat.id.toString();
            const tgMsgId = msg.message_id;

            const chRes = await pool.query("SELECT * FROM channels WHERE telegram_chat_id = $1", [tgChatId]);
            if (chRes.rows.length === 0) return; 
            
            const channel = chRes.rows[0];
            let messageText = msg.text || msg.caption || '';
            let mediaUrl = null;
            let replyToLocalId = null;

            if (msg.reply_to_message) {
                const tgReplyId = msg.reply_to_message.message_id;
                const localMsgCheck = await pool.query("SELECT id FROM channel_messages WHERE telegram_msg_id = $1 LIMIT 1", [tgReplyId]);
                if (localMsgCheck.rows.length > 0) {
                    replyToLocalId = localMsgCheck.rows[0].id;
                }
            }

            if (msg.photo && msg.photo.length > 0) {
                const photo = msg.photo[msg.photo.length - 1];
                const fileLink = await bot.getFileLink(photo.file_id);
                const ext = path.extname(fileLink) || '.jpg';
                const filename = `${photo.file_id}${ext}`;
                const destPath = path.join(__dirname, '../uploads', filename);
                
                await new Promise((resolve, reject) => {
                    const file = fs.createWriteStream(destPath);
                    https.get(fileLink, (response) => {
                        response.pipe(file);
                        file.on('finish', () => { file.close(); resolve(); });
                    }).on('error', (err) => { fs.unlink(destPath); reject(err); });
                });
                mediaUrl = `/uploads/${filename}`;
            }

            await pool.query(
                "INSERT INTO channel_messages (channel_id, telegram_msg_id, sender_email, sender_name, message_text, media_url, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [channel.id, tgMsgId, 'telegram_sync', 'Telegram Admin', messageText, mediaUrl, replyToLocalId]
            );

            let pushTarget = 'both';
            if (channel.required_level === 'level_2') pushTarget = 'login_with_level_2';
            else if (channel.required_level === 'level_3') pushTarget = 'login_with_level_3';
            else if (channel.required_level === 'level_4') pushTarget = 'login_with_level_4';

            const pushTitle = `New post in ${channel.name}`;
            const pushBody = messageText ? (messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText) : 'Media attachment uploaded.';
            
            await pushQueue.add('send-push', { title: pushTitle, body: pushBody, targetAudience: pushTarget, url: `/home.html` });

        } catch (error) { console.error("❌ TG Sync Error:", error); }
    });
}

const sendChannelMessage = async (chatId, text, imagePath, replyToLocalId = null) => {
    if (!bot) return null;
    try {
        const opts = { parse_mode: 'HTML' }; 
        if (replyToLocalId) {
            const repCheck = await pool.query("SELECT telegram_msg_id FROM channel_messages WHERE id = $1", [replyToLocalId]);
            if (repCheck.rows.length > 0 && repCheck.rows[0].telegram_msg_id) {
                opts.reply_to_message_id = parseInt(repCheck.rows[0].telegram_msg_id);
            }
        }

        let sentMsg;
        if (imagePath && fs.existsSync(imagePath)) {
            sentMsg = await bot.sendPhoto(chatId, imagePath, { caption: text, ...opts });
        } else if (text) {
            sentMsg = await bot.sendMessage(chatId, text, opts);
        }
        return sentMsg ? sentMsg.message_id : null;
    } catch (err) { return null; }
};

module.exports = { bot, sendChannelMessage };
