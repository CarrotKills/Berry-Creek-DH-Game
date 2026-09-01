const assert = require("node:assert/strict");

const base = "http://127.0.0.1:8080";
async function action(type, payload = {}) {
  const response = await fetch(`${base}/api/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, payload }) });
  assert.equal(response.status, 200);
}

(async () => {
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
    action("SET_SCORE", { playerId: "live-a", holeIndex: 0, score: 4 }),
    action("SET_SCORE", { playerId: "live-b", holeIndex: 0, score: 5 })
  ]);
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /event: state/);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.players.length, 2);
  assert.equal(state.players.find((p) => p.id === "live-a").scores[0], 4);
  assert.equal(state.players.find((p) => p.id === "live-b").scores[0], 5);
  await reader.cancel();
  await action("CLEAR_ROUND");
  console.log("Concurrent API and live-update tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
