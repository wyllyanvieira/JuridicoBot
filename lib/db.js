const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', 'database.sqlite');

if (!fs.existsSync(DB_PATH)) {
  // ensure file exists
  fs.writeFileSync(DB_PATH, '');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) return console.error('SQLite error:', err.message);
});

// Promisify helpers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Initialize tables
const initSql = [
  `CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT UNIQUE,
    title TEXT,
    description TEXT,
    type TEXT,
    status TEXT,
    priority TEXT,
    instance INTEGER,
    court TEXT,
    parties TEXT,
    participants TEXT,
    metadata TEXT,
    timeline TEXT,
    thread_id TEXT,
    created_by TEXT,
    created_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    filename TEXT,
    url TEXT,
    uploaded_by TEXT,
    uploaded_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS hearings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    hearing_at TEXT,
    duration_minutes INTEGER,
    location TEXT,
    created_by TEXT,
    created_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    action TEXT,
    author_id TEXT,
    author_tag TEXT,
    details TEXT,
    created_at TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    roles TEXT,
    created_at TEXT
  );`
];

(async () => {
  try {
    for (const s of initSql) {
      await run(s);
    }
    // Seed metadata: optional
  } catch (err) {
    console.error('Failed to initialize DB:', err);
  }
})();

// Utility functions
async function createCase(payload) {
  // payload: { case_number, title, description, type, status, priority, instance, court, parties (json), participants (json), metadata (json), timeline (json), thread_id, created_by }
  const sql = `INSERT INTO cases (case_number, title, description, type, status, priority, instance, court, parties, participants, metadata, timeline, thread_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const now = new Date().toISOString();
  const params = [
    payload.case_number,
    payload.title || null,
    payload.description || null,
    payload.type || null,
    payload.status || 'Pendente',
    payload.priority ?? null,
    payload.instance || 1,
    payload.court || null,
    JSON.stringify(payload.parties || []),
    JSON.stringify(payload.participants || {}),
    JSON.stringify(payload.metadata || {}),
    JSON.stringify(payload.timeline || []),
    payload.thread_id || null,
    payload.created_by || null,
    now
  ];
  const res = await run(sql, params);
  return get('SELECT * FROM cases WHERE id = ?', [res.lastID]);
}

async function getCaseById(id) {
  return get('SELECT * FROM cases WHERE id = ?', [id]);
}

async function getCaseByNumber(caseNumber) {
  return get('SELECT * FROM cases WHERE case_number = ?', [caseNumber]);
}

async function listCases(limit = 10, offset = 0) {
  return all('SELECT * FROM cases ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
}

async function updateCase(id, updates = {}) {
  const allowed = ['title','description','type','status','priority','instance','court','parties','participants','metadata','timeline','thread_id'];
  const sets = [];
  const params = [];
  for (const k of Object.keys(updates)) {
    if (!allowed.includes(k)) continue;
    let val = updates[k];
    if (k === 'parties' || k === 'participants' || k === 'metadata' || k === 'timeline') {
      val = JSON.stringify(val);
    }
    sets.push(`${k} = ?`);
    params.push(val);
  }
  if (sets.length === 0) return getCaseById(id);
  const sql = `UPDATE cases SET ${sets.join(', ')} WHERE id = ?`;
  params.push(id);
  await run(sql, params);
  return getCaseById(id);
}

async function addDocument(case_id, file) {
  const sql = `INSERT INTO documents (case_id, filename, url, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?)`;
  const now = new Date().toISOString();
  const res = await run(sql, [case_id, file.filename, file.url, file.uploaded_by || null, now]);
  return get('SELECT * FROM documents WHERE id = ?', [res.lastID]);
}

async function addHearing(case_id, hearing) {
  const sql = `INSERT INTO hearings (case_id, hearing_at, duration_minutes, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
  const now = new Date().toISOString();
  const res = await run(sql, [case_id, hearing.hearing_at, hearing.duration_minutes || 60, hearing.location || null, hearing.created_by || null, now]);
  return get('SELECT * FROM hearings WHERE id = ?', [res.lastID]);
}

async function addLog(case_id, action, author_id, author_tag, details) {
  const sql = `INSERT INTO activity_logs (case_id, action, author_id, author_tag, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
  const now = new Date().toISOString();
  const res = await run(sql, [case_id, action, author_id, author_tag, details, now]);
  return get('SELECT * FROM activity_logs WHERE id = ?', [res.lastID]);
}

module.exports = {
  db,
  run,
  get,
  all,
  createCase,
  getCaseById,
  getCaseByNumber,
  listCases,
  updateCase,
  addDocument,
  addHearing,
  addLog
};
