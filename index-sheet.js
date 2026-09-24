"use strict";

const NAME_HEADERS = new Set(["name", "player", "player name", "golfer", "golfer name", "member", "member name"]);
const FIRST_NAME_HEADERS = new Set(["first", "first name", "firstname", "given name"]);
const LAST_NAME_HEADERS = new Set(["last", "last name", "lastname", "surname", "family name"]);
const INDEX_HEADERS = new Set(["index", "ghin index", "handicap index", "handicap index number", "hcp index", "hi", "handicap"]);
const UPDATE_DATE_HEADERS = new Set(["update date", "updated", "last updated", "date updated", "roster date", "as of", "as of date"]);

function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (quoted) throw new Error("The index sheet contains an unfinished quoted value");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((values) => values.some((value) => String(value).trim()));
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[®™]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameKeys(value) {
  const source = String(value || "").trim();
  const keys = new Set([normalizeName(source)]);
  const comma = source.indexOf(",");
  if (comma > 0) keys.add(normalizeName(`${source.slice(comma + 1)} ${source.slice(0, comma)}`));
  keys.delete("");
  return [...keys];
}

function parseGolfIndex(value) {
  const source = String(value ?? "").trim().replace(/^=/, "").replace(/[−–—]/g, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) return null;
  const magnitude = Number(source.replace(/^\+/, ""));
  if (!Number.isFinite(magnitude)) return null;
  const index = source.startsWith("+") ? -Math.abs(magnitude) : magnitude;
  if (index < -10 || index > 54) return null;
  return Math.round(index * 10) / 10;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSheetDate(value) {
  const source = String(value || "").trim();
  let match = source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|20\d{2})\b/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return isoDate(year, Number(match[1]), Number(match[2]));
  }
  const monthMatch = source.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  if (monthMatch) {
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(monthMatch[1].toLowerCase()) + 1;
    return isoDate(Number(monthMatch[3]), month, Number(monthMatch[2]));
  }
  return "";
}

function findUpdateDate(rows, header) {
  for (const values of rows) {
    for (let index = 0; index < values.length; index += 1) {
      const cell = String(values[index] || "").trim();
      const normalized = normalizeHeader(cell);
      if (UPDATE_DATE_HEADERS.has(normalized)) {
        const adjacent = values.slice(index + 1).map(parseSheetDate).find(Boolean);
        if (adjacent) return adjacent;
      }
      if (/\b(?:update date|last updated|date updated|roster date|as of)\b/i.test(cell)) {
        const embedded = parseSheetDate(cell);
        if (embedded) return embedded;
      }
    }
  }
  if (header) {
    const headers = rows[header.rowIndex].map(normalizeHeader);
    const dateColumn = columnIndex(headers, UPDATE_DATE_HEADERS);
    if (dateColumn >= 0) {
      for (const values of rows.slice(header.rowIndex + 1)) {
        const date = parseSheetDate(values[dateColumn]);
        if (date) return date;
      }
    }
  }
  return "";
}

function columnIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.has(header));
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const headers = rows[rowIndex].map(normalizeHeader);
    const name = columnIndex(headers, NAME_HEADERS);
    const first = columnIndex(headers, FIRST_NAME_HEADERS);
    const last = columnIndex(headers, LAST_NAME_HEADERS);
    const handicapIndex = columnIndex(headers, INDEX_HEADERS);
    if (handicapIndex >= 0 && (name >= 0 || first >= 0 || last >= 0)) return { rowIndex, name, first, last, handicapIndex };
  }
  return null;
}

function addSheetEntry(valid, invalid, sheetRow, name, rawIndex) {
  const ghin = parseGolfIndex(rawIndex);
  if (!name || ghin === null) {
    invalid.push({ row: sheetRow, name, value: rawIndex, reason: !name ? "Missing player name" : "Invalid Handicap Index" });
    return;
  }
  valid.push({ row: sheetRow, name, ghin, keys: nameKeys(name) });
}

function firstValue(values) {
  return String(values.find((value) => String(value || "").trim()) || "").trim();
}

function parseTabularRows(rows, header, valid, invalid) {
  rows.slice(header.rowIndex + 1).forEach((values, offset) => {
    const sheetRow = header.rowIndex + offset + 2;
    const name = header.name >= 0
      ? String(values[header.name] || "").trim()
      : [values[header.first], values[header.last]].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
    const rawIndex = String(values[header.handicapIndex] ?? "").trim();
    if (!name && !rawIndex) return;
    addSheetEntry(valid, invalid, sheetRow, name, rawIndex);
  });
}

function parseVerticalRoster(rows, valid, invalid) {
  const updateRow = rows.findIndex((values) => values.some((value) => UPDATE_DATE_HEADERS.has(normalizeHeader(value)) || /\b(?:update date|last updated|date updated|roster date|as of)\b/i.test(String(value || ""))));
  const start = updateRow >= 0 ? updateRow + 1 : 0;
  for (let rowIndex = start; rowIndex + 2 < rows.length; rowIndex += 3) {
    const name = firstValue(rows[rowIndex]);
    const rawIndex = firstValue(rows[rowIndex + 2]);
    if (!name && !rawIndex) continue;
    addSheetEntry(valid, invalid, rowIndex + 1, name, rawIndex);
  }
}

function parseIndexSheet(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The published index sheet is empty");
  const header = findHeader(rows);
  const valid = [];
  const invalid = [];
  if (header) parseTabularRows(rows, header, valid, invalid);
  else parseVerticalRoster(rows, valid, invalid);
  if (!valid.length) throw new Error("No player names and Handicap Indexes were found in the published sheet");
  return { valid, invalid, updateDate: findUpdateDate(rows, header) };
}

function buildIndexUpdatePlan(savedPlayers, parsedSheet) {
  const sheetByName = new Map();
  parsedSheet.valid.forEach((entry) => {
    entry.keys.forEach((key) => {
      const entries = sheetByName.get(key) || [];
      if (!entries.some((existing) => existing.row === entry.row)) entries.push(entry);
      sheetByName.set(key, entries);
    });
  });
  const updates = [];
  const unchanged = [];
  const unmatched = [];
  const ambiguous = [];

  savedPlayers.forEach((player) => {
    const matches = new Map();
    nameKeys(player.name).forEach((key) => (sheetByName.get(key) || []).forEach((entry) => matches.set(entry.row, entry)));
    const candidates = [...matches.values()];
    const distinctIndexes = [...new Set(candidates.map((entry) => entry.ghin))];
    if (!candidates.length) unmatched.push({ id: player.id, name: player.name });
    else if (distinctIndexes.length !== 1) ambiguous.push({ id: player.id, name: player.name });
    else {
      const ghin = distinctIndexes[0];
      const result = { id: player.id, name: player.name, previousGhin: Number(player.ghin), ghin };
      if (Math.abs(Number(player.ghin) - ghin) < 0.0001) unchanged.push(result);
      else updates.push(result);
    }
  });

  return {
    updates,
    unchanged,
    unmatched,
    ambiguous,
    invalidSheetRows: parsedSheet.invalid,
    validSheetRows: parsedSheet.valid.length
  };
}

module.exports = { parseCsv, parseGolfIndex, parseSheetDate, parseIndexSheet, normalizeName, buildIndexUpdatePlan };
