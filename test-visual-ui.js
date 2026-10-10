"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

assert.match(css, /--forest:\s*#b51222/);
assert.match(css, /--radius-lg:\s*16px/);
assert.match(css, /\.tab-icon\s*\{/);
assert.equal((html.match(/class="tab-icon"/g) || []).length, 4, "Each main navigation item needs an icon");
assert.match(app, /class="score-card-header"/);
assert.match(app, /class="score-group-pill">Group/);
assert.match(css, /\.group-score-card \.score-stepper input[^}]*font-size:\s*2rem/s);
assert.match(css, /\.score-cell\.active-hole[^}]*box-shadow:\s*inset 0 0 0 2px var\(--forest\)/s);
assert.match(css, /\.scorecard-segment-heading\s*\{[^}]*#4f080f/s);
assert.match(css, /#tournamentView::before[^}]*berry-creek-leader-flower\.png/s);
assert.match(css, /\.skeleton-block[^}]*animation:\s*skeleton-shimmer/s);
assert.match(app, /savedPlayersLoading/);
assert.match(app, /leaderboardLoading/);
assert.match(app, /No saved players yet\. Use Add Player above/);
assert.match(html, /No round is ready yet\. Ask an admin to start a round/);
assert.match(css, /@media \(hover: none\)[\s\S]*transform:\s*scale\(0\.96\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log("Visual UI tests passed.");
