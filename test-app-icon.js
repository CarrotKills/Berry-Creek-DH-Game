"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");

const expectedSizes = new Map([
  ["app-icon-32.png", 32],
  ["app-icon-180.png", 180],
  ["app-icon-192.png", 192],
  ["app-icon-512.png", 512]
]);

for (const [filename, expected] of expectedSizes) {
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${filename} must be a PNG`);
  assert.equal(bytes.readUInt32BE(16), expected, `${filename} width`);
  assert.equal(bytes.readUInt32BE(20), expected, `${filename} height`);
}

const html = fs.readFileSync("index.html", "utf8");
const manifest = fs.readFileSync("manifest.webmanifest", "utf8");
const worker = fs.readFileSync("service-worker.js", "utf8");

const master = fs.readFileSync("app-icon-master.png");
assert.equal(crypto.createHash("sha256").update(master).digest("hex"), "b15020d4018f70a6f64aadf77245c9b45979000525e66d487398fd52b38ff81d", "Master artwork must remain identical to the supplied original");
assert.match(html, /app-icon-master\.png\?v=9\.16\.28/);
assert.doesNotMatch(html, /class="club-logo" src="berry-creek-logo\.jpeg"/);
assert.match(html, /app-icon-180\.png\?v=9\.16\.28/);
assert.match(html, /app-icon-32\.png\?v=9\.16\.28/);
assert.match(manifest, /app-icon-192\.png\?v=9\.16\.28/);
assert.match(manifest, /app-icon-512\.png\?v=9\.16\.28/);
assert.match(worker, /app-icon-master\.png\?v=9\.16\.28/);
assert.match(worker, /app-icon-180\.png\?v=9\.16\.28/);

console.log("Home-screen icon tests passed.");
