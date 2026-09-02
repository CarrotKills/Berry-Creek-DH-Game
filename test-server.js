const assert = require("node:assert/strict");
const R = require("./round-state.js");

const base = "http://127.0.0.1:8080";
let scoreTokens = {};
async function action(type, payload = {}, options = {}) {
  const headers = { "Content-Type": "application/json", "X-Scoring-Group": options.group || "A" };
  if (R.isAdminAction(type) || options.admin) {
    headers["X-Admin-Pin"] = options.pin || "2468";
    headers["X-Admin-Override"] = "1";
  } else if (R.isScoringAction(type) && !options.noToken) {
    headers["X-Scoring-Token"] = scoreTokens[options.group || "A"] || "";
  }
  const response = await fetch(`${base}/api/action`, { method: "POST", headers, body: JSON.stringify({ type, payload }) });
  assert.equal(response.status, options.status || 200);
  return response;
}

async function playerRequest(path = "", options = {}) {
  const headers = { ...(options.headers || {}), "X-Admin-Pin": options.pin || "2468" };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api/players${path}`, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  assert.equal(response.status, options.status || 200);
  return response.json();
}

(async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.appVersion, "9.5.2");
  const sortingAsset = await fetch(`${base}/leaderboard-sort.js`);
  assert.equal(sortingAsset.status, 200);
  const wrongPin = await fetch(`${base}/api/admin/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "wrong" }) });
  assert.equal(wrongPin.status, 401);
  const rightPin = await fetch(`${base}/api/admin/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) });
  assert.equal(rightPin.status, 200);
  const unauthorizedTokens = await fetch(`${base}/api/share-tokens`);
  assert.equal(unauthorizedTokens.status, 401);
  const tokenResponse = await fetch(`${base}/api/share-tokens`, { headers: { "X-Admin-Pin": "2468" } });
  assert.equal(tokenResponse.status, 200);
  scoreTokens = (await tokenResponse.json()).tokens;
  assert.equal(Object.keys(scoreTokens).length, 6);
  const unauthorizedRounds = await fetch(`${base}/api/rounds`);
  assert.equal(unauthorizedRounds.status, 401);
  const unauthorizedPlayers = await fetch(`${base}/api/players`);
  assert.equal(unauthorizedPlayers.status, 401);
  const createdSaved = await playerRequest("", { method: "POST", status: 201, body: { name: "Saved Golfer", ghin: 15.2, teeKey: "championship" } });
  const listedSaved = await playerRequest();
  assert.equal(listedSaved.players.some((player) => player.id === createdSaved.player.id), true);
  const updatedSaved = await playerRequest(`/${createdSaved.player.id}`, { method: "PUT", body: { ghin: 13.7 } });
  assert.equal(updatedSaved.player.ghin, 13.7);
  await playerRequest(`/${createdSaved.player.id}`, { method: "DELETE" });
  const emptySaved = await playerRequest();
  assert.equal(emptySaved.players.some((player) => player.id === createdSaved.player.id), false);
  await action("CLEAR_ROUND");
  const streamResponse = await fetch(`${base}/api/events`);
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body.getReader();
  await reader.read();

  await Promise.all([
    action("ADD_PLAYER", { player: { id: "live-a", name: "Live A", group: "A", teeKey: "championship", ghin: 10 } }),
    action("ADD_PLAYER", { player: { id: "live-b", name: "Live B", group: "B", teeKey: "member", ghin: 18 } })
  ]);
  await Promise.all([
    action("SET_SCORE", { playerId: "live-a", holeIndex: 0, score: 4 }, { group: "A" }),
    action("SET_SCORE", { playerId: "live-b", holeIndex: 0, score: 5 }, { group: "B" })
  ]);
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /event: state/);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.players.length, 2);
  assert.equal(state.players.find((p) => p.id === "live-a").scores[0], 4);
  assert.equal(state.players.find((p) => p.id === "live-b").scores[0], 5);
  await action("SET_SCORE", { playerId: "live-a", holeIndex: 1, score: 3 }, { group: "A", noToken: true, status: 403 });
  await action("SET_SCORE", { playerId: "live-b", holeIndex: 1, score: 3 }, { group: "A", status: 403 });
  const savedRoundResponse = await fetch(`${base}/api/rounds`, { method: "POST", headers: { "X-Admin-Pin": "2468", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(savedRoundResponse.status, 201);
  const savedRound = (await savedRoundResponse.json()).round;
  const savedRounds = await (await fetch(`${base}/api/rounds`, { headers: { "X-Admin-Pin": "2468" } })).json();
  assert.equal(savedRounds.rounds.some((round) => round.id === savedRound.id), true);
  const savedRoundDetail = await (await fetch(`${base}/api/rounds/${savedRound.id}`, { headers: { "X-Admin-Pin": "2468" } })).json();
  assert.equal(savedRoundDetail.round.state.players.length, 2);
  const deletedRound = await fetch(`${base}/api/rounds/${savedRound.id}`, { method: "DELETE", headers: { "X-Admin-Pin": "2468" } });
  assert.equal(deletedRound.status, 200);
  await action("SET_LOCKED", { locked: true });
  await action("SET_SCORE", { playerId: "live-a", holeIndex: 1, score: 3 }, { group: "A", status: 423 });
  await action("SET_LOCKED", { locked: false });
  await action("RESET_SCORES");
  const resetState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(resetState.players.length, 2);
  assert.equal(resetState.players.every((player) => player.scores.every((score) => score === "")), true);
  assert.equal(resetState.auditLog.length > 0, true);
  await reader.cancel();
  await action("CLEAR_ROUND");
  console.log("Concurrent API and live-update tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
