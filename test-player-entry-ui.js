"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must remain unique");
assert.match(html, /id="addPlayerBtn"[^>]*aria-controls="savedPlayerEntryPanel"/);
assert.match(html, /id="addGuestBtn"[^>]*aria-controls="guestEntryPanel"/);
assert.match(html, /id="savedPlayerEntryPanel"[^>]*hidden/);
assert.match(html, /id="guestEntryPanel"[^>]*hidden/);
assert.ok(html.indexOf('id="savedPlayerSearch"') < html.indexOf('id="savedPlayerEntryPanel"'), "Search must appear before the Add Player form");
assert.ok(html.indexOf('id="savedPlayerList"') < html.indexOf('id="savedPlayerEntryPanel"'), "Saved roster must appear before the entry forms");
assert.match(app, /openPlayerEntry\("saved"\)/);
assert.match(app, /openPlayerEntry\("guest"\)/);
assert.match(app, /playerEntryMode = "";\s*render\(\);/);

console.log("Player-entry UI tests passed.");
