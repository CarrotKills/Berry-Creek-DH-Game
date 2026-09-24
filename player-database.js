"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const TEE_KEY_ALIASES = Object.freeze({ creekWomen: "creekMen", creekBerryCombo: "creekMen", berryMen: "creekMen", berryWomen: "creekMen" });
const TEE_KEYS = new Set(["championship", "member", "memberCreekCombo", "creekMen"]);
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeTeeKey(value) {
  const requested = String(value || "championship").slice(0, 40);
  const normalized = TEE_KEY_ALIASES[requested] || requested;
  return TEE_KEYS.has(normalized) ? normalized : "championship";
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new Error("Username must be 3 to 30 letters, numbers, dots, dashes, or underscores");
  return username;
}

function normalizePin(value) {
  const pin = String(value || "").trim();
  if (!/^\d{4,10}$/.test(pin)) throw new Error("PIN must contain 4 to 10 digits");
  return pin;
}

function hashPin(pin, salt) { return crypto.scryptSync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS); }

function normalizeInput(value) {
  const name = String(value?.name || "").trim().slice(0, 40);
  if (!name) throw new Error("Player name is required");
  const rawGhin = Number(value?.ghin);
  const ghin = Number.isFinite(rawGhin) ? Math.max(-10, Math.min(54, rawGhin)) : 0;
  return { name, ghin, teeKey: normalizeTeeKey(value?.teeKey) };
}

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id, username: row.username, name: row.name, role: "player", accountType: row.account_type,
    playerId: row.player_id || "", roundId: row.round_id || "", activePlayerId: row.active_player_id || "",
    createdAt: row.created_at, updatedAt: row.updated_at, lastLoginAt: row.last_login_at || ""
  };
}

function fromRow(row, account = null) {
  return row ? {
    id: row.id, name: row.name, ghin: Number(row.ghin), teeKey: normalizeTeeKey(row.tee_key),
    username: account?.username || "", loginConfigured: Boolean(account), lastLoginAt: account?.lastLoginAt || "",
    createdAt: row.created_at, updatedAt: row.updated_at
  } : null;
}

function normalizeStored(value) {
  const player = normalizeInput(value);
  const id = String(value?.id || crypto.randomUUID()).slice(0, 100);
  const now = new Date().toISOString();
  return { ...player, id, createdAt: String(value?.createdAt || now).slice(0, 40), updatedAt: String(value?.updatedAt || value?.createdAt || now).slice(0, 40) };
}

function normalizeStoredAccount(value) {
  const accountType = value?.accountType === "guest" ? "guest" : "player";
  const username = normalizeUsername(value?.username);
  const pinSalt = String(value?.pinSalt || "");
  const pinHash = String(value?.pinHash || "");
  if (!/^[a-f0-9]{32}$/i.test(pinSalt) || !/^[a-f0-9]{64}$/i.test(pinHash)) throw new Error("A player login in the backup is invalid");
  const now = new Date().toISOString();
  return {
    id: String(value?.id || crypto.randomUUID()), username, name: String(value?.name || "Player").trim().slice(0, 40), accountType,
    playerId: accountType === "player" ? String(value?.playerId || "") : "",
    roundId: accountType === "guest" ? String(value?.roundId || "") : "",
    activePlayerId: accountType === "guest" ? String(value?.activePlayerId || "") : "",
    pinSalt, pinHash, createdAt: String(value?.createdAt || now).slice(0, 40),
    updatedAt: String(value?.updatedAt || value?.createdAt || now).slice(0, 40), lastLoginAt: String(value?.lastLoginAt || "").slice(0, 40)
  };
}

class PlayerDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ghin REAL NOT NULL DEFAULT 0,
        tee_key TEXT NOT NULL DEFAULT 'championship',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('player', 'guest')),
        player_id TEXT,
        round_id TEXT,
        active_player_id TEXT,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS player_invitations (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        player_id TEXT NOT NULL,
        created_by_admin_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_player_accounts_saved_player ON player_accounts(player_id) WHERE account_type = 'player';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_player_accounts_guest_round_player ON player_accounts(round_id, active_player_id) WHERE account_type = 'guest';
      CREATE INDEX IF NOT EXISTS idx_player_accounts_round ON player_accounts(round_id);
      CREATE INDEX IF NOT EXISTS idx_player_invitations_player ON player_invitations(player_id);
      CREATE INDEX IF NOT EXISTS idx_player_invitations_expires ON player_invitations(expires_at);
      PRAGMA optimize;
    `);
    this.listStatement = this.db.prepare("SELECT * FROM players ORDER BY name COLLATE NOCASE, created_at");
    this.findStatement = this.db.prepare("SELECT * FROM players WHERE id = ?");
    this.insertStatement = this.db.prepare("INSERT INTO players (id, name, ghin, tee_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    this.updateStatement = this.db.prepare("UPDATE players SET name = ?, ghin = ?, tee_key = ?, updated_at = ? WHERE id = ?");
    this.updateIndexStatement = this.db.prepare("UPDATE players SET ghin = ?, updated_at = ? WHERE id = ?");
    this.deleteStatement = this.db.prepare("DELETE FROM players WHERE id = ?");
    this.accountForPlayerStatement = this.db.prepare("SELECT * FROM player_accounts WHERE account_type = 'player' AND player_id = ?");
    this.accountByUsernameStatement = this.db.prepare("SELECT * FROM player_accounts WHERE username = ? COLLATE NOCASE");
    this.accountByIdStatement = this.db.prepare("SELECT * FROM player_accounts WHERE id = ?");
    this.insertAccountStatement = this.db.prepare("INSERT INTO player_accounts (id, username, name, account_type, player_id, round_id, active_player_id, pin_salt, pin_hash, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    this.updateAccountStatement = this.db.prepare("UPDATE player_accounts SET username = ?, name = ?, pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?");
    this.updateAccountWithoutPinStatement = this.db.prepare("UPDATE player_accounts SET username = ?, name = ?, updated_at = ? WHERE id = ?");
    this.updateAccountNameStatement = this.db.prepare("UPDATE player_accounts SET name = ? WHERE id = ?");
    this.recordLoginStatement = this.db.prepare("UPDATE player_accounts SET last_login_at = ? WHERE id = ?");
    this.deletePlayerAccountStatement = this.db.prepare("DELETE FROM player_accounts WHERE account_type = 'player' AND player_id = ?");
    this.deleteGuestAccountStatement = this.db.prepare("DELETE FROM player_accounts WHERE account_type = 'guest' AND round_id = ? AND active_player_id = ?");
    this.deleteGuestRoundAccountsStatement = this.db.prepare("DELETE FROM player_accounts WHERE account_type = 'guest' AND round_id = ?");
    this.allAccountsStatement = this.db.prepare("SELECT * FROM player_accounts ORDER BY created_at");
    this.clearAccountsStatement = this.db.prepare("DELETE FROM player_accounts");
    this.insertInvitationStatement = this.db.prepare("INSERT INTO player_invitations (id, token_hash, player_id, created_by_admin_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
    this.findInvitationStatement = this.db.prepare("SELECT * FROM player_invitations WHERE token_hash = ?");
    this.useInvitationStatement = this.db.prepare("UPDATE player_invitations SET used_at = ? WHERE id = ? AND used_at IS NULL");
    this.invalidatePlayerInvitationsStatement = this.db.prepare("UPDATE player_invitations SET used_at = ? WHERE player_id = ? AND used_at IS NULL");
    this.deletePlayerInvitationsStatement = this.db.prepare("DELETE FROM player_invitations WHERE player_id = ?");
    this.pruneInvitationsStatement = this.db.prepare("DELETE FROM player_invitations WHERE used_at IS NOT NULL OR expires_at < ?");
    this.clearInvitationsStatement = this.db.prepare("DELETE FROM player_invitations");
  }

  accountForPlayer(id) { return publicAccount(this.accountForPlayerStatement.get(String(id))); }
  list() { return this.listStatement.all().map((row) => fromRow(row, this.accountForPlayer(row.id))); }
  find(id) { const row = this.findStatement.get(String(id)); return fromRow(row, row ? this.accountForPlayer(row.id) : null); }
  findAccountByUsername(value) { try { return publicAccount(this.accountByUsernameStatement.get(normalizeUsername(value))); } catch (_) { return null; } }
  findAccount(id) { return publicAccount(this.accountByIdStatement.get(String(id))); }

  authenticate(usernameValue, pinValue, activeRoundId) {
    let username;
    let pin;
    try { username = normalizeUsername(usernameValue); pin = normalizePin(pinValue); }
    catch (_) { return null; }
    const row = this.accountByUsernameStatement.get(username);
    if (!row || (row.account_type === "guest" && row.round_id !== String(activeRoundId || ""))) return null;
    if (row.account_type === "player" && !this.findStatement.get(row.player_id)) return null;
    const supplied = hashPin(pin, Buffer.from(row.pin_salt, "hex"));
    const expected = Buffer.from(row.pin_hash, "hex");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? publicAccount(row) : null;
  }

  create(value) {
    const player = normalizeInput(value);
    const id = String(value?.id || crypto.randomUUID());
    const now = new Date().toISOString();
    const wantsAccount = value?.username !== undefined || value?.pin !== undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertStatement.run(id, player.name, player.ghin, player.teeKey, now, now);
      if (wantsAccount) this.setCredentials(id, { username: value.username, pin: value.pin }, { inTransaction: true });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.find(id);
  }

  setCredentials(playerId, value, options = {}) {
    const player = this.findStatement.get(String(playerId));
    if (!player) throw new Error("Saved player not found");
    const currentRow = this.accountForPlayerStatement.get(String(playerId));
    const username = normalizeUsername(value?.username === undefined ? currentRow?.username : value.username);
    const owner = this.accountByUsernameStatement.get(username);
    if (owner && owner.id !== currentRow?.id) throw new Error("That username is already in use");
    const pinProvided = value?.pin !== undefined && value.pin !== "";
    if (!currentRow && !pinProvided) throw new Error("Choose a PIN when creating a player login");
    const now = new Date().toISOString();
    const write = () => {
      if (!currentRow) {
        const pin = normalizePin(value.pin);
        const salt = crypto.randomBytes(16);
        this.insertAccountStatement.run(crypto.randomUUID(), username, player.name, "player", player.id, "", "", salt.toString("hex"), hashPin(pin, salt).toString("hex"), now, now, null);
      } else if (pinProvided) {
        const pin = normalizePin(value.pin);
        const salt = crypto.randomBytes(16);
        this.updateAccountStatement.run(username, player.name, salt.toString("hex"), hashPin(pin, salt).toString("hex"), now, currentRow.id);
      } else this.updateAccountWithoutPinStatement.run(username, player.name, now, currentRow.id);
    };
    if (options.inTransaction) write();
    else {
      this.db.exec("BEGIN IMMEDIATE");
      try { write(); this.db.exec("COMMIT"); }
      catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    return this.find(playerId);
  }

  createGuestAccount(roundId, activePlayerId, nameValue, value) {
    const round = String(roundId || "");
    const activePlayer = String(activePlayerId || "");
    const name = String(nameValue || "Guest").trim().slice(0, 40);
    if (!round || !activePlayer || !name) throw new Error("Guest login details are incomplete");
    const username = normalizeUsername(value?.username);
    if (this.accountByUsernameStatement.get(username)) throw new Error("That username is already in use");
    const pin = normalizePin(value?.pin);
    const salt = crypto.randomBytes(16);
    const now = new Date().toISOString();
    this.insertAccountStatement.run(crypto.randomUUID(), username, name, "guest", "", round, activePlayer, salt.toString("hex"), hashPin(pin, salt).toString("hex"), now, now, null);
    return this.findAccountByUsername(username);
  }

  removeGuestAccount(roundId, activePlayerId) { this.deleteGuestAccountStatement.run(String(roundId || ""), String(activePlayerId || "")); }
  removeGuestAccountsForRound(roundId) { this.deleteGuestRoundAccountsStatement.run(String(roundId || "")); }

  retirePlayerAccess(playerId) {
    const id = String(playerId || "");
    const current = this.accountForPlayer(id);
    const retiredAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.invalidatePlayerInvitationsStatement.run(retiredAt, id);
      this.deletePlayerAccountStatement.run(id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return current;
  }

  createInvitation(playerId, createdByAdminId, hours = 24) {
    const player = this.find(playerId);
    if (!player) throw new Error("Saved player not found");
    const creator = String(createdByAdminId || "").trim();
    if (!creator) throw new Error("A named admin is required to create a player invitation");
    const validHours = Math.max(1, Math.min(168, Number(hours) || 24));
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.pruneInvitationsStatement.run(createdAt);
      this.invalidatePlayerInvitationsStatement.run(createdAt, player.id);
      this.insertInvitationStatement.run(crypto.randomUUID(), tokenHash, player.id, creator, createdAt, expiresAt);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { token, playerId: player.id, playerName: player.name, createdAt, expiresAt, resetsExistingLogin: player.loginConfigured };
  }

  acceptInvitation(tokenValue, value) {
    const token = String(tokenValue || "").trim();
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new Error("This player invitation is invalid");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invitation = this.findInvitationStatement.get(tokenHash);
      if (!invitation || invitation.used_at) throw new Error("This player invitation has already been used or is invalid");
      if (Date.parse(invitation.expires_at) <= Date.now()) throw new Error("This player invitation has expired");
      const wasReset = Boolean(this.accountForPlayerStatement.get(invitation.player_id));
      const player = this.setCredentials(invitation.player_id, { username: value?.username, pin: value?.pin }, { inTransaction: true });
      const used = this.useInvitationStatement.run(new Date().toISOString(), invitation.id);
      if (Number(used.changes) !== 1) throw new Error("This player invitation has already been used");
      this.db.exec("COMMIT");
      return { player, account: this.accountForPlayer(player.id), wasReset };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  update(id, value) {
    const current = this.find(id);
    if (!current) throw new Error("Saved player not found");
    const player = normalizeInput({ ...current, ...value });
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.updateStatement.run(player.name, player.ghin, player.teeKey, now, String(id));
      if (value?.username !== undefined || value?.pin !== undefined) this.setCredentials(id, value, { inTransaction: true });
      else if (current.loginConfigured) this.updateAccountNameStatement.run(player.name, this.accountForPlayer(id).id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.find(id);
  }

  updateIndexes(values) {
    if (!Array.isArray(values)) throw new Error("Index updates must be an array");
    const updates = values.map((value) => {
      const id = String(value?.id || "");
      const ghin = Number(value?.ghin);
      if (!id || !this.find(id)) throw new Error("Saved player not found");
      if (!Number.isFinite(ghin) || ghin < -10 || ghin > 54) throw new Error("A Handicap Index is invalid");
      return { id, ghin: Math.round(ghin * 10) / 10 };
    });
    const updatedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try { updates.forEach((update) => this.updateIndexStatement.run(update.ghin, updatedAt, update.id)); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return updates.map((update) => this.find(update.id));
  }

  recordLogin(accountId) {
    const account = this.findAccount(accountId);
    if (account) this.recordLoginStatement.run(new Date().toISOString(), account.id);
    return this.findAccount(accountId);
  }

  remove(id) {
    const current = this.find(id);
    if (!current) throw new Error("Saved player not found");
    this.db.exec("BEGIN IMMEDIATE");
    try { this.deletePlayerInvitationsStatement.run(String(id)); this.deletePlayerAccountStatement.run(String(id)); this.deleteStatement.run(String(id)); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return current;
  }

  exportAccounts() {
    return this.allAccountsStatement.all().map((row) => ({
      id: row.id, username: row.username, name: row.name, accountType: row.account_type, playerId: row.player_id || "", roundId: row.round_id || "", activePlayerId: row.active_player_id || "",
      pinSalt: row.pin_salt, pinHash: row.pin_hash, createdAt: row.created_at, updatedAt: row.updated_at, lastLoginAt: row.last_login_at || ""
    }));
  }

  replaceAccounts(values) {
    if (!Array.isArray(values)) throw new Error("Player logins must be an array");
    const accounts = values.map(normalizeStoredAccount);
    const usernames = new Set();
    accounts.forEach((account) => {
      if (usernames.has(account.username)) throw new Error("The backup contains duplicate usernames");
      if (account.accountType === "player" && !this.findStatement.get(account.playerId)) throw new Error("A player login in the backup has no matching saved player");
      usernames.add(account.username);
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.clearAccountsStatement.run();
      accounts.forEach((account) => this.insertAccountStatement.run(account.id, account.username, account.name, account.accountType, account.playerId, account.roundId, account.activePlayerId, account.pinSalt, account.pinHash, account.createdAt, account.updatedAt, account.lastLoginAt || null));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return accounts.map((account) => this.findAccount(account.id));
  }

  replaceAll(values) {
    if (!Array.isArray(values)) throw new Error("Saved players must be an array");
    const players = values.map(normalizeStored);
    const ids = new Set();
    players.forEach((player) => { if (ids.has(player.id)) throw new Error("The backup contains duplicate saved-player IDs"); ids.add(player.id); });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.clearInvitationsStatement.run();
      this.db.exec("DELETE FROM players");
      players.forEach((player) => this.insertStatement.run(player.id, player.name, player.ghin, player.teeKey, player.createdAt, player.updatedAt));
      this.db.prepare("DELETE FROM player_accounts WHERE account_type = 'player' AND player_id NOT IN (SELECT id FROM players)").run();
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.list();
  }

  close() { this.db.close(); }
}

PlayerDatabase.normalizeUsername = normalizeUsername;

module.exports = PlayerDatabase;
