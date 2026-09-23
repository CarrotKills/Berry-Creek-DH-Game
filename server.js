"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const Round = require("./round-state.js");
const AdminDatabase = require("./admin-database.js");
const PlayerDatabase = require("./player-database.js");
const RoundHistoryDatabase = require("./round-history-database.js");
const IndexSheet = require("./index-sheet.js");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PIN = String(process.env.ADMIN_PIN || "2468");
const APP_VERSION = "9.11.3";
const ROOT = __dirname;
const DEFAULT_DATA_DIR = process.env.PLAYERS_DB_FILE ? path.dirname(path.resolve(process.env.PLAYERS_DB_FILE)) : path.join(ROOT, "data");
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const DATA_FILE = path.resolve(process.env.ROUND_FILE || path.join(DATA_DIR, "round.json"));
const PLAYERS_DB_FILE = path.resolve(process.env.PLAYERS_DB_FILE || path.join(DATA_DIR, "players.sqlite"));
const ROUND_HISTORY_DB_FILE = path.resolve(process.env.ROUND_HISTORY_DB_FILE || path.join(DATA_DIR, "rounds.sqlite"));
const ADMIN_DB_FILE = path.resolve(process.env.ADMIN_DB_FILE || path.join(DATA_DIR, "admins.sqlite"));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, "backups"));
const BACKUP_FORMAT = "berry-creek-complete-backup";
const BACKUP_FORMAT_VERSION = 2;
const SNAPSHOT_LIMIT = 25;
const DESTRUCTIVE_ACTIONS = new Set(["CLEAR_ROUND", "REPLACE_ROUND", "START_FROM_SAVED", "RESET_SCORES"]);
const SHARE_SECRET = String(process.env.SHARE_SECRET || ADMIN_PIN);
const AUTH_SECRET = String(process.env.AUTH_SECRET || SHARE_SECRET);
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const INDEX_SHEET_CSV_URL = String(process.env.INDEX_SHEET_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vSZyzvxEBnr9IugRMC6aptHh1ZJ3mugb4boxRmu7NS7TL-kn7BY3hAgmtSHh-7ZoyvuFtLmUEL5v3f9/pub?output=csv");
const INDEX_SHEET_MAX_BYTES = 2 * 1024 * 1024;
const clients = new Map();
const adminLoginAttempts = new Map();
const adminAuthCache = new Map();
const adminDatabase = new AdminDatabase(ADMIN_DB_FILE);
const playerDatabase = new PlayerDatabase(PLAYERS_DB_FILE);
const roundHistoryDatabase = new RoundHistoryDatabase(ROUND_HISTORY_DB_FILE);

function readState() {
  try { return Round.normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); }
  catch (_) { return Round.defaultState(); }
}

let state = readState();

function persist() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

persist();

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function broadcast() {
  const data = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  clients.forEach((_, res) => res.write(data));
}

function presencePayload() {
  const connectedGroups = [...clients.values()].map((client) => {
    if (client.accountId) {
      const account = playerDatabase.findAccount(client.accountId);
      const player = activePlayerForAccount(sessionAccount(account, "player"));
      if (player && state.settings.scorekeepers[player.group] === player.id) return player.group;
    }
    return client.scorer && scoringTokenMatches(client.group, client.token) ? client.group : "";
  });
  return Object.fromEntries(Round.GROUPS.map((group) => [group, connectedGroups.filter((connectedGroup) => connectedGroup === group).length]));
}

function broadcastPresence() {
  const data = `event: presence\ndata: ${JSON.stringify(presencePayload())}\n\n`;
  clients.forEach((_, res) => res.write(data));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function buildCompleteBackup(reason = "manual") {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    reason: String(reason).slice(0, 80),
    activeRound: state,
    savedPlayers: playerDatabase.list(),
    playerAccounts: playerDatabase.exportAccounts(),
    savedRounds: roundHistoryDatabase.exportAll()
  };
}

function normalizeCompleteBackup(value) {
  if (value?.format !== BACKUP_FORMAT || ![1, BACKUP_FORMAT_VERSION].includes(Number(value?.formatVersion))) throw new Error("That file is not a Berry Creek complete backup");
  if (!value.activeRound || !Array.isArray(value.activeRound.players)) throw new Error("The active round in the backup is invalid");
  if (!Array.isArray(value.savedPlayers) || value.savedPlayers.length > 5000) throw new Error("The saved-player data in the backup is invalid");
  if (!Array.isArray(value.savedRounds) || value.savedRounds.length > 1000) throw new Error("The saved-round data in the backup is invalid");
  if (value.playerAccounts !== undefined && (!Array.isArray(value.playerAccounts) || value.playerAccounts.length > 5000)) throw new Error("The player-login data in the backup is invalid");
  const savedRounds = value.savedRounds.map((round) => {
    if (!round?.state || !Array.isArray(round.state.players)) throw new Error("A saved round in the backup is invalid");
    return { ...round, state: Round.normalizeState(round.state) };
  });
  return {
    ...value,
    activeRound: Round.normalizeState(value.activeRound),
    savedPlayers: value.savedPlayers,
    playerAccounts: Array.isArray(value.playerAccounts) ? value.playerAccounts : null,
    savedRounds
  };
}

function snapshotFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((name) => /^berry-creek-snapshot-.*\.json$/.test(name)).sort().reverse();
  } catch (_) {
    return [];
  }
}

