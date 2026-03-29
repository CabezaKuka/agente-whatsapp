const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = '/app/data';
const DB_PATH = path.join(DB_DIR, 'inbox.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      wa_id TEXT PRIMARY KEY,
      name TEXT,
      last_message_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT,
      meta_message_id TEXT,
      status TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function upsertContact(waId, name = null) {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contacts (wa_id, name, last_message_at)
    VALUES (?, ?, ?)
    ON CONFLICT(wa_id) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      last_message_at = excluded.last_message_at
  `).run(waId, name, now);
}

function saveIncoming({ waId, name = null, text = '', metaMessageId = null }) {
  const now = new Date().toISOString();
  upsertContact(waId, name);

  db.prepare(`
    INSERT INTO messages (wa_id, direction, text, meta_message_id, status, created_at)
    VALUES (?, 'in', ?, ?, NULL, ?)
  `).run(waId, text, metaMessageId, now);
}

function saveOutgoing({ waId, text = '', metaMessageId = null, status = 'sent' }) {
  const now = new Date().toISOString();
  upsertContact(waId, null);

  db.prepare(`
    INSERT INTO messages (wa_id, direction, text, meta_message_id, status, created_at)
    VALUES (?, 'out', ?, ?, ?, ?)
  `).run(waId, text, metaMessageId, status, now);
}

function updateStatus(metaMessageId, status) {
  db.prepare(`
    UPDATE messages
    SET status = ?
    WHERE meta_message_id = ?
  `).run(status, metaMessageId);
}

function getChats() {
  return db.prepare(`
    SELECT wa_id, name, last_message_at
    FROM contacts
    ORDER BY last_message_at DESC
  `).all();
}

function getMessages(waId) {
  return db.prepare(`
    SELECT direction, text, status, created_at
    FROM messages
    WHERE wa_id = ?
    ORDER BY created_at ASC
  `).all(waId);
}

module.exports = {
  initDb,
  saveIncoming,
  saveOutgoing,
  updateStatus,
  getChats,
  getMessages,
};
