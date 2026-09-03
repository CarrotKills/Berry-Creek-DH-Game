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
const APP_VERSION = "9.7.0";
const ROOT = __dirname;
const DEFAULT_DATA_DIR = process.env.PLAYERS_DB_FILE ? path.dirname(path.resolve(process.env.PLAYERS_DB_FILE)) : path.join(ROOT, "data");
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const DATA_FILE = path.resolve(process.env.ROUND_FILE || path.join(DATA_DIR, "round.json"));
const PLAYERS_DB_FILE = path.resolve(process.env.PLAYERS_DB_FILE || path.join(DATA_DIR, "players.sqlite"));
const ROUND_HISTORY_DB_FILE = path.resolve(process.env.ROUND_HISTORY_DB_FILE || path.join(DATA_DIR, "rounds.sqlite"));
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

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
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
      if (req.method === "DELETE" && roundRoute) return sendJson(res, 200, { ok: true, round: roundHistoryDatabase.remove(decodeURIComponent(roundRoute[1])) });
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
      if (Round.isScoringAction(action.type) && !adminOverride && (!scorerAuthorized || !scoringGroupAllowed(action, scoringGroup))) {
        return sendJson(res, 403, { ok: false, error: "A current group scorekeeper link or admin access is required" });
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
