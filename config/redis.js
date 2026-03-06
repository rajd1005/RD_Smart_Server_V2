const { createClient } = require('redis');
require('dotenv').config();

// --- REDIS CLIENT SETUP (For standard caching) ---
const redisClient = createClient({ 
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

redisClient.on('error', (err) => console.log('Redis Client Error', err.message));

redisClient.connect()
    .then(() => console.log('✅ Connected to Redis'))
    .catch(console.error);

// --- REDIS CONNECTION SETUP (For BullMQ queues and workers) ---
const redisConnection = { 
    host: process.env.REDISHOST || process.env.REDIS_HOST || '127.0.0.1', 
    port: parseInt(process.env.REDISPORT || process.env.REDIS_PORT || '6379'),
    password: process.env.REDISPASSWORD || process.env.REDIS_PASSWORD || undefined
};

module.exports = {
    redisClient,
    redisConnection
};
