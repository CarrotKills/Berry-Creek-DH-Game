"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SAMPLE_RATE = 44_100;
const DURATION_SECONDS = 2.9;
const FRAME_COUNT = Math.round(SAMPLE_RATE * DURATION_SECONDS);
const dry = new Float64Array(FRAME_COUNT);
const calls = [
  { start: 0.04, duration: 0.82, startFrequency: 2_250, endFrequency: 1_050, amplitude: 0.82, warble: 22, phase: 0 },
  { start: 0.88, duration: 0.68, startFrequency: 1_850, endFrequency: 920, amplitude: 0.68, warble: 18, phase: 0 },
  { start: 1.60, duration: 1.08, startFrequency: 2_400, endFrequency: 760, amplitude: 0.94, warble: 15, phase: 0 }
];

let randomState = 0x4d595df4;
let noiseLowPass = 0;

function randomSigned() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return ((randomState >>> 0) / 0xffffffff) * 2 - 1;
}

function envelope(progress) {
  if (progress <= 0 || progress >= 1) return 0;
  const attack = Math.min(1, progress / 0.045);
  const release = Math.min(1, (1 - progress) / 0.24);
  return Math.pow(attack, 0.42) * Math.pow(release, 1.35) * (0.86 + 0.14 * Math.sin(Math.PI * progress));
}

for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  const time = frame / SAMPLE_RATE;
  const whiteNoise = randomSigned();
  noiseLowPass += 0.075 * (whiteNoise - noiseLowPass);
  const breathNoise = whiteNoise - noiseLowPass;
  let sample = 0;

  calls.forEach((call, callIndex) => {
    const localTime = time - call.start;
    if (localTime <= 0 || localTime >= call.duration) return;
    const progress = localTime / call.duration;
    const glide = Math.pow(progress, 0.72);
    const baseFrequency = call.startFrequency * Math.pow(call.endFrequency / call.startFrequency, glide);
    const flutter = 1
      + 0.055 * Math.sin(2 * Math.PI * call.warble * localTime)
      + 0.021 * Math.sin(2 * Math.PI * (call.warble * 2.37) * localTime + callIndex);
    const frequency = baseFrequency * flutter;
    call.phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    const voice = 0.58 * Math.sin(call.phase)
      + 0.27 * Math.sin(call.phase * 2.01 + 0.35)
      + 0.10 * Math.sin(call.phase * 3.04 + 1.1)
      + 0.05 * Math.sin(call.phase * 4.13 + 0.6);
    const rasp = 0.16 * breathNoise * (0.35 + 0.65 * Math.sin(Math.PI * progress));
    sample += call.amplitude * envelope(progress) * Math.tanh((voice + rasp) * 1.45);
  });

  dry[frame] = sample;
}

const mixed = new Float64Array(FRAME_COUNT);
const echoOne = Math.round(SAMPLE_RATE * 0.075);
const echoTwo = Math.round(SAMPLE_RATE * 0.155);
let peak = 0;
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  const sample = dry[frame]
    + (frame >= echoOne ? dry[frame - echoOne] * 0.20 : 0)
    + (frame >= echoTwo ? dry[frame - echoTwo] * 0.09 : 0);
  const finalFade = frame > FRAME_COUNT - SAMPLE_RATE * 0.18
    ? Math.max(0, (FRAME_COUNT - frame) / (SAMPLE_RATE * 0.18))
    : 1;
  mixed[frame] = sample * finalFade;
  peak = Math.max(peak, Math.abs(mixed[frame]));
}

const gain = peak ? 0.88 / peak : 1;
const dataBytes = FRAME_COUNT * 2;
const wav = Buffer.alloc(44 + dataBytes);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(dataBytes, 40);
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  const value = Math.max(-1, Math.min(1, mixed[frame] * gain));
  wav.writeInt16LE(Math.round(value * 32767), 44 + frame * 2);
}

const destination = path.join(__dirname, "eagle-call.wav");
fs.writeFileSync(destination, wav);
console.log(`Created ${destination} (${DURATION_SECONDS.toFixed(1)} seconds, ${SAMPLE_RATE} Hz mono PCM)`);
