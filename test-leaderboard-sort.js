"use strict";

const assert = require("node:assert/strict");
const Sort = require("./leaderboard-sort.js");

const players = [
  { id: "b", sortValues: { player: "Bob", net: 71, birdies: 1 } },
  { id: "a", sortValues: { player: "Alice", net: 69, birdies: 3 } },
  { id: "c", sortValues: { player: "Charlie", net: null, birdies: 2 } }
];

assert.deepEqual(Sort.sortItems(players, "player", "asc").map((item) => item.id), ["a", "b", "c"]);
assert.deepEqual(Sort.sortItems(players, "birdies", "desc").map((item) => item.id), ["a", "c", "b"]);
assert.deepEqual(Sort.sortItems(players, "net", "asc").map((item) => item.id), ["a", "b", "c"]);
assert.deepEqual(Sort.sortItems(players, "net", "desc").map((item) => item.id), ["b", "a", "c"]);
assert.equal(Sort.compareValues(null, 5, "desc"), 1);

const pointItems = [
  { id: "flower", ledger: { settledNet: 6 }, totals: { total: { net: 70 } } },
  { id: "points-tie", ledger: { settledNet: 6 }, totals: { total: { net: 72 } } },
  { id: "negative-tie", ledger: { settledNet: -4 }, totals: { total: { net: 74 } } },
  { id: "poop", ledger: { settledNet: -4 }, totals: { total: { net: 78 } } }
];
assert.deepEqual(Sort.pointMarkerIds(pointItems), { leaderId: "flower", loserId: "poop" }, "Total Net breaks point ties in the appropriate direction");
assert.deepEqual(Sort.pointMarkerIds([
  { id: "a", ledger: { settledNet: 5 }, totals: { total: { net: 70 } } },
  { id: "b", ledger: { settledNet: 5 }, totals: { total: { net: 70 } } },
  { id: "c", ledger: { settledNet: -2 }, totals: { total: { net: 80 } } }
]), { leaderId: null, loserId: "c" }, "An unresolved points and Total Net tie awards no flower");
assert.deepEqual(Sort.pointMarkerIds([
  { id: "a", ledger: { settledNet: 5 }, totals: { total: { net: 70 } } },
  { id: "b", ledger: { settledNet: -2 }, totals: { total: { net: 80 } } },
  { id: "c", ledger: { settledNet: -2 }, totals: { total: { net: 80 } } }
]), { leaderId: "a", loserId: null }, "An unresolved points and Total Net tie awards no poop");
assert.deepEqual(Sort.pointMarkerIds([
  { id: "a", ledger: { settledNet: 0 }, totals: { total: { net: 0 } } },
  { id: "b", ledger: { settledNet: 0 }, totals: { total: { net: 0 } } }
]), { leaderId: null, loserId: null }, "Zero points award no markers");
console.log("Leaderboard sorting tests passed.");
