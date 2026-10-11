"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");

assert.match(html, /id="roundIdentityBar"[^>]*role="status"/);
assert.match(html, /id="roundIdentityName"/);
assert.match(html, /id="roundIdentityContext"/);
assert.match(html, /id="roundIdentityState"/);
assert.match(app, /function renderRoundIdentity\(\)/);
assert.match(app, /score: `Group \$\{selectedGroup\} · Hole \$\{selectedHole\}`/);
assert.match(css, /\.round-identity-bar[^}]*linear-gradient/s);
assert.match(css, /\.round-identity-bar \{ position: sticky; top: var\(--app-header-height/);

assert.equal((html.match(/data-scroll-surface/g) || []).length, 3, "Live scorecard, leaderboard, and saved leaderboard need scroll tracking");
assert.equal((html.match(/class="scroll-cue"/g) || []).length, 3, "Every tracked table needs a swipe cue");
assert.match(app, /function updateScrollAffordance\(surface\)/);
assert.match(app, /classList\.toggle\("can-scroll-right"/);
assert.match(css, /thead th \{ position: sticky; top: 0; z-index: 3;/);
assert.match(css, /\.leaderboard th:first-child \{ z-index: 5;/);

assert.match(app, /class="group-progress-ring" style="--progress:\$\{progress\}"/);
assert.match(css, /\.group-progress-ring[^}]*conic-gradient/s);
assert.doesNotMatch(app, /class="progress-track"/);

assert.match(html, /id="confirmDialog" class="decision-dialog decision-dialog-danger"/);
assert.match(html, /id="finalizeDialog" class="decision-dialog decision-dialog-save"/);
assert.match(html, /class="dialog-heading"/);
assert.match(css, /\.dialog-symbol[^}]*border-radius: 50%/s);
assert.match(css, /dialog\[open\][^}]*dialog-arrive/s);

for (const icon of ["reset", "user-plus", "refresh", "lock", "save", "mail", "print", "download", "upload", "snapshot"]) {
  assert.match(html + css, new RegExp(`data-icon=["']${icon}["']`), `Missing ${icon} icon`);
}
assert.match(css, /mask: var\(--icon-mask\)/);
assert.doesNotMatch(css, /#startNewRoundBtn::before/);

assert.match(app, /const scoreVisualState = syncState === "error"/);
assert.match(app, /group-score-card score-\$\{scoreVisualState\}/);
assert.match(app, /class="score-state-badge is-\$\{scoreVisualState\}"/);
assert.match(css, /\.group-score-card\.score-saved[^}]*var\(--success\)/s);
assert.match(css, /\.group-score-card\.score-missing/);
assert.match(css, /font-variant-numeric: tabular-nums/);

console.log("Aesthetic phase UI tests passed.");
