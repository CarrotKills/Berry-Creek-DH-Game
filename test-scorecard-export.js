const assert = require("node:assert/strict");
const E = require("./score-engine.js");
const X = require("./scorecard-export.js");

const player = {
  id: "export-player",
  name: "Export Player",
  ghin: 10,
  teeKey: "championship",
  group: "A",
  scores: [3, 4, 7, ...Array(15).fill("")]
};
const model = X.buildScorecardModel({
  course: E.COURSE,
  settings: { par: 72, allowance: 100 },
  players: [player],
  group: "A",
  roundName: "Test Round",
  date: "2026-09-03",
  scoring: E
});

assert.equal(model.playerRows.length, 1);
assert.equal(model.teeRows[0].total, 6600);
assert.equal(model.frontPar, 36);
assert.equal(model.backPar, 36);
assert.equal(model.totalPar, 72);
assert.deepEqual(model.playerRows[0].marks.slice(0, 3), ["birdie", "bogey", "double-bogey"]);
assert.equal(model.playerRows[0].totalGross, 14);
console.log("Scorecard JPEG model tests passed.");
