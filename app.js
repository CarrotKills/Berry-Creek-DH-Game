(function () {
  "use strict";
  const E = window.BerryCreekScoring;
  const R = window.BerryCreekRoundState;
  const L = window.BerryCreekLeaderboardSort;
  const X = window.BerryCreekScorecardExport;
  const APP_VERSION = "9.6.2";
  const STORAGE_KEY = "berry-creek-tics-v2";
  const QUEUE_KEY = "berry-creek-pending-actions-v1";
  const PREFS_KEY = "berry-creek-device-prefs-v1";
  const ADMIN_PIN_KEY = "berry-creek-admin-pin";
  const KP_HOLES = [2, 8, 12, 17];
  const LEADERBOARD_COLUMNS = [
    { key: "player", label: "Player", firstDirection: "asc", text: true },
    { key: "group", label: "Grp", firstDirection: "asc", text: true },
    { key: "thru", label: "Thru", firstDirection: "desc" },
    { key: "handicap", label: "Hcp", firstDirection: "asc" },
    { key: "gross", label: "Gross", firstDirection: "asc" },
    { key: "net", label: "Net", firstDirection: "asc" },
    { key: "birdies", label: "Birdies", firstDirection: "desc" },
    { key: "eagles", label: "Eagles+", firstDirection: "desc" },
    { key: "skins", label: "Skins", firstDirection: "desc" },
    { key: "front", label: "F", firstDirection: "desc" },
    { key: "back", label: "B", firstDirection: "desc" },
    { key: "totalNet", label: "Total", firstDirection: "desc" },
    { key: "sandyPars", label: "Sandy par", firstDirection: "desc" },
    { key: "sandyBirdies", label: "Sandy birdie", firstDirection: "desc" },
    { key: "kps", label: "KP", firstDirection: "desc" },
    { key: "kpFails", label: "KP Fails", firstDirection: "desc" },
    { key: "positive", label: "Points +", firstDirection: "desc" },
    { key: "negative", label: "Points −", firstDirection: "desc" },
    { key: "netPoints", label: "Net points", firstDirection: "desc" }
  ];
  const $ = (selector) => document.querySelector(selector);
  const teeEntries = Object.entries(E.COURSE.tees);
  const params = new URLSearchParams(location.search);
  const spectatorMode = params.get("spectator") === "1";
  let state = loadLocal();
  let connectionMode = "connecting";
  let selectedGroup = R.GROUPS.includes(params.get("group")) ? params.get("group") : "A";
  let selectedHole = 1;
  let scorecardOpen = false;
  let scorerLinkLocked = params.get("scorer") === "1";
  let scorerToken = params.get("token") || "";
  const scorerRoundId = params.get("round") || "";
  let celebrationAudioContext;
  let eventSource;
  let serviceWorkerRegistration;
  let toastTimer;
  let adminPin = sessionStorage.getItem(ADMIN_PIN_KEY) || "";
  let adminUnlocked = Boolean(adminPin);
  let savedPlayers = [];
  let savedRounds = [];
  let shareTokens = {};
  let activeSavedRound = null;
  let pendingReuseRound = null;
  let savedPlayerSearch = "";
  const savedPlayerGroupSelections = new Map();
  const scoreSyncStatus = new Map();
  const scoreSyncTimers = new Map();
  let groupPresence = {};
  let autoAdvanceTimer;
  let leaderboardSort = { key: "standing", direction: "asc" };
  let preferences = loadPreferences();

  function loadLocal() {
    try { return R.normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return R.defaultState(); }
  }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function loadPreferences() {
    try { return { sound: true, autoAdvance: false, display: "normal", ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; }
    catch (_) { return { sound: true, autoAdvance: false, display: "normal" }; }
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
  function displayIndex(value) { return E.formatHandicap(value, 1); }
  function displayPlayingHandicap(value) { return E.formatHandicap(value, 0); }
  function complete(value, done) { return done ? String(value) : "—"; }
  function groupPlayers(group = selectedGroup) { return state.players.filter((player) => player.group === group); }
  function isLocked() { return Boolean(state.settings.locked); }
  function scorerLinkExpired() { return scorerLinkLocked && (!scorerToken || !scorerRoundId || scorerRoundId !== state.roundId); }
  function canScore() { return !spectatorMode && !isLocked() && (adminUnlocked || (scorerLinkLocked && !scorerLinkExpired())); }
  function scoreSyncKey(playerId, holeIndex) { return `${playerId}:${holeIndex}`; }

  function setScoreSyncStatus(playerId, holeIndex, status) {
    const key = scoreSyncKey(playerId, holeIndex);
    clearTimeout(scoreSyncTimers.get(key));
    scoreSyncStatus.set(key, status);
    if (status === "synced") {
      scoreSyncTimers.set(key, setTimeout(() => {
        scoreSyncStatus.delete(key);
        scoreSyncTimers.delete(key);
        renderGroupScoring();
      }, 2600));
    }
  }

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
    renderSavedPlayers();
    renderGroupProgress();
  }

  function stampedAction(action, admin) {
    return {
      type: action.type,
      payload: action.payload || {},
      meta: { at: new Date().toISOString(), actor: admin ? "Admin" : `Group ${selectedGroup} scorer`, group: selectedGroup }
    };
  }

  async function postAction(action, admin) {
    const headers = { "Content-Type": "application/json", "X-Scoring-Group": selectedGroup };
    const adminOverride = admin || (adminUnlocked && !scorerLinkLocked && R.isScoringAction(action.type));
    if (adminOverride) {
      headers["X-Admin-Pin"] = adminPin;
      headers["X-Admin-Override"] = "1";
    } else if (scorerLinkLocked && scorerToken) {
      headers["X-Scoring-Token"] = scorerToken;
    }
    const response = await fetch("/api/action", { method: "POST", headers, body: JSON.stringify(action) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body.error || "The change was not accepted");
      error.serverRejected = true;
      throw error;
    }
  }

  async function databaseRequest(path, options = {}) {
    if (!adminUnlocked) throw new Error("Admin access is required");
    const headers = { ...(options.headers || {}), "X-Admin-Pin": adminPin };
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        adminUnlocked = false;
        adminPin = "";
        savedPlayers = [];
        sessionStorage.removeItem(ADMIN_PIN_KEY);
        render();
      }
      throw new Error(body.error || "The admin request failed");
    }
    return body;
  }

  async function loadSavedPlayers() {
    if (!adminUnlocked || connectionMode !== "live") {
      savedPlayers = [];
      renderSavedPlayers();
      return;
    }
    const status = $("#playerDatabaseStatus");
    status.textContent = "Loading saved players…";
    try {
      const body = await databaseRequest("/api/players", { cache: "no-store" });
      savedPlayers = Array.isArray(body.players) ? body.players : [];
      renderSavedPlayers();
    } catch (error) {
      savedPlayers = [];
      renderSavedPlayers(error.message);
    }
  }

  async function loadSavedRounds() {
    if (!adminUnlocked || connectionMode !== "live") {
      savedRounds = [];
      renderSavedRounds();
      return;
    }
    try {
      const body = await databaseRequest("/api/rounds", { cache: "no-store" });
      savedRounds = Array.isArray(body.rounds) ? body.rounds : [];
      renderSavedRounds();
    } catch (error) {
      savedRounds = [];
      renderSavedRounds(error.message);
    }
  }

  async function loadShareTokens() {
    if (!adminUnlocked || connectionMode !== "live") {
      shareTokens = {};
      renderGroupSharing();
      return;
    }
    try {
      const body = await databaseRequest("/api/share-tokens", { cache: "no-store" });
      shareTokens = body.tokens || {};
      renderGroupSharing();
    } catch (error) {
      shareTokens = {};
      renderGroupSharing(error.message);
    }
  }

  async function loadAdminData() {
    await Promise.all([loadSavedPlayers(), loadSavedRounds(), loadShareTokens()]);
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
    if (spectatorMode) { showToast("This leaderboard link is view only.", "error"); return false; }
    if (isLocked() && !["SET_LOCKED", "CLEAR_ROUND", "START_FROM_SAVED"].includes(action.type)) { showToast("The round is finalized and locked.", "error"); return false; }
    if (admin && !adminUnlocked) {
      openAdminDialog();
      showToast("Admin access is required for that change.", "error");
      return false;
    }
    const localAction = stampedAction(action, admin || (adminUnlocked && !scorerLinkLocked && R.isScoringAction(action.type)));
    state = R.applyAction(state, localAction);
    saveLocal();
    render();
    if (connectionMode !== "live") {
      const queue = loadQueue();
      queue.push({ action, admin });
      saveQueue(queue);
      setConnection("offline");
      showToast("Saved on this device and waiting to sync.");
      return true;
    }
    try {
      await postAction(action, admin);
      return true;
    } catch (error) {
      if (error.serverRejected) {
        await refreshState().catch(() => {});
        showToast(error.message, "error");
        return false;
      } else {
        const queue = loadQueue();
        queue.push({ action, admin });
        saveQueue(queue);
        setConnection("reconnecting");
        showToast("Connection lost. The change is waiting to sync.", "error");
        return true;
      }
    }
  }

  async function flushQueue() {
    const queue = loadQueue();
    if (!queue.length) return;
    let rejected = 0;
    for (const item of queue) {
      try {
        await postAction(item.action, item.admin);
        if (item.action.type === "SET_SCORE") setScoreSyncStatus(item.action.payload.playerId, Number(item.action.payload.holeIndex), "synced");
      }
      catch (error) {
        if (!error.serverRejected) throw error;
        rejected += 1;
        if (item.action.type === "SET_SCORE") setScoreSyncStatus(item.action.payload.playerId, Number(item.action.payload.holeIndex), "error");
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
      await loadAdminData();
      eventSource?.close();
      const eventUrl = new URL("/api/events", location.origin);
      if (scorerLinkLocked) {
        eventUrl.searchParams.set("scorer", "1");
        eventUrl.searchParams.set("group", selectedGroup);
        eventUrl.searchParams.set("token", scorerToken);
      }
      eventSource = new EventSource(eventUrl);
      eventSource.addEventListener("state", (event) => {
        state = R.normalizeState(JSON.parse(event.data));
        saveLocal();
        setConnection("live");
        render();
      });
      eventSource.addEventListener("presence", (event) => {
        groupPresence = JSON.parse(event.data);
        renderGroupProgress();
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

  function savedGroupOptions(selected) {
    return R.GROUPS.map((group) => {
      const count = groupPlayers(group).length;
      return `<option value="${group}" ${group === selected ? "selected" : ""} ${count >= R.MAX_GROUP_SIZE ? "disabled" : ""}>Group ${group} (${count}/5)</option>`;
    }).join("");
  }

  function renderSavedPlayers(errorMessage = "") {
    const list = $("#savedPlayerList");
    const status = $("#playerDatabaseStatus");
    const search = $("#savedPlayerSearch");
    if (!list || !status || !search) return;
    list.replaceChildren();
    search.disabled = !adminUnlocked || connectionMode !== "live";
    search.value = savedPlayerSearch;
    if (!adminUnlocked) {
      status.textContent = "Unlock admin controls to view saved players.";
      return;
    }
    if (connectionMode !== "live") {
      status.textContent = "The saved player database requires a live connection.";
      return;
    }
    if (errorMessage) {
      status.textContent = errorMessage;
      list.innerHTML = '<div class="empty-state">Saved players could not be loaded.</div>';
      return;
    }
    const query = savedPlayerSearch.trim().toLowerCase();
    const filtered = savedPlayers.filter((player) => player.name.toLowerCase().includes(query));
    const activeCount = savedPlayers.filter((saved) => state.players.some((player) => player.directoryId === saved.id)).length;
    status.textContent = `${savedPlayers.length} saved player${savedPlayers.length === 1 ? "" : "s"} · ${activeCount} in this round`;
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">${savedPlayers.length ? "No saved players match that search." : "No saved players yet. Use the form above to create the reusable roster."}</div>`;
      return;
    }
    const canEdit = adminUnlocked && connectionMode === "live" && !isLocked();
    filtered.forEach((saved) => {
      const activePlayer = state.players.find((player) => player.directoryId === saved.id);
      let selected = savedPlayerGroupSelections.get(saved.id) || nextAvailableGroup();
      if (groupPlayers(selected).length >= R.MAX_GROUP_SIZE) selected = nextAvailableGroup();
      savedPlayerGroupSelections.set(saved.id, selected);
      const addDisabled = !canEdit || Boolean(activePlayer) || state.players.length >= R.MAX_PLAYERS || groupPlayers(selected).length >= R.MAX_GROUP_SIZE;
      const row = document.createElement("article");
      row.className = "saved-player-row";
      row.dataset.savedPlayerId = saved.id;
      row.innerHTML = `<label class="saved-player-name">Name<input class="saved-name" type="text" maxlength="40" value="${esc(saved.name)}" ${canEdit ? "" : "disabled"}></label>
        <label>GHIN Index<input class="saved-ghin" type="text" maxlength="6" inputmode="decimal" value="${displayIndex(saved.ghin)}" placeholder="12.4 or +4.2" ${canEdit ? "" : "disabled"}></label>
        <label>Tee<select class="saved-tee" ${canEdit ? "" : "disabled"}>${teeOptions(saved.teeKey)}</select></label>
        <label>Add to<select class="saved-group" ${addDisabled ? "disabled" : ""}>${savedGroupOptions(selected)}</select></label>
        <div class="saved-player-actions"><button class="button button-primary add-saved-player" type="button" ${addDisabled ? "disabled" : ""}>${activePlayer ? `In Group ${activePlayer.group}` : "Add to group"}</button><button class="button button-quiet delete-saved-player" type="button" ${canEdit ? "" : "disabled"}>Delete</button></div>`;
      const name = row.querySelector(".saved-name");
      const ghin = row.querySelector(".saved-ghin");
      const tee = row.querySelector(".saved-tee");
      const group = row.querySelector(".saved-group");
      name.addEventListener("change", () => updateSavedPlayer(saved.id, { name: name.value }));
      ghin.addEventListener("change", () => updateSavedPlayer(saved.id, { ghin: E.parseHandicapInput(ghin.value) }));
      tee.addEventListener("change", () => updateSavedPlayer(saved.id, { teeKey: tee.value }));
      group.addEventListener("change", () => savedPlayerGroupSelections.set(saved.id, group.value));
      row.querySelector(".add-saved-player").addEventListener("click", () => addSavedPlayerToRound(saved.id, group.value));
      row.querySelector(".delete-saved-player").addEventListener("click", () => deleteSavedPlayer(saved.id));
      list.append(row);
    });
  }

  async function createSavedPlayer(event) {
    event.preventDefault();
    const name = $("#savedPlayerName").value.trim();
    if (!name) return showToast("Enter a player name before saving.", "error");
    try {
      const body = await databaseRequest("/api/players", {
        method: "POST",
        body: JSON.stringify({ name, ghin: E.parseHandicapInput($("#savedPlayerGhin").value), teeKey: $("#savedPlayerTee").value })
      });
      savedPlayers = [...savedPlayers, body.player].sort((a, b) => a.name.localeCompare(b.name));
      $("#savedPlayerName").value = "";
      $("#savedPlayerGhin").value = "0.0";
      render();
      showToast(`${body.player.name} saved to the player database.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function updateSavedPlayer(id, patch) {
    if (!adminUnlocked || connectionMode !== "live" || isLocked()) return;
    try {
      const body = await databaseRequest(`/api/players/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) });
      savedPlayers = savedPlayers.map((player) => player.id === id ? body.player : player).sort((a, b) => a.name.localeCompare(b.name));
      const linkedPlayers = state.players.filter((player) => player.directoryId === id);
      for (const player of linkedPlayers) {
        await dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, directoryId: id, name: body.player.name, ghin: body.player.ghin, teeKey: body.player.teeKey } });
      }
      render();
      showToast(`${body.player.name}'s saved details were updated.`, "success");
    } catch (error) {
      render();
      showToast(error.message, "error");
    }
  }

  async function addSavedPlayerToRound(id, group) {
    const saved = savedPlayers.find((player) => player.id === id);
    if (!saved) return;
    if (state.players.some((player) => player.directoryId === id)) return showToast(`${saved.name} is already in this round.`, "error");
    if (state.players.length >= R.MAX_PLAYERS) return showValidation("Maximum of 30 players reached.");
    if (!R.GROUPS.includes(group) || groupPlayers(group).length >= R.MAX_GROUP_SIZE) return showValidation(`Group ${group} already has five players.`);
    const player = R.normalizePlayer({ id: makeId(), directoryId: saved.id, name: saved.name, ghin: saved.ghin, teeKey: saved.teeKey, group });
    await dispatch({ type: "ADD_PLAYER", payload: { player } });
    showToast(`${saved.name} added to Group ${group}.`, "success");
  }

  async function deleteSavedPlayer(id) {
    const saved = savedPlayers.find((player) => player.id === id);
    if (!saved || !window.confirm(`Delete ${saved.name} from the saved player database? Their current-round scores will remain.`)) return;
    try {
      await databaseRequest(`/api/players/${encodeURIComponent(id)}`, { method: "DELETE" });
      const linkedPlayers = state.players.filter((player) => player.directoryId === id);
      savedPlayers = savedPlayers.filter((player) => player.id !== id);
      savedPlayerGroupSelections.delete(id);
      for (const player of linkedPlayers) await dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, directoryId: "" } });
      render();
      showToast(`${saved.name} deleted from the saved player database.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
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
      const ghinInput = row.querySelector(".player-ghin"); ghinInput.value = displayIndex(player.ghin);
      const tee = row.querySelector(".player-tee"); tee.innerHTML = teeOptions(player.teeKey);
      const group = row.querySelector(".player-group"); group.innerHTML = groupOptions(player.group, player.id);
      row.querySelector(".playing-hcp strong").textContent = displayPlayingHandicap(hcp(player));
      name.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, name: event.target.value } }));
      ghinInput.addEventListener("change", (event) => dispatch({ type: "UPDATE_PLAYER", payload: { playerId: player.id, ghin: E.parseHandicapInput(event.target.value) } }));
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
    const notice = $("#scorerLinkNotice");
    notice.hidden = adminUnlocked && !scorerLinkLocked;
    if (scorerLinkLocked && !scorerLinkExpired()) notice.textContent = `This protected scorekeeper link is assigned to Group ${selectedGroup}.`;
    else if (scorerLinkLocked) notice.textContent = "This scoring link has expired. Ask the admin for the current round's group link.";
    else notice.textContent = "Unlock admin controls or open a protected group scorekeeper link to enter scores.";
    const holes = $("#holeSelect");
    if (!holes.options.length) holes.innerHTML = E.COURSE.holes.map((hole) => `<option value="${hole.number}">Hole ${hole.number}</option>`).join("");
    holes.value = selectedHole;
  }

  function renderHoleBanner(players) {
    const base = E.COURSE.holes[selectedHole - 1];
    const details = [...new Set(players.map((player) => { const hole = E.holesForPlayer(E.COURSE, player)[selectedHole - 1]; return `${teeOf(player).name}: ${hole.yards} yds · SI ${hole.strokeIndex}`; }))];
    const kpWinnerId = state.settings.kpWinners[String(selectedHole)];
    const kpWinner = state.players.find((player) => player.id === kpWinnerId);
    const kpClaimState = kpWinner ? E.kpClaimStatus(kpWinner, E.COURSE, state.settings, selectedHole - 1) : "none";
    const kpDetail = kpClaimState === "current" ? " · 1 tic" : kpClaimState === "failed" ? " · KP FAIL · 0 tics" : kpClaimState === "pending" ? " · score pending · 0 tics" : "";
    const kpStatus = KP_HOLES.includes(selectedHole) ? `<span class="kp-status">KP: ${kpWinner ? `${esc(nameOf(kpWinner, state.players.indexOf(kpWinner)))}${kpDetail}` : "Open"}</span>` : "";
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

  async function setScore(playerId, score) {
    if (!canScore()) return showToast(isLocked() ? "The round is finalized and locked." : scorerLinkExpired() ? "This scorekeeper link has expired. Ask the admin for a new link." : "A current scorekeeper link or admin access is required.", "error");
    const player = state.players.find((item) => item.id === playerId);
    const holeIndex = selectedHole - 1;
    const par = E.COURSE.holes[holeIndex].par;
    const wasComplete = groupPlayers().length > 0 && groupPlayers().every((item) => item.scores[holeIndex] !== "");
    const numeric = score === "" ? "" : Math.max(1, Math.min(20, Number(score) || 1));
    if (numeric !== "" && numeric !== player?.scores[holeIndex] && (numeric <= par - 3 || numeric >= par + 5)) {
      if (!window.confirm(`${nameOf(player, 0)}: confirm a score of ${numeric} on Hole ${selectedHole} (par ${par})?`)) return renderGroupScoring();
    }
    const isNewEagle = E.isEagle(numeric, par) && !E.isEagle(player?.scores[holeIndex], par);
    const isNewBirdie = E.isBirdie(numeric, par) && !E.isBirdie(player?.scores[holeIndex], par);
    if (isNewEagle) playEagleCelebration();
    else if (isNewBirdie) playBirdieTweets();
    setScoreSyncStatus(playerId, holeIndex, connectionMode === "live" ? "saving" : "pending");
    renderGroupScoring();
    const accepted = await dispatch({ type: "SET_SCORE", payload: { playerId, holeIndex, score: numeric } });
    setScoreSyncStatus(playerId, holeIndex, accepted ? (connectionMode === "live" ? "synced" : "pending") : "error");
    renderGroupScoring();
    const isComplete = groupPlayers().length > 0 && groupPlayers().every((item) => item.scores[holeIndex] !== "");
    if (accepted && !wasComplete && isComplete && preferences.autoAdvance && selectedHole < 18) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = setTimeout(() => {
        if (selectedHole === holeIndex + 1 && groupPlayers().length && groupPlayers().every((item) => item.scores[holeIndex] !== "")) moveToHole(selectedHole + 1, { skipMissingCheck: true });
      }, 700);
    }
  }

  function renderGroupScoring() {
    renderGroupSelectors();
    const players = groupPlayers();
    renderHoleBanner(players);
    $("#roundLockedNotice").hidden = !isLocked();
    const list = $("#groupScoreList");
    $("#exportScorecardJpegBtn").disabled = players.length === 0;
    $("#exportScorecardPdfBtn").disabled = players.length === 0;
    const canUndo = state.undoStack.some((entry) => entry.group === selectedGroup);
    $("#undoScoreBtn").disabled = !canScore() || !canUndo;
    const holeComplete = players.length > 0 && players.every((player) => player.scores[selectedHole - 1] !== "");
    const advanceButton = $("#advanceHoleBtn");
    advanceButton.hidden = !holeComplete || selectedHole >= 18;
    advanceButton.textContent = selectedHole < 18 ? `Continue to Hole ${selectedHole + 1}` : "Round complete";
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
      const kpClaimState = E.kpClaimStatus(player, E.COURSE, state.settings, index);
      const kpNote = kpClaimState === "failed"
        ? `<span class="prior-kp-note kp-fail-note">KP FAIL · ${hasKp ? "bogey or worse" : "supplanted"} · 0 tics</span>`
        : kpClaimState === "pending" ? '<span class="prior-kp-note">KP pending score · 0 tics</span>' : "";
      const hasSkin = E.skinResult(state.players, E.COURSE, state.settings, index).winnerId === player.id;
      const disabled = canScore() ? "" : "disabled";
      const syncState = scoreSyncStatus.get(scoreSyncKey(player.id, index));
      const syncLabel = { saving: "Saving…", pending: "Waiting to sync", synced: "Saved", error: "Sync problem" }[syncState] || "";
      return `<article class="group-score-card" data-player-id="${player.id}">
        <div class="score-player"><strong>${esc(nameOf(player, state.players.indexOf(player)))}</strong><span>${esc(teeOf(player).name)} · Hcp ${displayPlayingHandicap(hcp(player))} · ${strokes > 0 ? `gets ${strokes}` : strokes < 0 ? `gives ${Math.abs(strokes)}` : "no stroke"}</span></div>
        <div class="score-entry-wrap"><div class="score-stepper"><button type="button" data-delta="-1" ${disabled} aria-label="Decrease score">−</button><input type="number" min="1" max="20" inputmode="numeric" value="${gross}" ${disabled} aria-label="${esc(nameOf(player, 0))}'s gross score"><button type="button" data-delta="1" ${disabled} aria-label="Increase score">+</button></div>${syncLabel ? `<span class="score-sync score-sync--${syncState}" role="status">${syncLabel}</span>` : ""}</div>
        <div class="net-box"><span>Net</span><strong>${net ?? "—"}</strong></div>
        <div class="card-tics">${achievement ? `<span class="auto-tic">${achievement} ✓</span>` : ""}${hasSkin ? '<span class="auto-tic">Net skin ✓</span>' : ""}${canMarkSandy ? `<label class="tic-toggle"><input data-kind="sandy" type="checkbox" ${player.sandies[index] ? "checked" : ""} ${disabled}>Sand save</label>` : ""}${isKpHole ? `<label class="tic-toggle kp-toggle"><input data-kind="kp" type="checkbox" ${hasKp ? "checked" : ""} ${disabled}>KP</label>` : ""}${kpNote}${sandyPar ? '<span class="auto-tic">Sandy par ✓</span>' : ""}${sandyBirdie ? '<span class="auto-tic">Sandy birdie ✓</span>' : ""}</div>
      </article>`;
    }).join("");
    list.querySelectorAll(".group-score-card").forEach((card) => {
      const player = state.players.find((item) => item.id === card.dataset.playerId);
      const input = card.querySelector('input[type="number"]');
      input?.addEventListener("change", (event) => setScore(player.id, event.target.value));
      card.querySelectorAll("[data-delta]").forEach((button) => button.addEventListener("click", () => setScore(player.id, E.steppedScore(player.scores[selectedHole - 1], E.COURSE.holes[selectedHole - 1].par, Number(button.dataset.delta)))));
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

  function strokesReceived(player, holeIndex) {
    const hole = E.holesForPlayer(E.COURSE, player)[holeIndex];
    return Math.max(0, E.strokesForHole(hcp(player), hole.strokeIndex));
  }

  function handicapDots(player, holeIndex) {
    const strokes = strokesReceived(player, holeIndex);
    if (!strokes) return "";
    return `<span class="handicap-dots" aria-label="${strokes} handicap stroke${strokes === 1 ? "" : "s"} received"><span aria-hidden="true">${"●".repeat(strokes)}</span></span>`;
  }

  function scoreMarkClasses(score, holeIndex) {
    const mark = E.scoreMark(score, E.COURSE.holes[holeIndex].par);
    return mark && mark !== "par" ? ` score-mark score-mark--${mark}` : "";
  }

  function kpScorecardMark(player, holeIndex) {
    const status = E.kpClaimStatus(player, E.COURSE, state.settings, holeIndex);
    if (status === "none") return "";
    if (status === "failed") return '<span class="kp-scorecard-fail" aria-label="KP FAIL; 0 tics" title="KP FAIL; 0 tics">KP FAIL</span>';
    const label = status === "current" ? "Current qualifying KP; 1 tic" : "Current KP; score pending; 0 tics";
    return `<span class="kp-scorecard-mark ${status === "current" ? "is-current" : "is-pending"}" aria-label="${label}" title="${label}">KP</span>`;
  }

  function renderGroupScorecard(players) {
    $("#groupScorecardHead").innerHTML = `<tr><th>Player</th>${E.COURSE.holes.map((hole) => `<th>${hole.number}</th>`).join("")}<th>Out</th><th>In</th><th class="running-total-heading">Running total</th><th>Net</th></tr>`;
    $("#groupScorecardBody").innerHTML = players.map((player) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const completedHoles = player.scores.filter((score) => Number.isFinite(Number(score)) && Number(score) >= 1).length;
      const runningTotal = completedHoles ? totals.total.gross : "—";
      const cells = player.scores.map((score, index) => `<td><button type="button" class="score-cell ${index + 1 === selectedHole ? "active-hole" : ""}" data-card-hole="${index + 1}"><span class="score-cell-value${scoreMarkClasses(score, index)}">${score || "—"}</span>${handicapDots(player, index)}${kpScorecardMark(player, index)}</button></td>`).join("");
      return `<tr><td>${esc(nameOf(player, state.players.indexOf(player)))}</td>${cells}<td>${complete(totals.front.gross, totals.front.completed)}</td><td>${complete(totals.back.gross, totals.back.completed)}</td><td class="running-total" aria-label="Running gross total after ${completedHoles} hole${completedHoles === 1 ? "" : "s"}">${runningTotal}</td><td>${complete(totals.total.net, totals.total.completed)}</td></tr>`;
    }).join("");
    document.querySelectorAll("[data-card-hole]").forEach((button) => button.addEventListener("click", () => { selectedHole = Number(button.dataset.cardHole); renderGroupScoring(); }));
  }

  function renderKPs() {
    const canAdminEdit = adminUnlocked && !isLocked();
    $("#kpPanel").innerHTML = KP_HOLES.map((hole) => {
      const winnerId = state.settings.kpWinners[String(hole)];
      const player = state.players.find((item) => item.id === winnerId);
      const status = player ? E.kpClaimStatus(player, E.COURSE, state.settings, hole - 1) : "none";
      const statusText = status === "current" ? "Qualifying KP · 1 tic" : status === "failed" ? "KP FAIL · 0 tics" : status === "pending" ? "Score pending · 0 tics" : "Open";
      return `<div class="kp-card"><label>Hole ${hole} KP<select data-kp-hole="${hole}" ${canAdminEdit ? "" : "disabled"}><option value="">No winner</option>${state.players.map((item, index) => `<option value="${item.id}" ${winnerId === item.id ? "selected" : ""}>${esc(nameOf(item, index))} · ${item.group}</option>`).join("")}</select></label><span class="kp-card-status ${status === "failed" ? "is-failed" : ""}">${statusText}</span></div>`;
    }).join("");
    document.querySelectorAll("[data-kp-hole]").forEach((select) => select.addEventListener("change", (event) => dispatch({ type: "SET_KP", payload: { hole: Number(event.target.dataset.kpHole), playerId: event.target.value } }, { admin: true })));
  }

  function standingCompare(a, b) {
    const aThru = a.sortValues.thru;
    const bThru = b.sortValues.thru;
    if (a.totals.total.completed !== b.totals.total.completed) return a.totals.total.completed ? -1 : 1;
    if (a.totals.total.completed) return a.totals.total.net - b.totals.total.net || a.sortValues.player.localeCompare(b.sortValues.player);
    return bThru - aThru || a.totals.total.net - b.totals.total.net || a.sortValues.player.localeCompare(b.sortValues.player);
  }

  function leaderboardItems() {
    return state.players.map((player, index) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const tics = E.ticSummary(player, state.players, E.COURSE, state.settings);
      const ledger = E.pointsLedger(player, state.players, E.COURSE, state.settings);
      return {
        player,
        index,
        totals,
        tics,
        ledger,
        sortValues: {
          player: nameOf(player, index),
          group: player.group,
          thru: player.scores.filter(Boolean).length,
          handicap: hcp(player),
          gross: totals.total.completed ? totals.total.gross : null,
          net: totals.total.completed ? totals.total.net : null,
          birdies: tics.birdies,
          eagles: tics.eagles,
          skins: tics.skins,
          front: tics.front,
          back: tics.back,
          totalNet: tics.totalNet,
          sandyPars: tics.sandyPars,
          sandyBirdies: tics.sandyBirdies,
          kps: tics.kps,
          kpFails: tics.kpFails,
          positive: ledger.positive,
          negative: ledger.negative,
          netPoints: ledger.net
        }
      };
    });
  }

  function rankedPlayers() {
    const items = leaderboardItems();
    if (leaderboardSort.key === "standing") return items.sort(standingCompare);
    return L.sortItems(items, leaderboardSort.key, leaderboardSort.direction, standingCompare);
  }

  function renderLeaderboardHeaders() {
    $("#leaderboardHead").innerHTML = `<tr>${LEADERBOARD_COLUMNS.map((column) => {
      const active = leaderboardSort.key === column.key;
      const ariaSort = active ? ` aria-sort="${leaderboardSort.direction === "asc" ? "ascending" : "descending"}"` : "";
      const icon = active ? (leaderboardSort.direction === "asc" ? "▲" : "▼") : "↕";
      return `<th${ariaSort}><button class="leaderboard-sort-button" type="button" data-leaderboard-sort="${column.key}" title="Sort by ${esc(column.label)}">${esc(column.label)}<span class="sort-icon" aria-hidden="true">${icon}</span></button></th>`;
    }).join("")}</tr>`;
    document.querySelectorAll("[data-leaderboard-sort]").forEach((button) => button.addEventListener("click", () => {
      const column = LEADERBOARD_COLUMNS.find((item) => item.key === button.dataset.leaderboardSort);
      leaderboardSort = leaderboardSort.key === column.key
        ? { key: column.key, direction: leaderboardSort.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: column.firstDirection };
      renderLeaderboard();
    }));
    const activeColumn = LEADERBOARD_COLUMNS.find((column) => column.key === leaderboardSort.key);
    $("#resetLeaderboardSortBtn").hidden = !activeColumn;
    $("#leaderboardSortStatus").textContent = activeColumn
      ? `Sorted by ${activeColumn.label}, ${activeColumn.text ? (leaderboardSort.direction === "asc" ? "A to Z" : "Z to A") : (leaderboardSort.direction === "asc" ? "lowest to highest" : "highest to lowest")}.`
      : "Live standings order. Select a column heading to sort.";
  }

  function renderLeaderboard() {
    renderKPs();
    renderLeaderboardHeaders();
    const players = rankedPlayers();
    const standingLeaderId = [...players].sort(standingCompare)[0]?.player.id;
    $("#leaderboardBody").innerHTML = players.map((item) => {
      const tics = item.tics;
      const ledger = item.ledger;
      const thru = item.sortValues.thru;
      const netClass = ledger.net > 0 ? "is-positive" : ledger.net < 0 ? "is-negative" : "";
      const netText = `${ledger.net > 0 ? "+" : ""}${ledger.net.toFixed(1)}`;
      return `<tr class="${item.player.id === standingLeaderId && item.totals.total.completed ? "leader-row-leading" : ""}"><td>${esc(nameOf(item.player, item.index))}</td><td>${item.player.group}</td><td>${thru === 18 ? "F" : thru}</td><td>${displayPlayingHandicap(hcp(item.player))}</td><td>${complete(item.totals.total.gross, item.totals.total.completed)}</td><td>${complete(item.totals.total.net, item.totals.total.completed)}</td><td>${tics.birdies}</td><td>${tics.eagles}</td><td>${tics.skins}</td><td>${tics.front}</td><td>${tics.back}</td><td>${tics.totalNet}</td><td>${tics.sandyPars}</td><td>${tics.sandyBirdies}</td><td>${tics.kps}</td><td class="kp-fails-count">${tics.kpFails}</td><td class="points-positive">${ledger.positive ? `+${ledger.positive.toFixed(1)}` : "0.0"}</td><td class="points-negative">${ledger.negative.toFixed(1)}</td><td class="points-net ${netClass}">${netText}</td></tr>`;
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
    url.searchParams.set("round", state.roundId);
    if (shareTokens[group]) url.searchParams.set("token", shareTokens[group]);
    return url.href;
  }

  function spectatorUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("view", "leaderboard");
    url.searchParams.set("spectator", "1");
    return url.href;
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); }
    catch (_) {
      const input = document.createElement("textarea");
      input.value = value; document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
    }
  }

  function openQr(title, url) {
    $("#qrTitle").textContent = title;
    $("#qrImage").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&format=png&data=${encodeURIComponent(url)}`;
    $("#qrLinkText").textContent = url;
    $("#qrDialog").showModal();
  }

  function renderSpectatorSharing() {
    const url = spectatorUrl();
    $("#spectatorShareCard").innerHTML = `<article class="group-share-card"><div><strong>Live leaderboard</strong><span>View-only access · updates automatically</span></div><div class="share-actions"><button class="button button-quiet" type="button" data-viewer-share="copy">Copy link</button><button class="button button-quiet" type="button" data-viewer-share="share">Share</button><button class="button button-primary" type="button" data-viewer-share="qr">QR code</button></div></article>`;
    document.querySelectorAll("[data-viewer-share]").forEach((button) => button.addEventListener("click", async () => {
      if (button.dataset.viewerShare === "copy") { await copyText(url); showToast("Read-only leaderboard link copied.", "success"); }
      if (button.dataset.viewerShare === "share") {
        if (navigator.share) await navigator.share({ title: "Berry Creek live leaderboard", text: "Follow the Berry Creek DH Game live leaderboard", url }).catch(() => {});
        else { await copyText(url); showToast("Read-only leaderboard link copied.", "success"); }
      }
      if (button.dataset.viewerShare === "qr") openQr("Read-only leaderboard", url);
    }));
  }

  function renderGroupSharing(errorMessage = "") {
    if (!adminUnlocked) {
      $("#groupShareGrid").innerHTML = '<div class="empty-state">Unlock admin controls to create protected group scoring links.</div>';
      return;
    }
    if (errorMessage || !R.GROUPS.every((group) => shareTokens[group])) {
      $("#groupShareGrid").innerHTML = `<div class="empty-state">${esc(errorMessage || "Protected scoring links are loading…")}</div>`;
      return;
    }
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
        openQr(`Group ${group} scoring link`, url);
      }
    }));
  }

  function renderSavedRounds(errorMessage = "") {
    const status = $("#savedRoundsStatus");
    const list = $("#savedRoundsList");
    if (!status || !list) return;
    if (!adminUnlocked) {
      status.textContent = "Unlock admin controls to save or view historical rounds.";
      list.replaceChildren();
      return;
    }
    if (connectionMode !== "live") {
      status.textContent = "Saved rounds require a live connection.";
      list.replaceChildren();
      return;
    }
    if (errorMessage) {
      status.textContent = errorMessage;
      list.innerHTML = '<div class="empty-state">Saved rounds could not be loaded.</div>';
      return;
    }
    status.textContent = `${savedRounds.length} saved round${savedRounds.length === 1 ? "" : "s"}`;
    list.innerHTML = savedRounds.length ? savedRounds.map((round) => {
      const savedAt = Number.isNaN(Date.parse(round.savedAt)) ? round.savedAt : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(round.savedAt));
      return `<article class="saved-round-card"><div><strong>${esc(round.roundName)}</strong><span>${esc(round.date)} · ${round.playerCount} player${round.playerCount === 1 ? "" : "s"} · ${round.completed ? "Complete" : "In progress when saved"}</span><span>Saved ${esc(savedAt)}</span></div><div class="saved-round-actions"><button class="button button-primary" type="button" data-round-action="view" data-round-id="${round.id}">View results</button><button class="button button-quiet" type="button" data-round-action="roster" data-round-id="${round.id}">Reuse roster</button><button class="button button-quiet" type="button" data-round-action="download" data-round-id="${round.id}">Download</button><button class="button button-quiet" type="button" data-round-action="delete" data-round-id="${round.id}">Delete</button></div></article>`;
    }).join("") : '<div class="empty-state">No rounds have been saved yet.</div>';
    document.querySelectorAll("[data-round-action]").forEach((button) => button.addEventListener("click", () => handleSavedRoundAction(button.dataset.roundAction, button.dataset.roundId)));
  }

  async function saveCurrentRound() {
    if (!state.players.length) return showToast("Add at least one player before saving the round.", "error");
    try {
      const body = await databaseRequest("/api/rounds", { method: "POST", body: JSON.stringify({}) });
      savedRounds = [body.round, ...savedRounds];
      renderSavedRounds();
      showToast(`${body.round.roundName} saved to round history.`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function archivedPlayerRows(roundState) {
    return roundState.players.map((player, index) => {
      const tee = E.teeForPlayer(E.COURSE, player);
      const handicap = E.playingHandicap(player.ghin, roundState.settings, tee);
      const totals = E.playerTotals(player, E.COURSE, roundState.settings);
      const tics = E.ticSummary(player, roundState.players, E.COURSE, roundState.settings);
      const ledger = E.pointsLedger(player, roundState.players, E.COURSE, roundState.settings);
      const netClass = ledger.net > 0 ? "is-positive" : ledger.net < 0 ? "is-negative" : "";
      return `<tr><td>${esc(player.name.trim() || `Player ${index + 1}`)}</td><td>${player.group}</td><td>${complete(totals.total.gross, totals.total.completed)}</td><td>${complete(totals.total.net, totals.total.completed)}</td><td>${tics.kps}</td><td class="kp-fails-count">${tics.kpFails}</td><td class="points-positive">${ledger.positive ? `+${ledger.positive.toFixed(1)}` : "0.0"}</td><td class="points-negative">${ledger.negative.toFixed(1)}</td><td class="points-net ${netClass}">${ledger.net > 0 ? "+" : ""}${ledger.net.toFixed(1)}</td></tr>`;
    }).join("");
  }

  async function fetchSavedRound(id) {
    const body = await databaseRequest(`/api/rounds/${encodeURIComponent(id)}`, { cache: "no-store" });
    return body.round;
  }

  async function handleSavedRoundAction(action, id) {
    try {
      if (action === "delete") {
        const item = savedRounds.find((round) => round.id === id);
        if (!item || !window.confirm(`Delete the saved copy of ${item.roundName}?`)) return;
        await databaseRequest(`/api/rounds/${encodeURIComponent(id)}`, { method: "DELETE" });
        savedRounds = savedRounds.filter((round) => round.id !== id);
        renderSavedRounds();
        return showToast("Saved round deleted.", "success");
      }
      const round = await fetchSavedRound(id);
      if (action === "download") {
        return downloadBlob(JSON.stringify(round.state, null, 2), "application/json", `berry-creek-${round.date}-saved.json`);
      }
      if (action === "roster") {
        pendingReuseRound = round;
        const sourceState = R.normalizeState(round.state);
        $("#reuseRosterText").textContent = `${sourceState.players.length} players and their Group A–F assignments will be copied into a new round dated today. Scores, KPs, sand saves, tics, and the locked status will not be copied.`;
        const dialog = $("#reuseRosterDialog");
        dialog.returnValue = "cancel";
        dialog.showModal();
        return;
      }
      activeSavedRound = round;
      const roundState = R.normalizeState(round.state);
      $("#savedRoundDialogTitle").textContent = round.roundName;
      $("#savedRoundDialogMeta").textContent = `${round.date} · ${round.playerCount} player${round.playerCount === 1 ? "" : "s"} · ${round.completed ? "Complete round" : "Saved before every score was entered"}`;
      $("#savedRoundDialogBody").innerHTML = archivedPlayerRows(roundState);
      const groups = R.GROUPS.filter((group) => roundState.players.some((player) => player.group === group));
      $("#savedRoundGroupSelect").innerHTML = groups.map((group) => `<option value="${group}">Group ${group}</option>`).join("");
      $("#exportSavedRoundJpegBtn").disabled = groups.length === 0;
      $("#exportSavedRoundPdfBtn").disabled = groups.length === 0;
      $("#exportAllSavedRoundJpegsBtn").disabled = groups.length === 0;
      $("#exportAllSavedRoundPdfBtn").disabled = groups.length === 0;
      $("#savedRoundDialog").showModal();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function renderAudit() {
    const log = [...state.auditLog].reverse();
    $("#auditList").innerHTML = log.length ? log.map((entry) => {
      const when = Number.isNaN(Date.parse(entry.at)) ? entry.at : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at));
      return `<article class="audit-entry"><div><strong>${esc(entry.detail)}</strong><span>${esc(entry.actor)}</span></div><time>${esc(when)}</time></article>`;
    }).join("") : '<div class="empty-state">No changes recorded yet.</div>';
  }

  function renderGroupProgress() {
    const grid = $("#groupProgressGrid");
    if (!grid) return;
    grid.innerHTML = R.GROUPS.map((group) => {
      const players = groupPlayers(group);
      const completedHoles = players.length ? E.COURSE.holes.filter((_, holeIndex) => players.every((player) => player.scores[holeIndex] !== "")).length : 0;
      const currentIndex = players.length ? E.COURSE.holes.findIndex((_, holeIndex) => players.some((player) => player.scores[holeIndex] === "")) : -1;
      const missing = currentIndex >= 0 ? players.filter((player) => player.scores[currentIndex] === "").length : 0;
      const activity = state.groupActivity[group];
      const lastUpdate = activity?.at && !Number.isNaN(Date.parse(activity.at))
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(activity.at))
        : "No scoring activity";
      const connected = Number(groupPresence[group] || 0);
      const position = !players.length ? "No players" : completedHoles === 18 ? "Complete" : `Hole ${currentIndex + 1} · ${missing} missing`;
      return `<article class="group-progress-card ${completedHoles === 18 ? "is-complete" : ""}"><div class="group-progress-heading"><strong>Group ${group}</strong><span class="presence-label ${connected ? "is-connected" : ""}"><span class="status-dot"></span>${connected ? `${connected} connected` : "Not connected"}</span></div><div class="group-progress-meta"><span>${players.length}/5 players</span><span>${position}</span></div><div class="progress-track" aria-label="${completedHoles} of 18 holes complete"><span style="width:${(completedHoles / 18) * 100}%"></span></div><small>${completedHoles}/18 holes · ${esc(lastUpdate)}</small></article>`;
    }).join("");
  }

  function finalizationChecklistItems() {
    const items = [];
    if (!state.players.length) items.push({ ok: false, text: "No players are assigned to the round." });
    else items.push({ ok: true, text: `${state.players.length} players are assigned.` });
    R.GROUPS.forEach((group) => {
      const players = groupPlayers(group);
      if (!players.length) return;
      const missing = players.reduce((total, player) => total + player.scores.filter((score) => score === "").length, 0);
      items.push({ ok: missing === 0, text: missing ? `Group ${group} has ${missing} missing score${missing === 1 ? "" : "s"}.` : `Group ${group} has all scores entered.` });
    });
    const missingKps = KP_HOLES.filter((hole) => !state.settings.kpWinners[String(hole)]);
    items.push({ ok: missingKps.length === 0, text: missingKps.length ? `KP${missingKps.length === 1 ? " is" : "s are"} unassigned on Hole${missingKps.length === 1 ? "" : "s"} ${missingKps.join(", ")}.` : "All KPs are assigned." });
    const unusual = state.players.reduce((total, player) => total + player.scores.filter((score, index) => score !== "" && (Number(score) <= E.COURSE.holes[index].par - 3 || Number(score) >= E.COURSE.holes[index].par + 5)).length, 0);
    items.push({ ok: unusual === 0, text: unusual ? `${unusual} unusual score${unusual === 1 ? " needs" : "s need"} a final review.` : "No unusual scores need review." });
    const names = state.players.map((player) => player.name.trim().toLowerCase()).filter(Boolean);
    const namesReady = names.length === state.players.length && new Set(names).size === names.length;
    items.push({ ok: namesReady, text: namesReady ? "All player names are complete and unique." : "One or more player names are missing or duplicated." });
    return items;
  }

  function openFinalizeDialog() {
    const items = finalizationChecklistItems();
    $("#finalizeChecklist").innerHTML = items.map((item) => `<li class="${item.ok ? "check-ok" : "check-warning"}"><span aria-hidden="true">${item.ok ? "✓" : "!"}</span>${esc(item.text)}</li>`).join("");
    const dialog = $("#finalizeDialog");
    dialog.returnValue = "cancel";
    dialog.showModal();
  }

  function renderTournament() {
    const locked = isLocked();
    $("#roundStatusText").textContent = locked ? "The round is finalized. Scorecards and results remain available to view." : "The round is open for live scoring.";
    $("#toggleRoundLockBtn").textContent = locked ? "Unlock round" : "Finalize and lock round";
    $("#toggleRoundLockBtn").classList.toggle("button-danger", !locked);
    $("#toggleRoundLockBtn").classList.toggle("button-primary", locked);
    $("#soundToggle").checked = preferences.sound;
    $("#autoAdvanceToggle").checked = preferences.autoAdvance;
    $("#displayMode").value = preferences.display;
    renderGroupProgress();
    renderSpectatorSharing();
    renderGroupSharing();
    renderSavedRounds();
    renderAudit();
  }

  function renderAdminState() {
    $("#adminBtn").textContent = adminUnlocked ? "Lock admin controls" : "Admin unlock";
    $("#setupLockedNotice").hidden = adminUnlocked;
    document.querySelectorAll(".admin-control").forEach((control) => {
      const isRoundLockControl = control.id === "toggleRoundLockBtn";
      const isSaveRoundControl = control.id === "saveRoundBtn";
      const isNewRoundControl = control.id === "startNewRoundBtn";
      const atPlayerLimit = control.id === "addPlayerBtn" && state.players.length >= R.MAX_PLAYERS;
      const noRoundToSave = isSaveRoundControl && !state.players.length;
      control.disabled = !adminUnlocked || (isLocked() && !isRoundLockControl && !isSaveRoundControl && !isNewRoundControl) || atPlayerLimit || noRoundToSave;
    });
    $("#lockStatus").hidden = !isLocked();
    $("#spectatorStatus").hidden = !spectatorMode;
    document.body.classList.toggle("round-locked", isLocked());
    document.body.classList.toggle("spectator-mode", spectatorMode);
  }

  function render() {
    $("#roundName").value = state.roundName;
    $("#roundDate").value = state.date;
    $("#allowance").value = state.settings.allowance;
    const savedPlayerTee = $("#savedPlayerTee");
    const selectedSavedTee = savedPlayerTee.value || E.COURSE.defaultTee;
    savedPlayerTee.innerHTML = teeOptions(selectedSavedTee);
    renderPlayers();
    renderSavedPlayers();
    renderGroupScoring();
    renderLeaderboard();
    renderTournament();
    renderAdminState();
  }

  function switchView(name) {
    if (spectatorMode) name = "leaderboard";
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

  function moveToHole(nextHole, options = {}) {
    clearTimeout(autoAdvanceTimer);
    const missing = groupPlayers().filter((player) => !player.scores[selectedHole - 1]);
    if (!options.skipMissingCheck && missing.length && nextHole !== selectedHole && !window.confirm(`Hole ${selectedHole} still has ${missing.length} missing score${missing.length === 1 ? "" : "s"}. Leave this hole anyway?`)) return;
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
        if (!response.ok) throw new Error("Incorrect admin PIN");
      } else if (candidate !== "2468") throw new Error("Connect to the server to verify a custom PIN");
      adminPin = candidate;
      adminUnlocked = true;
      sessionStorage.setItem(ADMIN_PIN_KEY, candidate);
      $("#adminDialog").close();
      render();
      await loadAdminData();
      showToast("Admin controls unlocked.", "success");
    } catch (error) {
      $("#adminError").textContent = error.message;
      $("#adminError").hidden = false;
    }
  }

  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
  function downloadBlob(contents, type, filename) {
    const link = document.createElement("a");
    const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
  }

  async function exportGroupScorecardJpeg() {
    const players = groupPlayers();
    if (!players.length) return showToast(`No players are assigned to Group ${selectedGroup}.`, "error");
    const button = $("#exportScorecardJpegBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Creating JPEG…";
    try {
      const jpeg = await X.createScorecardJpeg({
        course: E.COURSE,
        settings: state.settings,
        players,
        group: selectedGroup,
        roundName: state.roundName,
        date: state.date,
        scoring: E,
        logoUrl: "berry-creek-logo.jpeg"
      });
      downloadBlob(jpeg, "image/jpeg", `berry-creek-group-${selectedGroup.toLowerCase()}-${state.date || "scorecard"}.jpg`);
      showToast(`Group ${selectedGroup} scorecard exported as a JPEG.`, "success");
    } catch (error) {
      showToast(error.message || "The scorecard JPEG could not be created.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = groupPlayers().length === 0;
    }
  }

  async function exportGroupScorecardPdf() {
    const players = groupPlayers();
    if (!players.length) return showToast(`No players are assigned to Group ${selectedGroup}.`, "error");
    const button = $("#exportScorecardPdfBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Creating PDF…";
    try {
      const jpeg = await X.createScorecardJpeg({
        course: E.COURSE,
        settings: state.settings,
        players,
        group: selectedGroup,
        roundName: state.roundName,
        date: state.date,
        scoring: E,
        logoUrl: "berry-creek-logo.jpeg"
      });
      const pdf = await X.createScorecardPdf(jpeg);
      downloadBlob(pdf, "application/pdf", `berry-creek-group-${selectedGroup.toLowerCase()}-${state.date || "scorecard"}.pdf`);
      showToast(`Group ${selectedGroup} scorecard exported as a PDF.`, "success");
    } catch (error) {
      showToast(error.message || "The scorecard PDF could not be created.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = groupPlayers().length === 0;
    }
  }

  function safeFilePart(value) {
    return String(value || "scorecard").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scorecard";
  }

  function savedRoundExportOptions(roundState, group) {
    return {
      course: E.COURSE,
      settings: roundState.settings,
      players: roundState.players.filter((player) => player.group === group),
      group,
      roundName: roundState.roundName,
      date: roundState.date,
      scoring: E,
      logoUrl: "berry-creek-logo.jpeg"
    };
  }

  async function exportSavedRoundJpeg() {
    if (!activeSavedRound) return;
    const roundState = R.normalizeState(activeSavedRound.state);
    const group = $("#savedRoundGroupSelect").value;
    const button = $("#exportSavedRoundJpegBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Creating JPEG…";
    try {
      const jpeg = await X.createScorecardJpeg(savedRoundExportOptions(roundState, group));
      downloadBlob(jpeg, "image/jpeg", `${safeFilePart(roundState.roundName)}-group-${group.toLowerCase()}.jpg`);
      showToast(`Saved Group ${group} scorecard exported.`, "success");
    } catch (error) {
      showToast(error.message || "The saved scorecard could not be exported.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = !activeSavedRound;
    }
  }

  async function exportSavedRoundPdf() {
    if (!activeSavedRound) return;
    const roundState = R.normalizeState(activeSavedRound.state);
    const group = $("#savedRoundGroupSelect").value;
    const button = $("#exportSavedRoundPdfBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Creating PDF…";
    try {
      const jpeg = await X.createScorecardJpeg(savedRoundExportOptions(roundState, group));
      const pdf = await X.createScorecardPdf(jpeg);
      downloadBlob(pdf, "application/pdf", `${safeFilePart(roundState.roundName)}-group-${group.toLowerCase()}.pdf`);
      showToast(`Saved Group ${group} scorecard exported as a PDF.`, "success");
    } catch (error) {
      showToast(error.message || "The saved scorecard PDF could not be exported.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = !activeSavedRound;
    }
  }

  async function exportAllSavedRoundJpegs() {
    if (!activeSavedRound) return;
    const roundState = R.normalizeState(activeSavedRound.state);
    const groups = R.GROUPS.filter((group) => roundState.players.some((player) => player.group === group));
    if (!groups.length) return showToast("This saved round has no group scorecards to export.", "error");
    const button = $("#exportAllSavedRoundJpegsBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    try {
      const files = [];
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        button.textContent = `Creating ${index + 1} of ${groups.length}…`;
        const blob = await X.createScorecardJpeg(savedRoundExportOptions(roundState, group));
        files.push({ name: `${safeFilePart(roundState.roundName)}-group-${group.toLowerCase()}.jpg`, blob });
      }
      const archive = await X.createZip(files);
      downloadBlob(archive, "application/zip", `${safeFilePart(roundState.roundName)}-scorecards.zip`);
      showToast(`${groups.length} saved group scorecards exported together.`, "success");
    } catch (error) {
      showToast(error.message || "The saved scorecards could not be exported.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = !activeSavedRound;
    }
  }

  async function exportAllSavedRoundPdf() {
    if (!activeSavedRound) return;
    const roundState = R.normalizeState(activeSavedRound.state);
    const groups = R.GROUPS.filter((group) => roundState.players.some((player) => player.group === group));
    if (!groups.length) return showToast("This saved round has no group scorecards to export.", "error");
    const button = $("#exportAllSavedRoundPdfBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    try {
      const pages = [];
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        button.textContent = `Creating ${index + 1} of ${groups.length}…`;
        pages.push(await X.createScorecardJpeg(savedRoundExportOptions(roundState, group)));
      }
      const pdf = await X.createScorecardPdf(pages);
      downloadBlob(pdf, "application/pdf", `${safeFilePart(roundState.roundName)}-all-scorecards.pdf`);
      showToast(`${groups.length} saved group scorecards exported as one PDF.`, "success");
    } catch (error) {
      showToast(error.message || "The saved scorecards PDF could not be exported.", "error");
    } finally {
      button.textContent = originalLabel;
      button.disabled = !activeSavedRound;
    }
  }

  async function startFromSavedRoster() {
    if (!pendingReuseRound) return;
    const source = R.normalizeState(pendingReuseRound.state);
    const nextState = R.defaultState();
    nextState.roundName = source.roundName || "Berry Creek Round";
    nextState.date = new Date().toISOString().slice(0, 10);
    nextState.settings.allowance = source.settings.allowance;
    nextState.players = source.players.map((player) => {
      const saved = player.directoryId ? savedPlayers.find((item) => item.id === player.directoryId) : null;
      return R.normalizePlayer({
        id: makeId(),
        directoryId: saved?.id || player.directoryId,
        name: saved?.name || player.name,
        ghin: saved?.ghin ?? player.ghin,
        teeKey: saved?.teeKey || player.teeKey,
        group: player.group
      });
    });
    if (!await dispatch({ type: "START_FROM_SAVED", payload: { state: nextState } })) return;
    pendingReuseRound = null;
    selectedHole = 1;
    selectedGroup = "A";
    shareTokens = {};
    groupPresence = {};
    savedPlayerGroupSelections.clear();
    scoreSyncStatus.clear();
    await refreshState().catch(() => {});
    await loadShareTokens();
    switchView("setup");
    showToast("New round created from the saved roster. Current saved-player details were used where available.", "success");
  }

  function downloadCsv() {
    const headers = ["Player", "Group", "GHIN Index", "Tee", "Playing Handicap", ...E.COURSE.holes.map((hole) => `Hole ${hole.number}`), "Gross", "Net", "Birdies", "Eagles or Better", "Skins", "Front Net Tic", "Back Net Tic", "Total Net Tic", "Sandy Pars", "Sandy Birdies", "KP Tic Holes", "KP Fail Holes", "KP Marked Holes", "Raw Tics", "Weighted Tics", "Achievement Points", "Points Positive", "Points Negative", "Net Points"];
    const rows = state.players.map((player, index) => {
      const totals = E.playerTotals(player, E.COURSE, state.settings);
      const tics = E.ticSummary(player, state.players, E.COURSE, state.settings);
      const ledger = E.pointsLedger(player, state.players, E.COURSE, state.settings);
      const kpHoles = KP_HOLES.filter((hole) => E.kpClaimStatus(player, E.COURSE, state.settings, hole - 1) === "current").join("; ");
      const kpFailHoles = KP_HOLES.filter((hole) => E.kpClaimStatus(player, E.COURSE, state.settings, hole - 1) === "failed").join("; ");
      const kpMarkedHoles = KP_HOLES.filter((hole) => (state.settings.kpClaims[String(hole)] || []).includes(player.id)).join("; ");
      return [nameOf(player, index), player.group, displayIndex(player.ghin), teeOf(player).name, displayPlayingHandicap(hcp(player)), ...player.scores, totals.total.completed ? totals.total.gross : "", totals.total.completed ? totals.total.net : "", tics.birdies, tics.eagles, tics.skins, tics.front, tics.back, tics.totalNet, tics.sandyPars, tics.sandyBirdies, kpHoles, kpFailHoles, kpMarkedHoles, tics.total, tics.weightedTics, tics.pointsEarned.toFixed(1), ledger.positive.toFixed(1), ledger.negative.toFixed(1), ledger.net.toFixed(1)].map(csvCell).join(",");
    });
    downloadBlob([headers.map(csvCell).join(","), ...rows].join("\r\n"), "text/csv;charset=utf-8", `berry-creek-results-${state.date}.csv`);
  }

  function preparePrintReport() {
    const kpRows = KP_HOLES.map((hole) => {
      const player = state.players.find((item) => item.id === state.settings.kpWinners[String(hole)]);
      const status = player ? E.kpClaimStatus(player, E.COURSE, state.settings, hole - 1) : "none";
      const detail = status === "current" ? " · 1 tic" : status === "failed" ? " · KP FAIL · 0 tics" : status === "pending" ? " · score pending · 0 tics" : "";
      return `<tr><td>Hole ${hole}</td><td>${player ? `${esc(nameOf(player, state.players.indexOf(player)))}${detail}` : "—"}</td></tr>`;
    }).join("");
    const skinRows = E.COURSE.holes.map((hole, index) => {
      const result = E.skinResult(state.players, E.COURSE, state.settings, index);
      const player = state.players.find((item) => item.id === result.winnerId);
      const resultText = result.status === "awarded" ? esc(nameOf(player, state.players.indexOf(player))) : result.status === "tie" ? "No skin — tie" : "Pending";
      return `<tr><td>${hole.number}</td><td>${resultText}</td></tr>`;
    }).join("");
    const groupTables = R.GROUPS.filter((group) => groupPlayers(group).length).map((group) => `<section class="print-group"><h3>Group ${group} scorecard</h3><p>Each dot is one handicap stroke received. Circles mark birdies and eagles; squares mark bogeys and worse. Filled KP earns 1 tic; outlined KP is pending; red diagonal KP FAIL earns 0 tics.</p><table><thead><tr><th>Player</th>${E.COURSE.holes.map((hole) => `<th>${hole.number}</th>`).join("")}<th>Gross</th><th>Net</th></tr></thead><tbody>${groupPlayers(group).map((player, playerIndex) => { const totals = E.playerTotals(player, E.COURSE, state.settings); return `<tr><td>${esc(nameOf(player, playerIndex))}</td>${player.scores.map((score, holeIndex) => `<td><span class="print-score-value${scoreMarkClasses(score, holeIndex)}">${score || "—"}</span><span class="print-dots">${"●".repeat(strokesReceived(player, holeIndex))}</span>${kpScorecardMark(player, holeIndex)}</td>`).join("")}<td>${complete(totals.total.gross, totals.total.completed)}</td><td>${complete(totals.total.net, totals.total.completed)}</td></tr>`; }).join("")}</tbody></table></section>`).join("");
    const leaders = rankedPlayers().map((item, rank) => `<tr><td>${rank + 1}</td><td>${esc(nameOf(item.player, item.index))}</td><td>${item.player.group}</td><td>${item.player.scores.filter(Boolean).length}</td><td>${complete(item.totals.total.gross, item.totals.total.completed)}</td><td>${complete(item.totals.total.net, item.totals.total.completed)}</td><td>${item.tics.kps}</td><td>${item.tics.kpFails}</td><td>+${item.ledger.positive.toFixed(1)}</td><td>${item.ledger.negative.toFixed(1)}</td><td>${item.ledger.net.toFixed(1)}</td></tr>`).join("");
    $("#printReport").innerHTML = `<header><img src="berry-creek-logo.jpeg" alt=""><div><h1>${esc(state.roundName)}</h1><p>${esc(state.date)} · The Club at Berry Creek</p></div></header><h2>Leaderboard</h2><table><thead><tr><th>Place</th><th>Player</th><th>Group</th><th>Thru</th><th>Gross</th><th>Net</th><th>KP</th><th>KP Fails</th><th>Points +</th><th>Points −</th><th>Net points</th></tr></thead><tbody>${leaders}</tbody></table><div class="print-columns"><section><h2>KPs</h2><table><tbody>${kpRows}</tbody></table></section><section><h2>Net skins</h2><table><thead><tr><th>Hole</th><th>Winner</th></tr></thead><tbody>${skinRows}</tbody></table></section></div>${groupTables}`;
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
  $("#savedPlayerForm").addEventListener("submit", createSavedPlayer);
  $("#savedPlayerSearch").addEventListener("input", (event) => { savedPlayerSearch = event.target.value; renderSavedPlayers(); });
  $("#resetLeaderboardSortBtn").addEventListener("click", () => { leaderboardSort = { key: "standing", direction: "asc" }; renderLeaderboard(); });
  $("#activeGroupSelect").addEventListener("change", (event) => { clearTimeout(autoAdvanceTimer); selectedGroup = event.target.value; const url = new URL(location.href); url.searchParams.set("group", selectedGroup); history.replaceState(null, "", url); renderGroupScoring(); });
  $("#holeSelect").addEventListener("change", (event) => moveToHole(Number(event.target.value)));
  $("#prevHoleBtn").addEventListener("click", () => moveToHole(selectedHole === 1 ? 18 : selectedHole - 1));
  $("#nextHoleBtn").addEventListener("click", () => moveToHole(selectedHole === 18 ? 1 : selectedHole + 1));
  $("#advanceHoleBtn").addEventListener("click", () => moveToHole(Math.min(18, selectedHole + 1), { skipMissingCheck: true }));
  $("#undoScoreBtn").addEventListener("click", async () => {
    const entry = [...state.undoStack].reverse().find((item) => item.group === selectedGroup);
    if (!entry) return showToast(`Group ${selectedGroup} has no scoring change to undo.`, "error");
    if (await dispatch({ type: "UNDO_LAST", payload: { group: selectedGroup } })) showToast(`Undid ${entry.detail}.`, "success");
  });
  $("#toggleScorecardBtn").addEventListener("click", () => { scorecardOpen = !scorecardOpen; updateScorecardVisibility(); });
  $("#exportScorecardJpegBtn").addEventListener("click", exportGroupScorecardJpeg);
  $("#exportScorecardPdfBtn").addEventListener("click", exportGroupScorecardPdf);
  $("#roundName").addEventListener("change", (event) => dispatch({ type: "SET_META", payload: { roundName: event.target.value } }));
  $("#roundDate").addEventListener("change", (event) => dispatch({ type: "SET_META", payload: { date: event.target.value } }));
  $("#allowance").addEventListener("change", (event) => dispatch({ type: "SET_ALLOWANCE", payload: { allowance: Number(event.target.value) } }));
  $("#adminBtn").addEventListener("click", () => {
    if (adminUnlocked) { adminUnlocked = false; adminPin = ""; savedPlayers = []; savedRounds = []; shareTokens = {}; savedPlayerSearch = ""; savedPlayerGroupSelections.clear(); sessionStorage.removeItem(ADMIN_PIN_KEY); render(); showToast("Admin controls locked."); }
    else openAdminDialog();
  });
  $("#adminSubmitBtn").addEventListener("click", (event) => { event.preventDefault(); verifyAdmin(); });
  $("#adminPinInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); verifyAdmin(); } });
  $("#toggleRoundLockBtn").addEventListener("click", () => {
    if (isLocked()) dispatch({ type: "SET_LOCKED", payload: { locked: false } });
    else openFinalizeDialog();
  });
  const finalizeDialog = $("#finalizeDialog");
  finalizeDialog.addEventListener("close", () => {
    if (finalizeDialog.returnValue === "confirm") dispatch({ type: "SET_LOCKED", payload: { locked: true } });
  });
  $("#saveRoundBtn").addEventListener("click", saveCurrentRound);
  $("#downloadSavedRoundBtn").addEventListener("click", () => {
    if (activeSavedRound) downloadBlob(JSON.stringify(activeSavedRound.state, null, 2), "application/json", `berry-creek-${activeSavedRound.date}-saved.json`);
  });
  $("#exportSavedRoundJpegBtn").addEventListener("click", exportSavedRoundJpeg);
  $("#exportSavedRoundPdfBtn").addEventListener("click", exportSavedRoundPdf);
  $("#exportAllSavedRoundJpegsBtn").addEventListener("click", exportAllSavedRoundJpegs);
  $("#exportAllSavedRoundPdfBtn").addEventListener("click", exportAllSavedRoundPdf);
  $("#soundToggle").addEventListener("change", (event) => { preferences.sound = event.target.checked; savePreferences(); showToast(preferences.sound ? "Celebration sounds on." : "Celebration sounds muted."); });
  $("#autoAdvanceToggle").addEventListener("change", (event) => { preferences.autoAdvance = event.target.checked; savePreferences(); showToast(preferences.autoAdvance ? "Automatic hole advance is on." : "Automatic hole advance is off."); });
  $("#displayMode").addEventListener("change", (event) => { preferences.display = event.target.value; savePreferences(); document.body.dataset.display = preferences.display; });
  $("#exportBtn").addEventListener("click", () => downloadBlob(JSON.stringify(state, null, 2), "application/json", `berry-creek-${state.date}.json`));
  $("#csvBtn").addEventListener("click", downloadCsv);
  $("#printBtn").addEventListener("click", () => { preparePrintReport(); window.print(); });
  $("#importInput").addEventListener("change", async (event) => { try { const imported = R.normalizeState(JSON.parse(await event.target.files[0].text())); await dispatch({ type: "REPLACE_ROUND", payload: { state: imported } }); } catch (_) { showToast("That file is not a valid Berry Creek backup.", "error"); } event.target.value = ""; });
  const resetDialog = $("#confirmDialog");
  $("#resetAppBtn").addEventListener("click", () => { resetDialog.returnValue = "cancel"; resetDialog.showModal(); });
  resetDialog.addEventListener("close", async () => {
    if (resetDialog.returnValue === "scores") { selectedHole = 1; dispatch({ type: "RESET_SCORES" }); }
    if (resetDialog.returnValue === "everything") {
      selectedHole = 1;
      selectedGroup = "A";
      if (await dispatch({ type: "CLEAR_ROUND" })) {
        shareTokens = {};
        groupPresence = {};
        await refreshState().catch(() => {});
        await loadShareTokens();
      }
    }
  });
  const newRoundDialog = $("#newRoundDialog");
  $("#startNewRoundBtn").addEventListener("click", () => { newRoundDialog.returnValue = "cancel"; newRoundDialog.showModal(); });
  newRoundDialog.addEventListener("close", async () => {
    if (newRoundDialog.returnValue !== "confirm") return;
    selectedHole = 1;
    selectedGroup = "A";
    savedPlayerGroupSelections.clear();
    if (!await dispatch({ type: "CLEAR_ROUND" })) return;
    shareTokens = {};
    groupPresence = {};
    scoreSyncStatus.clear();
    await refreshState().catch(() => {});
    await loadShareTokens();
    switchView("setup");
    showToast("New round ready. Saved players and round history were kept.", "success");
  });
  const reuseRosterDialog = $("#reuseRosterDialog");
  reuseRosterDialog.addEventListener("close", () => {
    if (reuseRosterDialog.returnValue === "confirm") startFromSavedRoster();
    else pendingReuseRound = null;
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
  const initialView = spectatorMode ? "leaderboard" : params.get("view");
  if (["setup", "score", "leaderboard", "tournament"].includes(initialView)) switchView(initialView);
  connect();
  registerServiceWorker();
  checkVersion();
})();
