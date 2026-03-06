const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: false });
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

module.exports = {
    bot,
    CHAT_ID,
    toMarkdown
};
