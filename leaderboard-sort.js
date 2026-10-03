(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BerryCreekLeaderboardSort = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isMissing(value) {
    return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  }

  function compareValues(a, b, direction = "asc") {
    const aMissing = isMissing(a);
    const bMissing = isMissing(b);
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      return aMissing ? 1 : -1;
    }
    const comparison = typeof a === "string" || typeof b === "string"
      ? String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
      : Number(a) - Number(b);
    return direction === "desc" ? -comparison : comparison;
  }

  function sortItems(items, key, direction = "asc", fallbackCompare = () => 0) {
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
      const primary = compareValues(a.item.sortValues?.[key], b.item.sortValues?.[key], direction);
      if (primary) return primary;
      const fallback = fallbackCompare(a.item, b.item);
      return fallback || a.index - b.index;
    }).map((entry) => entry.item);
  }

  function pointMarkerIds(items) {
    const entries = items.map((item) => ({
      id: item.player?.id ?? item.id,
      points: Number(item.ledger?.settledNet) || 0,
      totalNet: Number(item.totals?.total?.net) || 0
    })).filter((item) => item.id !== undefined && item.id !== null);
    if (!entries.length) return { leaderId: null, loserId: null };

    const highestPoints = Math.max(...entries.map((item) => item.points));
    const leaders = entries.filter((item) => item.points === highestPoints);
    const lowestLeaderNet = Math.min(...leaders.map((item) => item.totalNet));
    const finalLeaders = leaders.filter((item) => item.totalNet === lowestLeaderNet);

    const lowestPoints = Math.min(...entries.map((item) => item.points));
    const losers = entries.filter((item) => item.points === lowestPoints);
    const highestLoserNet = Math.max(...losers.map((item) => item.totalNet));
    const finalLosers = losers.filter((item) => item.totalNet === highestLoserNet);

    return {
      leaderId: highestPoints > 0 && finalLeaders.length === 1 ? finalLeaders[0].id : null,
      loserId: lowestPoints < 0 && finalLosers.length === 1 ? finalLosers[0].id : null
    };
  }

  return { compareValues, sortItems, pointMarkerIds };
});
