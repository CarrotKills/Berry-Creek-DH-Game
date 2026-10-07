"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

assert.match(html, /<details id="savedRoundsArchive" class="saved-rounds-archive">/);
assert.doesNotMatch(html, /<details id="savedRoundsArchive"[^>]*\sopen(?:\s|>)/);
assert.match(html, /<strong>Saved Rounds Archive<\/strong>/);
assert.match(html, /id="savedRoundsStatus"[^>]*aria-live="polite"/);
assert.match(html, /id="savedRoundsList" class="saved-rounds-list"/);
assert.ok(html.indexOf('id="savedRoundsStatus"') < html.indexOf('id="savedRoundsList"'), "Archive count must appear before its round list");
assert.match(app, /status\.textContent = `\$\{savedRounds\.length\} saved round/);
assert.match(app, /data-round-action="view"/);
assert.match(app, /data-round-action="roster"/);
assert.match(app, /data-round-action="download"/);
assert.match(app, /data-round-action="delete"/);
assert.match(css, /\.saved-rounds-archive\s*\{/);
assert.match(css, /\.saved-rounds-archive > summary/);
assert.match(css, /\.archive-folder-icon/);

console.log("Saved-round archive UI tests passed.");
