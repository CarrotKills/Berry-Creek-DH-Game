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
assert.doesNotMatch(html, /id="exportBtn"/);
assert.doesNotMatch(html, /id="importInput"/);
assert.doesNotMatch(html, /Active round file/);
assert.doesNotMatch(app, /REPLACE_ROUND/);
assert.ok(html.indexOf('id="savedRoundsStatus"') < html.indexOf('id="savedRoundsList"'), "Archive count must appear before its round list");
assert.match(app, /status\.textContent = `\$\{savedRounds\.length\} saved round/);
assert.match(app, /data-round-action="view"/);
assert.match(app, /data-round-action="print"/);
assert.match(app, /data-round-action="roster"/);
assert.match(app, /data-round-action="download"/);
assert.match(app, /data-round-action="delete"/);
assert.match(css, /\.saved-rounds-archive\s*\{/);
assert.match(css, /\.saved-rounds-archive > summary/);
assert.match(css, /\.archive-folder-icon/);
assert.match(html, /id="printSavedRoundBtn"[^>]*>Print Results</);
assert.match(html, /id="savedRoundHistoryTitle">Round Change History</);
assert.match(html, /id="savedRoundHistoryCount"/);
assert.match(html, /id="savedRoundHistoryList" class="audit-list saved-round-audit-list"/);
assert.match(html, /complete change history will be archived before the new round starts/);
assert.match(app, /if \(action === "print"\) \{\s*preparePrintReport\(round\.state\);\s*window\.print\(\);/);
assert.match(app, /function preparePrintReport\(roundState = null\)/);
assert.match(app, /preparePrintReport\(activeSavedRound\.state\)/);
assert.match(app, /logoUrl: `app-icon-master\.png\?v=\$\{APP_VERSION\}`/);
assert.match(app, /function printRoundHistoryMarkup\(round\)/);
assert.match(app, /\$\{groupTables\}\$\{holeComments\}\$\{roundHistory\}/);
assert.match(app, /function preserveCurrentRoundBeforeReset\(\)/);
assert.match(app, /hasMeaningfulHistory = state\.auditLog\.some\(\(entry\) => entry\.type !== "CLEAR_ROUND"\)/);
assert.match(app, /preserveBeforeReset: true/);
assert.match(app, /The previous round and its complete change history were archived/);
assert.match(css, /\.saved-round-change-history\s*\{/);
assert.match(css, /\.print-round-history\s*\{/);

console.log("Saved-round archive UI tests passed.");
