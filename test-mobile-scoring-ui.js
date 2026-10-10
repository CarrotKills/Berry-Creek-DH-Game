"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Every element id must be unique");

assert.match(html, /id="mobileScoringDock"/);
assert.match(html, /id="mobileScoringStatus"/);
assert.match(html, /id="mobileMissingScoresReminder"[^>]+role="alert"/);
assert.match(html, /id="mobilePrevHoleBtn"/);
assert.match(html, /id="mobileHoleSelect"/);
assert.match(html, /id="mobileNextHoleBtn"/);
assert.ok(html.indexOf('id="mobileScoringDock"') > html.indexOf('id="groupScorecardPanel"'));

assert.match(app, /\[\$\("#holeSelect"\), \$\("#mobileHoleSelect"\)\]/);
assert.match(app, /mobileScoringStatus"\)\.textContent = `Group \$\{selectedGroup\} · Hole \$\{selectedHole\}/);
assert.match(app, /mobileHoleSelect"\)\.addEventListener\("change"/);
assert.match(app, /mobilePrevHoleBtn"\)\.addEventListener\("click"/);
assert.match(app, /mobileNextHoleBtn"\)\.addEventListener\("click"/);
assert.match(app, /classList\.toggle\("header-compact", window\.innerWidth <= 760 && window\.scrollY > 72\)/);
assert.match(app, /new ResizeObserver\(scheduleHeaderLayout\)/);
assert.match(app, /window\.addEventListener\("scroll", scheduleHeaderLayout, \{ passive: true \}\)/);
assert.match(app, /dispatchWithTouchFeedback/);
assert.match(app, /Sandy marked/);
assert.match(app, /KP marked/);
assert.match(app, /Scorekeeper assigned/);
assert.match(app, /navigator\.vibrate\(12\)/);

assert.match(css, /\.mobile-scoring-dock \{ display: none; \}/);
assert.match(css, /\.mobile-scoring-dock \{ position: fixed; right: 0; bottom: calc\(4\.05rem \+ env\(safe-area-inset-bottom\)\); left: 0;/);
assert.match(css, /\.mobile-missing-scores-reminder \{[^}]*background: var\(--danger\)/s);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /\.app-header \{ position: sticky; top: 0; z-index: 40;/);
assert.match(css, /\.tabs \{ position: fixed; top: auto; right: 0; bottom: 0; left: 0; z-index: 50;[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/s);
assert.match(css, /\.tab \{ display: grid; justify-items: center;[^}]*min-height: 3\.45rem/s);
assert.match(css, /body\.header-compact \.compact-app-title \{ display: block; \}/);
assert.match(css, /body:has\(\.score-stepper input:focus\) \.mobile-scoring-dock \{ display: none; \}/);
assert.match(css, /button:not\(:disabled\):active/);
assert.match(css, /\.touch-confirmation/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log("Mobile scoring UI tests passed.");
