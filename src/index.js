const Telebot = require('telebot');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { promises: fsPromises } = require('fs');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const db = require('../db');
const token = '5548558539:AAHz5IUlbnK-6gBO-ZY8PdnvTtr6BWrvwzE';
const token2 = '7378618098:AAFdJf7Zcjz1t1kRRl0VRoZ0h64D229ogS4';
const token3 = '1773215702:AAFik8HlsFLk7E2EtgKrFQCh-ZsXOjYSRWo'; // Add your third bot token here

const bot = new Telebot(token);
const bot2 = new Telebot(token2);
const bot3 = new Telebot(token3);
const app = express();
const port = process.env.PORT || 3001;
const newChatId = '-1003179717428';
const oldChatId = '-1002195971113';
const ffmpeg = require('fluent-ffmpeg');
const File = require('./mongomodel');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfprobePath(ffprobePath);
ffmpeg.setFfmpegPath(ffmpegPath);
const { exec } = require('child_process');
const mergeAll = require('./dindex.js');
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50 GB limit
}));

// AWS SDK import qilish
const AWS = require('aws-sdk');
const dotenv = require('dotenv'); // npm install dotenv
dotenv.config();

// S3 konfiguratsiyasi ( .env faylida saqlang: AWS_ACCESS_KEY_ID=your_key, AWS_SECRET_ACCESS_KEY=your_secret, AWS_REGION=eu-central-1 )
AWS.config.update({
    accessKeyId: 'AKIAQVNJF56PAHDUWZWX',
    secretAccessKey: '9vUDX9a6PWKRLVDriL9PRKr2CW2/PAO18WDkkAss',
    region: 'eu-north-1' // masalan, 'eu-central-1'
});

const s3 = new AWS.S3();

// Faylni S3 ga yuklash funksiyasi
async function uploadToS3(fileBuffer, fileName, bucketName, contentType, acl = 'public-read') {
    const params = {
        Bucket: bucketName,
        Key: fileName, // Papka qo'shish mumkin, masalan: 'images/' + fileName
        Body: fileBuffer,
        ContentType: contentType,
        ACL: acl // 'public-read' agar umumiy bo'lsa; 'private' qilish mumkin
    };

    try {
        const result = await s3.upload(params).promise();
        return result.Location; // S3 URL qaytaradi
    } catch (err) {
        console.error('S3 yuklash xatosi:', err);
        throw err;
    }
}

// Faylni S3 dan yuklab olish uchun presigned URL olish funksiyasi (private fayllar uchun)
async function getPresignedUrl(bucketName, fileKey, expiresIn = 3600) { // 1 soat
    const params = {
        Bucket: bucketName,
        Key: fileKey,
        Expires: expiresIn
    };
    return s3.getSignedUrlPromise('getObject', params);
}

async function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                return reject(err);
            }
            const duration = metadata.format.duration; // davomiylikni olish
            resolve(duration);
        });
    });
}

function splitVideo(inputPath, chunkSizeMB) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                return reject(err);
            }

            const duration = metadata.format.duration; // in seconds
            const fileSize = metadata.format.size; // in bytes
            const chunkSizeBytes = chunkSizeMB * 1024 * 1024;

            const segmentTime = (duration * chunkSizeBytes) / fileSize;
            const outputDir = path.dirname(inputPath);
            const fileBaseName = path.basename(inputPath, path.extname(inputPath));
            const outputPattern = path.join(outputDir, `${fileBaseName}_part%03d.mp4`);

            ffmpeg(inputPath)
                .outputOptions([
                    '-c copy',
                    '-f segment',
                    `-segment_time ${segmentTime}`,
                    '-reset_timestamps 1'
                ])
                .output(outputPattern)
                .on('end', () => {
                    const chunkPaths = fs.readdirSync(outputDir)
                        .filter(file => file.startsWith(fileBaseName) && file !== path.basename(inputPath))
                        .map(file => path.join(outputDir, file));

                    resolve(chunkPaths);
                })
                .on('error', (err) => {
                    reject(err);
                })
                .run();
        });
    });
}

async function sendWithBots(bots, chatId, filePath, isPhoto = false) {
    for (const currentBot of bots) {
        try {
            if (isPhoto) {
                return await currentBot.sendPhoto(chatId, filePath);
            } else {
                return await currentBot.sendDocument(chatId, filePath);
            }
        } catch (err) {
            console.error(`Error sending with bot ${currentBot.token}:`, err);
            continue;
        }
    }
    throw new Error('All bots failed to send the file');
}

app.post('/img-docs', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).send('No files were uploaded.');
        }

        const file = req.files.file;

        if (file.size > 20 * 1024 * 1024) { // Check file size limit
            return res.status(400).send('File is too big.');
        }

        const fileExtension = file.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `images/${uuid}.${fileExtension}`; // Papka qo'shish
        if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }

        // S3 ga yuklash
        const bucketName = 'ilmlar-images-2025-uz'; // O'zingizning bucket nomingizni qo'ying, masalan 'ilmlar-images-2025-uz'
        const s3Url = await uploadToS3(file.data, fileName, bucketName, file.mimetype);

        // Faylni lokal saqlash shart emas, to'g'ridan-to'g'ri bufferdan yuklangan
        res.send(s3Url); // S3 URL qaytaradi, masalan: https://your-bucket-name.s3.eu-central-1.amazonaws.com/images/uuid.jpg
    } catch (err) {
        console.error('Error handling file upload:', err);
        res.status(500).send('Internal server error.');
    }
});

