"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function normalizeInput(value) {
  const name = String(value?.name || "").trim().slice(0, 40);
  if (!name) throw new Error("Player name is required");
  const rawGhin = Number(value?.ghin);
  const ghin = Number.isFinite(rawGhin) ? Math.max(-10, Math.min(54, rawGhin)) : 0;
  const teeKey = String(value?.teeKey || "championship").slice(0, 40);
  return { name, ghin, teeKey };
}

function fromRow(row) {
  return row ? {
    id: row.id,
    name: row.name,
    ghin: Number(row.ghin),
    teeKey: row.tee_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

class PlayerDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ghin REAL NOT NULL DEFAULT 0,
        tee_key TEXT NOT NULL DEFAULT 'championship',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.listStatement = this.db.prepare("SELECT * FROM players ORDER BY name COLLATE NOCASE, created_at");
    this.findStatement = this.db.prepare("SELECT * FROM players WHERE id = ?");
    this.insertStatement = this.db.prepare("INSERT INTO players (id, name, ghin, tee_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    this.updateStatement = this.db.prepare("UPDATE players SET name = ?, ghin = ?, tee_key = ?, updated_at = ? WHERE id = ?");
    this.deleteStatement = this.db.prepare("DELETE FROM players WHERE id = ?");
  }

  list() { return this.listStatement.all().map(fromRow); }

  find(id) { return fromRow(this.findStatement.get(String(id))); }

  create(value) {
    const player = normalizeInput(value);
    const id = String(value?.id || crypto.randomUUID());
    const now = new Date().toISOString();
    this.insertStatement.run(id, player.name, player.ghin, player.teeKey, now, now);
    return this.find(id);
  }

  update(id, value) {
    const current = this.find(id);
    if (!current) throw new Error("Saved player not found");
    const player = normalizeInput({ ...current, ...value });
    this.updateStatement.run(player.name, player.ghin, player.teeKey, new Date().toISOString(), String(id));
    return this.find(id);
  }

  remove(id) {
    const current = this.find(id);
    if (!current) throw new Error("Saved player not found");
    this.deleteStatement.run(String(id));
    return current;
  }

  close() { this.db.close(); }
}

module.exports = PlayerDatabase;
