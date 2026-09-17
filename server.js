"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const Round = require("./round-state.js");
const PlayerDatabase = require("./player-database.js");
const RoundHistoryDatabase = require("./round-history-database.js");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PIN = String(process.env.ADMIN_PIN || "2468");
const APP_VERSION = "9.9.0";
const ROOT = __dirname;
const DEFAULT_DATA_DIR = process.env.PLAYERS_DB_FILE ? path.dirname(path.resolve(process.env.PLAYERS_DB_FILE)) : path.join(ROOT, "data");
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const DATA_FILE = path.resolve(process.env.ROUND_FILE || path.join(DATA_DIR, "round.json"));
const PLAYERS_DB_FILE = path.resolve(process.env.PLAYERS_DB_FILE || path.join(DATA_DIR, "players.sqlite"));
const ROUND_HISTORY_DB_FILE = path.resolve(process.env.ROUND_HISTORY_DB_FILE || path.join(DATA_DIR, "rounds.sqlite"));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, "backups"));
const BACKUP_FORMAT = "berry-creek-complete-backup";
const BACKUP_FORMAT_VERSION = 1;
const SNAPSHOT_LIMIT = 25;
const DESTRUCTIVE_ACTIONS = new Set(["CLEAR_ROUND", "REPLACE_ROUND", "START_FROM_SAVED", "RESET_SCORES"]);
const SHARE_SECRET = String(process.env.SHARE_SECRET || ADMIN_PIN);
const clients = new Map();
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
  return Object.fromEntries(Round.GROUPS.map((group) => [group, [...clients.values()].filter((client) => client.group === group && client.scorer && scoringTokenMatches(group, client.token)).length]));
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
    savedRounds: roundHistoryDatabase.exportAll()
  };
}

