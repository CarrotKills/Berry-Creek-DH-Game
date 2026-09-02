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
console.log("Leaderboard sorting tests passed.");
