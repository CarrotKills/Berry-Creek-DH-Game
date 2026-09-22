"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const audio = fs.readFileSync("eagle-call.wav");
const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const worker = fs.readFileSync("service-worker.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

assert.equal(audio.toString("ascii", 0, 4), "RIFF");
assert.equal(audio.toString("ascii", 8, 12), "WAVE");
assert.equal(audio.readUInt16LE(20), 1, "audio must use PCM encoding");
assert.equal(audio.readUInt16LE(22), 1, "audio must be mono");
assert.equal(audio.readUInt32LE(24), 44_100);
assert.equal(audio.readUInt16LE(34), 16);
const duration = audio.readUInt32LE(40) / (44_100 * 2);
assert.ok(duration >= 2.8 && duration <= 3.0, `unexpected eagle-call duration: ${duration}`);
assert.match(app, /new Audio\("eagle-call\.wav"\)/);
assert.match(app, /eagleAudio\.play\(\)\.catch\(playEagleFallback\)/);
assert.match(html, /rel="preload" href="eagle-call\.wav" as="audio" type="audio\/wav"/);
assert.match(worker, /"\.\/eagle-call\.wav"/);
assert.match(server, /"\.wav": "audio\/wav"/);

console.log("Original eagle-call audio tests passed.");
