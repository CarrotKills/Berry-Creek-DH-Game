"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

assert.match(app, /key: "frontWeight", label: "FN"/);
assert.match(app, /key: "backWeight", label: "BN"/);
assert.match(app, /key: "totalNetWeight", label: "TN"/);
assert.match(app, /key: "sandies", label: "Sandy"/);
assert.match(app, /key: "kpMarked", label: "KPM"/);
assert.match(app, /E\.kpCode\(item\.player, state\.players, E\.COURSE, state\.settings, "kp"\)/);
assert.match(app, /E\.kpCode\(item\.player, state\.players, E\.COURSE, state\.settings, "marked"\)/);
assert.match(app, /\$\{tics\.frontWeight\}.*\$\{tics\.backWeight\}.*\$\{tics\.totalNetWeight\}.*\$\{tics\.sandies\}/s);
assert.doesNotMatch(app, /tics\.sandyPars|tics\.sandyBirdies/);
assert.doesNotMatch(app, /Sandy par ✓|Sandy birdie ✓/);
assert.match(html, /<th>FN<\/th><th>BN<\/th><th>TN<\/th><th>Sandy<\/th><th>KP<\/th><th>KPM<\/th>/);
assert.match(css, /\.kp-code[^}]*font-family: ui-monospace/s);
assert.doesNotMatch(html, /Non-cash points are automatic/);
assert.doesNotMatch(html, /KP\/KPM code order/);
assert.ok(html.indexOf('class="leaderboard-wrap"') < html.indexOf('id="printBtn"'), "Print results must appear below the leaderboard");
assert.ok(html.indexOf('class="leaderboard-wrap"') < html.indexOf('id="csvBtn"'), "Download spreadsheet must appear below the leaderboard");
assert.match(html, /class="section-actions leaderboard-footer-actions"/);
assert.match(css, /\.leaderboard-footer-actions\s*\{[^}]*justify-content:\s*flex-end/s);

console.log("Leaderboard display tests passed.");
