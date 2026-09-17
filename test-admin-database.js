const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdminDatabase = require("./admin-database.js");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "berry-creek-admin-test-"));
const database = new AdminDatabase(path.join(directory, "admins.sqlite"));

try {
  assert.equal(database.count(), 0);
  const alice = database.create({ name: "Alice Admin", pin: "1357" });
  assert.equal(database.authenticate("1357").name, "Alice Admin");
  assert.equal(database.authenticate("9999"), null);
  assert.equal(Object.hasOwn(database.list()[0], "pinHash"), false);
  assert.throws(() => database.create({ name: "Duplicate PIN", pin: "1357" }), /already assigned/);
  assert.throws(() => database.create({ name: "Short PIN", pin: "12" }), /4 to 10 digits/);

  const invitation = database.createInvitation(alice.id, 24);
  assert.match(invitation.token, /^[A-Za-z0-9_-]{40,60}$/);
  const bob = database.acceptInvitation(invitation.token, { name: "Bob Admin", pin: "8642" });
  assert.equal(database.authenticate("8642").id, bob.id);
  assert.throws(() => database.acceptInvitation(invitation.token, { name: "Reuse", pin: "2468" }), /already been used|invalid/);

  database.update(alice.id, { name: "Alice Updated", pin: "9753" });
  assert.equal(database.authenticate("1357"), null);
  assert.equal(database.authenticate("9753").name, "Alice Updated");
  database.recordLogin(alice.id);
  assert.ok(database.find(alice.id).lastLoginAt);

  database.remove(bob.id);
  assert.throws(() => database.remove(alice.id), /last admin/);
  console.log("Named admin database and invitation tests passed.");
} finally {
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
