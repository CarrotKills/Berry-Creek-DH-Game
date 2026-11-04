"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

assert.match(html, /id="playerAnnouncementDialog"/);
assert.match(html, /Did you know that you can add comments and pictures from your round to the official record\?/);
assert.match(html, /Please help us make the DH Gazette more accurate and comprehensive!/);
assert.match(html, /value="acknowledge">Got it/);
assert.match(app, /PLAYER_ANNOUNCEMENT_ID = "gazette-comments-and-photos-v1"/);
assert.match(app, /currentUser\.role === "player"/);
assert.match(app, /currentUser\.role === "admin" && currentUser\.playerId/);
assert.match(app, /maybeShowPlayerAnnouncement\(\)/);
assert.match(app, /acknowledgePlayerAnnouncement\(playerAnnouncementDialog\.dataset\.audienceKey\)/);
assert.match(styles, /\.player-announcement-dialog/);

console.log("One-time player announcement UI tests passed.");