function latestSnapshot() {
  const name = snapshotFiles()[0];
  if (!name) return null;
  const stat = fs.statSync(path.join(BACKUP_DIR, name));
  return { name, createdAt: stat.mtime.toISOString(), size: stat.size };
}

function createSnapshot(reason, bundle = buildCompleteBackup(reason)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = String(reason || "snapshot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "snapshot";
  const name = `berry-creek-snapshot-${stamp}-${safeReason}-${crypto.randomBytes(3).toString("hex")}.json`;
  const destination = path.join(BACKUP_DIR, name);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(bundle, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, destination);
  snapshotFiles().slice(SNAPSHOT_LIMIT).forEach((oldName) => fs.unlinkSync(path.join(BACKUP_DIR, oldName)));
  const stat = fs.statSync(destination);
  return { name, createdAt: stat.mtime.toISOString(), size: stat.size };
}

function restoreCompleteBackup(value) {
  const incoming = normalizeCompleteBackup(value);
  (incoming.playerAccounts || []).forEach((account) => {
    if (adminDatabase.findByUsername(account.username)) throw new Error(`Player username ${account.username} conflicts with an admin username`);
  });
  const previous = buildCompleteBackup("before-complete-restore");
  const snapshot = createSnapshot("before-complete-restore", previous);
  try {
    playerDatabase.replaceAll(incoming.savedPlayers);
    if (incoming.playerAccounts) playerDatabase.replaceAccounts(incoming.playerAccounts);
    roundHistoryDatabase.replaceAll(incoming.savedRounds);
    state = incoming.activeRound;
    persist();
  } catch (error) {
    playerDatabase.replaceAll(previous.savedPlayers);
    playerDatabase.replaceAccounts(previous.playerAccounts || []);
    roundHistoryDatabase.replaceAll(previous.savedRounds);
    state = Round.normalizeState(previous.activeRound);
    persist();
    throw error;
  }
  return { snapshot, activeRound: state, savedPlayerCount: incoming.savedPlayers.length, savedRoundCount: incoming.savedRounds.length };
}

function requestIsSecure(req) {
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = String(req.headers.host || "");
  return forwardedProtocol === "https" || Boolean(req.socket.encrypted) || /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
}

function readinessPayload(req) {
  let storageWritable = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.readiness-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok", { mode: 0o600 });
    fs.unlinkSync(probe);
    storageWritable = true;
  } catch (_) {}
  const persistentStorageConfigured = Boolean(process.env.DATA_DIR || process.env.PLAYERS_DB_FILE || process.env.ROUND_FILE || process.env.ROUND_HISTORY_DB_FILE || process.env.ADMIN_DB_FILE || DATA_DIR.startsWith("/var/data"));
  const adminCount = adminDatabase.count();
  const latest = latestSnapshot();
  const backupFresh = Boolean(latest && Date.now() - Date.parse(latest.createdAt) < 24 * 60 * 60 * 1000);
  const secureConnection = requestIsSecure(req);
  const authSecretConfigured = Boolean(process.env.AUTH_SECRET || process.env.SHARE_SECRET || process.env.ADMIN_PIN);
  const activeGroups = Round.GROUPS.filter((group) => state.players.some((player) => player.group === group));
  const competingPlayers = state.players.filter((player) => player.inGame).length;
  const savedPlayerCount = playerDatabase.list().length;
  const playerAccounts = playerDatabase.exportAccounts();
  const activePlayersWithoutLogin = state.players.filter((player) => player.isGuest
    ? !playerAccounts.some((account) => account.accountType === "guest" && account.roundId === state.roundId && account.activePlayerId === player.id)
    : !player.directoryId || !playerAccounts.some((account) => account.accountType === "player" && account.playerId === player.directoryId));
  const groupsWithoutScorekeeper = activeGroups.filter((group) => !state.settings.scorekeepers[group]);
  const savedRoundCount = roundHistoryDatabase.list().length;
  const checks = [
    { key: "storage", label: "Server storage is writable", ok: storageWritable, severity: "error", detail: storageWritable ? "Round and database files can be updated." : "The server cannot write to its data folder." },
    { key: "persistent", label: "Persistent storage is configured", ok: persistentStorageConfigured, severity: "error", detail: persistentStorageConfigured ? "A persistent data location is configured." : "Set DATA_DIR or PLAYERS_DB_FILE to a persistent disk before a live event." },
    { key: "pin", label: "Named admin access is configured", ok: adminCount > 0, severity: "warning", detail: adminCount ? `${adminCount} named admin${adminCount === 1 ? "" : "s"} can sign in with separate PINs.` : "Sign in with the setup PIN, then add at least one named admin." },
    { key: "auth-secret", label: "A private session secret is configured", ok: authSecretConfigured, severity: "warning", detail: authSecretConfigured ? "Signed user sessions remain private and stable across restarts." : "Set AUTH_SECRET to a long random value before live use." },
    { key: "backup", label: "A server snapshot is less than 24 hours old", ok: backupFresh, severity: "warning", detail: latest ? `Latest snapshot: ${latest.createdAt}.` : "Create a snapshot before the event begins." },
    { key: "roster", label: "The active round has competing players", ok: competingPlayers > 0, severity: "warning", detail: `${state.players.length} assigned; ${competingPlayers} in the game across ${activeGroups.length} group${activeGroups.length === 1 ? "" : "s"}.` },
    { key: "logins", label: "Active players have login credentials", ok: activePlayersWithoutLogin.length === 0, severity: "warning", detail: activePlayersWithoutLogin.length ? `${activePlayersWithoutLogin.length} active player${activePlayersWithoutLogin.length === 1 ? " does" : "s do"} not have a usable login.` : `${state.players.length} active player login${state.players.length === 1 ? " is" : "s are"} ready.` },
    { key: "scorekeepers", label: "Active groups have scorekeepers", ok: groupsWithoutScorekeeper.length === 0, severity: "warning", detail: groupsWithoutScorekeeper.length ? `Group${groupsWithoutScorekeeper.length === 1 ? "" : "s"} ${groupsWithoutScorekeeper.join(", ")} can select a scorekeeper on the Scoring page.` : "Every active group has one scorekeeper." },
    { key: "database", label: "Admin, player, and round databases are available", ok: true, severity: "error", detail: `${adminCount} admin${adminCount === 1 ? "" : "s"}; ${savedPlayerCount} saved player${savedPlayerCount === 1 ? "" : "s"}; ${playerAccounts.length} player login${playerAccounts.length === 1 ? "" : "s"}; ${savedRoundCount} saved round${savedRoundCount === 1 ? "" : "s"}.` },
    { key: "https", label: "The app is using a secure connection", ok: secureConnection, severity: "warning", detail: secureConnection ? "Usernames, PINs, and live scores are protected in transit." : "Use HTTPS before anyone signs in outside this device." }
  ];
  const failedErrors = checks.filter((check) => !check.ok && check.severity === "error").length;
  const failedWarnings = checks.filter((check) => !check.ok && check.severity === "warning").length;
  return {
    appVersion: APP_VERSION,
    status: failedErrors ? "not-ready" : failedWarnings ? "attention" : "ready",
    checkedAt: new Date().toISOString(),
    checks,
    latestSnapshot: latest,
    activeRound: { roundName: state.roundName, date: state.date, playerCount: state.players.length, competingPlayers, groupCount: activeGroups.length, locked: Boolean(state.settings.locked) }
  };
}

