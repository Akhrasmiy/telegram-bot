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
