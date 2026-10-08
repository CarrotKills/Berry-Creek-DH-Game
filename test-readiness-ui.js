"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

assert.match(html, /id="indexReadinessWarning"/);
assert.match(html, /id="systemDetails"/);
assert.match(html, /id="systemChecksList"/);
assert.match(html, /See each group's scorekeeper, connection status, position, and missing scores/);

assert.match(app, /readinessData\?\.indexCheck/);
assert.match(app, /readinessWarning\.hidden = !adminUnlocked \|\| !check \|\| check\.ok/);
assert.match(app, /Scorekeeper: \$\{nameOf\(scorekeeper/);
assert.match(app, /Scorekeeper: Not assigned/);
assert.match(app, /readinessData\?\.systemChecks/);

assert.match(server, /if \(!pinCheck\.ok\) checks\.push\(pinCheck\)/);
assert.match(server, /if \(!httpsCheck\.ok\) checks\.push\(httpsCheck\)/);
assert.match(server, /const systemChecks = \[/);
assert.match(server, /const indexCheck = \{/);
assert.doesNotMatch(server, /checksWithoutScorekeeper/);
assert.doesNotMatch(server, /key: "database"/);

console.log("Streamlined readiness UI tests passed.");
