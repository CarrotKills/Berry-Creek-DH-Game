"use strict";

const assert = require("node:assert/strict");
const Sheet = require("./index-sheet.js");

const parsed = Sheet.parseIndexSheet([
  "Update Date,9/21/2026",
  "Player Name,GHIN Index",
  "Alice Golfer,12.3",
  '"Smith, Bob",+4.2',
  "Duplicate Golfer,8.1",
  "Duplicate Golfer,9.1",
  "Invalid Golfer,NH"
].join("\r\n"));

assert.equal(parsed.updateDate, "2026-09-21");
assert.equal(parsed.valid.length, 4);
assert.equal(parsed.invalid.length, 1);
assert.equal(parsed.valid.find((player) => player.name === "Smith, Bob").ghin, -4.2);
assert.equal(Sheet.parseGolfIndex("+3.6"), -3.6);
assert.equal(Sheet.parseGolfIndex("=+0.2"), -0.2);
assert.equal(Sheet.parseGolfIndex("17.2"), 17.2);
assert.equal(Sheet.parseGolfIndex("NH"), null);
assert.equal(Sheet.parseSheetDate("Last updated September 20, 2026"), "2026-09-20");
assert.equal(Sheet.parseSheetDate("9/2/26"), "2026-09-02");

const plan = Sheet.buildIndexUpdatePlan([
  { id: "alice", name: "Alice Golfer", ghin: 14.1 },
  { id: "bob", name: "Bob Smith", ghin: -4.2 },
  { id: "missing", name: "Missing Golfer", ghin: 10 },
  { id: "duplicate", name: "Duplicate Golfer", ghin: 8.1 },
  { id: "invalid", name: "Invalid Golfer", ghin: 5 }
], parsed);

assert.deepEqual(plan.updates.map((player) => [player.id, player.ghin]), [["alice", 12.3]]);
assert.deepEqual(plan.unchanged.map((player) => player.id), ["bob"]);
assert.deepEqual(plan.unmatched.map((player) => player.id), ["missing"]);
assert.deepEqual(plan.ambiguous.map((player) => player.id), ["duplicate"]);
assert.deepEqual(plan.invalid.map((player) => player.id), ["invalid"]);

const splitNames = Sheet.parseIndexSheet("As of,2026-09-21\nFirst Name,Last Name,Handicap Index\nCarol,Player,7.4");
assert.equal(splitNames.updateDate, "2026-09-21");
assert.equal(splitNames.valid[0].name, "Carol Player");

const currentRosterLayout = Sheet.parseIndexSheet([
  ",Updated:,9/21/2026 15:25:46",
  "Aaron Alexander,,",
  "Berry Creek Country Club,,",
  "7.6,,",
  "Colton Bailey,,",
  "Berry Creek Country Club,,",
  "=+0.2,,"
].join("\n"));
assert.equal(currentRosterLayout.updateDate, "2026-09-21");
assert.deepEqual(currentRosterLayout.valid.map((player) => [player.name, player.ghin]), [["Aaron Alexander", 7.6], ["Colton Bailey", -0.2]]);

console.log("Published index-sheet tests passed.");