function normalizeCompleteBackup(value) {
  if (value?.format !== BACKUP_FORMAT || Number(value?.formatVersion) !== BACKUP_FORMAT_VERSION) throw new Error("That file is not a Berry Creek complete backup");
  if (!value.activeRound || !Array.isArray(value.activeRound.players)) throw new Error("The active round in the backup is invalid");
  if (!Array.isArray(value.savedPlayers) || value.savedPlayers.length > 5000) throw new Error("The saved-player data in the backup is invalid");
  if (!Array.isArray(value.savedRounds) || value.savedRounds.length > 1000) throw new Error("The saved-round data in the backup is invalid");
  const savedRounds = value.savedRounds.map((round) => {
    if (!round?.state || !Array.isArray(round.state.players)) throw new Error("A saved round in the backup is invalid");
    return { ...round, state: Round.normalizeState(round.state) };
  });
  return {
    ...value,
    activeRound: Round.normalizeState(value.activeRound),
    savedPlayers: value.savedPlayers,
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
  const previous = buildCompleteBackup("before-complete-restore");
  const snapshot = createSnapshot("before-complete-restore", previous);
  try {
    playerDatabase.replaceAll(incoming.savedPlayers);
    roundHistoryDatabase.replaceAll(incoming.savedRounds);
    state = incoming.activeRound;
    persist();
  } catch (error) {
    playerDatabase.replaceAll(previous.savedPlayers);
    roundHistoryDatabase.replaceAll(previous.savedRounds);
    state = Round.normalizeState(previous.activeRound);
    persist();
    throw error;
  }
  return { snapshot, activeRound: state, savedPlayerCount: incoming.savedPlayers.length, savedRoundCount: incoming.savedRounds.length };
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
  const persistentStorageConfigured = Boolean(process.env.DATA_DIR || process.env.PLAYERS_DB_FILE || process.env.ROUND_FILE || process.env.ROUND_HISTORY_DB_FILE || DATA_DIR.startsWith("/var/data"));
  const customAdminPin = Boolean(process.env.ADMIN_PIN && ADMIN_PIN !== "2468");
  const latest = latestSnapshot();
  const backupFresh = Boolean(latest && Date.now() - Date.parse(latest.createdAt) < 24 * 60 * 60 * 1000);
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = String(req.headers.host || "");
  const secureConnection = forwardedProtocol === "https" || Boolean(req.socket.encrypted) || /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const activeGroups = Round.GROUPS.filter((group) => state.players.some((player) => player.group === group));
  const competingPlayers = state.players.filter((player) => player.inGame).length;
  const savedPlayerCount = playerDatabase.list().length;
  const savedRoundCount = roundHistoryDatabase.list().length;
  const checks = [
    { key: "storage", label: "Server storage is writable", ok: storageWritable, severity: "error", detail: storageWritable ? "Round and database files can be updated." : "The server cannot write to its data folder." },
    { key: "persistent", label: "Persistent storage is configured", ok: persistentStorageConfigured, severity: "error", detail: persistentStorageConfigured ? "A persistent data location is configured." : "Set DATA_DIR or PLAYERS_DB_FILE to a persistent disk before a live event." },
    { key: "pin", label: "Admin PIN is customized", ok: customAdminPin, severity: "warning", detail: customAdminPin ? "The default PIN is not in use." : "Set ADMIN_PIN to something other than 2468." },
    { key: "backup", label: "A server snapshot is less than 24 hours old", ok: backupFresh, severity: "warning", detail: latest ? `Latest snapshot: ${latest.createdAt}.` : "Create a snapshot before the event begins." },
    { key: "roster", label: "The active round has competing players", ok: competingPlayers > 0, severity: "warning", detail: `${state.players.length} assigned; ${competingPlayers} in the game across ${activeGroups.length} group${activeGroups.length === 1 ? "" : "s"}.` },
    { key: "database", label: "Player and round databases are available", ok: true, severity: "error", detail: `${savedPlayerCount} saved player${savedPlayerCount === 1 ? "" : "s"}; ${savedRoundCount} saved round${savedRoundCount === 1 ? "" : "s"}.` },
    { key: "https", label: "The app is using a secure connection", ok: secureConnection, severity: "warning", detail: secureConnection ? "Scorekeeper and spectator links are protected in transit." : "Use HTTPS for links shared outside this device." }
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

function pinMatches(candidate) {
  const supplied = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(ADMIN_PIN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
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
  ".png": "image/png"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, state);
  if (req.method === "GET" && url.pathname === "/api/config") return sendJson(res, 200, { appVersion: APP_VERSION, adminPinRequired: true });

  if (req.method === "POST" && url.pathname === "/api/admin/check") {
    try {
      const body = await readBody(req);
      return pinMatches(body.pin) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { ok: false, error: "Incorrect admin PIN" });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/share-tokens") {
    if (!pinMatches(req.headers["x-admin-pin"])) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
    return sendJson(res, 200, { tokens: Object.fromEntries(Round.GROUPS.map((group) => [group, scoreTokenForGroup(group)])) });
  }

  if (req.method === "GET" && url.pathname === "/api/readiness") {
    if (!pinMatches(req.headers["x-admin-pin"])) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
    try { return sendJson(res, 200, readinessPayload(req)); }
    catch (error) { return sendJson(res, 500, { ok: false, error: error.message }); }
  }

  if (url.pathname === "/api/system-backup" || url.pathname === "/api/system-backup/snapshot" || url.pathname === "/api/system-backup/restore") {
    if (!pinMatches(req.headers["x-admin-pin"])) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
    try {
      if (req.method === "GET" && url.pathname === "/api/system-backup") {
        const bundle = buildCompleteBackup("download");
        return sendJson(res, 200, bundle, { "Content-Disposition": `attachment; filename="berry-creek-complete-${state.date}.json"` });
      }
      if (req.method === "POST" && url.pathname === "/api/system-backup/snapshot") {
        return sendJson(res, 201, { ok: true, snapshot: createSnapshot("manual-readiness-snapshot") });
      }
      if (req.method === "POST" && url.pathname === "/api/system-backup/restore") {
        const body = await readBody(req, 25 * 1024 * 1024);
        const result = restoreCompleteBackup(body.backup || body);
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
    if (!pinMatches(req.headers["x-admin-pin"])) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
    const roundRoute = url.pathname.match(/^\/api\/rounds\/([^/]+)$/);
    try {
      if (req.method === "GET" && url.pathname === "/api/rounds") return sendJson(res, 200, { rounds: roundHistoryDatabase.list() });
      if (req.method === "POST" && url.pathname === "/api/rounds") return sendJson(res, 201, { round: roundHistoryDatabase.create(state) });
      if (req.method === "GET" && roundRoute) {
        const round = roundHistoryDatabase.find(decodeURIComponent(roundRoute[1]));
        return round ? sendJson(res, 200, { round }) : sendJson(res, 404, { ok: false, error: "Saved round not found" });
      }
      if (req.method === "DELETE" && roundRoute) {
        createSnapshot("before-saved-round-delete");
        return sendJson(res, 200, { ok: true, round: roundHistoryDatabase.remove(decodeURIComponent(roundRoute[1])) });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      const status = error.message === "Saved round not found" ? 404 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
    }
  }

  if (url.pathname === "/api/players" || url.pathname.startsWith("/api/players/")) {
    if (!pinMatches(req.headers["x-admin-pin"])) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
    const playerRoute = url.pathname.match(/^\/api\/players\/([^/]+)$/);
    try {
      if (req.method === "GET" && url.pathname === "/api/players") {
        return sendJson(res, 200, { players: playerDatabase.list() });
      }
      if (req.method === "POST" && url.pathname === "/api/players") {
        const body = await readBody(req);
        return sendJson(res, 201, { player: playerDatabase.create(body.player || body) });
      }
      if (req.method === "PUT" && playerRoute) {
        const body = await readBody(req);
        return sendJson(res, 200, { player: playerDatabase.update(decodeURIComponent(playerRoute[1]), body.player || body) });
      }
      if (req.method === "DELETE" && playerRoute) {
        createSnapshot("before-saved-player-delete");
        const player = playerDatabase.remove(decodeURIComponent(playerRoute[1]));
        return sendJson(res, 200, { ok: true, player });
      }
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    } catch (error) {
      const status = error.message === "Saved player not found" ? 404 : 400;
      return sendJson(res, status, { ok: false, error: error.message });
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
    const scorer = url.searchParams.get("scorer") === "1" && scoringTokenMatches(requestedGroup, token);
    clients.set(res, { group: scorer ? requestedGroup : "", scorer, token });
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
      const adminAuthorized = pinMatches(req.headers["x-admin-pin"]);
      const adminOverride = req.headers["x-admin-override"] === "1" && adminAuthorized;
      const scoringGroup = String(req.headers["x-scoring-group"] || "").toUpperCase();
      const scorerAuthorized = scoringTokenMatches(scoringGroup, req.headers["x-scoring-token"]);

      if (Round.isAdminAction(action.type) && !adminAuthorized) return sendJson(res, 401, { ok: false, error: "Admin PIN required" });
      if (state.settings.locked && !["SET_LOCKED", "CLEAR_ROUND", "START_FROM_SAVED"].includes(action.type)) return sendJson(res, 423, { ok: false, error: "This round is finalized and locked" });
      const duplicatePlayer = duplicateActivePlayer(action);
      if (duplicatePlayer) return sendJson(res, 409, { ok: false, error: `${duplicatePlayer.name.trim() || "That player"} is already active in Group ${duplicatePlayer.group}` });
      if (Round.isScoringAction(action.type) && !adminOverride && (!scorerAuthorized || !scoringGroupAllowed(action, scoringGroup))) {
        return sendJson(res, 403, { ok: false, error: "A current group scorekeeper link or admin access is required" });
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
          actor: Round.isAdminAction(action.type) || adminOverride ? "Admin" : `Group ${scoringGroup} scorer`,
          group: scoringGroup
        }
      };
      if (DESTRUCTIVE_ACTIONS.has(action.type)) createSnapshot(`before-${action.type.toLowerCase().replaceAll("_", "-")}`);
      state = Round.applyAction(state, serverAction);
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
  if (!process.env.ADMIN_PIN) console.log("Admin PIN is using the default 2468. Set ADMIN_PIN in your host before the event.");
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  playerDatabase.close();
  roundHistoryDatabase.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
