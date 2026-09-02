(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekRoundState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PLAYERS = 30;
  const MAX_GROUP_SIZE = 5;
  const MAX_AUDIT_ENTRIES = 250;
  const GROUPS = ["A", "B", "C", "D", "E", "F"];
  const HOLE_PARS = [4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 5, 3, 5, 4, 4, 4, 3, 4];
  const ADMIN_ACTIONS = new Set(["SET_META", "SET_ALLOWANCE", "ADD_PLAYER", "REMOVE_PLAYER", "UPDATE_PLAYER", "REPLACE_ROUND", "RESET_SCORES", "CLEAR_ROUND", "SET_LOCKED", "CLEAR_AUDIT"]);
  const SCORING_ACTIONS = new Set(["SET_SCORE", "SET_SANDY", "SET_KP"]);

  function defaultState() {
    return {
      version: 3,
      revision: 0,
      roundName: "Berry Creek Round",
      date: new Date().toISOString().slice(0, 10),
      settings: { par: 72, allowance: 100, kpWinners: {}, locked: false },
      players: [],
      auditLog: []
    };
  }

  function normalizePlayer(player) {
    return {
      id: String(player.id || ""),
      directoryId: player.directoryId ? String(player.directoryId) : "",
      name: String(player.name || "").slice(0, 40),
      ghin: Number(player.ghin) || 0,
      teeKey: String(player.teeKey || "championship"),
      group: GROUPS.includes(player.group) ? player.group : "A",
      scores: Array.from({ length: 18 }, (_, i) => player.scores?.[i] ?? ""),
      skins: Array.from({ length: 18 }, (_, i) => Boolean(player.skins?.[i])),
      sandies: Array.from({ length: 18 }, (_, i) => {
        const gross = Number(player.scores?.[i]);
        return Boolean(player.sandies?.[i]) && gross >= 1 && gross <= HOLE_PARS[i];
      })
    };
  }

  function normalizeAuditEntry(entry) {
    return {
      id: String(entry?.id || ""),
      at: String(entry?.at || ""),
      actor: String(entry?.actor || "Scorekeeper").slice(0, 40),
      type: String(entry?.type || "UPDATE").slice(0, 30),
      detail: String(entry?.detail || "Round updated").slice(0, 180)
    };
  }

  function normalizeState(value) {
    const base = defaultState();
    if (!value || !Array.isArray(value.players)) return base;
    return {
      ...base,
      ...value,
      version: 3,
      settings: {
        ...base.settings,
        ...(value.settings || {}),
        kpWinners: value.settings?.kpWinners || {},
        locked: Boolean(value.settings?.locked)
      },
      players: value.players.slice(0, MAX_PLAYERS).map(normalizePlayer),
      auditLog: Array.isArray(value.auditLog) ? value.auditLog.slice(-MAX_AUDIT_ENTRIES).map(normalizeAuditEntry) : []
    };
  }

  function playerName(state, playerId) {
    const player = state.players.find((item) => item.id === playerId);
    return player?.name?.trim() || "Player";
  }

  function actionDescription(before, after, action) {
    const p = action?.payload || {};
    switch (action?.type) {
      case "SET_META": return "Updated round details";
      case "SET_ALLOWANCE": return `Set handicap allowance to ${after.settings.allowance}%`;
      case "ADD_PLAYER": return `Added ${p.player?.name?.trim() || "a player"} to Group ${p.player?.group || "A"}`;
      case "REMOVE_PLAYER": return `Removed ${playerName(before, p.playerId)}`;
      case "UPDATE_PLAYER": return `Updated ${playerName(after, p.playerId)}`;
      case "SET_SCORE": {
        const oldScore = before.players.find((item) => item.id === p.playerId)?.scores?.[Number(p.holeIndex)] || "blank";
        const newScore = after.players.find((item) => item.id === p.playerId)?.scores?.[Number(p.holeIndex)] || "blank";
        return `${playerName(after, p.playerId)} · Hole ${Number(p.holeIndex) + 1}: ${oldScore} → ${newScore}`;
      }
      case "SET_SANDY": return `${playerName(after, p.playerId)} · Hole ${Number(p.holeIndex) + 1}: sand save ${p.value ? "marked" : "removed"}`;
      case "SET_KP": return `Hole ${p.hole} KP: ${p.playerId ? playerName(after, p.playerId) : "cleared"}`;
      case "RESET_SCORES": return "Reset all scores and tics";
      case "CLEAR_ROUND": return "Started a new event";
      case "SET_LOCKED": return p.locked ? "Finalized and locked the round" : "Unlocked the round";
      case "REPLACE_ROUND": return "Imported a round backup";
      case "CLEAR_AUDIT": return "Cleared change history";
      default: return "Round updated";
    }
  }

  function addAudit(state, before, action) {
    if (action?.meta?.skipAudit) return;
    const at = String(action?.meta?.at || new Date().toISOString());
    state.auditLog.push(normalizeAuditEntry({
      id: `${at}-${state.revision}`,
      at,
      actor: action?.meta?.actor || "Scorekeeper",
      type: action?.type,
      detail: actionDescription(before, state, action)
    }));
    state.auditLog = state.auditLog.slice(-MAX_AUDIT_ENTRIES);
  }

  function isAdminAction(type) { return ADMIN_ACTIONS.has(type); }
  function isScoringAction(type) { return SCORING_ACTIONS.has(type); }

  function applyAction(inputState, action) {
    const before = normalizeState(inputState);
    let state = normalizeState(inputState);
    const p = action?.payload || {};
    let changed = true;
    switch (action?.type) {
      case "SET_META":
        if (typeof p.roundName === "string") state.roundName = p.roundName.slice(0, 60);
        if (typeof p.date === "string") state.date = p.date;
        break;
      case "SET_ALLOWANCE":
        state.settings.allowance = Math.max(0, Math.min(100, Number(p.allowance) || 0));
        break;
      case "SET_LOCKED":
        state.settings.locked = Boolean(p.locked);
        break;
      case "ADD_PLAYER": {
        if (state.players.length >= MAX_PLAYERS || !p.player?.id) { changed = false; break; }
        const incoming = normalizePlayer(p.player);
        const groupCount = state.players.filter((player) => player.group === incoming.group).length;
        if (groupCount < MAX_GROUP_SIZE) state.players.push(incoming);
        else changed = false;
        break;
      }
      case "REMOVE_PLAYER":
        if (!state.players.some((player) => player.id === p.playerId)) { changed = false; break; }
        state.players = state.players.filter((player) => player.id !== p.playerId);
        Object.keys(state.settings.kpWinners).forEach((hole) => {
          if (state.settings.kpWinners[hole] === p.playerId) delete state.settings.kpWinners[hole];
        });
        break;
      case "UPDATE_PLAYER": {
        const player = state.players.find((item) => item.id === p.playerId);
        if (!player) { changed = false; break; }
        if (typeof p.name === "string") player.name = p.name.slice(0, 40);
        if (typeof p.directoryId === "string") player.directoryId = p.directoryId;
        if (Number.isFinite(Number(p.ghin))) player.ghin = Math.max(-10, Math.min(54, Number(p.ghin)));
        if (typeof p.teeKey === "string") player.teeKey = p.teeKey;
        if (GROUPS.includes(p.group)) {
          const groupCount = state.players.filter((item) => item.group === p.group && item.id !== p.playerId).length;
          if (groupCount < MAX_GROUP_SIZE) player.group = p.group;
        }
        break;
      }
      case "SET_SCORE": {
        const player = state.players.find((item) => item.id === p.playerId);
        const holeIndex = Number(p.holeIndex);
        if (!player || holeIndex < 0 || holeIndex > 17) { changed = false; break; }
        player.scores[holeIndex] = p.score === "" ? "" : Math.max(1, Math.min(20, Number(p.score) || 1));
        if (player.scores[holeIndex] === "" || Number(player.scores[holeIndex]) > HOLE_PARS[holeIndex]) player.sandies[holeIndex] = false;
        break;
      }
      case "SET_SANDY": {
        const player = state.players.find((item) => item.id === p.playerId);
        const holeIndex = Number(p.holeIndex);
        const gross = Number(player?.scores[holeIndex]);
        if (!player || holeIndex < 0 || holeIndex > 17) { changed = false; break; }
        player.sandies[holeIndex] = Boolean(p.value) && gross >= 1 && gross <= HOLE_PARS[holeIndex];
        break;
      }
      case "SET_KP":
        if (![2, 8, 12, 17].includes(Number(p.hole))) { changed = false; break; }
        if (p.playerId && state.players.some((player) => player.id === p.playerId)) state.settings.kpWinners[String(p.hole)] = p.playerId;
        else delete state.settings.kpWinners[String(p.hole)];
        break;
      case "REPLACE_ROUND":
        state = normalizeState(p.state);
        break;
      case "RESET_SCORES":
        state.players.forEach((player) => {
          player.scores = Array(18).fill("");
          player.skins = Array(18).fill(false);
          player.sandies = Array(18).fill(false);
        });
        state.settings.kpWinners = {};
        state.settings.locked = false;
        break;
      case "CLEAR_ROUND":
        state = defaultState();
        break;
      case "CLEAR_AUDIT":
        state.auditLog = [];
        break;
      default:
        changed = false;
    }
    if (!changed) return state;
    state.revision = Number(inputState?.revision || 0) + 1;
    addAudit(state, before, action);
    return state;
  }

  return {
    MAX_PLAYERS,
    MAX_GROUP_SIZE,
    MAX_AUDIT_ENTRIES,
    GROUPS,
    HOLE_PARS,
    ADMIN_ACTIONS,
    SCORING_ACTIONS,
    defaultState,
    normalizePlayer,
    normalizeState,
    isAdminAction,
    isScoringAction,
    applyAction
  };
});
