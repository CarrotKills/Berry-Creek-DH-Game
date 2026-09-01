(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekRoundState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PLAYERS = 30;
  const MAX_GROUP_SIZE = 5;
  const GROUPS = ["A", "B", "C", "D", "E", "F"];

  function defaultState() {
    return {
      version: 2,
      revision: 0,
      roundName: "Berry Creek Round",
      date: new Date().toISOString().slice(0, 10),
      settings: { par: 72, allowance: 100, kpWinners: {} },
      players: []
    };
  }

  function normalizePlayer(player) {
    return {
      id: String(player.id || ""),
      name: String(player.name || ""),
      ghin: Number(player.ghin) || 0,
      teeKey: String(player.teeKey || "championship"),
      group: GROUPS.includes(player.group) ? player.group : "A",
      scores: Array.from({ length: 18 }, (_, i) => player.scores?.[i] ?? ""),
      skins: Array.from({ length: 18 }, (_, i) => Boolean(player.skins?.[i])),
      sandies: Array.from({ length: 18 }, (_, i) => Boolean(player.sandies?.[i]))
    };
  }

  function normalizeState(value) {
    const base = defaultState();
    if (!value || !Array.isArray(value.players)) return base;
    return {
      ...base,
      ...value,
      settings: { ...base.settings, ...(value.settings || {}), kpWinners: value.settings?.kpWinners || {} },
      players: value.players.slice(0, MAX_PLAYERS).map(normalizePlayer)
    };
  }

  function applyAction(inputState, action) {
    const state = normalizeState(inputState);
    const p = action?.payload || {};
    switch (action?.type) {
      case "SET_META":
        if (typeof p.roundName === "string") state.roundName = p.roundName.slice(0, 60);
        if (typeof p.date === "string") state.date = p.date;
        break;
      case "SET_ALLOWANCE":
        state.settings.allowance = Math.max(0, Math.min(100, Number(p.allowance) || 0));
        break;
      case "ADD_PLAYER": {
        if (state.players.length >= MAX_PLAYERS || !p.player?.id) break;
        const incoming = normalizePlayer(p.player);
        const groupCount = state.players.filter((player) => player.group === incoming.group).length;
        if (groupCount < MAX_GROUP_SIZE) state.players.push(incoming);
        break;
      }
      case "REMOVE_PLAYER":
        state.players = state.players.filter((player) => player.id !== p.playerId);
        Object.keys(state.settings.kpWinners).forEach((hole) => {
          if (state.settings.kpWinners[hole] === p.playerId) delete state.settings.kpWinners[hole];
        });
        break;
      case "UPDATE_PLAYER": {
        const player = state.players.find((item) => item.id === p.playerId);
        if (!player) break;
        if (typeof p.name === "string") player.name = p.name.slice(0, 40);
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
        if (!player || holeIndex < 0 || holeIndex > 17) break;
        player.scores[holeIndex] = p.score === "" ? "" : Math.max(1, Math.min(20, Number(p.score) || 1));
        break;
      }
      case "SET_SKIN": {
        const player = state.players.find((item) => item.id === p.playerId);
        if (player && p.holeIndex >= 0 && p.holeIndex < 18) player.skins[p.holeIndex] = Boolean(p.value);
        break;
      }
      case "SET_SANDY": {
        const player = state.players.find((item) => item.id === p.playerId);
        if (player && p.holeIndex >= 0 && p.holeIndex < 18) player.sandies[p.holeIndex] = Boolean(p.value);
        break;
      }
      case "SET_KP":
        if ([2, 8, 12, 17].includes(Number(p.hole))) {
          if (p.playerId && state.players.some((player) => player.id === p.playerId)) state.settings.kpWinners[String(p.hole)] = p.playerId;
          else delete state.settings.kpWinners[String(p.hole)];
        }
        break;
      case "REPLACE_ROUND":
        return normalizeState(p.state);
      case "CLEAR_ROUND":
        return defaultState();
      default:
        return state;
    }
    state.revision = Number(inputState?.revision || 0) + 1;
    return state;
  }

  return { MAX_PLAYERS, MAX_GROUP_SIZE, GROUPS, defaultState, normalizePlayer, normalizeState, applyAction };
});
