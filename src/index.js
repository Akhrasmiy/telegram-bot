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
const token = '6073168412:AAFTK49Y4eo51m5qzbUwJ4itSFtFymfAj6w';
const bot = new Telebot(token);
const app = express();
const port = process.env.PORT || 3001;
const chatId = '-1002195971113';
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
        const fileName = `${uuid}.${fileExtension}`;
        const filePath = path.join(__dirname, fileName);
        if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }
        fs.writeFile(filePath, file.data, async (err) => {
            if (err) {
                console.error('Error saving file:', err);
                return res.status(500).send('Failed to save file.');
            }

            try {
                let response;
                if (file.mimetype.startsWith('image/')) {
                    response = await bot.sendPhoto(chatId, filePath);
                    response.url = response.photo[0].file_id
                } else if (file.mimetype === 'application/pdf') {
                    response = await bot.sendDocument(chatId, filePath);
                    response.url = response.document.thumbnail.file_id
                } else {
                    return res.status(400).send('Unsupported file type.');
                }
                fs.unlink(filePath, () => { });
                res.send(`http://save.ilmlar.com/img-docs/${response.url}`);
            } catch (err) {
                console.error('Error sending file to Telegram:', err);
                fs.unlink(filePath, () => { });
                res.status(500).send('Failed to send file to Telegram.');
            }
        });
    } catch (err) {
        console.error('Error handling file upload:', err);
        res.status(500).send('Internal server error.');
    }
});

app.get('/img-docs/:file_id', async (req, res) => {
    try {
        const { file_id } = req.params;

        const uuid = uuidv4();
        const file = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);
        const filePath = file.data.result.file_path;
        const filedata = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, { responseType: 'arraybuffer' });
        const outputpath = `${uuid}.jpg`;
        const outputFilePath = path.resolve(__dirname, 'input', outputpath); // Ensure the path is absolute

        fs.writeFileSync(outputFilePath, filedata.data);
        console.log(outputFilePath)
        res.sendFile(outputFilePath, (err) => {
            fs.unlink(outputFilePath, () => { })
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to send file' });
            }
        });

    } catch (err) {
        console.error('Error fetching file:', err);
        res.status(500).send('Internal server error.');
    }
});
app.post('/file', async (req, res) => {
    try {
        if (!req.files || !req.files.video) {
            return res.status(400).send('No files were uploaded.');
        }

        const videoFile = req.files.video;

        if (videoFile.size > 50 * 1024 * 1024 * 1024) { // Check file size limit
            return res.status(400).send('File is too big.');
        }

        const fileExtension = videoFile.name.split('.').pop();
        const uuid = uuidv4();
        const fileName = `${uuid}.${fileExtension}`;
        const filePath = path.join(__dirname, fileName);

        fs.writeFile(filePath, videoFile.data, async (err) => {
            if (err) {
                console.error('Error saving file:', err);
                return res.status(500).send('Failed to save file.');
            }

            try {
                const chunks = await splitVideo(filePath, 10); // Split into 10 MB chunks
                console.log(chunks);
                const arr = [];
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    try {
                        const response = await bot.sendVideo(chatId, chunk);
                        console.log('Video sent:', response);
                        arr.push(response.video.file_id);
                        await File.create({ uuid: uuid, file_id: response.video.file_id });
                        fs.unlink(chunk, () => { });
                    } catch (err) {
                        console.error('Error sending video to Telegram:', err);
                        fs.unlink(chunk, () => { });
                        return res.status(500).send('Failed to send file to Telegram.');
                    }
                }
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
            const file_id = files[i].file_id;
            arr.push(`http://save.ilmlar.com/file?file_id=${file_id}`)
        }

        res.send(arr)
    } catch (error) {
        console.error('Error merging videos:', error);
        res.status(500).json({ error: 'Failed to merge videos' });
    }
});

app.get('/file', async (req, res) => {
    try {
        const file_id = req.query.file_id;
        const uuid = uuidv4();
        const file = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);
        const filePath = file.data.result.file_path;
        const filedata = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, { responseType: 'arraybuffer' });
        const outputpath = `${uuid}.mp4`;
        const outputFilePath = path.resolve(__dirname, 'input', outputpath); // Ensure the path is absolute

        fs.writeFileSync(outputFilePath, filedata.data);
        console.log(outputFilePath)
        res.sendFile(outputFilePath, (err) => {
            fs.unlink(outputFilePath, () => { })
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to send file' });
            }
        });
    } catch (error) {
        console.error('Error merging videos:', error);
        res.status(500).json({ error: 'Failed to merge videos' });
    }
});



db();
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    bot.start();
});
