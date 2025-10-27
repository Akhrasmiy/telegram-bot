const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { promises: fsPromises } = require('fs');
const fileUpload = require('express-fileupload');
const AWS = require('aws-sdk');
const dotenv = require('dotenv');
const ffmpeg = require('fluent-ffmpeg');
const File = require('./mongomodel');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

ffmpeg.setFfprobePath(ffprobePath);
ffmpeg.setFfmpegPath(ffmpegPath);

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50 GB limit
}));

// AWS S3 konfiguratsiyasi
AWS.config.update({
    accessKeyId: 'AKIAQVNJF56PAHDUWZWX',
    secretAccessKey: '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',
    region: 'eu-north-1'
});

const s3 = new AWS.S3();

// Faylni S3 ga yuklash funksiyasi
async function uploadToS3(fileBuffer, fileName, bucketName, contentType, acl = 'public-read') {
    const params = {
        Bucket: bucketName,
        Key: fileName,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: acl
    };
    try {
        const result = await s3.upload(params).promise();
        return result.Location;
    } catch (err) {
        console.error('S3 yuklash xatosi:', err);
        throw err;
    }
}

// Faylni S3 dan yuklab olish uchun presigned URL
async function getPresignedUrl(bucketName, fileKey, expiresIn = 3600) {
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
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

function splitVideo(inputPath, chunkSizeMB) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);

            const duration = metadata.format.duration;
            const fileSize = metadata.format.size;
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
                .on('error', (err) => reject(err))
                .run();
        });
    });
}

app.post('/img-docs', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).send('No files were uploaded.');
        }

        const file = req.files.file;
        if (file.size > 20 * 1024 * 1024) {
            return res.status(400).send('File is too big.');
        }

        const fileExtension = file.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `images/${uuid}.${fileExtension}`;
        if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }

        const bucketName = 'ilmlar-images-2025-uz';
        const s3Url = await uploadToS3(file.data, fileName, bucketName, file.mimetype);
        res.send(s3Url);
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
        if (file.size > 20 * 1024 * 1024) {
            return res.status(400).send('File is too big.');
        }

        const fileExtension = file.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `docs/${uuid}.${fileExtension}`;
        if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }

        const bucketName = 'ilmlar-images-2025-uz';
        const s3Url = await uploadToS3(file.data, fileName, bucketName, file.mimetype);
        res.send(s3Url);
    } catch (err) {
        console.error('Error handling file upload:', err);
        res.status(500).send('Internal server error.');
    }
});

app.get('/img-docs/:file_key', async (req, res) => {
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
        if (videoFile.size > 50 * 1024 * 1024 * 1024) {
            return res.status(400).send('File is too big.');
        }

        const fileExtension = videoFile.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `${uuid}.${fileExtension}`;
        const filePath = path.join(__dirname, "input", fileName);

        await fsPromises.writeFile(filePath, videoFile.data);

        try {
            const chunks = await splitVideo(filePath, 10);
            console.log(chunks);
            const arr = [];
            const bucketName = 'ilmlar-images-2025-uz';
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const chunkName = `videos/${uuid}_part${i}.mp4`;
                const s3Url = await uploadToS3(fs.readFileSync(chunk), chunkName, bucketName, 'video/mp4');
                const duration = await getVideoDuration(chunk);
                arr.push(s3Url);
                await File.create({ uuid, file_url: s3Url, duration });
                fs.unlinkSync(chunk);
            }
            console.log('file junatib bolindi');
            fs.unlinkSync(filePath);
            res.send(uuid);
        } catch (err) {
            console.error('Error splitting video:', err);
            fs.unlinkSync(filePath);
            res.status(500).send('Failed to split video.');
        }
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
        const files = await File.find({ uuid });
        const arr = files.map(file => ({ url: file.file_url, duration: file.duration }));
        res.send(arr);
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

app.get('/file', async (req, res) => {
    try {
        const file_key = req.query.file_key;
        const bucketName = 'ilmlar-images-2025-uz';
        const url = await getPresignedUrl(bucketName, file_key);
        res.redirect(url);
    } catch (error) {
        console.error('Error fetching file:', error);
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});

const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
server.timeout = 1500000;
