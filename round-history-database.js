"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function metadataFromRow(row) {
  return row ? {
    id: row.id,
    roundName: row.round_name,
    date: row.round_date,
    playerCount: Number(row.player_count),
    completed: Boolean(row.completed),
    locked: Boolean(row.locked),
    savedAt: row.saved_at
  } : null;
}

class RoundHistoryDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_rounds (
        id TEXT PRIMARY KEY,
        round_name TEXT NOT NULL,
        round_date TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        saved_at TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saved_rounds_saved_at
      ON saved_rounds(saved_at DESC);
      PRAGMA optimize;
    `);
    this.listStatement = this.db.prepare("SELECT id, round_name, round_date, player_count, completed, locked, saved_at FROM saved_rounds ORDER BY saved_at DESC");
    this.findStatement = this.db.prepare("SELECT * FROM saved_rounds WHERE id = ?");
    this.insertStatement = this.db.prepare("INSERT INTO saved_rounds (id, round_name, round_date, player_count, completed, locked, saved_at, state_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    this.deleteStatement = this.db.prepare("DELETE FROM saved_rounds WHERE id = ?");
  }

  list() { return this.listStatement.all().map(metadataFromRow); }

  find(id) {
    const row = this.findStatement.get(String(id));
    if (!row) return null;
    return { ...metadataFromRow(row), state: JSON.parse(row.state_json) };
  }

  create(state) {
    if (!state || !Array.isArray(state.players) || !state.players.length) throw new Error("Add at least one player before saving the round");
    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();
    const completed = state.players.every((player) => Array.isArray(player.scores) && player.scores.length === 18 && player.scores.every((score) => Number(score) >= 1));
    this.insertStatement.run(
      id,
      String(state.roundName || "Berry Creek Round").slice(0, 60),
      String(state.date || savedAt.slice(0, 10)).slice(0, 10),
      state.players.length,
      completed ? 1 : 0,
      state.settings?.locked ? 1 : 0,
      savedAt,
      JSON.stringify(state)
    );
    return this.find(id);
  }

  remove(id) {
    const current = this.find(id);
    if (!current) throw new Error("Saved round not found");
    this.deleteStatement.run(String(id));
    return metadataFromRow({
      id: current.id,
      round_name: current.roundName,
      round_date: current.date,
      player_count: current.playerCount,
      completed: current.completed ? 1 : 0,
      locked: current.locked ? 1 : 0,
      saved_at: current.savedAt
    });
  }

  close() { this.db.close(); }
}

module.exports = RoundHistoryDatabase;
