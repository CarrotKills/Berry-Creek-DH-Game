(function () {
  "use strict";
  const E = window.BerryCreekScoring;
  const R = window.BerryCreekRoundState;
  const APP_VERSION = "9.0.1";
  const STORAGE_KEY = "berry-creek-tics-v2";
  const QUEUE_KEY = "berry-creek-pending-actions-v1";
  const PREFS_KEY = "berry-creek-device-prefs-v1";
  const ADMIN_PIN_KEY = "berry-creek-admin-pin";
  const KP_HOLES = [2, 8, 12, 17];
  const $ = (selector) => document.querySelector(selector);
  const teeEntries = Object.entries(E.COURSE.tees);
  const params = new URLSearchParams(location.search);
  let state = loadLocal();
  let connectionMode = "connecting";
  let selectedGroup = R.GROUPS.includes(params.get("group")) ? params.get("group") : "A";
  let selectedHole = 1;
  let scorecardOpen = false;
  let scorerLinkLocked = params.get("scorer") === "1";
  let celebrationAudioContext;
  let eventSource;
  let serviceWorkerRegistration;
  let toastTimer;
  let adminPin = sessionStorage.getItem(ADMIN_PIN_KEY) || "";
  let adminUnlocked = Boolean(adminPin);
  let preferences = loadPreferences();

  function loadLocal() {
    try { return R.normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return R.defaultState(); }
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function loadPreferences() {
    try { return { sound: true, display: "normal", ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; }
    catch (_) { return { sound: true, display: "normal" }; }
  }
  function savePreferences() { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); }
  function loadQueue() {
    try { const value = JSON.parse(localStorage.getItem(QUEUE_KEY)); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  }
  function saveQueue(queue) { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-100))); }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function esc(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
  function nameOf(player, index) { return player.name.trim() || `Player ${index + 1}`; }
  function teeOf(player) { return E.teeForPlayer(E.COURSE, player); }
  function hcp(player) { return E.playingHandicap(player.ghin, state.settings, teeOf(player)); }
  function complete(value, done) { return done ? String(value) : "—"; }
  function groupPlayers(group = selectedGroup) { return state.players.filter((player) => player.group === group); }
  function isLocked() { return Boolean(state.settings.locked); }

  function showToast(message, kind = "info") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function setConnection(mode) {
    connectionMode = mode;
    const labels = { connecting: "Connecting", live: "Live · synced", reconnecting: "Reconnecting", offline: "Offline" };
    const status = $("#syncStatus");
    status.className = `status-pill connection-pill is-${mode}`;
    status.innerHTML = `<span class="status-dot"></span>${labels[mode]}`;
    const queued = loadQueue().length;
    const foot = $("#connectionFoot");
    if (mode === "live") foot.textContent = "All connected scorekeepers are updating live.";
    else if (queued) foot.textContent = `${queued} change${queued === 1 ? "" : "s"} waiting to sync.`;
    else foot.textContent = mode === "reconnecting" ? "Trying to restore live scoring…" : "Scores entered offline will sync when the connection returns.";
  }

  function stampedAction(action, admin) {
    return {
      type: action.type,
      payload: action.payload || {},
      meta: { at: new Date().toISOString(), actor: admin ? "Organizer" : `Group ${selectedGroup} scorer` }
    };
  }

  async function postAction(action, admin) {
    const headers = { "Content-Type": "application/json", "X-Scoring-Group": selectedGroup };
    if (admin) {
      headers["X-Admin-Pin"] = adminPin;
      headers["X-Admin-Override"] = "1";
    }
    const response = await fetch("/api/action", { method: "POST", headers, body: JSON.stringify(action) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body.error || "The change was not accepted");
      error.serverRejected = true;
      throw error;
    }
  }

  async function refreshState() {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load round");
    state = R.normalizeState(await response.json());
    saveLocal();
    render();
  }

  async function dispatch(action, options = {}) {
    const admin = options.admin ?? R.isAdminAction(action.type);
    if (isLocked() && action.type !== "SET_LOCKED") return showToast("The round is finalized and locked.", "error");
    if (admin && !adminUnlocked) {
      openAdminDialog();
      return showToast("Organizer access is required for that change.", "error");
    }
    const localAction = stampedAction(action, admin);
    state = R.applyAction(state, localAction);
    saveLocal();
    render();
    if (connectionMode !== "live") {
      const queue = loadQueue();
      queue.push({ action, admin });
      saveQueue(queue);
      setConnection("offline");
      return showToast("Saved on this device and waiting to sync.");
    }
    try {
      await postAction(action, admin);
    } catch (error) {
      if (error.serverRejected) {
        await refreshState().catch(() => {});
        showToast(error.message, "error");
      } else {
        const queue = loadQueue();
        queue.push({ action, admin });
        saveQueue(queue);
        setConnection("reconnecting");
        showToast("Connection lost. The change is waiting to sync.", "error");
      }
    }
  }

  async function flushQueue() {
    const queue = loadQueue();
    if (!queue.length) return;
    let rejected = 0;
    for (const item of queue) {
      try { await postAction(item.action, item.admin); }
      catch (error) {
        if (!error.serverRejected) throw error;
        rejected += 1;
      }
    }
    saveQueue([]);
    await refreshState();
    showToast(rejected ? `${queue.length - rejected} offline changes synced; ${rejected} could not be applied.` : `${queue.length} offline change${queue.length === 1 ? "" : "s"} synced.`, rejected ? "error" : "success");
  }

  async function connect() {
    if (!location.protocol.startsWith("http")) { setConnection("offline"); return; }
    setConnection(connectionMode === "live" ? "live" : "connecting");
    try {
      await refreshState();
      setConnection("live");
      await flushQueue();
      eventSource?.close();
      eventSource = new EventSource("/api/events");
      eventSource.addEventListener("state", (event) => {
        state = R.normalizeState(JSON.parse(event.data));
        saveLocal();
        setConnection("live");
        render();
      });
      eventSource.onerror = () => setConnection(navigator.onLine ? "reconnecting" : "offline");
    } catch (_) {
      setConnection(navigator.onLine ? "reconnecting" : "offline");
      render();
    }
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
      const count = state.players.filter((player) => player.group === group && player.id !== currentPlayerId).length;
      return `<option value="${group}" ${group === selected ? "selected" : ""} ${count >= R.MAX_GROUP_SIZE && group !== selected ? "disabled" : ""}>Group ${group} (${count + (group === selected ? 1 : 0)}/5)</option>`;
    }).join("");
  }

  function renderSetupWarnings() {
    const warnings = [];
    const missing = state.players.filter((player) => !player.name.trim()).length;
    const names = state.players.map((player) => player.name.trim().toLowerCase()).filter(Boolean);
    const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    if (missing) warnings.push(`${missing} player${missing === 1 ? " is" : "s are"} missing a name.`);
    if (duplicates.length) warnings.push(`Duplicate player name${duplicates.length === 1 ? "" : "s"}: ${duplicates.join(", ")}.`);
    const panel = $("#setupWarnings");
    panel.hidden = !warnings.length;
    panel.innerHTML = warnings.map((warning) => `<p>⚠ ${esc(warning)}</p>`).join("");
  }

  function renderPlayers() {
    const list = $("#playerList");
    list.replaceChildren();
    state.players.forEach((player, index) => {
      const row = $("#playerRowTemplate").content.firstElementChild.cloneNode(true);
      row.querySelector(".player-number").textContent = index + 1;
      const name = row.querySelector(".player-name"); name.value = player.name;
      const ghinInput = row.querySelector(".player-ghin"); ghinInput.value = player.ghin;
      const tee = row.querySelector(".player-tee"); tee.innerHTML = teeOptions(player.teeKey);
      const group = row.querySelector(".player-group"); group.innerHTML = groupOptions(player.group, player.id);
      row.querySelector(".playing-hcp strong").textContent = hcp(player);
      name.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, name: event.target.value } }));
      ghinInput.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, ghin: Number(event.target.value) || 0 } }));
      tee.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, teeKey: event.target.value } }));
      group.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, group: event.target.value } }));
      row.querySelector(".remove-player").addEventListener("click", () => dispatch({ type: "REMOVE_PLAYER", payload: { playerId: player.id } }));
      list.append(row);
    });
    if (!state.players.length) list.innerHTML = '<div class="empty-state">No players yet. Add up to 30 golfers.</div>';
    $("#playerLimit").hidden = true;
    $("#addPlayerBtn").disabled = state.players.length >= R.MAX_PLAYERS;
    $("#groupCounts").innerHTML = R.GROUPS.map((group) => `<span>Group ${group}: <strong>${groupPlayers(group).length}/5</strong></span>`).join("");
    renderSetupWarnings();
  }

  function renderGroupSelectors() {
    const select = $("#activeGroupSelect");
    select.innerHTML = R.GROUPS.map((group) => `<option value="${group}" ${group === selectedGroup ? "selected" : ""}>Group ${group} · ${groupPlayers(group).length} player${groupPlayers(group).length === 1 ? "" : "s"}</option>`).join("");
    select.disabled = scorerLinkLocked;
    $("#scorerLinkNotice").hidden = !scorerLinkLocked;
    if (scorerLinkLocked) $("#scorerLinkNotice").textContent = `This link is assigned to Group ${selectedGroup}.`;
    const holes = $("#holeSelect");
    if (!holes.options.length) holes.innerHTML = E.COURSE.holes.map((hole) => `<option value="${hole.number}">Hole ${hole.number}</option>`).join("");
    holes.value = selectedHole;
  }

  function renderHoleBanner(players) {
    const base = E.COURSE.holes[selectedHole - 1];
    const details = [...new Set(players.map((player) => { const hole = E.holesForPlayer(E.COURSE, player)[selectedHole - 1]; return `${teeOf(player).name}: ${hole.yards} yds · SI ${hole.strokeIndex}`; }))];
    const kpWinnerId = state.settings.kpWinners[String(selectedHole)];
    const kpWinner = state.players.find((player) => player.id === kpWinnerId);
    const kpStatus = KP_HOLES.includes(selectedHole) ? `<span class="kp-status">KP: ${kpWinner ? esc(nameOf(kpWinner, state.players.indexOf(kpWinner))) : "Open"}</span>` : "";
    const skin = E.skinResult(state.players, E.COURSE, state.settings, selectedHole - 1);
    const skinWinner = state.players.find((player) => player.id === skin.winnerId);
    const skinText = skin.status === "awarded" ? `Skin: ${esc(nameOf(skinWinner, state.players.indexOf(skinWinner)))}` : skin.status === "tie" ? "Skin: No skin (tie)" : "Skin: Pending";
    $("#holeBanner").innerHTML = `<strong>Hole ${selectedHole} · Par ${base.par}</strong><span>${details.length ? details.join("  |  ") : "Add players to see tee details."}</span><span class="skin-status">${skinText}</span>${kpStatus}`;
    const missing = players.filter((player) => !player.scores[selectedHole - 1]).length;
    $("#holeWarning").textContent = missing ? `${missing} score${missing === 1 ? "" : "s"} still missing on this hole.` : players.length ? "All group scores entered for this hole. ✓" : "";
    $("#holeWarning").classList.toggle("complete", Boolean(players.length && !missing));
  }

  function playEagleCelebration() {
    if (!preferences.sound) return;
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
    [{ frequency: 392, delay: 0, duration: 0.42 }, { frequency: 523.25, delay: 0.34, duration: 0.46 }, { frequency: 659.25, delay: 0.7, duration: 0.5 }, { frequency: 783.99, delay: 1.08, duration: 0.72 }, { frequency: 1046.5, delay: 1.55, duration: 1.35 }].forEach((note, index) => {
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
    if (!preferences.sound) return;
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
    if (isLocked()) return showToast("The round is finalized and locked.", "error");
    const player = state.players.find((item) => item.id === playerId);
    const holeIndex = selectedHole - 1;
    const par = E.COURSE.holes[holeIndex].par;
    const numeric = score === "" ? "" : Math.max(1, Math.min(20, Number(score) || 1));
    if (numeric !== "" && numeric !== player?.scores[holeIndex] && (numeric <= par - 3 || numeric >= par + 5)) {
      if (!window.confirm(`${nameOf(player, 0)}: confirm a score of ${numeric} on Hole ${selectedHole} (par ${par})?`)) return renderGroupScoring();
    }
    const isNewEagle = E.isEagle(numeric, par) && !E.isEagle(player?.scores[holeIndex], par);
    const isNewBirdie = E.isBirdie(numeric, par) && !E.isBirdie(player?.scores[holeIndex], par);
    if (isNewEagle) playEagleCelebration();
    else if (isNewBirdie) playBirdieTweets();
    dispatch({ type: "SET_SCORE", payload: { playerId, holeIndex, score: numeric } });
  }

  function renderGroupScoring() {
    renderGroupSelectors();
    const players = groupPlayers();
    renderHoleBanner(players);
    $("#roundLockedNotice").hidden = !isLocked();
    const list = $("#groupScoreList");
    list.innerHTML = players.map((player) => {
      const index = selectedHole - 1;
      const hole = E.holesForPlayer(E.COURSE, player)[index];
      const gross = player.scores[index];
      const strokes = E.strokesForHole(hcp(player), hole.strokeIndex);
      const net = E.netScore(gross, strokes);
      const birdie = Number(gross) > 0 && Number(gross) <= hole.par - 1;
      const achievement = E.isEagle(gross, hole.par) ? "Eagle" : E.isBirdie(gross, hole.par) ? "Birdie" : Number(gross) > 0 && Number(gross) <= hole.par - 3 ? "Albatross" : "";
      const sandyPar = player.sandies[index] && Number(gross) === hole.par;
      const sandyBirdie = player.sandies[index] && birdie;
      const canMarkSandy = Number(gross) >= 1 && Number(gross) <= hole.par;
      const isKpHole = KP_HOLES.includes(selectedHole);
      const hasKp = state.settings.kpWinners[String(selectedHole)] === player.id;
      const hasSkin = E.skinResult(state.players, E.COURSE, state.settings, index).winnerId === player.id;
      const disabled = isLocked() ? "disabled" : "";
      return `<article class="group-score-card" data-player-id="${player.id}">
        <div class="score-player"><strong>${esc(nameOf(player, state.players.indexOf(player)))}</strong><span>${esc(teeOf(player).name)} · Hcp ${hcp(player)} · ${strokes > 0 ? `gets ${strokes}` : strokes < 0 ? `gives ${Math.abs(strokes)}` : "no stroke"}</span></div>
        <div class="score-stepper"><button type="button" data-delta="-1" ${disabled} aria-label="Decrease score">−</button><input type="number" min="1" max="20" inputmode="numeric" value="${gross}" ${disabled} aria-label="${esc(nameOf(player, 0))}'s gross score"><button type="button" data-delta="1" ${disabled} aria-label="Increase score">+</button></div>
        <div class="net-box"><span>Net</span><strong>${net ?? "—"}</strong></div>
        <div class="card-tics">${achievement ? `<span class="auto-tic">${achievement} ✓</span>` : ""}${hasSkin ? '<span class="auto-tic">Net skin ✓</span>' : ""}${canMarkSandy ? `<label class="tic-toggle"><input data-kind="sandy" type="checkbox" ${player.sandies[index] ? "checked" : ""} ${disabled}>Sand save</label>` : ""}${isKpHole ? `<label class="tic-toggle kp-toggle"><input data-kind="kp" type="checkbox" ${hasKp ? "checked" : ""} ${disabled}>KP</label>` : ""}${sandyPar ? '<span class="auto-tic">Sandy par ✓</span>' : ""}${sandyBirdie ? '<span class="auto-tic">Sandy birdie ✓</span>' : ""}</div>
      </article>`;
    }).join("");
    list.querySelectorAll(".group-score-card").forEach((card) => {
      const player = state.players.find((item) => item.id === card.dataset.playerId);
      const input = card.querySelector('input[type="number"]');
      input?.addEventListener("change", (event) => setScore(player.id, event.target.value));
      card.querySelectorAll("[data-delta]").forEach((button) => button.addEventListener("click", () => setScore(player.id, Math.max(1, Math.min(20, (Number(player.scores[selectedHole - 1]) || E.COURSE.holes[selectedHole - 1].par) + Number(button.dataset.delta))))));
      card.querySelector('[data-kind="sandy"]')?.addEventListener("change", (event) => dispatch({ type: "SET_SANDY", payload: { playerId: player.id, holeIndex: selectedHole - 1, value: event.target.checked } }));
      card.querySelector('[data-kind="kp"]')?.addEventListener("change", (event) => dispatch({ type: "SET_KP", payload: { hole: selectedHole, playerId: event.target.checked ? player.id : "" } }));
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
    $("#groupScorecardHead").innerHTML = `<tr><th>Player</th>${E.COURSE.holes.map((hole) => `<th>${hole.number}</th>`).join("")}<th>Out</th><th>In</th><th>Net</th></tr>`;
    $("#groupScorecardBody").innerHTML = players.map((player) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const cells = player.scores.map((score, index) => `<td><button type="button" class="score-cell ${index + 1 === selectedHole ? "active-hole" : ""}" data-card-hole="${index + 1}">${score || "—"}</button></td>`).join("");
      return `<tr><td>${esc(nameOf(player, state.players.indexOf(player)))}</td>${cells}<td>${complete(totals.front.gross, totals.front.completed)}</td><td>${complete(totals.back.gross, totals.back.completed)}</td><td>${complete(totals.total.net, totals.total.completed)}</td></tr>`;
    }).join("");
    document.querySelectorAll("[data-card-hole]").forEach((button) => button.addEventListener("click", () => { selectedHole = Number(button.dataset.cardHole); renderGroupScoring(); }));
  }

  function renderKPs() {
    const canAdminEdit = adminUnlocked && !isLocked();
    $("#kpPanel").innerHTML = KP_HOLES.map((hole) => `<div class="kp-card"><label>Hole ${hole} KP<select data-kp-hole="${hole}" ${canAdminEdit ? "" : "disabled"}><option value="">No winner</option>${state.players.map((player, index) => `<option value="${player.id}" ${state.settings.kpWinners[String(hole)] === player.id ? "selected" : ""}>${esc(nameOf(player, index))} · ${player.group}</option>`).join("")}</select></label></div>`).join("");
    document.querySelectorAll("[data-kp-hole]").forEach((select) => select.addEventListener("change", (event) => dispatch({ type: "SET_KP", payload: { hole: Number(event.target.dataset.kpHole), playerId: event.target.value } }, { admin: true })));
  }

  function rankedPlayers() {
    return state.players.map((player, index) => ({ player, index, totals: E.playerTotals(player, E.COURSE, state.settings), tics: E.ticSummary(player, state.players, E.COURSE, state.settings) })).sort((a, b) => {
      const aThru = a.player.scores.filter(Boolean).length;
      const bThru = b.player.scores.filter(Boolean).length;
      if (a.totals.total.completed !== b.totals.total.completed) return a.totals.total.completed ? -1 : 1;
      if (a.totals.total.completed) return a.totals.total.net - b.totals.total.net;
      return bThru - aThru || a.totals.total.net - b.totals.total.net;
    });
  }

  function renderLeaderboard() {
    renderKPs();
    $("#leaderboardBody").innerHTML = rankedPlayers().map((item, rank) => {
      const tics = item.tics;
      const thru = item.player.scores.filter(Boolean).length;
      return `<tr class="${rank === 0 && item.totals.total.completed ? "leader-row-leading" : ""}"><td>${esc(nameOf(item.player, item.index))}</td><td>${item.player.group}</td><td>${thru === 18 ? "F" : thru}</td><td>${hcp(item.player)}</td><td>${complete(item.totals.total.gross, item.totals.total.completed)}</td><td>${complete(item.totals.total.net, item.totals.total.completed)}</td><td>${tics.birdies}</td><td>${tics.skins}</td><td>${tics.front}</td><td>${tics.back}</td><td>${tics.totalNet}</td><td>${tics.sandyPars}</td><td>${tics.sandyBirdies}</td><td>${tics.kps}</td><td class="tic-total">${tics.total}</td></tr>`;
    }).join("");
    $("#leaderboardEmpty").hidden = state.players.length > 0;
    $(".leaderboard-wrap").hidden = state.players.length === 0;
  }

  function groupScoringUrl(group) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("group", group);
    url.searchParams.set("view", "score");
    url.searchParams.set("scorer", "1");
    return url.href;
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); }
    catch (_) {
      const input = document.createElement("textarea");
      input.value = value; document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
    }
  }

  function renderGroupSharing() {
    $("#groupShareGrid").innerHTML = R.GROUPS.map((group) => `<article class="group-share-card"><div><strong>Group ${group}</strong><span>${groupPlayers(group).length}/5 players</span></div><div class="share-actions"><button class="button button-quiet" data-share-action="copy" data-group="${group}">Copy link</button><button class="button button-quiet" data-share-action="share" data-group="${group}">Share</button><button class="button button-primary" data-share-action="qr" data-group="${group}">QR code</button></div></article>`).join("");
    document.querySelectorAll("[data-share-action]").forEach((button) => button.addEventListener("click", async () => {
      const group = button.dataset.group;
      const url = groupScoringUrl(group);
      if (button.dataset.shareAction === "copy") { await copyText(url); showToast(`Group ${group} link copied.`, "success"); }
      if (button.dataset.shareAction === "share") {
        if (navigator.share) await navigator.share({ title: `Berry Creek Group ${group} scoring`, text: `Open the Group ${group} scorecard`, url }).catch(() => {});
        else { await copyText(url); showToast(`Group ${group} link copied.`, "success"); }
      }
      if (button.dataset.shareAction === "qr") {
        $("#qrTitle").textContent = `Group ${group} scoring link`;
        $("#qrImage").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=png&data=${encodeURIComponent(url)}`;
        $("#qrLinkText").textContent = url;
        $("#qrDialog").showModal();
      }
    }));
  }

  function renderAudit() {
    const log = [...state.auditLog].reverse();
    $("#auditList").innerHTML = log.length ? log.map((entry) => {
      const when = Number.isNaN(Date.parse(entry.at)) ? entry.at : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at));
      return `<article class="audit-entry"><div><strong>${esc(entry.detail)}</strong><span>${esc(entry.actor)}</span></div><time>${esc(when)}</time></article>`;
    }).join("") : '<div class="empty-state">No changes recorded yet.</div>';
  }

  function renderTournament() {
    const locked = isLocked();
    $("#roundStatusText").textContent = locked ? "The round is finalized. Scorecards and results remain available to view." : "The round is open for live scoring.";
    $("#toggleRoundLockBtn").textContent = locked ? "Unlock round" : "Finalize and lock round";
    $("#toggleRoundLockBtn").classList.toggle("button-danger", !locked);
    $("#toggleRoundLockBtn").classList.toggle("button-primary", locked);
    $("#soundToggle").checked = preferences.sound;
    $("#displayMode").value = preferences.display;
    renderGroupSharing();
    renderAudit();
  }

  function renderAdminState() {
    $("#organizerBtn").textContent = adminUnlocked ? "Lock organizer controls" : "Organizer unlock";
    $("#setupLockedNotice").hidden = adminUnlocked;
    document.querySelectorAll(".admin-control").forEach((control) => {
      const isRoundLockControl = control.id === "toggleRoundLockBtn";
      const atPlayerLimit = control.id === "addPlayerBtn" && state.players.length >= R.MAX_PLAYERS;
      control.disabled = !adminUnlocked || (isLocked() && !isRoundLockControl) || atPlayerLimit;
    });
    $("#lockStatus").hidden = !isLocked();
    document.body.classList.toggle("round-locked", isLocked());
  }

  function render() {
    $("#roundName").value = state.roundName;
    $("#roundDate").value = state.date;
    $("#allowance").value = state.settings.allowance;
    renderPlayers();
    renderGroupScoring();
    renderLeaderboard();
    renderTournament();
    renderAdminState();
  }

  function switchView(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.view === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".view").forEach((view) => {
      const active = view.id === `${name}View`;
      view.classList.toggle("active", active);
      view.hidden = !active;
    });
  }

  function moveToHole(nextHole) {
    const missing = groupPlayers().filter((player) => !player.scores[selectedHole - 1]);
    if (missing.length && nextHole !== selectedHole && !window.confirm(`Hole ${selectedHole} still has ${missing.length} missing score${missing.length === 1 ? "" : "s"}. Leave this hole anyway?`)) return;
    selectedHole = nextHole;
    renderGroupScoring();
  }

  function openAdminDialog() {
    $("#adminPinInput").value = "";
    $("#adminError").hidden = true;
    $("#adminDialog").showModal();
    requestAnimationFrame(() => $("#adminPinInput").focus());
  }

  async function verifyAdmin() {
    const candidate = $("#adminPinInput").value;
    try {
      if (connectionMode === "live") {
        const response = await fetch("/api/admin/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: candidate }) });
        if (!response.ok) throw new Error("Incorrect organizer PIN");
      } else if (candidate !== "2468") throw new Error("Connect to the server to verify a custom PIN");
      adminPin = candidate;
      adminUnlocked = true;
      sessionStorage.setItem(ADMIN_PIN_KEY, candidate);
      $("#adminDialog").close();
      render();
      showToast("Organizer controls unlocked.", "success");
    } catch (error) {
      $("#adminError").textContent = error.message;
      $("#adminError").hidden = false;
    }
  }

  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
  function downloadBlob(contents, type, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([contents], { type }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function downloadCsv() {
    const headers = ["Player", "Group", "GHIN Index", "Tee", "Playing Handicap", ...E.COURSE.holes.map((hole) => `Hole ${hole.number}`), "Gross", "Net", "Birdies", "Skins", "Front Net Tic", "Back Net Tic", "Total Net Tic", "Sandy Pars", "Sandy Birdies", "KP Holes", "Total Tics"];
    const rows = state.players.map((player, index) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const tics = E.ticSummary(player, state.players, E.COURSE, state.settings);
      const kpHoles = KP_HOLES.filter((hole) => state.settings.kpWinners[String(hole)] === player.id).join("; ");
      return [nameOf(player, index), player.group, player.ghin, teeOf(player).name, hcp(player), ...player.scores, totals.total.completed ? totals.total.gross : "", totals.total.completed ? totals.total.net : "", tics.birdies, tics.skins, tics.front, tics.back, tics.totalNet, tics.sandyPars, tics.sandyBirdies, kpHoles, tics.total].map(csvCell).join(",");
    });
    downloadBlob([headers.map(csvCell).join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8", `berry-creek-results-${state.date}.csv`);
  }

  function preparePrintReport() {
    const kpRows = KP_HOLES.map((hole) => {
      const player = state.players.find((item) => item.id === state.settings.kpWinners[String(hole)]);
      return `<tr><td>Hole ${hole}</td><td>${player ? esc(nameOf(player, state.players.indexOf(player))) : "—"}</td></tr>`;
    }).join("");
    const skinRows = E.COURSE.holes.map((hole, index) => {
      const result = E.skinResult(state.players, E.COURSE, state.settings, index);
      const player = state.players.find((item) => item.id === result.winnerId);
      const resultText = result.status === "awarded" ? esc(nameOf(player, state.players.indexOf(player))) : result.status === "tie" ? "No skin — tie" : "Pending";
      return `<tr><td>${hole.number}</td><td>${resultText}</td></tr>`;
    }).join("");
    const groupTables = R.GROUPS.filter((group) => groupPlayers(group).length).map((group) => `<section class="print-group"><h3>Group ${group} scorecard</h3><table><thead><tr><th>Player</th>${E.COURSE.holes.map((hole) => `<th>${hole.number}</th>`).join("")}<th>Gross</th><th>Net</th></tr></thead><tbody>${groupPlayers(group).map((player, playerIndex) => { const totals = E.playerTotals(player, E.COURSE, state.settings); return `<tr><td>${esc(nameOf(player, playerIndex))}</td>${player.scores.map((score) => `<td>${score || "—"}</td>`).join("")}<td>${complete(totals.total.gross, totals.total.completed)}</td><td>${complete(totals.total.net, totals.total.completed)}</td></tr>`; }).join("")}</tbody></table></section>`).join("");
    const leaders = rankedPlayers().map((item, rank) => `<tr><td>${rank + 1}</td><td>${esc(nameOf(item.player, item.index))}</td><td>${item.player.group}</td><td>${item.player.scores.filter(Boolean).length}</td><td>${complete(item.totals.total.gross, item.totals.total.completed)}</td><td>${complete(item.totals.total.net, item.totals.total.completed)}</td><td>${item.tics.total}</td></tr>`).join("");
    $("#printReport").innerHTML = `<header><img src="berry-creek-logo.jpeg" alt=""><div><h1>${esc(state.roundName)}</h1><p>${esc(state.date)} · The Club at Berry Creek</p></div></header><h2>Leaderboard</h2><table><thead><tr><th>Place</th><th>Player</th><th>Group</th><th>Thru</th><th>Gross</th><th>Net</th><th>Tics</th></tr></thead><tbody>${leaders}</tbody></table><div class="print-columns"><section><h2>KPs</h2><table><tbody>${kpRows}</tbody></table></section><section><h2>Net skins</h2><table><thead><tr><th>Hole</th><th>Winner</th></tr></thead><tbody>${skinRows}</tbody></table></section></div>${groupTables}`;
  }

  async function checkVersion() {
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      const latest = (await response.json()).version;
      const current = latest === APP_VERSION;
      $("#versionStatus").textContent = current ? "This device is current." : `Version ${latest} is available.`;
      $("#updateBanner").hidden = current;
      return current;
    } catch (_) {
      $("#versionStatus").textContent = "Update check unavailable.";
      return false;
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("service-worker.js");
      if (serviceWorkerRegistration.waiting) $("#updateBanner").hidden = false;
      serviceWorkerRegistration.addEventListener("updatefound", () => {
        const worker = serviceWorkerRegistration.installing;
        worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) $("#updateBanner").hidden = false; });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; location.reload(); } });
    } catch (_) {}
  }

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("#addPlayerBtn").addEventListener("click", addPlayer);
  $("#activeGroupSelect").addEventListener("change", (event) => { selectedGroup = event.target.value; const url = new URL(location.href); url.searchParams.set("group", selectedGroup); history.replaceState(null, "", url); renderGroupScoring(); });
  $("#holeSelect").addEventListener("change", (event) => moveToHole(Number(event.target.value)));
  $("#prevHoleBtn").addEventListener("click", () => moveToHole(selectedHole === 1 ? 18 : selectedHole - 1));
  $("#nextHoleBtn").addEventListener("click", () => moveToHole(selectedHole === 18 ? 1 : selectedHole + 1));
  $("#toggleScorecardBtn").addEventListener("click", () => { scorecardOpen = !scorecardOpen; updateScorecardVisibility(); });
  $("#roundName").addEventListener("change", (event) => dispatch({ type: "SET_META", payload: { roundName: event.target.value } }));
  $("#roundDate").addEventListener("change", (event) => dispatch({ type: "SET_META", payload: { date: event.target.value } }));
  $("#allowance").addEventListener("change", (event) => dispatch({ type: "SET_ALLOWANCE", payload: { allowance: Number(event.target.value) } }));
  $("#organizerBtn").addEventListener("click", () => {
    if (adminUnlocked) { adminUnlocked = false; adminPin = ""; sessionStorage.removeItem(ADMIN_PIN_KEY); render(); showToast("Organizer controls locked."); }
    else openAdminDialog();
  });
  $("#adminSubmitBtn").addEventListener("click", (event) => { event.preventDefault(); verifyAdmin(); });
  $("#adminPinInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); verifyAdmin(); } });
  $("#toggleRoundLockBtn").addEventListener("click", () => {
    if (!isLocked()) {
      const incomplete = state.players.reduce((sum, player) => sum + player.scores.filter((score) => !score).length, 0);
      if (incomplete && !window.confirm(`${incomplete} score${incomplete === 1 ? " is" : "s are"} still missing. Finalize the round anyway?`)) return;
    }
    dispatch({ type: "SET_LOCKED", payload: { locked: !isLocked() } });
  });
  $("#soundToggle").addEventListener("change", (event) => { preferences.sound = event.target.checked; savePreferences(); showToast(preferences.sound ? "Celebration sounds on." : "Celebration sounds muted."); });
  $("#displayMode").addEventListener("change", (event) => { preferences.display = event.target.value; savePreferences(); document.body.dataset.display = preferences.display; });
  $("#exportBtn").addEventListener("click", () => downloadBlob(JSON.stringify(state, null, 2), "application/json", `berry-creek-${state.date}.json`));
  $("#csvBtn").addEventListener("click", downloadCsv);
  $("#printBtn").addEventListener("click", () => { preparePrintReport(); window.print(); });
  $("#importInput").addEventListener("change", async (event) => { try { const imported = R.normalizeState(JSON.parse(await event.target.files[0].text())); await dispatch({ type: "REPLACE_ROUND", payload: { state: imported } }); } catch (_) { showToast("That file is not a valid Berry Creek backup.", "error"); } event.target.value = ""; });
  const resetDialog = $("#confirmDialog");
  $("#resetAppBtn").addEventListener("click", () => resetDialog.showModal());
  resetDialog.addEventListener("close", () => {
    if (resetDialog.returnValue === "scores") { selectedHole = 1; dispatch({ type: "RESET_SCORES" }); }
    if (resetDialog.returnValue === "everything") { selectedHole = 1; selectedGroup = "A"; dispatch({ type: "CLEAR_ROUND" }); }
  });
  $("#clearHistoryBtn").addEventListener("click", () => { if (window.confirm("Clear the complete change history?")) dispatch({ type: "CLEAR_AUDIT" }); });
  $("#checkUpdateBtn").addEventListener("click", async () => { await serviceWorkerRegistration?.update(); const current = await checkVersion(); if (current) showToast("This device already has the current version.", "success"); });
  $("#footerVersionBtn").addEventListener("click", () => { switchView("tournament"); checkVersion(); });
  $("#installUpdateBtn").addEventListener("click", () => { if (serviceWorkerRegistration?.waiting) serviceWorkerRegistration.waiting.postMessage({ type: "SKIP_WAITING" }); else location.reload(); });
  window.addEventListener("online", connect);
  window.addEventListener("offline", () => setConnection("offline"));

  document.body.dataset.display = preferences.display;
  $("#appVersion").textContent = `Version ${APP_VERSION}`;
  $("#footerVersionBtn").textContent = `App v${APP_VERSION}`;
  render();
  const initialView = params.get("view");
  if (["setup", "score", "leaderboard", "tournament"].includes(initialView)) switchView(initialView);
  connect();
  registerServiceWorker();
  checkVersion();
})();
