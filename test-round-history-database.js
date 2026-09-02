const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const RoundHistoryDatabase = require("./round-history-database.js");
const R = require("./round-state.js");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "berry-creek-rounds-"));
const database = new RoundHistoryDatabase(path.join(directory, "rounds.sqlite"));
let state = R.defaultState();
state.roundName = "History Test";
state.date = "2026-09-02";
state = R.applyAction(state, { type: "ADD_PLAYER", payload: { player: { id: "p1", name: "Test Golfer", group: "A", scores: Array(18).fill(4) } } });

const saved = database.create(state);
assert.equal(saved.roundName, "History Test");
assert.equal(saved.playerCount, 1);
assert.equal(saved.completed, true);
assert.equal(saved.state.players[0].scores.length, 18);
assert.equal(database.list().length, 1);
assert.equal(database.find(saved.id).state.players[0].name, "Test Golfer");
assert.equal(database.remove(saved.id).id, saved.id);
assert.equal(database.list().length, 0);

database.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log("All round history database tests passed.");
