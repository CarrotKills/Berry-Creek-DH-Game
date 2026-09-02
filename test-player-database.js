"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PlayerDatabase = require("./player-database.js");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "berry-creek-player-db-"));
const databaseFile = path.join(tempDirectory, "players.sqlite");
let database;

try {
  database = new PlayerDatabase(databaseFile);
  const created = database.create({ name: "Alice Golfer", ghin: 12.4, teeKey: "championship" });
  assert.equal(created.name, "Alice Golfer");
  assert.equal(database.list().length, 1);
  const updated = database.update(created.id, { ghin: 10.8, teeKey: "member" });
  assert.equal(updated.ghin, 10.8);
  assert.equal(updated.teeKey, "member");
  database.close();

  database = new PlayerDatabase(databaseFile);
  const persisted = database.find(created.id);
  assert.equal(persisted.name, "Alice Golfer");
  assert.equal(persisted.ghin, 10.8);
  database.remove(created.id);
  assert.equal(database.list().length, 0);
  database.close();
  database = null;
  console.log("Saved player database tests passed.");
} finally {
  if (database) database.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
