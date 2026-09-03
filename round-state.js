(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekRoundState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PLAYERS = 30;
  const MAX_GROUP_SIZE = 5;
  const MAX_AUDIT_ENTRIES = 250;
  const MAX_UNDO_ENTRIES = 100;
  const GROUPS = ["A", "B", "C", "D", "E", "F"];
  const HOLE_PARS = [4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 5, 3, 5, 4, 4, 4, 3, 4];
  const ADMIN_ACTIONS = new Set(["SET_META", "SET_ALLOWANCE", "ADD_PLAYER", "REMOVE_PLAYER", "UPDATE_PLAYER", "REPLACE_ROUND", "START_FROM_SAVED", "RESET_SCORES", "CLEAR_ROUND", "SET_LOCKED", "CLEAR_AUDIT"]);
  const SCORING_ACTIONS = new Set(["SET_SCORE", "SET_SANDY", "SET_KP", "UNDO_LAST"]);

  function newRoundId() {
    return globalThis.crypto?.randomUUID?.() || `round-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function defaultState() {
    return {
      version: 4,
      revision: 0,
      roundId: newRoundId(),
      roundName: "Berry Creek Round",
      date: new Date().toISOString().slice(0, 10),
      settings: { par: 72, allowance: 100, kpWinners: {}, locked: false },
      players: [],
      auditLog: [],
      groupActivity: {},
      undoStack: []
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

  function normalizeUndoEntry(entry) {
    return {
      id: String(entry?.id || ""),
      at: String(entry?.at || ""),
      group: GROUPS.includes(entry?.group) ? entry.group : "A",
      kind: ["score", "sandy", "kp"].includes(entry?.kind) ? entry.kind : "score",
      playerId: String(entry?.playerId || ""),
      holeIndex: Number.isInteger(Number(entry?.holeIndex)) ? Number(entry.holeIndex) : -1,
      hole: Number.isInteger(Number(entry?.hole)) ? Number(entry.hole) : 0,
      beforeValue: entry?.beforeValue ?? "",
      beforeSandy: Boolean(entry?.beforeSandy),
      afterValue: entry?.afterValue ?? "",
      detail: String(entry?.detail || "scoring change").slice(0, 140)
    };
  }

  function normalizeGroupActivity(value) {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(GROUPS.flatMap((group) => {
      const entry = value[group];
      return entry?.at ? [[group, { at: String(entry.at), action: String(entry.action || "UPDATE").slice(0, 30) }]] : [];
    }));
  }

  function normalizeState(value) {
    const base = defaultState();
    if (!value || !Array.isArray(value.players)) return base;
    return {
      ...base,
      ...value,
      version: 4,
      roundId: String(value.roundId || base.roundId),
      settings: {
        ...base.settings,
        ...(value.settings || {}),
        kpWinners: { ...(value.settings?.kpWinners || {}) },
        locked: Boolean(value.settings?.locked)
      },
      players: value.players.slice(0, MAX_PLAYERS).map(normalizePlayer),
      auditLog: Array.isArray(value.auditLog) ? value.auditLog.slice(-MAX_AUDIT_ENTRIES).map(normalizeAuditEntry) : [],
      groupActivity: normalizeGroupActivity(value.groupActivity),
      undoStack: Array.isArray(value.undoStack) ? value.undoStack.slice(-MAX_UNDO_ENTRIES).map(normalizeUndoEntry) : []
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
      case "UNDO_LAST": return `Undid ${p.detail || "the last scoring change"}`;
      case "RESET_SCORES": return "Reset all scores and tics";
      case "CLEAR_ROUND": return "Started a new event";
      case "SET_LOCKED": return p.locked ? "Finalized and locked the round" : "Unlocked the round";
      case "REPLACE_ROUND": return "Imported a round backup";
      case "START_FROM_SAVED": return "Started a new round from a saved roster";
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

  function actionGroup(before, after, action) {
    const p = action?.payload || {};
    if (action?.type === "UNDO_LAST" && GROUPS.includes(p.group)) return p.group;
    if (action?.type === "SET_SCORE" || action?.type === "SET_SANDY") {
      return after.players.find((player) => player.id === p.playerId)?.group || before.players.find((player) => player.id === p.playerId)?.group || "";
    }
    if (action?.type === "SET_KP") {
      const holderId = p.playerId || before.settings.kpWinners[String(p.hole)];
      return after.players.find((player) => player.id === holderId)?.group || before.players.find((player) => player.id === holderId)?.group || "";
    }
    return "";
  }

  function addUndoEntry(state, before, action, group) {
    const p = action.payload || {};
    const at = String(action?.meta?.at || new Date().toISOString());
    let entry;
    if (action.type === "SET_SCORE") {
      const previous = before.players.find((player) => player.id === p.playerId);
      entry = {
        id: `${at}-${state.revision}-score`, at, group, kind: "score", playerId: p.playerId,
        holeIndex: Number(p.holeIndex), beforeValue: previous?.scores?.[Number(p.holeIndex)] ?? "",
        beforeSandy: Boolean(previous?.sandies?.[Number(p.holeIndex)]), afterValue: p.score,
        detail: `${playerName(state, p.playerId)}'s Hole ${Number(p.holeIndex) + 1} score`
      };
    } else if (action.type === "SET_SANDY") {
      const previous = before.players.find((player) => player.id === p.playerId);
      entry = {
        id: `${at}-${state.revision}-sandy`, at, group, kind: "sandy", playerId: p.playerId,
        holeIndex: Number(p.holeIndex), beforeValue: Boolean(previous?.sandies?.[Number(p.holeIndex)]),
        afterValue: Boolean(p.value), detail: `${playerName(state, p.playerId)}'s Hole ${Number(p.holeIndex) + 1} sand save`
      };
    } else if (action.type === "SET_KP") {
      state.undoStack = state.undoStack.filter((item) => !(item.kind === "kp" && item.hole === Number(p.hole)));
      entry = {
        id: `${at}-${state.revision}-kp`, at, group, kind: "kp", hole: Number(p.hole),
        beforeValue: before.settings.kpWinners[String(p.hole)] || "", afterValue: p.playerId || "",
        detail: `Hole ${Number(p.hole)} KP change`
      };
    }
    if (entry) state.undoStack.push(normalizeUndoEntry(entry));
    state.undoStack = state.undoStack.slice(-MAX_UNDO_ENTRIES);
  }

  function undoLastScoringChange(state, p) {
    const group = GROUPS.includes(p.group) ? p.group : "";
    let targetIndex = -1;
    for (let index = state.undoStack.length - 1; index >= 0; index -= 1) {
      if (state.undoStack[index].group === group) { targetIndex = index; break; }
    }
    if (targetIndex < 0) return false;
    const entry = state.undoStack[targetIndex];
    if (entry.kind === "score") {
      const player = state.players.find((item) => item.id === entry.playerId && item.group === group);
      if (!player || entry.holeIndex < 0 || entry.holeIndex > 17) return false;
      player.scores[entry.holeIndex] = entry.beforeValue;
      player.sandies[entry.holeIndex] = entry.beforeSandy;
    } else if (entry.kind === "sandy") {
      const player = state.players.find((item) => item.id === entry.playerId && item.group === group);
      if (!player || entry.holeIndex < 0 || entry.holeIndex > 17) return false;
      player.sandies[entry.holeIndex] = Boolean(entry.beforeValue);
    } else if (entry.kind === "kp") {
      if (entry.beforeValue && state.players.some((player) => player.id === entry.beforeValue)) state.settings.kpWinners[String(entry.hole)] = entry.beforeValue;
      else delete state.settings.kpWinners[String(entry.hole)];
    }
    state.undoStack.splice(targetIndex, 1);
    p.detail = entry.detail;
    return true;
  }

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
        state.undoStack = state.undoStack.filter((entry) => entry.playerId !== p.playerId && entry.beforeValue !== p.playerId && entry.afterValue !== p.playerId);
        break;
      case "UPDATE_PLAYER": {
        const player = state.players.find((item) => item.id === p.playerId);
        if (!player) { changed = false; break; }
        const previousGroup = player.group;
        if (typeof p.name === "string") player.name = p.name.slice(0, 40);
        if (typeof p.directoryId === "string") player.directoryId = p.directoryId;
        if (Number.isFinite(Number(p.ghin))) player.ghin = Math.max(-10, Math.min(54, Number(p.ghin)));
        if (typeof p.teeKey === "string") player.teeKey = p.teeKey;
        if (GROUPS.includes(p.group)) {
          const groupCount = state.players.filter((item) => item.group === p.group && item.id !== p.playerId).length;
          if (groupCount < MAX_GROUP_SIZE) player.group = p.group;
        }
        if (player.group !== previousGroup) state.undoStack = state.undoStack.filter((entry) => entry.playerId !== p.playerId && entry.beforeValue !== p.playerId && entry.afterValue !== p.playerId);
        break;
      }
      case "SET_SCORE": {
        const player = state.players.find((item) => item.id === p.playerId);
        const holeIndex = Number(p.holeIndex);
        if (!player || holeIndex < 0 || holeIndex > 17) { changed = false; break; }
        const previousScore = player.scores[holeIndex];
        const previousSandy = player.sandies[holeIndex];
        player.scores[holeIndex] = p.score === "" ? "" : Math.max(1, Math.min(20, Number(p.score) || 1));
        if (player.scores[holeIndex] === "" || Number(player.scores[holeIndex]) > HOLE_PARS[holeIndex]) player.sandies[holeIndex] = false;
        if (player.scores[holeIndex] === previousScore && player.sandies[holeIndex] === previousSandy) changed = false;
        break;
      }
      case "SET_SANDY": {
        const player = state.players.find((item) => item.id === p.playerId);
        const holeIndex = Number(p.holeIndex);
        const gross = Number(player?.scores[holeIndex]);
        if (!player || holeIndex < 0 || holeIndex > 17) { changed = false; break; }
        const previous = player.sandies[holeIndex];
        player.sandies[holeIndex] = Boolean(p.value) && gross >= 1 && gross <= HOLE_PARS[holeIndex];
        if (player.sandies[holeIndex] === previous) changed = false;
        break;
      }
      case "SET_KP": {
        if (![2, 8, 12, 17].includes(Number(p.hole))) { changed = false; break; }
        const previous = state.settings.kpWinners[String(p.hole)] || "";
        if (p.playerId && state.players.some((player) => player.id === p.playerId)) state.settings.kpWinners[String(p.hole)] = p.playerId;
        else delete state.settings.kpWinners[String(p.hole)];
        if ((state.settings.kpWinners[String(p.hole)] || "") === previous) changed = false;
        break;
      }
      case "UNDO_LAST":
        changed = undoLastScoringChange(state, p);
        break;
      case "REPLACE_ROUND":
        state = normalizeState(p.state);
        break;
      case "START_FROM_SAVED":
        state = normalizeState(p.state);
        state.players.forEach((player) => {
          player.scores = Array(18).fill("");
          player.skins = Array(18).fill(false);
          player.sandies = Array(18).fill(false);
        });
        state.settings.locked = false;
        state.settings.kpWinners = {};
        state.groupActivity = {};
        state.undoStack = [];
        break;
      case "RESET_SCORES":
        state.players.forEach((player) => {
          player.scores = Array(18).fill("");
          player.skins = Array(18).fill(false);
          player.sandies = Array(18).fill(false);
        });
        state.settings.kpWinners = {};
        state.settings.locked = false;
        state.groupActivity = {};
        state.undoStack = [];
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
    const group = actionGroup(before, state, action);
    if (group && action.type !== "UNDO_LAST") addUndoEntry(state, before, action, group);
    if (group) state.groupActivity[group] = { at: String(action?.meta?.at || new Date().toISOString()), action: action.type };
    addAudit(state, before, action);
    return state;
  }

  return {
    MAX_PLAYERS,
    MAX_GROUP_SIZE,
    MAX_AUDIT_ENTRIES,
    MAX_UNDO_ENTRIES,
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
