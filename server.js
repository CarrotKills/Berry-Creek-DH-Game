"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const Round = require("./round-state.js");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PIN = String(process.env.ADMIN_PIN || "2468");
const APP_VERSION = "9.1.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "round.json");
const clients = new Set();

function readState() {
  try { return Round.normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); }
  catch (_) { return Round.defaultState(); }
}

let state = readState();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function broadcast() {
  const data = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  clients.forEach((res) => res.write(data));
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
      return pinMatches(body.pin) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { ok: false, error: "Incorrect organizer PIN" });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    try {
      const action = await readBody(req);
      const adminAuthorized = pinMatches(req.headers["x-admin-pin"]);
      const adminOverride = req.headers["x-admin-override"] === "1" && adminAuthorized;
      const scoringGroup = String(req.headers["x-scoring-group"] || "").toUpperCase();

      if (Round.isAdminAction(action.type) && !adminAuthorized) return sendJson(res, 401, { ok: false, error: "Organizer PIN required" });
      if (state.settings.locked && action.type !== "SET_LOCKED") return sendJson(res, 423, { ok: false, error: "This round is finalized and locked" });
      if (Round.isScoringAction(action.type) && !adminOverride && !scoringGroupAllowed(action, scoringGroup)) {
        return sendJson(res, 403, { ok: false, error: `This link can only score Group ${scoringGroup || "?"}` });
      }

      const serverAction = {
        type: action.type,
        payload: action.payload || {},
        meta: {
          at: new Date().toISOString(),
          actor: Round.isAdminAction(action.type) || adminOverride ? "Organizer" : `Group ${scoringGroup} scorer`
        }
      };
      state = Round.applyAction(state, serverAction);
      persist();
      broadcast();
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
  if (!process.env.ADMIN_PIN) console.log("Organizer PIN is using the default 2468. Set ADMIN_PIN in your host before the event.");
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
