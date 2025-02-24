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
const token2 = '7378618098:AAFdJf7Zcjz1t1kRRl0VRoZ0h64D229ogS4';

const bot = new Telebot(token);
const bot2 = new Telebot(token2);
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
        const filePath = path.join(__dirname, 'input', fileName);
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
                    console.log(response.photo)
                    response.url = response.photo.at(-1).file_id
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
        const fileName = `${uuid}.${fileExtension}`;
        const filePath = path.join(__dirname, 'input', fileName);
        //
        if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && file.mimetype !== 'application/pdf') {
            return res.status(400).send('No files were uploaded.');
        }
        fs.writeFile(filePath, file.data, async (err) => {
            if (err) {
                console.error('Error saving file:', err);
                return res.status(500).send('Failed to save file.');
            }

            try {
                let response;
                if (file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    response = await bot.sendDocument(chatId, filePath);
                    console.log(response)
                    response.url = response.document?.thumbnail?.file_id ? response.document.thumbnail.file_id : response.document.file_id
                } else {
                    return res.status(400).send('Unsupported file type.');
                }
                fs.unlink(filePath, () => { });
                res.send(`http://save.ilmlar.com/pdf-docs/${response.url}`);
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

        // Step 1: Fetch the file path from Telegram using the file_id
        const fileResponse = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);

        if (!fileResponse.data || !fileResponse.data.result) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = fileResponse.data.result.file_path;
        const extension = filePath.split('.').pop(); // Extract the extension

        // Step 2: Download the file from the Telegram API
        const fileDataResponse = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, { responseType: 'arraybuffer' });

        // Step 3: Ensure the 'input' directory exists
        const inputDir = path.resolve(__dirname, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        // Step 4: Generate a unique file name and store the file
        const uuid = uuidv4();
        const outputFilePath = path.resolve(inputDir, `${uuid}.jpg`);

        fs.writeFileSync(outputFilePath, fileDataResponse.data);
        console.log(`File saved at: ${outputFilePath}`);

        // Step 5: Serve the file to the client
        res.sendFile(outputFilePath, (err) => {
            // Delete the file after sending it to the client
            fs.unlink(outputFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });

            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to send file' });
            }
        });

    } catch (err) {
        console.error('Error fetching file:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});
app.get('/pdf-docs/:file_id', async (req, res) => {
    try {
        const { file_id } = req.params;

        // Step 1: Fetch the file path from Telegram using the file_id
        const fileResponse = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);

        if (!fileResponse.data || !fileResponse.data.result) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = fileResponse.data.result.file_path;
        const extension = filePath.split('.').pop(); // Extract the extension

        // Step 2: Download the file from the Telegram API
        const fileDataResponse = await axios.get(`https://api.telegram.org/file/bot${token}/${filePath}`, { responseType: 'arraybuffer' });

        // Step 3: Ensure the 'input' directory exists
        const inputDir = path.resolve(__dirname, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        // Step 4: Generate a unique file name and store the file
        const uuid = uuidv4();
        const outputFilePath = path.resolve(inputDir, `${uuid}.${extension}`);

        fs.writeFileSync(outputFilePath, fileDataResponse.data);
        console.log(`File saved at: ${outputFilePath}`);

        // Step 5: Serve the file to the client
        res.sendFile(outputFilePath, (err) => {
            // Delete the file after sending it to the client
            fs.unlink(outputFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });

            if (err) {
                console.error('Error sending file:', err);
                res.status(500).json({ error: 'Failed to send file' });
            }
        });

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
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    let response;

                    try {
                        // Try sending with the first bot
                        response = await bot.sendVideo(chatId, chunk);
                    } catch (err) {
                        console.error('Error sending video with bot1:', err);

                        // If the first bot fails, try with the second bot
                        try {
                            response = await bot2.sendVideo(chatId, chunk);
                        } catch (bot2Err) {
                            console.error('Error sending video with bot2:', bot2Err);
                            fs.unlink(chunk, () => { });
                            return res.status(500).send('Failed to send file to Telegram.');
                        }
                    }

                    const duration = await getVideoDuration(chunk);
                    arr.push(response.video.file_id);

                    await File.create({ uuid: uuid, file_id: response.video.file_id, duration: duration });
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
            const file_id = files[i].file_id;
            arr.push({ url: `http://save.ilmlar.com/file?file_id=${file_id}`, duration: files[i].duration })
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
const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    bot.start();
    bot2.start()
});
server.timeout = 1500000;
