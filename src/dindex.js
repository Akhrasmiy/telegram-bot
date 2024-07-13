const ffmpeg = require('fluent-ffmpeg');
const { promises: fsPromises, writeFile, unlink } = require('fs');
const { basename, join } = require('path');
const axios = require('axios');
const express = require('express');
const app = express();

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

const FOLDERS = {
    INPUT: './src/input',
    OUTPUT: './src/output',
    TEMP: './src/temp'
};
const ERRORS = {
    INPUT: 'Please add input videos to the input folder'
};

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

function isNil(obj) {
    return obj === null || typeof obj === 'undefined';
}

function isEmpty(obj) {
    return obj === '' || isNil(obj);
}

function isObject(obj) {
    return obj != null && typeof obj === 'object';
}

function isArray(obj) {
    return Object.prototype.toString.call(obj) === '[object Array]';
}

function onError(err) {
    if (isObject(err)) {
        console.error(`Error: ${err.message}`, '\n');
    } else {
        console.error(err, '\n');
    }

    process.exitCode = 1;
}

function mergeVideos(videoPaths) {
    return new Promise((resolve, reject) => {
        const firstVideo = videoPaths.shift();
        const outputFileName = 'merged_video.mp4';
        const outputFilePath = join(FOLDERS.OUTPUT, outputFileName);

        let mergedVideo = ffmpeg(firstVideo);

        videoPaths.forEach((videoPath, index) => {
            mergedVideo = mergedVideo.input(videoPath);
            console.log(index);
        });

        mergedVideo
            .on('error', reject)
            .on('start', () => {
                console.log(`Starting merge for videos`);
            })
            .on('end', () => {
                console.log(`Videos merged!`);
                resolve();
            })
            .mergeToFile(outputFilePath, FOLDERS.TEMP);
    });
}

async function mergeAll() {
    try {
        const inputFiles = await fsPromises.readdir(FOLDERS.INPUT);

        if (!isArray(inputFiles) || inputFiles.length === 0) {
            throw new Error(ERRORS.INPUT);
        }

        const videoPaths = [];

        for (const i of inputFiles) {
            const iPath = join(FOLDERS.INPUT, i);
            const stat = await fsPromises.stat(iPath);

            if (!stat.isDirectory()) {
                videoPaths.push(iPath);
            }
        }

        if (videoPaths.length > 0) {
            await mergeVideos(videoPaths);
        }
    } catch (e) {
        onError(e);
    }
}

async function downloadFile(url, outputPath) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    await fsPromises.writeFile(outputPath, response.data);
}

app.get('/file', async (req, res) => {
    try {
        const uuid = req.query.uuid;
        if (!uuid) {
            return res.status(400).send('File ID is required.');
        }

        const files = await File.find({ uuid: uuid });
        const arr = [];

        await Promise.all(files.map(async (file, index) => {
            const file_id = file.file_id;
            const fileResponse = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`);
            const filePath = fileResponse.data.result.file_path;
            const outputpath = join(FOLDERS.INPUT, `${uuid}_${index}.mp4`);

            await downloadFile(`https://api.telegram.org/file/bot${token}/${filePath}`, outputpath);
            arr.push(outputpath);
        }));

        await mergeAll();

        res.sendFile(join(__dirname, 'src/output/merged_video.mp4'), (err) => {
            unlink(join(FOLDERS.OUTPUT, 'merged_video.mp4'), () => { });
            arr.forEach((el) => {
                unlink(el, () => { });
            });
        });
    } catch (error) {
        console.error('Error merging videos:', error);
        res.status(500).json({ error: 'Failed to merge videos' });
    }
});

// Nginx server start
app.listen(3000, () => {
    console.log('Server started on port 3000');
});
