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
                const bots = [bot, bot2, bot3];
                let response;
                if (file.mimetype.startsWith('image/')) {
                    response = await sendWithBots(bots, newChatId, filePath, true);
                    console.log(response.photo)
                    response.url = response.photo.at(-1).file_id
                } else if (file.mimetype === 'application/pdf') {
                    response = await sendWithBots(bots, newChatId, filePath, false);
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
                const bots = [bot, bot2, bot3];
                let response;
                if (file.mimetype === 'application/pdf' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    response = await sendWithBots(bots, newChatId, filePath, false);
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

async function getFileFromBots(tokens, file_id) {
    for (const currentToken of tokens) {
        try {
            const fileResponse = await axios.get(`https://api.telegram.org/bot${currentToken}/getFile?file_id=${file_id}`);
            if (fileResponse.data && fileResponse.data.result) {
                return {
                    filePath: fileResponse.data.result.file_path,
                    token: currentToken
                };
            }
        } catch (getErr) {
            console.error(`Error getting file with token ${currentToken}:`, getErr);
            continue;
        }
    }
    return null;
}

app.get('/img-docs/:file_id', async (req, res) => {
    try {
        const { file_id } = req.params;
        const tokens = [token, token2, token3]; // Try old bots first (assuming old files with them), then new

        const fileInfo = await getFileFromBots(tokens, file_id);
        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found with any bot' });
        }

        const { filePath, token: successfulToken } = fileInfo;
        const extension = filePath.split('.').pop(); // Extract the extension

        // Download the file from the Telegram API
        let filedata;
        try {
            filedata = await axios.get(`https://api.telegram.org/file/bot${successfulToken}/${filePath}`, { responseType: 'arraybuffer' });
        } catch (downloadErr) {
            console.error(`Error downloading file with token ${successfulToken}:`, downloadErr);
            return res.status(500).json({ error: 'Failed to download file' });
        }

        // Ensure the 'input' directory exists
        const inputDir = path.resolve(__dirname, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        // Generate a unique file name and store the file
        const uuid = uuidv4();
        const outputFilePath = path.resolve(inputDir, `${uuid}.jpg`);

        fs.writeFileSync(outputFilePath, filedata.data);
        console.log(`File saved at: ${outputFilePath}`);

        // Serve the file to the client
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
        const tokens = [token, token2, token3]; // Try old bots first (assuming old files with them), then new

        const fileInfo = await getFileFromBots(tokens, file_id);
        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found with any bot' });
        }

        const { filePath, token: successfulToken } = fileInfo;
        const extension = filePath.split('.').pop(); // Extract the extension

        // Download the file from the Telegram API
        let filedata;
        try {
            filedata = await axios.get(`https://api.telegram.org/file/bot${successfulToken}/${filePath}`, { responseType: 'arraybuffer' });
        } catch (downloadErr) {
            console.error(`Error downloading file with token ${successfulToken}:`, downloadErr);
            return res.status(500).json({ error: 'Failed to download file' });
        }

        // Ensure the 'input' directory exists
        const inputDir = path.resolve(__dirname, 'input');
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        }

        // Generate a unique file name and store the file
        const uuid = uuidv4();
        const outputFilePath = path.resolve(inputDir, `${uuid}.${extension}`);

        fs.writeFileSync(outputFilePath, filedata.data);
        console.log(`File saved at: ${outputFilePath}`);

        // Serve the file to the client
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
                const bots = [bot, bot2, bot3];
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    let response;

                    response = await sendWithBots(bots, newChatId, chunk, false);

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
        const tokens = [token, token2, token3]; // Try old bots first

        const fileInfo = await getFileFromBots(tokens, file_id);
        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found with any bot' });
        }

        const { filePath, token: successfulToken } = fileInfo;

        // Download the file from the Telegram API
        let filedata;
        try {
            filedata = await axios.get(`https://api.telegram.org/file/bot${successfulToken}/${filePath}`, { responseType: 'arraybuffer' });
        } catch (downloadErr) {
            console.error(`Error downloading file with token ${successfulToken}:`, downloadErr);
            return res.status(500).json({ error: 'Failed to download file' });
        }

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
    bot2.start();
    bot3.start();
});
server.timeout = 1500000;
