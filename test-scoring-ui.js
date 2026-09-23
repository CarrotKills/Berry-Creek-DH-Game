"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

assert.doesNotMatch(html, /id="undoScoreBtn"/);
assert.doesNotMatch(html, /id="exportScorecardJpegBtn"/);
assert.doesNotMatch(html, /id="exportScorecardPdfBtn"/);
assert.match(html, /id="advanceHoleBtn"/);
assert.match(html, /id="advanceHoleBtnBottom"/);
assert.ok(html.indexOf('id="advanceHoleBtnBottom"') > html.indexOf('id="groupScoreList"'));
assert.ok(html.indexOf('id="toggleScorecardBtn"') > html.indexOf('id="advanceHoleBtnBottom"'));
assert.ok(html.indexOf('class="scorecard scorecard group-scorecard"') === -1);
assert.ok(html.indexOf('class="scorecard group-scorecard"') < html.indexOf('class="scorecard-legend"'));
assert.ok(html.indexOf('class="scorecard-legend"') < html.indexOf('id="hideScorecardBtn"'));
assert.match(app, /Skin Pending: \$\{pendingSkinNames/);
assert.match(app, /KP Pending: \$\{kpName\}/);
assert.match(app, />KPM<\/span>/);
assert.match(app, />S<\/span>/);
assert.match(app, /scorecard-segment-heading">Out/);
assert.match(app, /scorecard-segment-heading">In/);
assert.match(app, /scorecard-segment-heading">Total/);
assert.doesNotMatch(app, /Running total/);
assert.match(app, /prevHoleBtn"\)\.addEventListener\("click", \(\) => moveToHole\([^\n]+skipMissingCheck: true/);
assert.match(app, /playerId: player\.id, value: event\.target\.checked/);
assert.match(app, /data-kind="scorekeeper"/);
assert.match(app, /type: "SET_SCOREKEEPER"/);
assert.doesNotMatch(app, /<span class="auto-tic">Sandy ✓<\/span>/);
assert.match(html, /<h2>Sign in<\/h2>/);

console.log("Scoring-page UI tests passed.");
