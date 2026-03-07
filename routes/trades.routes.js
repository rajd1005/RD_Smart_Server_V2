const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { bot, CHAT_ID, toMarkdown } = require('../services/telegram.service');
const { authenticateToken } = require('../middlewares/auth.middleware');
const pushRoutes = require('./push.routes'); 
const { sendPushNotification, checkTradePushEnabled } = pushRoutes;

const DELETE_PASSWORD = (process.env.DELETE_PASSWORD || "admin123").trim(); 

function getISTTime() { 
    return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }); 
}
function getDBTime() { 
    return new Date().toISOString(); 
}
function calculatePoints(type, entry, currentPrice) { 
    if (!entry || !currentPrice) return 0; 
    return (type === 'BUY') ? (currentPrice - entry) : (entry - currentPrice); 
}

router.get('/', authenticateToken, async (req, res) => {
    try {
        // --- NEW LOGIC: Check if trade alerts are enabled ---
        const settingRes = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'push_trade_alerts'");
        const pushTradeAlerts = settingRes.rows.length > 0 ? settingRes.rows[0].setting_value : 'true';

        // If trade alerts are disabled, send an empty array so the frontend shows nothing for trades
        if (pushTradeAlerts === 'false' || pushTradeAlerts === '0') {
            return res.json([]); 
        }

        // If enabled, fetch trades as normal
        res.json((await pool.query(`SELECT * FROM trades WHERE CAST(created_at AS TIMESTAMP) >= NOW() - INTERVAL '30 days' ORDER BY id DESC`)).rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

router.post('/signal_detected', async (req, res) => {
    const { trade_id, symbol, type, entry, sl, tp1, tp2, tp3 } = req.body;
    try {
        console.log(`\n➡️ TRADE WEBHOOK RECEIVED: SIGNAL (${symbol} ${type})`);
        
        let sentMsgId = null;
        try {
            let tgMsg = `🚨 *NEW SIGNAL DETECTED*\n\n💎 *Symbol:* #${toMarkdown(symbol)}\n📊 *Type:* ${toMarkdown(type)}\n🕒 *Time:* ${toMarkdown(getISTTime())}`;
            if (entry || sl || tp1) {
                tgMsg += `\n\n🚪 *Entry:* ${toMarkdown(entry)}\n🛑 *SL:* ${toMarkdown(sl)}\n🎯 *TP1:* ${toMarkdown(tp1)} | *TP2:* ${toMarkdown(tp2)} | *TP3:* ${toMarkdown(tp3)}`;
            }
            const sentMsg = await bot.sendMessage(CHAT_ID, tgMsg, { parse_mode: 'Markdown' });
            sentMsgId = sentMsg.message_id;
        } catch (tgErr) { console.error("⚠️ Telegram Send Failed (Skipping TG):", tgErr.message); }

        await pool.query(
            `INSERT INTO trades (trade_id, symbol, type, entry_price, sl_price, tp1_price, tp2_price, tp3_price, telegram_msg_id, created_at, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SIGNAL') ON CONFLICT (trade_id) DO NOTHING;`, 
             [trade_id, symbol, type, entry || 0, sl || 0, tp1 || 0, tp2 || 0, tp3 || 0, sentMsgId, getDBTime()]
        );
        await pool.query("DELETE FROM trades WHERE CAST(created_at AS TIMESTAMP) < NOW() - INTERVAL '30 days'");
        
        req.app.get('io').emit('trade_update'); 
        res.json({ success: true });
    } catch (err) { 
        console.error("❌ SIGNAL ENDPOINT ERROR:", err);
        res.status(500).json({ error: err.message }); 
    }
});

router.post('/setup_confirmed', async (req, res) => {
    const { trade_id, symbol, type, entry, sl, tp1, tp2, tp3 } = req.body;
    try {
        console.log(`\n➡️ TRADE WEBHOOK RECEIVED: SETUP CONFIRMED (${symbol})`);

        const isPushEnabled = await checkTradePushEnabled();
        const oldTrades = await pool.query("SELECT * FROM trades WHERE symbol = $1 AND status IN ('SIGNAL', 'SETUP', 'ACTIVE') AND trade_id != $2", [symbol, trade_id]);
        
        let reversalSymbols = [];
        for (const t of oldTrades.rows) {
            await pool.query("UPDATE trades SET status = 'CLOSED (Reversal)' WHERE trade_id = $1", [t.trade_id]);
            
            try {
                if(t.telegram_msg_id) { await bot.sendMessage(CHAT_ID, `🔄 *Trade Reversed*\n❌ Closed by new signal.`, { reply_to_message_id: t.telegram_msg_id, parse_mode: 'Markdown' }); }
            } catch(tgErr) { console.error("⚠️ Telegram Reversal Send Failed (Skipping TG):", tgErr.message); }
            
            reversalSymbols.push(t.symbol);
        }
        
        const check = await pool.query("SELECT telegram_msg_id FROM trades WHERE trade_id = $1", [trade_id]);
        await pool.query(`INSERT INTO trades (trade_id, symbol, type, entry_price, sl_price, tp1_price, tp2_price, tp3_price, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SETUP', $9) ON CONFLICT (trade_id) DO UPDATE SET entry_price = EXCLUDED.entry_price, sl_price = EXCLUDED.sl_price, tp1_price = EXCLUDED.tp1_price, tp2_price = EXCLUDED.tp2_price, tp3_price = EXCLUDED.tp3_price, status = 'SETUP';`, [trade_id, symbol, type, entry, sl, tp1, tp2, tp3, getDBTime()]);
        
        try {
            const opts = { parse_mode: 'Markdown' }; if (check.rows[0]?.telegram_msg_id) opts.reply_to_message_id = check.rows[0].telegram_msg_id;
            await bot.sendMessage(CHAT_ID, `✅ *SETUP CONFIRMED*\n\n💎 *Symbol:* #${toMarkdown(symbol)}\n🚀 *Type:* ${toMarkdown(type)}\n🚪 *Entry:* ${toMarkdown(entry)}\n🛑 *SL:* ${toMarkdown(sl)}\n\n🎯 *TP1:* ${toMarkdown(tp1)}\n🎯 *TP2:* ${toMarkdown(tp2)}\n🎯 *TP3:* ${toMarkdown(tp3)}`, opts);
        } catch(tgErr) { console.error("⚠️ Telegram Send Failed (Skipping TG):", tgErr.message); }

        req.app.get('io').emit('trade_update'); 
        
        if (isPushEnabled) { 
            let bodyStr = `${symbol} - ${type}\nEntry: ${entry} | SL: ${sl}\nTargets: ${tp1}, ${tp2}, ${tp3}`;
            if (reversalSymbols.length > 0) {
                bodyStr = `🔄 CLOSED: ${reversalSymbols.join(', ')} (Reversal)\n\n${bodyStr}`;
            }
            await sendPushNotification({ title: '✅ SETUP CONFIRMED', body: bodyStr }, req.app.get('io')); 
        }
        
        res.json({ success: true });
    } catch (err) { 
        console.error("❌ SETUP ENDPOINT ERROR:", err);
        res.status(500).json({ error: err.message }); 
    }
});

router.post('/price_update', async (req, res) => {
    const { symbol, bid, ask } = req.body;
    try {
        const trades = await pool.query("SELECT * FROM trades WHERE symbol = $1 AND status = 'ACTIVE'", [symbol]);
        for (const t of trades.rows) { await pool.query("UPDATE trades SET points_gained = $1 WHERE id = $2", [calculatePoints(t.type, t.entry_price, (t.type === 'BUY') ? bid : ask), t.id]); }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/log_event', async (req, res) => {
    const { trade_id, new_status, price } = req.body;
    try {
        console.log(`\n➡️ TRADE WEBHOOK RECEIVED: EVENT (${new_status})`);

        const result = await pool.query("SELECT * FROM trades WHERE trade_id = $1", [trade_id]);
        if (result.rows.length === 0) return res.json({ success: false, msg: "Trade not found" });
        const trade = result.rows[0];
        
        if (trade.status.includes('TP') && new_status === 'SL HIT') { return res.json({ success: true, msg: "Profit Locked: SL Ignored" }); }
        if (trade.status === 'TP3 HIT' && (new_status === 'TP2 HIT' || new_status === 'TP1 HIT')) return res.json({ success: true });
        if (trade.status === 'TP2 HIT' && new_status === 'TP1 HIT') return res.json({ success: true });
        if (trade.status === new_status) return res.json({ success: true }); 

        await pool.query("UPDATE trades SET status = $1, points_gained = $2 WHERE trade_id = $3", [new_status, calculatePoints(trade.type, trade.entry_price, price), trade_id]);
        
        try {
            const opts = { parse_mode: 'Markdown' }; if (trade.telegram_msg_id) opts.reply_to_message_id = trade.telegram_msg_id;
            await bot.sendMessage(CHAT_ID, `⚡ *UPDATE: ${toMarkdown(new_status)}*\n\n💎 *Symbol:* #${toMarkdown(trade.symbol)}\n📉 *Price:* ${toMarkdown(price)}`, opts);
        } catch(tgErr) { console.error("⚠️ Telegram Send Failed (Skipping TG):", tgErr.message); }
        
        req.app.get('io').emit('trade_update'); 
        
        const isPushEnabled = await checkTradePushEnabled();
        
        if (isPushEnabled && new_status !== 'SL HIT') { 
            await sendPushNotification({ title: `⚡ ${new_status}`, body: `${trade.symbol} @ ${price}` }, req.app.get('io')); 
        } else if (new_status === 'SL HIT') {
            console.log(`🔇 Skipping push notification for SL HIT as per rules.`);
        }
        
        res.json({ success: true });
    } catch (err) { 
        console.error("❌ LOG EVENT ENDPOINT ERROR:", err);
        res.status(500).json({ error: err.message }); 
    }
});

router.post('/delete_trades', authenticateToken, async (req, res) => {
    const { trade_ids, password } = req.body; 
    if (password !== DELETE_PASSWORD) { return res.status(401).json({ success: false, msg: "❌ Incorrect Password!" }); }
    if (!trade_ids || !Array.isArray(trade_ids) || trade_ids.length === 0) { return res.status(400).json({ success: false, msg: "No IDs provided" }); }
    try { 
        await pool.query("DELETE FROM trades WHERE trade_id = ANY($1)", [trade_ids]); 
        req.app.get('io').emit('trade_update'); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
