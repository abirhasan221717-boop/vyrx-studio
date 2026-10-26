'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'vyrx.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- user | admin
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | active | rejected | banned
  language TEXT NOT NULL DEFAULT 'en',
  credits INTEGER NOT NULL DEFAULT 0,
  last_daily_grant TEXT,                       -- YYYY-MM-DD (UTC)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  prompt TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT 'wan',
  voice_lang TEXT NOT NULL DEFAULT 'en',
  ref_image TEXT,
  ref_video TEXT,
  status TEXT NOT NULL DEFAULT 'waiting_engine', -- waiting_engine|queued|processing|done|failed
  stage TEXT NOT NULL DEFAULT '',                -- ''|waking|generating|stitching
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  refunded INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  result_path TEXT,
  wake_since TEXT,
  wake_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notice',
  status TEXT NOT NULL DEFAULT 'Queued',       -- Queued | Sent | Failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',         -- open | replied
  user_unread INTEGER NOT NULL DEFAULT 0,
  admin_unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  sender TEXT NOT NULL,                        -- user | admin
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,                    -- ISO timestamp
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function addLedger(userId, delta, reason) {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const balance = Math.max(0, user.credits + delta);
  const applied = balance - user.credits;
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(balance, userId);
  db.prepare('INSERT INTO ledger(user_id, delta, reason, balance_after) VALUES(?, ?, ?, ?)').run(userId, applied, reason, balance);
  return balance;
}

// +500 daily grant on first activity of the day (active users only).
function ensureDailyGrant(user) {
  if (!user || user.status !== 'active') return user;
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_daily_grant === today) return user;
  db.prepare('UPDATE users SET last_daily_grant = ? WHERE id = ?').run(today, user.id);
  addLedger(user.id, 500, 'Daily grant +500');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

module.exports = { db, getSetting, setSetting, deleteSetting, addLedger, ensureDailyGrant, DB_PATH };
