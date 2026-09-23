"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const MAX_ADMINS = 30;
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) throw new Error("Admin name is required");
  return name;
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new Error("Username must be 3 to 30 letters, numbers, dots, dashes, or underscores");
  return username;
}

function suggestedUsername(name) {
  const base = String(name || "admin").trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 24);
  return /^[a-z0-9]/.test(base) && base.length >= 3 ? base : `admin.${crypto.randomBytes(2).toString("hex")}`;
}

function normalizePin(value) {
  const pin = String(value || "").trim();
  if (!/^\d{4,10}$/.test(pin)) throw new Error("Admin PIN must contain 4 to 10 digits");
  return pin;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function publicAdmin(row) {
  return row ? {
    id: row.id,
    name: row.name,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || ""
  } : null;
}

class AdminDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS admin_invitations (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_by_admin_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_admins_name ON admins(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_admin_invitations_expires ON admin_invitations(expires_at);
      PRAGMA optimize;
    `);
    if (!this.db.prepare("PRAGMA table_info(admins)").all().some((column) => column.name === "username")) this.db.exec("ALTER TABLE admins ADD COLUMN username TEXT");
    const usedUsernames = new Set();
    const legacyRows = this.db.prepare("SELECT id, name, username FROM admins ORDER BY created_at").all();
    const migrateUsername = this.db.prepare("UPDATE admins SET username = ? WHERE id = ?");
    legacyRows.forEach((row) => {
      let username;
      try { username = normalizeUsername(row.username); }
      catch (_) { username = suggestedUsername(row.name); }
      const base = username;
      let suffix = 2;
      while (usedUsernames.has(username)) username = `${base.slice(0, 27)}${suffix++}`;
      usedUsernames.add(username);
      if (row.username !== username) migrateUsername.run(username, row.id);
    });
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username COLLATE NOCASE)");
    this.listStatement = this.db.prepare("SELECT id, name, username, created_at, updated_at, last_login_at FROM admins ORDER BY name COLLATE NOCASE, created_at");
    this.authRowsStatement = this.db.prepare("SELECT id, name, username, pin_salt, pin_hash, created_at, updated_at, last_login_at FROM admins ORDER BY created_at");
    this.authCredentialsStatement = this.db.prepare("SELECT id, name, username, pin_salt, pin_hash, created_at, updated_at, last_login_at FROM admins WHERE username = ? COLLATE NOCASE");
    this.findStatement = this.db.prepare("SELECT id, name, username, created_at, updated_at, last_login_at FROM admins WHERE id = ?");
    this.findUsernameStatement = this.db.prepare("SELECT id, name, username, created_at, updated_at, last_login_at FROM admins WHERE username = ? COLLATE NOCASE");
    this.insertStatement = this.db.prepare("INSERT INTO admins (id, name, username, pin_salt, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.updateNameStatement = this.db.prepare("UPDATE admins SET name = ?, username = ?, updated_at = ? WHERE id = ?");
    this.updatePinStatement = this.db.prepare("UPDATE admins SET name = ?, username = ?, pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?");
    this.loginStatement = this.db.prepare("UPDATE admins SET last_login_at = ? WHERE id = ?");
    this.deleteStatement = this.db.prepare("DELETE FROM admins WHERE id = ?");
    this.countStatement = this.db.prepare("SELECT COUNT(*) AS count FROM admins");
    this.insertInvitationStatement = this.db.prepare("INSERT INTO admin_invitations (id, token_hash, created_by_admin_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)");
    this.findInvitationStatement = this.db.prepare("SELECT * FROM admin_invitations WHERE token_hash = ?");
    this.useInvitationStatement = this.db.prepare("UPDATE admin_invitations SET used_at = ? WHERE id = ? AND used_at IS NULL");
    this.pruneInvitationsStatement = this.db.prepare("DELETE FROM admin_invitations WHERE used_at IS NOT NULL OR expires_at < ?");
  }

  count() { return Number(this.countStatement.get().count); }

  list() { return this.listStatement.all().map(publicAdmin); }

  find(id) { return publicAdmin(this.findStatement.get(String(id))); }

  findByUsername(username) {
    try { return publicAdmin(this.findUsernameStatement.get(normalizeUsername(username))); }
    catch (_) { return null; }
  }

  authenticate(value, ignoredId = "") {
    let pin;
    try { pin = normalizePin(value); }
    catch (_) { return null; }
    let matched = null;
    this.authRowsStatement.all().forEach((row) => {
      if (row.id === ignoredId) return;
      const supplied = hashPin(pin, Buffer.from(row.pin_salt, "hex"));
      const expected = Buffer.from(row.pin_hash, "hex");
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) matched = publicAdmin(row);
    });
    return matched;
  }

  authenticateCredentials(usernameValue, pinValue) {
    let username;
    let pin;
    try { username = normalizeUsername(usernameValue); pin = normalizePin(pinValue); }
    catch (_) { return null; }
    const row = this.authCredentialsStatement.get(username);
    if (!row) return null;
    const supplied = hashPin(pin, Buffer.from(row.pin_salt, "hex"));
    const expected = Buffer.from(row.pin_hash, "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? publicAdmin(row) : null;
  }

  create(value) {
    if (this.count() >= MAX_ADMINS) throw new Error(`A maximum of ${MAX_ADMINS} admins may be saved`);
    const name = normalizeName(value?.name);
    const username = normalizeUsername(value?.username || suggestedUsername(name));
    if (this.findByUsername(username)) throw new Error("That username is already in use");
    const pin = normalizePin(value?.pin);
    if (this.authenticate(pin)) throw new Error("That PIN is already assigned to another admin");
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16);
    const now = new Date().toISOString();
    this.insertStatement.run(id, name, username, salt.toString("hex"), hashPin(pin, salt).toString("hex"), now, now);
    return this.find(id);
  }

  update(id, value) {
    const current = this.find(id);
    if (!current) throw new Error("Admin not found");
    const name = value?.name === undefined ? current.name : normalizeName(value.name);
    const username = value?.username === undefined ? current.username : normalizeUsername(value.username);
    const usernameOwner = this.findByUsername(username);
    if (usernameOwner && usernameOwner.id !== String(id)) throw new Error("That username is already in use");
    const now = new Date().toISOString();
    if (value?.pin === undefined || value.pin === "") {
      this.updateNameStatement.run(name, username, now, String(id));
    } else {
      const pin = normalizePin(value.pin);
      if (this.authenticate(pin, String(id))) throw new Error("That PIN is already assigned to another admin");
      const salt = crypto.randomBytes(16);
      this.updatePinStatement.run(name, username, salt.toString("hex"), hashPin(pin, salt).toString("hex"), now, String(id));
    }
    return this.find(id);
  }

  recordLogin(id) {
    if (this.find(id)) this.loginStatement.run(new Date().toISOString(), String(id));
    return this.find(id);
  }

  remove(id) {
    const current = this.find(id);
    if (!current) throw new Error("Admin not found");
    if (this.count() <= 1) throw new Error("The last admin cannot be removed");
    this.deleteStatement.run(String(id));
    return current;
  }

  createInvitation(createdByAdminId, hours = 24) {
    if (!this.find(createdByAdminId)) throw new Error("A named admin is required to create an invitation");
    this.pruneInvitationsStatement.run(new Date().toISOString());
    const validHours = Math.max(1, Math.min(168, Number(hours) || 24));
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
    this.insertInvitationStatement.run(crypto.randomUUID(), tokenHash, String(createdByAdminId), createdAt, expiresAt);
    return { token, createdAt, expiresAt };
  }

  acceptInvitation(tokenValue, value) {
    const token = String(tokenValue || "").trim();
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new Error("This admin invitation is invalid");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invitation = this.findInvitationStatement.get(tokenHash);
      if (!invitation || invitation.used_at) throw new Error("This admin invitation has already been used or is invalid");
      if (Date.parse(invitation.expires_at) <= Date.now()) throw new Error("This admin invitation has expired");
      const admin = this.create(value);
      const used = this.useInvitationStatement.run(new Date().toISOString(), invitation.id);
      if (Number(used.changes) !== 1) throw new Error("This admin invitation has already been used");
      this.db.exec("COMMIT");
      return admin;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() { this.db.close(); }
}

AdminDatabase.MAX_ADMINS = MAX_ADMINS;
AdminDatabase.normalizeUsername = normalizeUsername;

module.exports = AdminDatabase;