app.post('/pdf-docs', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).send('No files were uploaded.');
        }

        const file = req.files.file;

        if (file.size > 20 * 1024 * 1024) { // Check file size limit
            return res.status(400).send('File is too big.');
        }

        const fileExtension = file.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `docs/${uuid}.${fileExtension}`; // Papka qo'shish
        if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }

        // S3 ga yuklash
        const bucketName = 'ilmlar-images-2025-uz'; // O'zingizning bucket nomingizni qo'ying
        const s3Url = await uploadToS3(file.data, fileName, bucketName, file.mimetype);

        res.send(s3Url);
    } catch (err) {
        console.error('Error handling file upload:', err);
        res.status(500).send('Internal server error.');
    }
});

// /img-docs/:file_id endpointini olib tashlash yoki presigned URL bilan yangilash
app.get('/img-docs/:file_key', async (req, res) => {
    try {
        const { file_key } = req.params; // Endi file_id emas, S3 key (masalan, images/uuid.jpg)
        const bucketName = 'ilmlar-images-2025-uz';

        // Presigned URL olish (agar ACL private bo'lsa)
        const url = await getPresignedUrl(bucketName, file_key);

        // Redirect qilish yoki to'g'ridan-to'g'ri yuklab olish
        res.redirect(url);
    } catch (err) {
        console.error('Error fetching file:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// /pdf-docs/:file_key uchun ham shunga o'xshash
app.get('/pdf-docs/:file_key', async (req, res) => {
    try {
        const { file_key } = req.params;
        const bucketName = 'ilmlar-images-2025-uz';

        const url = await getPresignedUrl(bucketName, file_key);
        res.redirect(url);
    } catch (err) {
        console.error('Error fetching file:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});


app.post('/file', async (req, res) => {
    try {
        if (!req.files || !req.files.video) {
            return res.status(400).send('No files were uploaded.');
        }
        console.log("incoming file");

        const videoFile = req.files.video;

        if (videoFile.size > 50 * 1024 * 1024 * 1024) { // Check file size limit
            return res.status(400).send('File is too big.');
        }

        const fileExtension = videoFile.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `${uuid}.${fileExtension}`;
        const filePath = path.join(__dirname, "input", fileName);

        fs.writeFile(filePath, videoFile.data, async (err) => {
            if (err) {
                console.error('Error saving file:', err);
                return res.status(500).send('Failed to save file.');
            }

            try {
                const chunks = await splitVideo(filePath, 10); // Split into 10 MB chunks
                console.log(chunks);
                const arr = [];
                const bucketName = 'ilmlar-images-2025-uz'; // O'zingizning bucket nomingizni qo'ying
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const chunkName = `videos/${uuid}_part${i}.mp4`;

                    // S3 ga yuklash (Telegram o'rniga)
                    const s3Url = await uploadToS3(fs.readFileSync(chunk), chunkName, bucketName, 'video/mp4');

                    const duration = await getVideoDuration(chunk);
                    arr.push(s3Url);

                    await File.create({ uuid: uuid, file_url: s3Url, duration: duration }); // file_id o'rniga file_url
                    fs.unlink(chunk, () => { });
                }
                console.log('file junatib bolindi')
                fs.unlink(filePath, () => { });
                res.send(uuid);
            } catch (err) {
                console.error('Error splitting video:', err);
                fs.unlink(filePath, () => { });
                res.status(500).send('Failed to split video.');
            }
        });
    } catch (err) {
        console.error('Error handling file upload:', err);
        res.status(500).send('Internal server error.');
    }
});


app.get('/video', async (req, res) => {
    try {
        const uuid = req.query.uuid;
        if (!uuid) {
            return res.status(400).send('File ID is required.');
        }
        const files = await File.find({ uuid: uuid })
        const arr = []
        for (let i = 0; i < files.length; i++) {
            const file_url = files[i].file_url; // file_id o'rniga file_url
            arr.push({ url: file_url, duration: files[i].duration }) // To'g'ridan-to'g'ri S3 URL
        }

        res.send(arr)
    } catch (error) {
        console.error('Error merging videos:', error);
        res.status(500).json({ error: 'Failed to merge videos' });
    }
});

app.get('/file', async (req, res) => {
    try {
        const file_key = req.query.file_key; // file_id o'rniga file_key (masalan, videos/uuid_part0.mp4)
        const bucketName = 'ilmlar-images-2025-uz';

        const url = await getPresignedUrl(bucketName, file_key);
        res.redirect(url);
    } catch (error) {
        console.error('Error fetching file:', error);
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});



db();
const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    bot.start();
    bot2.start();
    bot3.start();
});
server.timeout = 1500000;
