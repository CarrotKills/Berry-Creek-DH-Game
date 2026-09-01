(function () {
  "use strict";
  const E = window.BerryCreekScoring;
  const R = window.BerryCreekRoundState;
  const STORAGE_KEY = "berry-creek-tics-v2";
  const KP_HOLES = [2, 8, 12, 17];
  const $ = (selector) => document.querySelector(selector);
  const teeEntries = Object.entries(E.COURSE.tees);
  let state = loadLocal();
  let online = false;
  let selectedGroup = new URLSearchParams(location.search).get("group") || "A";
  let selectedHole = 1;
  let scorecardOpen = false;
  let celebrationAudioContext;

  function loadLocal() {
    try { return R.normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return R.defaultState(); }
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function esc(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
  function nameOf(player, index) { return player.name.trim() || `Player ${index + 1}`; }
  function teeOf(player) { return E.teeForPlayer(E.COURSE, player); }
  function hcp(player) { return E.playingHandicap(player.ghin, state.settings, teeOf(player)); }
  function complete(value, done) { return done ? String(value) : "—"; }
  function groupPlayers(group = selectedGroup) { return state.players.filter((player) => player.group === group); }
  function setConnection(isOnline) {
    online = isOnline;
    $("#syncStatus").textContent = online ? "Live · synced" : "Local mode";
    $("#connectionFoot").textContent = online ? "All connected scorekeepers update this leaderboard live." : "Start server.js for shared live scoring.";
  }

  async function dispatch(action) {
    state = R.applyAction(state, action);
    saveLocal();
    render();
    if (!online) return;
    try {
      const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      if (!response.ok) throw new Error("Sync failed");
    } catch (_) { setConnection(false); }
  }

  async function connect() {
    if (!location.protocol.startsWith("http")) { setConnection(false); return; }
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("No server");
      state = R.normalizeState(await response.json());
      saveLocal();
      setConnection(true);
      render();
      const events = new EventSource("/api/events");
      events.addEventListener("state", (event) => { state = R.normalizeState(JSON.parse(event.data)); saveLocal(); setConnection(true); render(); });
      events.onerror = () => setConnection(false);
    } catch (_) { setConnection(false); render(); }
  }

  function nextAvailableGroup() { return R.GROUPS.find((g) => groupPlayers(g).length < R.MAX_GROUP_SIZE) || "A"; }
  function addPlayer() {
    if (state.players.length >= R.MAX_PLAYERS) return showValidation("Maximum of 30 players reached.");
    const group = nextAvailableGroup();
    if (groupPlayers(group).length >= R.MAX_GROUP_SIZE) return showValidation("All six groups already have five players.");
    const player = R.normalizePlayer({ id: makeId(), name: "", ghin: 0, teeKey: E.COURSE.defaultTee, group });
    dispatch({ type: "ADD_PLAYER", payload: { player } });
    requestAnimationFrame(() => $("#playerList").lastElementChild?.querySelector(".player-name")?.focus());
  }
  function showValidation(message) { const el = $("#playerLimit"); el.textContent = message; el.hidden = false; }

  function teeOptions(selected) {
    return teeEntries.map(([key, tee]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${esc(tee.name)} · ${tee.rating}/${tee.slope}</option>`).join("");
  }
  function groupOptions(selected, currentPlayerId) {
    return R.GROUPS.map((group) => {
      const count = state.players.filter((p) => p.group === group && p.id !== currentPlayerId).length;
      return `<option value="${group}" ${group === selected ? "selected" : ""} ${count >= R.MAX_GROUP_SIZE && group !== selected ? "disabled" : ""}>Group ${group} (${count + (group === selected ? 1 : 0)}/5)</option>`;
    }).join("");
  }

  function renderPlayers() {
    const list = $("#playerList");
    list.replaceChildren();
    state.players.forEach((player, index) => {
      const row = $("#playerRowTemplate").content.firstElementChild.cloneNode(true);
      row.querySelector(".player-number").textContent = index + 1;
      const name = row.querySelector(".player-name"); name.value = player.name;
      const ghin = row.querySelector(".player-ghin"); ghin.value = player.ghin;
      const tee = row.querySelector(".player-tee"); tee.innerHTML = teeOptions(player.teeKey);
      const group = row.querySelector(".player-group"); group.innerHTML = groupOptions(player.group, player.id);
      row.querySelector(".playing-hcp strong").textContent = hcp(player);
      name.addEventListener("change", (e) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, name: e.target.value } }));
      ghin.addEventListener("change", (e) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, ghin: Number(e.target.value) || 0 } }));
      tee.addEventListener("change", (e) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, teeKey: e.target.value } }));
      group.addEventListener("change", (e) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, group: e.target.value } }));
      row.querySelector(".remove-player").addEventListener("click", () => dispatch({ type: "REMOVE_PLAYER", payload: { playerId: player.id } }));
      list.append(row);
    });
    if (!state.players.length) list.innerHTML = '<div class="empty-state">No players yet. Add up to 30 golfers.</div>';
    $("#playerLimit").hidden = true;
    $("#addPlayerBtn").disabled = state.players.length >= R.MAX_PLAYERS;
    $("#groupCounts").innerHTML = R.GROUPS.map((g) => `<span>Group ${g}: <strong>${groupPlayers(g).length}/5</strong></span>`).join("");
  }

  function renderGroupSelectors() {
    const select = $("#activeGroupSelect");
    select.innerHTML = R.GROUPS.map((g) => `<option value="${g}" ${g === selectedGroup ? "selected" : ""}>Group ${g} · ${groupPlayers(g).length} player${groupPlayers(g).length === 1 ? "" : "s"}</option>`).join("");
    const holes = $("#holeSelect");
    if (!holes.options.length) holes.innerHTML = E.COURSE.holes.map((h) => `<option value="${h.number}">Hole ${h.number}</option>`).join("");
    holes.value = selectedHole;
  }

  function renderHoleBanner(players) {
    const base = E.COURSE.holes[selectedHole - 1];
    const details = [...new Set(players.map((player) => { const h = E.holesForPlayer(E.COURSE, player)[selectedHole - 1]; return `${teeOf(player).name}: ${h.yards} yds · SI ${h.strokeIndex}`; }))];
    const kpWinnerId = state.settings.kpWinners[String(selectedHole)];
    const kpWinner = state.players.find((player) => player.id === kpWinnerId);
    const kpStatus = KP_HOLES.includes(selectedHole) ? `<span class="kp-status">KP: ${kpWinner ? esc(nameOf(kpWinner, state.players.indexOf(kpWinner))) : "Open"}</span>` : "";
    const skin = E.skinResult(state.players, E.COURSE, state.settings, selectedHole - 1);
    const skinWinner = state.players.find((player) => player.id === skin.winnerId);
    const skinText = skin.status === "awarded" ? `Skin: ${esc(nameOf(skinWinner, state.players.indexOf(skinWinner)))}` : skin.status === "tie" ? "Skin: No skin (tie)" : "Skin: Pending";
    $("#holeBanner").innerHTML = `<strong>Hole ${selectedHole} · Par ${base.par}</strong><span>${details.length ? details.join("  |  ") : "Add players to see tee details."}</span><span class="skin-status">${skinText}</span>${kpStatus}`;
  }

  function playEagleCelebration() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    celebrationAudioContext ||= new AudioContextClass();
    const ctx = celebrationAudioContext;
    ctx.resume().catch(() => {});
    const start = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.22, start + 0.04);
    master.gain.setValueAtTime(0.22, start + 2.45);
    master.gain.exponentialRampToValueAtTime(0.0001, start + 2.95);
    master.connect(ctx.destination);
    [
      { frequency: 392, delay: 0, duration: 0.42 },
      { frequency: 523.25, delay: 0.34, duration: 0.46 },
      { frequency: 659.25, delay: 0.7, duration: 0.5 },
      { frequency: 783.99, delay: 1.08, duration: 0.72 },
      { frequency: 1046.5, delay: 1.55, duration: 1.35 }
    ].forEach((note, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === 4 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(note.frequency, start + note.delay);
      if (index === 4) oscillator.frequency.exponentialRampToValueAtTime(1318.5, start + 2.15);
      gain.gain.setValueAtTime(0.0001, start + note.delay);
      gain.gain.exponentialRampToValueAtTime(index === 4 ? 0.65 : 0.45, start + note.delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.delay + note.duration);
      oscillator.connect(gain).connect(master);
      oscillator.start(start + note.delay);
      oscillator.stop(start + note.delay + note.duration + 0.05);
    });
  }

  function playBirdieTweets() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    celebrationAudioContext ||= new AudioContextClass();
    const ctx = celebrationAudioContext;
    ctx.resume().catch(() => {});
    const start = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, start);
    master.connect(ctx.destination);
    [0, 0.29].forEach((delay, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteStart = start + delay;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(index ? 1850 : 1700, noteStart);
      oscillator.frequency.exponentialRampToValueAtTime(index ? 2550 : 2350, noteStart + 0.09);
      oscillator.frequency.exponentialRampToValueAtTime(index ? 2100 : 1950, noteStart + 0.2);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.5, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.22);
      oscillator.connect(gain).connect(master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.23);
    });
  }

  function setScore(playerId, score) {
    const player = state.players.find((item) => item.id === playerId);
    const holeIndex = selectedHole - 1;
    const par = E.COURSE.holes[holeIndex].par;
    const wasEagle = E.isEagle(player?.scores[holeIndex], par);
    const isNewEagle = E.isEagle(score, par) && !wasEagle;
    const wasBirdie = E.isBirdie(player?.scores[holeIndex], par);
    const isNewBirdie = E.isBirdie(score, par) && !wasBirdie;
    if (isNewEagle) playEagleCelebration();
    else if (isNewBirdie) playBirdieTweets();
    dispatch({ type: "SET_SCORE", payload: { playerId, holeIndex, score } });
  }

  function renderGroupScoring() {
    renderGroupSelectors();
    const players = groupPlayers();
    renderHoleBanner(players);
    const list = $("#groupScoreList");
    list.innerHTML = players.map((player) => {
      const i = selectedHole - 1;
      const hole = E.holesForPlayer(E.COURSE, player)[i];
      const gross = player.scores[i];
      const strokes = E.strokesForHole(hcp(player), hole.strokeIndex);
      const net = E.netScore(gross, strokes);
      const birdie = Number(gross) > 0 && Number(gross) <= hole.par - 1;
      const achievement = E.isEagle(gross, hole.par) ? "Eagle" : E.isBirdie(gross, hole.par) ? "Birdie" : Number(gross) > 0 && Number(gross) <= hole.par - 3 ? "Albatross" : "";
      const sandyPar = player.sandies[i] && Number(gross) === hole.par;
      const sandyBirdie = player.sandies[i] && birdie;
      const canMarkSandy = Number(gross) >= 1 && Number(gross) <= hole.par;
      const isKpHole = KP_HOLES.includes(selectedHole);
      const hasKp = state.settings.kpWinners[String(selectedHole)] === player.id;
      const hasSkin = E.skinResult(state.players, E.COURSE, state.settings, i).winnerId === player.id;
      return `<article class="group-score-card" data-player-id="${player.id}">
        <div class="score-player"><strong>${esc(nameOf(player, state.players.indexOf(player)))}</strong><span>${esc(teeOf(player).name)} · Hcp ${hcp(player)} · ${strokes > 0 ? `gets ${strokes}` : strokes < 0 ? `gives ${Math.abs(strokes)}` : "no stroke"}</span></div>
        <div class="score-stepper"><button type="button" data-delta="-1" aria-label="Decrease ${esc(nameOf(player, 0))}'s score">−</button><input type="number" min="1" max="20" inputmode="numeric" value="${gross}" aria-label="${esc(nameOf(player, 0))}'s gross score"><button type="button" data-delta="1" aria-label="Increase ${esc(nameOf(player, 0))}'s score">+</button></div>
        <div class="net-box"><span>Net</span><strong>${net ?? "—"}</strong></div>
        <div class="card-tics">${achievement ? `<span class="auto-tic">${achievement} ✓</span>` : ""}${hasSkin ? '<span class="auto-tic">Net skin ✓</span>' : ""}${canMarkSandy ? `<label class="tic-toggle"><input data-kind="sandy" type="checkbox" ${player.sandies[i] ? "checked" : ""}>Sand save</label>` : ""}${isKpHole ? `<label class="tic-toggle kp-toggle"><input data-kind="kp" type="checkbox" ${hasKp ? "checked" : ""}>KP</label>` : ""}${sandyPar ? '<span class="auto-tic">Sandy par ✓</span>' : ""}${sandyBirdie ? '<span class="auto-tic">Sandy birdie ✓</span>' : ""}</div>
      </article>`;
    }).join("");
    list.querySelectorAll(".group-score-card").forEach((card) => {
      const player = state.players.find((p) => p.id === card.dataset.playerId);
      const input = card.querySelector('input[type="number"]');
      input.addEventListener("change", (e) => setScore(player.id, e.target.value));
      card.querySelectorAll("[data-delta]").forEach((button) => button.addEventListener("click", () => setScore(player.id, Math.max(1, Math.min(20, (Number(player.scores[selectedHole - 1]) || E.COURSE.holes[selectedHole - 1].par) + Number(button.dataset.delta))))));
      card.querySelector('[data-kind="sandy"]')?.addEventListener("change", (e) => dispatch({ type: "SET_SANDY", payload: { playerId: player.id, holeIndex: selectedHole - 1, value: e.target.checked } }));
      card.querySelector('[data-kind="kp"]')?.addEventListener("change", (e) => dispatch({ type: "SET_KP", payload: { hole: selectedHole, playerId: e.target.checked ? player.id : "" } }));
    });
    $("#noGroupPlayers").hidden = players.length > 0;
    list.hidden = players.length === 0;
    renderGroupScorecard(players);
    updateScorecardVisibility();
  }

  function updateScorecardVisibility() {
    $("#groupScorecardPanel").hidden = !scorecardOpen;
    $("#toggleScorecardBtn").setAttribute("aria-expanded", String(scorecardOpen));
    $("#toggleScorecardBtn").textContent = scorecardOpen ? "Hide group scorecard" : "Show group scorecard";
  }

  function renderGroupScorecard(players) {
    $("#groupScorecardHead").innerHTML = `<tr><th>Player</th>${E.COURSE.holes.map((h) => `<th>${h.number}</th>`).join("")}<th>Out</th><th>In</th><th>Net</th></tr>`;
    $("#groupScorecardBody").innerHTML = players.map((player) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const cells = player.scores.map((score, i) => `<td><button type="button" class="score-cell ${i + 1 === selectedHole ? "active-hole" : ""}" data-card-hole="${i + 1}">${score || "—"}</button></td>`).join("");
      return `<tr><td>${esc(nameOf(player, state.players.indexOf(player)))}</td>${cells}<td>${complete(totals.front.gross, totals.front.completed)}</td><td>${complete(totals.back.gross, totals.back.completed)}</td><td>${complete(totals.total.net, totals.total.completed)}</td></tr>`;
    }).join("");
    document.querySelectorAll("[data-card-hole]").forEach((button) => button.addEventListener("click", () => { selectedHole = Number(button.dataset.cardHole); renderGroupScoring(); }));
  }

  function renderKPs() {
    $("#kpPanel").innerHTML = KP_HOLES.map((hole) => `<div class="kp-card"><label>Hole ${hole} KP<select data-kp-hole="${hole}"><option value="">No winner</option>${state.players.map((player, i) => `<option value="${player.id}" ${state.settings.kpWinners[String(hole)] === player.id ? "selected" : ""}>${esc(nameOf(player, i))} · ${player.group}</option>`).join("")}</select></label></div>`).join("");
    document.querySelectorAll("[data-kp-hole]").forEach((select) => select.addEventListener("change", (e) => dispatch({ type: "SET_KP", payload: { hole: Number(e.target.dataset.kpHole), playerId: e.target.value } })));
  }

  function renderLeaderboard() {
    renderKPs();
    const ranked = state.players.map((player, index) => ({ player, index, totals: E.playerTotals(player, E.COURSE, state.settings), tics: E.ticSummary(player, state.players, E.COURSE, state.settings) })).sort((a, b) => {
      const aThru = a.player.scores.filter(Boolean).length, bThru = b.player.scores.filter(Boolean).length;
      if (a.totals.total.completed !== b.totals.total.completed) return a.totals.total.completed ? -1 : 1;
      if (a.totals.total.completed) return a.totals.total.net - b.totals.total.net;
      return bThru - aThru || a.totals.total.net - b.totals.total.net;
    });
    $("#leaderboardBody").innerHTML = ranked.map((item, rank) => {
      const t = item.tics, thru = item.player.scores.filter(Boolean).length;
      return `<tr class="${rank === 0 && item.totals.total.completed ? "leader-row-leading" : ""}"><td>${esc(nameOf(item.player, item.index))}</td><td>${item.player.group}</td><td>${thru === 18 ? "F" : thru}</td><td>${hcp(item.player)}</td><td>${complete(item.totals.total.gross, item.totals.total.completed)}</td><td>${complete(item.totals.total.net, item.totals.total.completed)}</td><td>${t.birdies}</td><td>${t.skins}</td><td>${t.front}</td><td>${t.back}</td><td>${t.totalNet}</td><td>${t.sandyPars}</td><td>${t.sandyBirdies}</td><td>${t.kps}</td><td class="tic-total">${t.total}</td></tr>`;
    }).join("");
    $("#leaderboardEmpty").hidden = state.players.length > 0;
    $(".leaderboard-wrap").hidden = state.players.length === 0;
  }

  function render() {
    $("#roundName").value = state.roundName; $("#roundDate").value = state.date; $("#allowance").value = state.settings.allowance;
    renderPlayers(); renderGroupScoring(); renderLeaderboard();
  }

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => { const active = item === tab; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll(".view").forEach((view) => { const active = view.id === `${tab.dataset.view}View`; view.classList.toggle("active", active); view.hidden = !active; });
  }));
  $("#addPlayerBtn").addEventListener("click", addPlayer);
  $("#activeGroupSelect").addEventListener("change", (e) => { selectedGroup = e.target.value; history.replaceState(null, "", `?group=${selectedGroup}`); renderGroupScoring(); });
  $("#holeSelect").addEventListener("change", (e) => { selectedHole = Number(e.target.value); renderGroupScoring(); });
  $("#prevHoleBtn").addEventListener("click", () => { selectedHole = selectedHole === 1 ? 18 : selectedHole - 1; renderGroupScoring(); });
  $("#nextHoleBtn").addEventListener("click", () => { selectedHole = selectedHole === 18 ? 1 : selectedHole + 1; renderGroupScoring(); });
  $("#toggleScorecardBtn").addEventListener("click", () => { scorecardOpen = !scorecardOpen; updateScorecardVisibility(); });
  $("#printBtn").addEventListener("click", () => window.print());
  $("#roundName").addEventListener("change", (e) => dispatch({ type: "SET_META", payload: { roundName: e.target.value } }));
  $("#roundDate").addEventListener("change", (e) => dispatch({ type: "SET_META", payload: { date: e.target.value } }));
  $("#allowance").addEventListener("change", (e) => dispatch({ type: "SET_ALLOWANCE", payload: { allowance: Number(e.target.value) } }));
  $("#exportBtn").addEventListener("click", () => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })); link.download = `berry-creek-${state.date}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  $("#importInput").addEventListener("change", async (e) => { try { const imported = R.normalizeState(JSON.parse(await e.target.files[0].text())); await dispatch({ type: "REPLACE_ROUND", payload: { state: imported } }); } catch (_) { alert("That file is not a valid Berry Creek Tics backup."); } e.target.value = ""; });
  const dialog = $("#confirmDialog");
  $("#resetAppBtn").addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "scores") { selectedHole = 1; dispatch({ type: "RESET_SCORES" }); }
    if (dialog.returnValue === "everything") { selectedHole = 1; selectedGroup = "A"; dispatch({ type: "CLEAR_ROUND" }); }
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(() => {});
  render(); connect();
})();
