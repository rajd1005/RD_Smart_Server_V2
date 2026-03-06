const { Worker } = require('bullmq');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { pool } = require('../config/database');
const { redisClient, redisConnection } = require('../config/redis');

const videoWorker = new Worker('video-encoding', async job => {
    const { lessonDbId, videoPath, hlsDirStr } = job.data;
    const lessonId = crypto.randomUUID();
    const lessonHlsDir = path.join(hlsDirStr, lessonId);
    if (!fs.existsSync(lessonHlsDir)) fs.mkdirSync(lessonHlsDir, { recursive: true });

    const key = crypto.randomBytes(16);
    const keyPath = path.join(lessonHlsDir, 'enc.key');
    fs.writeFileSync(keyPath, key);

    const keyUrl = `/api/hls-key/${lessonId}/enc.key`; 
    const keyInfoPath = path.join(lessonHlsDir, 'enc.keyinfo');
    fs.writeFileSync(keyInfoPath, `${keyUrl}\n${keyPath}`);

    const m3u8Path = `/hls/${lessonId}/output.m3u8`;

    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .outputOptions([
                '-profile:v baseline', 
                '-level 3.0', 
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-start_number 0', 
                '-hls_time 10', 
                '-hls_list_size 0', 
                '-f hls', 
                `-hls_key_info_file ${keyInfoPath}`
            ])
            .output(path.join(lessonHlsDir, 'output.m3u8'))
            .on('end', async () => {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                await pool.query("UPDATE lesson_videos SET hls_manifest_url = $1 WHERE id = $2", [m3u8Path, lessonDbId]);
                await redisClient.del('public_courses').catch(()=>{});
                console.log(`✅ Background processing complete for Lesson ID: ${lessonDbId}`);
                resolve();
            })
            .on('error', (err) => { 
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath); 
                reject(err); 
            })
            .run();
    });
}, { connection: redisConnection });

module.exports = videoWorker;