function normalizedScore(value) {
  return value === "" || value === null || value === undefined ? "" : Number(value);
}

function centralDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function fetchIndexUpdatePlan() {
  let response;
  try {
    response = await fetch(INDEX_SHEET_CSV_URL, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.5", "User-Agent": `Berry-Creek-DH-Game/${APP_VERSION}` }
    });
  } catch (error) {
    throw requestError(`The published index sheet could not be reached: ${error.message}`, 502);
  }
  if (!response.ok) throw requestError(`The published index sheet returned HTTP ${response.status}`, 502);
  const csv = await response.text();
  if (Buffer.byteLength(csv, "utf8") > INDEX_SHEET_MAX_BYTES) throw requestError("The published index sheet is too large to import", 422);
  try {
    const parsed = IndexSheet.parseIndexSheet(csv);
    return { parsed, plan: IndexSheet.buildIndexUpdatePlan(playerDatabase.list(), parsed) };
  } catch (error) {
    throw requestError(`The published index sheet could not be read: ${error.message}`, 422);
  }
}

function legacyPinMatches(candidate) {
  const supplied = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(ADMIN_PIN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function authenticateAdmin(candidate) {
  const cacheKey = crypto.createHash("sha256").update(String(candidate || "")).digest("hex");
  const cached = adminAuthCache.get(cacheKey);
  if (cached) {
    const current = adminDatabase.find(cached.id);
    if (current && current.updatedAt === cached.updatedAt) return { ...current, bootstrap: false };
    adminAuthCache.delete(cacheKey);
  }
  const registered = adminDatabase.authenticate(candidate);
  if (registered) {
    adminAuthCache.set(cacheKey, registered);
    return { ...registered, bootstrap: false };
  }
  if (adminDatabase.count() === 0 && legacyPinMatches(candidate)) return { id: "bootstrap", name: "Admin setup", bootstrap: true };
  return null;
}

function accountUsernameInUse(username, ignored = {}) {
  const admin = adminDatabase.findByUsername(username);
  if (admin && !(ignored.role === "admin" && ignored.id === admin.id)) return true;
  const player = playerDatabase.findAccountByUsername(username);
  return Boolean(player && !(ignored.role === "player" && ignored.id === player.id));
}

function sessionAccount(value, role) {
  if (!value) return null;
  if (role === "admin") return { id: value.id, username: value.username || "admin", name: value.name, role: "admin", updatedAt: value.updatedAt, bootstrap: Boolean(value.bootstrap) };
  return { id: value.id, username: value.username, name: value.name, role: "player", accountType: value.accountType, playerId: value.playerId || "", roundId: value.roundId || "", activePlayerId: value.activePlayerId || "", updatedAt: value.updatedAt };
}

function issueSession(account) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: account.id, role: account.role, ver: account.updatedAt || "bootstrap", iat: now, exp: now + SESSION_TTL_SECONDS })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(tokenValue) {
  const [payloadPart, signaturePart, extra] = String(tokenValue || "").split(".");
  if (!payloadPart || !signaturePart || extra) return null;
  const supplied = Buffer.from(signaturePart);
  const expected = Buffer.from(crypto.createHmac("sha256", AUTH_SECRET).update(payloadPart).digest("base64url"));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")); }
  catch (_) { return null; }
  if (!payload?.sub || !["admin", "player"].includes(payload.role) || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
  if (payload.role === "admin") {
    if (payload.sub === "bootstrap" && adminDatabase.count() === 0 && payload.ver === "bootstrap") return sessionAccount({ id: "bootstrap", username: "admin", name: "Admin setup", updatedAt: "bootstrap", bootstrap: true }, "admin");
    const admin = adminDatabase.find(payload.sub);
    return admin && admin.updatedAt === payload.ver ? sessionAccount(admin, "admin") : null;
  }
  const player = playerDatabase.findAccount(payload.sub);
  if (!player || player.updatedAt !== payload.ver) return null;
  if (player.accountType === "guest" && player.roundId !== state.roundId) return null;
  return sessionAccount(player, "player");
}

function requestSession(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? verifySession(header.slice(7)) : null;
}

function authenticateAdminRequest(req) {
  const session = requestSession(req);
  if (session?.role === "admin") return session;
  return authenticateAdmin(req.headers["x-admin-pin"]);
}

function activePlayerForAccount(account) {
  if (!account || account.role !== "player") return null;
  if (account.accountType === "guest") return account.roundId === state.roundId ? state.players.find((player) => player.id === account.activePlayerId) || null : null;
  return state.players.find((player) => player.directoryId && player.directoryId === account.playerId) || null;
}

function loginAttemptKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function loginBlockedUntil(req) {
  const attempt = adminLoginAttempts.get(loginAttemptKey(req));
  if (!attempt?.blockedUntil || attempt.blockedUntil <= Date.now()) return 0;
  return attempt.blockedUntil;
}

function recordFailedLogin(req) {
  const key = loginAttemptKey(req);
  const previous = adminLoginAttempts.get(key) || { failures: 0, blockedUntil: 0 };
  const failures = previous.failures + 1;
  adminLoginAttempts.set(key, { failures: failures >= 5 ? 0 : failures, blockedUntil: failures >= 5 ? Date.now() + 60_000 : 0 });
}

function recordSystemAudit(actor, type, detail) {
  const at = new Date().toISOString();
  state.auditLog.push({ id: `${at}-${state.revision + 1}`, at, actor: String(actor || "Admin").slice(0, 40), type: String(type || "ADMIN_UPDATE").slice(0, 30), detail: String(detail || "Admin update").slice(0, 180) });
  state.auditLog = state.auditLog.slice(-250);
  state.revision = Number(state.revision || 0) + 1;
  persist();
  broadcast();
}

function scoreTokenForGroup(group) {
  return crypto.createHmac("sha256", SHARE_SECRET).update(`berry-creek-score:${state.roundId}:${group}`).digest("hex");
}

function scoringTokenMatches(group, candidate) {
  if (!Round.GROUPS.includes(group)) return false;
  const supplied = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(scoreTokenForGroup(group));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function scoringGroupAllowed(action, group) {
  if (!Round.GROUPS.includes(group)) return false;
  const p = action?.payload || {};
  if (action.type === "SET_SCORE" || action.type === "SET_SANDY") {
    return state.players.some((player) => player.id === p.playerId && player.group === group);
  }
  if (action.type === "SET_KP") {
    if (p.playerId) return state.players.some((player) => player.id === p.playerId && player.group === group);
    const holderId = state.settings.kpWinners[String(p.hole)];
    return !holderId || state.players.some((player) => player.id === holderId && player.group === group);
  }
  if (action.type === "UNDO_LAST") return p.group === group;
  return true;
}

function duplicateActivePlayer(action) {
  const p = action?.payload || {};
  if (action?.type === "ADD_PLAYER") return Round.activePlayerConflict(state.players, p.player);
  if (action?.type === "UPDATE_PLAYER" && typeof p.directoryId === "string") {
    const player = state.players.find((item) => item.id === p.playerId);
    if (!player) return null;
    return Round.activePlayerConflict(state.players, { ...player, directoryId: p.directoryId }, player.id);
  }
  return null;
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".wav": "audio/wav"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, state);
  if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, { appVersion: APP_VERSION, accountLogin: true, adminSetupRequired: adminDatabase.count() === 0 });
  if (req.method === "GET" && url.pathname === "/api/public-leaderboard") {
    if (state.players.length) return sendJson(res, 200, { source: "active", state, savedAt: null });
    const latest = roundHistoryDatabase.latest();
    return latest
      ? sendJson(res, 200, { source: "saved", state: latest.state, savedAt: latest.savedAt, savedRoundId: latest.id })
      : sendJson(res, 200, { source: "empty", state, savedAt: null });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const blockedUntil = loginBlockedUntil(req);
      if (blockedUntil) return sendJson(res, 429, { ok: false, error: "Too many incorrect login attempts. Try again in one minute." }, { "Retry-After": String(Math.ceil((blockedUntil - Date.now()) / 1000)) });
      const body = await readBody(req);
      let account = sessionAccount(adminDatabase.authenticateCredentials(body.username, body.pin), "admin");
      if (!account && !String(body.username || "").trim()) account = sessionAccount(authenticateAdmin(body.pin), "admin");
      if (!account && adminDatabase.count() === 0 && ["admin", "setup"].includes(String(body.username || "").trim().toLowerCase()) && legacyPinMatches(body.pin)) {
        account = sessionAccount({ id: "bootstrap", username: "admin", name: "Admin setup", updatedAt: "bootstrap", bootstrap: true }, "admin");
      }
      if (!account) account = sessionAccount(playerDatabase.authenticate(body.username, body.pin, state.roundId), "player");
      if (!account) {
        recordFailedLogin(req);
        return sendJson(res, 401, { ok: false, error: "Incorrect username or PIN" });
      }
      adminLoginAttempts.delete(loginAttemptKey(req));
      if (account.role === "admin" && !account.bootstrap) account = sessionAccount(adminDatabase.recordLogin(account.id), "admin");
      if (account.role === "player") account = sessionAccount(playerDatabase.recordLogin(account.id), "player");
      return sendJson(res, 200, { ok: true, account, token: issueSession(account), setupRequired: Boolean(account.bootstrap) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    const account = requestSession(req);
    return account ? sendJson(res, 200, { ok: true, account }) : sendJson(res, 401, { ok: false, error: "Your sign-in has expired" });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/check") {
    try {
      const blockedUntil = loginBlockedUntil(req);
      if (blockedUntil) return sendJson(res, 429, { ok: false, error: "Too many incorrect PIN attempts. Try again in one minute." }, { "Retry-After": String(Math.ceil((blockedUntil - Date.now()) / 1000)) });
      const body = await readBody(req);
      const admin = body.username ? adminDatabase.authenticateCredentials(body.username, body.pin) : authenticateAdmin(body.pin);
      if (!admin) {
        recordFailedLogin(req);
        return sendJson(res, 401, { ok: false, error: "Incorrect admin PIN" });
      }
      adminLoginAttempts.delete(loginAttemptKey(req));
      const signedInAdmin = sessionAccount(admin.bootstrap ? admin : { ...adminDatabase.recordLogin(admin.id), bootstrap: false }, "admin");
      return sendJson(res, 200, { ok: true, admin: signedInAdmin, account: signedInAdmin, token: issueSession(signedInAdmin), setupRequired: Boolean(admin.bootstrap) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin-invitations/accept") {
    try {
      if (!requestIsSecure(req)) return sendJson(res, 400, { ok: false, error: "Open the hosted HTTPS app to create private admin access" });
      const body = await readBody(req);
      if (accountUsernameInUse(body.username)) return sendJson(res, 409, { ok: false, error: "That username is already in use" });
      const admin = adminDatabase.acceptInvitation(body.token, { name: body.name, username: body.username, pin: body.pin });
      adminAuthCache.clear();
      recordSystemAudit(admin.name, "ADMIN_ACCEPT", `${admin.name} joined as an admin through a private invitation`);
      const account = sessionAccount(admin, "admin");
      return sendJson(res, 201, { ok: true, admin, account, token: issueSession(account) });
    } catch (error) {
      const status = /expired|already been used|invalid/.test(error.message) ? 410 : /already assigned/.test(error.message) ? 409 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin-invitations") {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    if (adminIdentity.bootstrap) return sendJson(res, 400, { ok: false, error: "Create the first named admin before making invitation links" });
    if (!requestIsSecure(req)) return sendJson(res, 400, { ok: false, error: "Open the hosted HTTPS app before creating a private admin link" });
    try {
      const body = await readBody(req);
      const invitation = adminDatabase.createInvitation(adminIdentity.id, body.hours);
      recordSystemAudit(adminIdentity.name, "ADMIN_INVITE", "Created a private admin invitation link");
      return sendJson(res, 201, { ok: true, invitation });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/player-invitations/accept") {
    try {
      if (!requestIsSecure(req)) return sendJson(res, 400, { ok: false, error: "Open the hosted HTTPS app to create private player access" });
      const body = await readBody(req);
      if (adminDatabase.findByUsername(body.username)) return sendJson(res, 409, { ok: false, error: "That username is already in use" });
      const accepted = playerDatabase.acceptInvitation(body.token, { username: body.username, pin: body.pin });
      const account = sessionAccount(accepted.account, "player");
      recordSystemAudit(accepted.player.name, accepted.wasReset ? "PLAYER_ACCESS_RESET" : "PLAYER_ACCESS_SETUP", `${accepted.player.name} privately ${accepted.wasReset ? "reset" : "created"} player access`);
      return sendJson(res, 201, { ok: true, player: accepted.player, account, token: issueSession(account), wasReset: accepted.wasReset });
    } catch (error) {
      const status = /expired|already been used|invalid/.test(error.message) ? 410 : /already in use/.test(error.message) ? 409 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/player-invitations") {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    if (adminIdentity.bootstrap) return sendJson(res, 400, { ok: false, error: "Create the first named admin before making player setup links" });
    if (!requestIsSecure(req)) return sendJson(res, 400, { ok: false, error: "Open the hosted HTTPS app before creating a private player link" });
    try {
      const body = await readBody(req);
      const invitation = playerDatabase.createInvitation(body.playerId, adminIdentity.id, body.hours);
      recordSystemAudit(adminIdentity.name, "PLAYER_INVITE", `Created a private ${invitation.resetsExistingLogin ? "login reset" : "login setup"} link for ${invitation.playerName}`);
      return sendJson(res, 201, { ok: true, invitation });
    } catch (error) {
      return sendJson(res, error.message === "Saved player not found" ? 404 : 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/admins" || url.pathname.startsWith("/api/admins/")) {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    const adminRoute = url.pathname.match(/^\/api\/admins\/([^/]+)$/);
    try {
      if (req.method === "GET" && url.pathname === "/api/admins") {
        return sendJson(res, 200, { admins: adminDatabase.list(), currentAdmin: adminIdentity, setupRequired: adminIdentity.bootstrap });
      }
      if (req.method === "POST" && url.pathname === "/api/admins") {
        if (!adminIdentity.bootstrap) return sendJson(res, 403, { ok: false, error: "Use a private setup link so each new admin can choose their own PIN" });
        const body = await readBody(req);
        const candidate = body.admin || body;
        if (accountUsernameInUse(candidate.username)) return sendJson(res, 409, { ok: false, error: "That username is already in use" });
        const admin = adminDatabase.create(candidate);
        adminAuthCache.clear();
        recordSystemAudit(adminIdentity.name, "ADMIN_CREATE", `Added admin ${admin.name}`);
        const account = sessionAccount(admin, "admin");
        return sendJson(res, 201, { admin, sessionAdmin: account, token: issueSession(account), bootstrapDisabled: adminDatabase.count() === 1 });
      }
      if (req.method === "PUT" && adminRoute) {
        const body = await readBody(req);
        const targetId = decodeURIComponent(adminRoute[1]);
        const update = body.admin || body;
        if (update.pin && targetId !== adminIdentity.id) return sendJson(res, 403, { ok: false, error: "Only an admin can change their own private PIN" });
        if (update.username && accountUsernameInUse(update.username, { role: "admin", id: targetId })) return sendJson(res, 409, { ok: false, error: "That username is already in use" });
        const admin = adminDatabase.update(targetId, update);
        adminAuthCache.clear();
        recordSystemAudit(adminIdentity.name, "ADMIN_UPDATE", `Updated admin ${admin.name}`);
        const account = sessionAccount(admin, "admin");
        return sendJson(res, 200, { admin, sessionAdmin: account, ...(targetId === adminIdentity.id ? { token: issueSession(account) } : {}) });
      }
      if (req.method === "DELETE" && adminRoute) {
        const targetId = decodeURIComponent(adminRoute[1]);
        if (targetId === adminIdentity.id) return sendJson(res, 400, { ok: false, error: "Sign in as another admin before removing your own account" });
        const admin = adminDatabase.remove(targetId);
        adminAuthCache.clear();
        recordSystemAudit(adminIdentity.name, "ADMIN_REMOVE", `Removed admin ${admin.name}`);
        return sendJson(res, 200, { ok: true, admin });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      const status = /already assigned/.test(error.message) ? 409 : /not found/.test(error.message) ? 404 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/share-tokens") {
    if (!authenticateAdminRequest(req)) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    return sendJson(res, 200, { tokens: Object.fromEntries(Round.GROUPS.map((group) => [group, scoreTokenForGroup(group)])) });
  }

  if (req.method === "GET" && url.pathname === "/api/readiness") {
    if (!authenticateAdminRequest(req)) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    try { return sendJson(res, 200, readinessPayload(req)); }
    catch (error) { return sendJson(res, 500, { ok: false, error: error.message }); }
  }

  if (url.pathname === "/api/system-backup" || url.pathname === "/api/system-backup/snapshot" || url.pathname === "/api/system-backup/restore") {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    try {
      if (req.method === "GET" && url.pathname === "/api/system-backup") {
        const bundle = buildCompleteBackup("download");
        return sendJson(res, 200, bundle, { "Content-Disposition": `attachment; filename="berry-creek-complete-${state.date}.json"` });
      }
      if (req.method === "POST" && url.pathname === "/api/system-backup/snapshot") {
        const snapshot = createSnapshot("manual-readiness-snapshot");
        recordSystemAudit(adminIdentity.name, "BACKUP_SNAPSHOT", "Created a server recovery snapshot");
        return sendJson(res, 201, { ok: true, snapshot });
      }
      if (req.method === "POST" && url.pathname === "/api/system-backup/restore") {
        const body = await readBody(req, 25 * 1024 * 1024);
        const result = restoreCompleteBackup(body.backup || body);
        recordSystemAudit(adminIdentity.name, "BACKUP_RESTORE", "Restored a complete backup");
        broadcast();
        broadcastPresence();
        return sendJson(res, 200, { ok: true, ...result });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/rounds" || url.pathname.startsWith("/api/rounds/")) {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    const roundRoute = url.pathname.match(/^\/api\/rounds\/([^/]+)$/);
    try {
      if (req.method === "GET" && url.pathname === "/api/rounds") return sendJson(res, 200, { rounds: roundHistoryDatabase.list() });
      if (req.method === "POST" && url.pathname === "/api/rounds") {
        const round = roundHistoryDatabase.create(state);
        recordSystemAudit(adminIdentity.name, "ROUND_SAVE", `Saved ${round.roundName} to round history`);
        return sendJson(res, 201, { round });
      }
      if (req.method === "GET" && roundRoute) {
        const round = roundHistoryDatabase.find(decodeURIComponent(roundRoute[1]));
        return round ? sendJson(res, 200, { round }) : sendJson(res, 404, { ok: false, error: "Saved round not found" });
      }
      if (req.method === "DELETE" && roundRoute) {
        createSnapshot("before-saved-round-delete");
        const round = roundHistoryDatabase.remove(decodeURIComponent(roundRoute[1]));
        recordSystemAudit(adminIdentity.name, "ROUND_DELETE", `Deleted saved round ${round.roundName}`);
        return sendJson(res, 200, { ok: true, round });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      const status = error.message === "Saved round not found" ? 404 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/players" || url.pathname.startsWith("/api/players/")) {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    const playerRoute = url.pathname.match(/^\/api\/players\/([^/]+)$/);
    try {
      if (req.method === "GET" && url.pathname === "/api/players") {
        return sendJson(res, 200, { players: playerDatabase.list() });
      }
      if (req.method === "POST" && url.pathname === "/api/players") {
        const body = await readBody(req);
        const candidate = body.player || body;
        if (Object.hasOwn(candidate, "username") || Object.hasOwn(candidate, "pin")) return sendJson(res, 403, { ok: false, error: "Use a private player setup link so the player can choose their own username and PIN" });
        const player = playerDatabase.create(candidate);
        recordSystemAudit(adminIdentity.name, "PLAYER_SAVE", `Saved ${player.name} to the player database`);
        return sendJson(res, 201, { player });
      }
      if (req.method === "POST" && url.pathname === "/api/players/update-indexes") {
        if (state.settings.locked) return sendJson(res, 423, { ok: false, error: "Unlock the finalized round before updating indexes" });
        const body = await readBody(req);
        const { parsed, plan } = await fetchIndexUpdatePlan();
        const today = centralDate();
        const outdated = parsed.updateDate !== today;
        if (outdated && body.confirmOutdated !== true) {
          return sendJson(res, 409, {
            ok: false,
            code: "OUTDATED_INDEX_ROSTER",
            error: "Are you sure you want to update, the roster is outdated.",
            sheetDate: parsed.updateDate || null,
            currentDate: today
          });
        }
        let activePlayersUpdated = 0;
        if (plan.updates.length) {
          createSnapshot("before-index-update");
          playerDatabase.updateIndexes(plan.updates);
          const updatedIndexes = new Map(plan.updates.map((update) => [update.id, update.ghin]));
          state.players = state.players.map((player) => {
            if (!player.directoryId || !updatedIndexes.has(player.directoryId) || Number(player.ghin) === updatedIndexes.get(player.directoryId)) return player;
            activePlayersUpdated += 1;
            return { ...player, ghin: updatedIndexes.get(player.directoryId) };
          });
          const dateDescription = parsed.updateDate || "no update date";
          recordSystemAudit(adminIdentity.name, "INDEX_IMPORT", `Updated ${plan.updates.length} saved player index${plan.updates.length === 1 ? "" : "es"} from the published roster dated ${dateDescription}`);
        }
        return sendJson(res, 200, {
          ok: true,
          players: playerDatabase.list(),
          summary: {
            updated: plan.updates.length,
            unchanged: plan.unchanged.length,
            unmatched: plan.unmatched.map((player) => player.name),
            ambiguous: plan.ambiguous.map((player) => player.name),
            invalid: plan.invalid.map((player) => player.name),
            invalidSheetRows: plan.invalidSheetRows.length,
            validSheetRows: plan.validSheetRows,
            activePlayersUpdated,
            sheetDate: parsed.updateDate || null,
            currentDate: today,
            outdated
          }
        });
      }
      if (req.method === "PUT" && playerRoute) {
        const body = await readBody(req);
        const targetId = decodeURIComponent(playerRoute[1]);
        const candidate = body.player || body;
        if (Object.hasOwn(candidate, "username") || Object.hasOwn(candidate, "pin")) return sendJson(res, 403, { ok: false, error: "Use a private player reset link so the player can choose their own username and PIN" });
        const player = playerDatabase.update(targetId, candidate);
        recordSystemAudit(adminIdentity.name, "PLAYER_UPDATE", `Updated saved player ${player.name}`);
        return sendJson(res, 200, { player });
      }
      if (req.method === "DELETE" && playerRoute) {
        createSnapshot("before-saved-player-delete");
        const player = playerDatabase.remove(decodeURIComponent(playerRoute[1]));
        recordSystemAudit(adminIdentity.name, "PLAYER_DELETE", `Removed ${player.name} from the player database`);
        return sendJson(res, 200, { ok: true, player });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      const status = error.statusCode || (error.message === "Saved player not found" ? 404 : 400);
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/guest-accounts") {
    const adminIdentity = authenticateAdminRequest(req);
    if (!adminIdentity) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
    try {
      const body = await readBody(req);
      const player = state.players.find((item) => item.id === String(body.activePlayerId || "") && item.isGuest);
      if (!player) return sendJson(res, 404, { ok: false, error: "Active guest not found" });
      if (accountUsernameInUse(body.username)) return sendJson(res, 409, { ok: false, error: "That username is already in use" });
      const account = playerDatabase.createGuestAccount(state.roundId, player.id, player.name, { username: body.username, pin: body.pin });
      recordSystemAudit(adminIdentity.name, "GUEST_LOGIN", `Created temporary login for ${player.name}`);
      return sendJson(res, 201, { account });
    } catch (error) {
      return sendJson(res, /already in use/.test(error.message) ? 409 : 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const requestedGroup = String(url.searchParams.get("group") || "").toUpperCase();
    const token = String(url.searchParams.get("token") || "");
    const account = playerDatabase.findAccount(String(url.searchParams.get("account") || ""));
    const activeAccountPlayer = activePlayerForAccount(sessionAccount(account, "player"));
    const accountScorekeeper = Boolean(activeAccountPlayer && state.settings.scorekeepers[activeAccountPlayer.group] === activeAccountPlayer.id);
    const legacyScorer = url.searchParams.get("scorer") === "1" && scoringTokenMatches(requestedGroup, token);
    const scorer = accountScorekeeper || legacyScorer;
    clients.set(res, { group: accountScorekeeper ? activeAccountPlayer.group : legacyScorer ? requestedGroup : "", scorer, token, accountId: account?.id || "" });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    res.write(`event: presence\ndata: ${JSON.stringify(presencePayload())}\n\n`);
    broadcastPresence();
    req.on("close", () => {
      clients.delete(res);
      broadcastPresence();
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    try {
      const action = await readBody(req);
      const sessionIdentity = requestSession(req);
      const adminIdentity = sessionIdentity?.role === "admin" ? sessionIdentity : authenticateAdmin(req.headers["x-admin-pin"]);
      const adminAuthorized = Boolean(adminIdentity);
      const adminOverride = req.headers["x-admin-override"] === "1" && adminAuthorized;
      const scoringGroup = String(req.headers["x-scoring-group"] || "").toUpperCase();
      const actorPlayer = activePlayerForAccount(sessionIdentity);
      const assignedScorekeeper = actorPlayer && actorPlayer.group === scoringGroup && state.settings.scorekeepers[scoringGroup] === actorPlayer.id;
      const legacyScorerAuthorized = scoringTokenMatches(scoringGroup, req.headers["x-scoring-token"]);
      const scorerAuthorized = Boolean(assignedScorekeeper || legacyScorerAuthorized);

      if (Round.isAdminAction(action.type) && !adminAuthorized) return sendJson(res, 401, { ok: false, error: "Admin sign-in required" });
      if (state.settings.locked && !["SET_LOCKED", "CLEAR_ROUND", "START_FROM_SAVED"].includes(action.type)) return sendJson(res, 423, { ok: false, error: "This round is finalized and locked" });
      const duplicatePlayer = duplicateActivePlayer(action);
      if (duplicatePlayer) return sendJson(res, 409, { ok: false, error: `${duplicatePlayer.name.trim() || "That player"} is already active in Group ${duplicatePlayer.group}` });
      if (Round.isScoringAction(action.type) && !adminOverride && (!scorerAuthorized || !scoringGroupAllowed(action, scoringGroup))) {
        return sendJson(res, 403, { ok: false, error: "Sign in as this group's scorekeeper or as an admin to enter scores" });
      }
      if (Round.ACCESS_ACTIONS.has(action.type)) {
        const group = String(action.payload?.group || "").toUpperCase();
        const targetPlayerId = String(action.payload?.playerId || "");
        const currentScorekeeperId = String(state.settings.scorekeepers[group] || "");
        const targetIsInGroup = !targetPlayerId || state.players.some((player) => player.id === targetPlayerId && player.group === group);
        const groupMemberMayAssign = actorPlayer?.group === group && (!currentScorekeeperId || currentScorekeeperId === actorPlayer.id);
        if (!Round.GROUPS.includes(group) || !targetIsInGroup) return sendJson(res, 400, { ok: false, error: "Choose a player from that group" });
        if (!adminAuthorized && !groupMemberMayAssign) return sendJson(res, 403, { ok: false, error: currentScorekeeperId ? "Only the current scorekeeper or an admin can change this selection" : "Only a signed-in member of this group can choose its scorekeeper" });
      }

      if (action.type === "SET_SCORE") {
        const payload = action.payload || {};
        const player = state.players.find((item) => item.id === payload.playerId);
        const holeIndex = Number(payload.holeIndex);
        const hasExpectedScore = Object.prototype.hasOwnProperty.call(payload, "expectedScore");
        if (player && Number.isInteger(holeIndex) && holeIndex >= 0 && holeIndex < 18 && hasExpectedScore && !payload.force) {
          const currentScore = normalizedScore(player.scores[holeIndex]);
          const expectedScore = normalizedScore(payload.expectedScore);
          const attemptedScore = normalizedScore(payload.score);
          if (currentScore !== expectedScore && currentScore !== attemptedScore) {
            return sendJson(res, 409, {
              ok: false,
              code: "SCORE_CONFLICT",
              error: `${player.name.trim() || "This player"}'s Hole ${holeIndex + 1} score changed on another device`,
              conflict: { playerId: player.id, playerName: player.name, holeIndex, currentScore, attemptedScore }
            });
          }
        }
      }

      const serverAction = {
        type: action.type,
        payload: action.payload || {},
        meta: {
          at: new Date().toISOString(),
          actor: Round.isAdminAction(action.type) || adminOverride || (Round.ACCESS_ACTIONS.has(action.type) && adminIdentity) ? adminIdentity.name : sessionIdentity?.name || `Group ${scoringGroup} scorer`,
          group: scoringGroup
        }
      };
      const removedGuest = action.type === "REMOVE_PLAYER" ? state.players.find((player) => player.id === action.payload?.playerId && player.isGuest) : null;
      const previousRoundId = state.roundId;
      if (DESTRUCTIVE_ACTIONS.has(action.type)) createSnapshot(`before-${action.type.toLowerCase().replaceAll("_", "-")}`);
      state = Round.applyAction(state, serverAction);
      if (removedGuest) playerDatabase.removeGuestAccount(state.roundId, removedGuest.id);
      if (["CLEAR_ROUND", "START_FROM_SAVED"].includes(action.type) && state.roundId !== previousRoundId) playerDatabase.removeGuestAccountsForRound(previousRoundId);
      persist();
      broadcast();
      broadcastPresence();
      return sendJson(res, 200, { ok: true, revision: state.revision });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: "Forbidden" });
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) return sendJson(res, 404, { error: "Not found" });
    const isEntry = filePath.endsWith("index.html") || filePath.endsWith("version.json") || filePath.endsWith("service-worker.js");
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream", "Cache-Control": isEntry ? "no-cache, no-store, must-revalidate" : "public, max-age=300" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Berry Creek DH Game v${APP_VERSION} running at http://localhost:${PORT}`);
  if (adminDatabase.count() === 0) console.log("No named admins exist yet. Use the ADMIN_PIN setup PIN to create the first named admin.");
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  adminDatabase.close();
  playerDatabase.close();
  roundHistoryDatabase.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
