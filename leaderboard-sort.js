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

  return { compareValues, sortItems };
});
