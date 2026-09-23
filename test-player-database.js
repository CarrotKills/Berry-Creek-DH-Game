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
  assert.equal(created.loginConfigured, false);
  const invalidatedInvitation = database.createInvitation(created.id, "admin-1", 24);
  const invitation = database.createInvitation(created.id, "admin-1", 24);
  assert.throws(() => database.acceptInvitation(invalidatedInvitation.token, { username: "alice.old", pin: "111111" }), /already been used or is invalid/);
  const accepted = database.acceptInvitation(invitation.token, { username: "alice.golfer", pin: "123456" });
  assert.equal(accepted.player.loginConfigured, true);
  assert.equal(accepted.wasReset, false);
  assert.throws(() => database.acceptInvitation(invitation.token, { username: "alice.again", pin: "111111" }), /already been used or is invalid/);
  assert.equal(database.authenticate("alice.golfer", "123456", "round-1").playerId, created.id);
  const resetInvitation = database.createInvitation(created.id, "admin-1", 24);
  const reset = database.acceptInvitation(resetInvitation.token, { username: "alice.golfer", pin: "246810" });
  assert.equal(reset.wasReset, true);
  assert.equal(database.authenticate("alice.golfer", "123456", "round-1"), null);
  assert.equal(database.authenticate("alice.golfer", "246810", "round-1").playerId, created.id);
  assert.equal(database.list().length, 1);
  const updated = database.update(created.id, { ghin: 10.8, teeKey: "member" });
  assert.equal(updated.ghin, 10.8);
  assert.equal(updated.teeKey, "member");
  const guest = database.createGuestAccount("round-1", "guest-active", "Guest Golfer", { username: "guest.golfer", pin: "654321" });
  assert.equal(database.authenticate("guest.golfer", "654321", "round-1").activePlayerId, "guest-active");
  assert.equal(database.authenticate("guest.golfer", "654321", "round-2"), null);
  assert.ok(database.exportAccounts().some((account) => account.id === guest.id));
  const accountBackup = database.exportAccounts();
  database.replaceAccounts(accountBackup);
  assert.equal(database.authenticate("alice.golfer", "246810", "round-1").playerId, created.id);
  assert.equal(database.authenticate("guest.golfer", "654321", "round-1").activePlayerId, "guest-active");
  const migrated = database.create({ name: "Legacy Tee", ghin: 8.2, teeKey: "creekWomen" });
  assert.equal(migrated.teeKey, "creekMen");
  const bulkUpdated = database.updateIndexes([{ id: created.id, ghin: -2.4 }, { id: migrated.id, ghin: 7.1 }]);
  assert.equal(bulkUpdated.find((player) => player.id === created.id).ghin, -2.4);
  assert.equal(bulkUpdated.find((player) => player.id === migrated.id).ghin, 7.1);
  database.remove(migrated.id);
  database.close();

  database = new PlayerDatabase(databaseFile);
  const persisted = database.find(created.id);
  assert.equal(persisted.name, "Alice Golfer");
  assert.equal(persisted.ghin, -2.4);
  database.remove(created.id);
  assert.equal(database.list().length, 0);
  database.close();
  database = null;
  console.log("Saved player database tests passed.");
} finally {
  if (database) database.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
