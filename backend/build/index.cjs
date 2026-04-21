"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_config = require("dotenv/config");
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_express5 = __toESM(require("express"), 1);

// src/db/database.ts
var import_bcryptjs3 = __toESM(require("bcryptjs"), 1);

// src/db/mysqlStore.ts
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var import_promise = __toESM(require("mysql2/promise"), 1);
var pool = null;
function requirePool() {
  if (!pool) throw new Error("MySQL pool not initialized");
  return pool;
}
function assertSafeMysqlIdentifier(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`DB_NAME \u4EC5\u5141\u8BB8\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\uFF0C\u5F53\u524D: ${name}`);
  }
}
async function initMysqlStore() {
  const host = process.env.DB_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.DB_PORT?.trim() || "3306");
  const user = process.env.DB_USER?.trim() || "root";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_NAME?.trim() || "matrix_data";
  assertSafeMysqlIdentifier(database);
  const poolSizeRaw = process.env.DB_POOL_SIZE?.trim();
  const charset = process.env.DB_CHARSET?.trim() || "utf8mb4";
  const bootstrap = import_promise.default.createPool({
    host,
    port,
    user,
    password,
    waitForConnections: true,
    connectionLimit: 2
  });
  const b = await bootstrap.getConnection();
  try {
    await b.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    b.release();
    await bootstrap.end();
  }
  pool = import_promise.default.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: poolSizeRaw ? Math.max(1, Number(poolSizeRaw)) : 10,
    charset
  });
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'user',
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS douyin_bindings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        session_id VARCHAR(128) NOT NULL UNIQUE,
        nickname VARCHAR(255) NULL,
        douyin_id VARCHAR(255) NULL,
        avatar_url TEXT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_douyin_bindings_user (user_id),
        CONSTRAINT fk_douyin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS douyin_daily_snapshots (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        session_id VARCHAR(128) NOT NULL,
        snapshot_date DATE NOT NULL,
        likes INT NULL,
        mutual INT NULL,
        following INT NULL,
        followers INT NULL,
        parsed TINYINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uq_daily_snapshot (user_id, session_id, snapshot_date),
        CONSTRAINT fk_daily_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_daily_snap_user_session (user_id, session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } finally {
    conn.release();
  }
}
async function mysqlGetUserByUsername(username) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT id, username, password_hash, role, created_at FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  const r = rows[0];
  if (!r) return void 0;
  return {
    id: Number(r.id),
    username: String(r.username),
    password_hash: String(r.password_hash),
    role: String(r.role),
    created_at: Number(r.created_at)
  };
}
async function mysqlGetUserById(id) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT id, username, role FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  const r = rows[0];
  if (!r) return void 0;
  return { id: Number(r.id), username: String(r.username), role: String(r.role) };
}
async function mysqlCreateUser(username, passwordPlain, role) {
  const p = requirePool();
  const hash = import_bcryptjs.default.hashSync(passwordPlain, 10);
  const [result] = await p.query(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    [username, hash, role, Date.now()]
  );
  return Number(result.insertId);
}
async function mysqlListDouyinBindingsForUser(userId) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT session_id, nickname, douyin_id, avatar_url, updated_at FROM douyin_bindings WHERE user_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  return rows.map((r) => ({
    session_id: String(r.session_id),
    nickname: r.nickname != null ? String(r.nickname) : null,
    douyin_id: r.douyin_id != null ? String(r.douyin_id) : null,
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
    updated_at: Number(r.updated_at)
  }));
}
async function mysqlGetDouyinBindingBySession(sessionId) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT user_id, session_id FROM douyin_bindings WHERE session_id = ? LIMIT 1",
    [sessionId]
  );
  const r = rows[0];
  if (!r) return void 0;
  return { user_id: Number(r.user_id), session_id: String(r.session_id) };
}
async function mysqlUpsertDouyinBinding(userId, sessionId, fields) {
  const p = requirePool();
  const now = Date.now();
  const nickname = fields.nickname ?? null;
  const douyinId = fields.douyinId ?? null;
  const avatarUrl = fields.avatarUrl ?? null;
  await p.query(
    `INSERT INTO douyin_bindings (user_id, session_id, nickname, douyin_id, avatar_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       nickname = VALUES(nickname),
       douyin_id = VALUES(douyin_id),
       avatar_url = VALUES(avatar_url),
       updated_at = VALUES(updated_at)`,
    [userId, sessionId, nickname, douyinId, avatarUrl, now]
  );
}
async function mysqlDeleteDouyinBinding(userId, sessionId) {
  const p = requirePool();
  const [result] = await p.query(
    "DELETE FROM douyin_bindings WHERE user_id = ? AND session_id = ?",
    [userId, sessionId]
  );
  return result.affectedRows;
}
async function mysqlCountUsers() {
  const p = requirePool();
  const [rows] = await p.query("SELECT COUNT(*) AS c FROM users");
  return Number(rows[0]?.c ?? 0);
}
async function mysqlCountDouyinBindings() {
  const p = requirePool();
  const [rows] = await p.query("SELECT COUNT(*) AS c FROM douyin_bindings");
  return Number(rows[0]?.c ?? 0);
}
async function mysqlListAllDouyinBindings() {
  const p = requirePool();
  const [rows] = await p.query("SELECT user_id, session_id FROM douyin_bindings");
  return rows.map((r) => ({ user_id: Number(r.user_id), session_id: String(r.session_id) }));
}
async function mysqlUpsertDailySnapshot(userId, sessionId, snapshotDate, data) {
  const p = requirePool();
  const now = Date.now();
  const parsed = data.parsed ? 1 : 0;
  await p.query(
    `INSERT INTO douyin_daily_snapshots (user_id, session_id, snapshot_date, likes, mutual, following, followers, parsed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       likes = VALUES(likes),
       mutual = VALUES(mutual),
       following = VALUES(following),
       followers = VALUES(followers),
       parsed = VALUES(parsed),
       created_at = VALUES(created_at)`,
    [userId, sessionId, snapshotDate, data.likes, data.mutual, data.following, data.followers, parsed, now]
  );
}
async function mysqlListDailySnapshotDates(userId, sessionId) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT snapshot_date FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? ORDER BY snapshot_date DESC",
    [userId, sessionId]
  );
  return rows.map((r) => {
    const sd = r.snapshot_date;
    return sd instanceof Date ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10);
  });
}
async function mysqlGetDailySnapshot(userId, sessionId, snapshotDate) {
  const p = requirePool();
  const [rows] = await p.query(
    "SELECT snapshot_date, likes, mutual, following, followers, parsed FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? AND snapshot_date = ? LIMIT 1",
    [userId, sessionId, snapshotDate]
  );
  const r = rows[0];
  if (!r) return void 0;
  const sd = r.snapshot_date;
  const dateStr = sd instanceof Date ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10);
  return {
    snapshot_date: dateStr,
    likes: r.likes == null ? null : Number(r.likes),
    mutual: r.mutual == null ? null : Number(r.mutual),
    following: r.following == null ? null : Number(r.following),
    followers: r.followers == null ? null : Number(r.followers),
    parsed: Boolean(r.parsed)
  };
}

// src/db/sqliteStore.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_bcryptjs2 = __toESM(require("bcryptjs"), 1);
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var db = null;
function initSqliteStore() {
  const rawPath = process.env.DATABASE_PATH?.trim() || "data/matrix.db";
  const dbPath = (0, import_node_path.resolve)(process.cwd(), rawPath);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(dbPath), { recursive: true });
  const instance = new import_better_sqlite3.default(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS douyin_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      nickname TEXT,
      douyin_id TEXT,
      avatar_url TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_douyin_bindings_user ON douyin_bindings(user_id);

    CREATE TABLE IF NOT EXISTS douyin_daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      likes INTEGER,
      mutual INTEGER,
      following INTEGER,
      followers INTEGER,
      parsed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, session_id, snapshot_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_snap_user_session ON douyin_daily_snapshots(user_id, session_id);
  `);
  db = instance;
}
function getDb() {
  if (!db) throw new Error("SQLite not initialized");
  return db;
}
function sqliteGetUserByUsername(username) {
  return getDb().prepare("SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?").get(username);
}
function sqliteGetUserById(id) {
  return getDb().prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
}
function sqliteCreateUser(username, passwordPlain, role) {
  const hash = import_bcryptjs2.default.hashSync(passwordPlain, 10);
  const info = getDb().prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)").run(username, hash, role, Date.now());
  return Number(info.lastInsertRowid);
}
function sqliteListDouyinBindingsForUser(userId) {
  return getDb().prepare(
    "SELECT session_id, nickname, douyin_id, avatar_url, updated_at FROM douyin_bindings WHERE user_id = ? ORDER BY updated_at DESC"
  ).all(userId);
}
function sqliteGetDouyinBindingBySession(sessionId) {
  return getDb().prepare("SELECT user_id, session_id FROM douyin_bindings WHERE session_id = ?").get(sessionId);
}
function sqliteUpsertDouyinBinding(userId, sessionId, fields) {
  const now = Date.now();
  const nickname = fields.nickname ?? null;
  const douyinId = fields.douyinId ?? null;
  const avatarUrl = fields.avatarUrl ?? null;
  getDb().prepare(
    `INSERT INTO douyin_bindings (user_id, session_id, nickname, douyin_id, avatar_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         user_id = excluded.user_id,
         nickname = excluded.nickname,
         douyin_id = excluded.douyin_id,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`
  ).run(userId, sessionId, nickname, douyinId, avatarUrl, now);
}
function sqliteDeleteDouyinBinding(userId, sessionId) {
  const r = getDb().prepare("DELETE FROM douyin_bindings WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
  return r.changes;
}
function sqliteCountUsers() {
  const r = getDb().prepare("SELECT COUNT(*) AS c FROM users").get();
  return Number(r.c);
}
function sqliteCountDouyinBindings() {
  const r = getDb().prepare("SELECT COUNT(*) AS c FROM douyin_bindings").get();
  return Number(r.c);
}
function sqliteListAllDouyinBindings() {
  return getDb().prepare("SELECT user_id, session_id FROM douyin_bindings").all();
}
function sqliteUpsertDailySnapshot(userId, sessionId, snapshotDate, data) {
  const now = Date.now();
  const parsed = data.parsed ? 1 : 0;
  getDb().prepare(
    `INSERT INTO douyin_daily_snapshots (user_id, session_id, snapshot_date, likes, mutual, following, followers, parsed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, session_id, snapshot_date) DO UPDATE SET
         likes = excluded.likes,
         mutual = excluded.mutual,
         following = excluded.following,
         followers = excluded.followers,
         parsed = excluded.parsed,
         created_at = excluded.created_at`
  ).run(
    userId,
    sessionId,
    snapshotDate,
    data.likes,
    data.mutual,
    data.following,
    data.followers,
    parsed,
    now
  );
}
function sqliteListDailySnapshotDates(userId, sessionId) {
  const rows = getDb().prepare(
    "SELECT snapshot_date FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? ORDER BY snapshot_date DESC"
  ).all(userId, sessionId);
  return rows.map((r) => String(r.snapshot_date).slice(0, 10));
}
function sqliteGetDailySnapshot(userId, sessionId, snapshotDate) {
  const r = getDb().prepare(
    "SELECT snapshot_date, likes, mutual, following, followers, parsed FROM douyin_daily_snapshots WHERE user_id = ? AND session_id = ? AND snapshot_date = ?"
  ).get(userId, sessionId, snapshotDate);
  if (!r) return void 0;
  return {
    snapshot_date: String(r.snapshot_date),
    likes: r.likes == null ? null : Number(r.likes),
    mutual: r.mutual == null ? null : Number(r.mutual),
    following: r.following == null ? null : Number(r.following),
    followers: r.followers == null ? null : Number(r.followers),
    parsed: Boolean(r.parsed)
  };
}

// src/db/database.ts
var dbMode = "sqlite";
async function initDatabase() {
  const t = (process.env.DB_TYPE || "sqlite").trim().toLowerCase();
  if (t === "mysql") {
    await initMysqlStore();
    dbMode = "mysql";
    const host = process.env.DB_HOST || "127.0.0.1";
    const port = process.env.DB_PORT || "3306";
    console.log(`[db] MySQL ${host}:${port} / ${process.env.DB_NAME || "matrix_data"}`);
  } else {
    initSqliteStore();
    dbMode = "sqlite";
    console.log("[db] SQLite", process.env.DATABASE_PATH?.trim() || "data/matrix.db");
  }
}
async function getUserByUsername(username) {
  if (dbMode === "mysql") return mysqlGetUserByUsername(username);
  return sqliteGetUserByUsername(username);
}
async function getUserById(id) {
  if (dbMode === "mysql") return mysqlGetUserById(id);
  return sqliteGetUserById(id);
}
async function createUser(username, passwordPlain, role) {
  if (dbMode === "mysql") return mysqlCreateUser(username, passwordPlain, role);
  return sqliteCreateUser(username, passwordPlain, role);
}
function verifyPassword(row, passwordPlain) {
  return import_bcryptjs3.default.compareSync(passwordPlain, row.password_hash);
}
async function seedAdminUser() {
  const u = process.env.ADMIN_USERNAME?.trim();
  const p = process.env.ADMIN_PASSWORD?.trim();
  if (!u || !p) {
    console.warn("[auth] ADMIN_USERNAME / ADMIN_PASSWORD \u672A\u914D\u7F6E\uFF0C\u8DF3\u8FC7\u7BA1\u7406\u5458\u79CD\u5B50\u8D26\u53F7");
    return;
  }
  const existing = await getUserByUsername(u);
  if (existing) return;
  await createUser(u, p, "admin");
  console.log("[auth] \u5DF2\u521B\u5EFA\u7BA1\u7406\u5458\u8D26\u53F7:", u);
}
async function listDouyinBindingsForUser(userId) {
  if (dbMode === "mysql") return mysqlListDouyinBindingsForUser(userId);
  return sqliteListDouyinBindingsForUser(userId);
}
async function getDouyinBindingBySession(sessionId) {
  if (dbMode === "mysql") return mysqlGetDouyinBindingBySession(sessionId);
  return sqliteGetDouyinBindingBySession(sessionId);
}
async function upsertDouyinBinding(userId, sessionId, fields) {
  if (dbMode === "mysql") return mysqlUpsertDouyinBinding(userId, sessionId, fields);
  sqliteUpsertDouyinBinding(userId, sessionId, fields);
}
async function deleteDouyinBinding(userId, sessionId) {
  if (dbMode === "mysql") return mysqlDeleteDouyinBinding(userId, sessionId);
  return sqliteDeleteDouyinBinding(userId, sessionId);
}
async function countUsers() {
  if (dbMode === "mysql") return mysqlCountUsers();
  return sqliteCountUsers();
}
async function countDouyinBindings() {
  if (dbMode === "mysql") return mysqlCountDouyinBindings();
  return sqliteCountDouyinBindings();
}
async function listAllDouyinBindings() {
  if (dbMode === "mysql") return mysqlListAllDouyinBindings();
  return sqliteListAllDouyinBindings();
}
async function upsertDailySnapshot(userId, sessionId, snapshotDate, data) {
  if (dbMode === "mysql") return mysqlUpsertDailySnapshot(userId, sessionId, snapshotDate, data);
  sqliteUpsertDailySnapshot(userId, sessionId, snapshotDate, data);
}
async function getDailySnapshot(userId, sessionId, snapshotDate) {
  if (dbMode === "mysql") return mysqlGetDailySnapshot(userId, sessionId, snapshotDate);
  return sqliteGetDailySnapshot(userId, sessionId, snapshotDate);
}
async function listDailySnapshotDates(userId, sessionId) {
  if (dbMode === "mysql") return mysqlListDailySnapshotDates(userId, sessionId);
  return sqliteListDailySnapshotDates(userId, sessionId);
}

// src/jobs/dailyDouyinSnapshot.ts
var import_node_cron = __toESM(require("node-cron"), 1);

// src/douyin/playwrightLogin.ts
var import_node_crypto = require("node:crypto");

// src/douyin/playwrightCookieImport.ts
var DEFAULT_DOMAIN = ".douyin.com";
var DEFAULT_PATH = "/";
function normalizeImportedCookie(partial) {
  const name = typeof partial.name === "string" ? partial.name.trim() : "";
  const value = typeof partial.value === "string" ? partial.value : String(partial.value ?? "");
  if (!name) return null;
  const domain = typeof partial.domain === "string" && partial.domain.trim().length > 0 ? partial.domain.trim() : DEFAULT_DOMAIN;
  const path5 = typeof partial.path === "string" && partial.path.trim().length > 0 ? partial.path.trim() : DEFAULT_PATH;
  let expires = -1;
  if (typeof partial.expires === "number" && Number.isFinite(partial.expires)) expires = partial.expires;
  return {
    name,
    value,
    domain,
    path: path5,
    expires,
    httpOnly: partial.httpOnly === true,
    secure: partial.secure !== false,
    sameSite: partial.sameSite ?? "Lax"
  };
}
function parseDouyinCookiePaste(raw) {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return [];
      const out2 = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const c = normalizeImportedCookie(item);
        if (c) out2.push(c);
      }
      return dedupeCookies(out2);
    } catch {
      return [];
    }
  }
  let lineSource = text;
  const m = /(?:^|\n)\s*Cookie:\s*(.+)/i.exec(text);
  if (m?.[1]) lineSource = m[1].trim();
  const segments = lineSource.split(/[\n\r]+|;/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of segments) {
    if (seg.startsWith("#")) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    let value = seg.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!name || name.toLowerCase() === "path" || name.toLowerCase() === "domain") continue;
    out.push({
      name,
      value,
      domain: DEFAULT_DOMAIN,
      path: DEFAULT_PATH,
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    });
  }
  return dedupeCookies(out);
}
function dedupeCookies(cookies) {
  const map = /* @__PURE__ */ new Map();
  for (const c of cookies) {
    const key = `${c.domain}|${c.path}|${c.name}`;
    map.set(key, c);
  }
  return [...map.values()];
}
function looksLikeDouyinAuthCookies(cookies) {
  if (cookies.length < 2) return false;
  const names = cookies.map((c) => c.name.toLowerCase());
  return names.some(
    (n) => n.includes("sessionid") || n.includes("session_ssid") || n.includes("sid_tt") || n.includes("odin") || n.includes("passport") || n.includes("ttwid") || n.includes("ms_token")
  );
}

// src/douyin/playwrightSessionDisk.ts
var import_promises = require("node:fs/promises");
var import_node_path2 = __toESM(require("node:path"), 1);
var DATA_DIR = import_node_path2.default.join(process.cwd(), "data");
var SESSION_FILE = import_node_path2.default.join(DATA_DIR, "douyin-playwright-sessions.json");
async function readDiskSessions() {
  try {
    const buf = await (0, import_promises.readFile)(SESSION_FILE, "utf8");
    const parsed = JSON.parse(buf);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.filter(
      (r) => r && typeof r.id === "string" && typeof r.createdAt === "number" && Array.isArray(r.cookies) && r.cookies.length > 0
    );
  } catch {
    return [];
  }
}
async function writeDiskSessions(rows) {
  await (0, import_promises.mkdir)(DATA_DIR, { recursive: true });
  const payload = { version: 1, sessions: rows };
  await (0, import_promises.writeFile)(SESSION_FILE, JSON.stringify(payload), "utf8");
}

// src/douyin/playwrightLogin.ts
var CREATOR_URL = "https://creator.douyin.com/";
var store = /* @__PURE__ */ new Map();
var cookieVault = /* @__PURE__ */ new Map();
var DEFAULT_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
var MIN_SESSION_TTL_MS = 60 * 1e3;
var MAX_SESSION_TTL_MS = 3650 * 24 * 60 * 60 * 1e3;
function getSessionTtlMs() {
  const raw = process.env.DOUYIN_PLAYWRIGHT_SESSION_TTL_MS;
  if (!raw?.trim()) return DEFAULT_SESSION_TTL_MS;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_SESSION_TTL_MS;
  return Math.min(Math.max(n, MIN_SESSION_TTL_MS), MAX_SESSION_TTL_MS);
}
var persistTimer = null;
function schedulePersistSessions() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushSessionsToDisk();
  }, 2e3);
}
async function flushSessionsToDisk() {
  const rows = [];
  for (const [id, s] of store) {
    if (s.phase !== "logged_in") continue;
    const cookies = cookieVault.get(id);
    if (!cookies?.length) continue;
    rows.push({
      id,
      createdAt: s.createdAt,
      user: s.user,
      cookies
    });
  }
  try {
    await writeDiskSessions(rows);
  } catch (e) {
    console.error("[douyin] persist sessions failed", e);
  }
}
async function initPlaywrightSessionsFromDisk() {
  const rows = await readDiskSessions();
  const ttl = getSessionTtlMs();
  const now = Date.now();
  let n = 0;
  for (const row of rows) {
    if (now - row.createdAt > ttl) continue;
    store.set(row.id, {
      id: row.id,
      phase: "logged_in",
      hint: "\u5DF2\u4ECE\u670D\u52A1\u7AEF\u672C\u5730\u6062\u590D\uFF08\u626B\u7801\u6216 Cookie \u5BFC\u5165\uFF09",
      createdAt: row.createdAt,
      user: row.user,
      cookieCount: row.cookies.length
    });
    cookieVault.set(row.id, row.cookies);
    n++;
  }
  if (n > 0) console.log(`[douyin] restored ${n} session(s) from disk`);
}
function prune() {
  const now = Date.now();
  const ttl = getSessionTtlMs();
  let removed = false;
  for (const [id, s] of store) {
    if (now - s.createdAt > ttl) {
      store.delete(id);
      cookieVault.delete(id);
      removed = true;
    }
  }
  if (removed) schedulePersistSessions();
}
function touchLoggedInSessionTtl(id) {
  const cur = store.get(id);
  if (cur?.phase === "logged_in") {
    cur.createdAt = Date.now();
    store.set(id, cur);
    schedulePersistSessions();
  }
}
function getPlaywrightCookieVault(sessionId) {
  prune();
  const cookies = cookieVault.get(sessionId);
  if (cookies?.length) touchLoggedInSessionTtl(sessionId);
  return cookies;
}
function createPlaywrightSessionRecord() {
  prune();
  const id = (0, import_node_crypto.randomUUID)();
  const s = {
    id,
    phase: "preparing",
    hint: "\u6B63\u5728\u542F\u52A8\u6D4F\u89C8\u5668\u5E76\u6253\u5F00\u6296\u97F3\u521B\u4F5C\u8005\u4E2D\u5FC3\u2026",
    createdAt: Date.now()
  };
  store.set(id, s);
  return s;
}
function getPlaywrightSession(id) {
  prune();
  const s = store.get(id);
  if (s?.phase === "logged_in") touchLoggedInSessionTtl(id);
  return s;
}
function deletePlaywrightSession(id) {
  const had = store.has(id) || cookieVault.has(id);
  store.delete(id);
  cookieVault.delete(id);
  schedulePersistSessions();
  return had;
}
function patch(id, partial) {
  const cur = store.get(id);
  if (!cur) return;
  Object.assign(cur, partial);
  store.set(id, cur);
  if (cur.phase === "logged_in") schedulePersistSessions();
}
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function isQrOrLoginModalOpen(page) {
  const scanTitle = await page.getByText(/扫码登录/).first().isVisible().catch(() => false);
  if (scanTitle) return true;
  const openDouyin = await page.getByText(/打开抖音/).first().isVisible().catch(() => false);
  if (openDouyin) return true;
  const qrImg = await page.locator('img[src*="qrcode" i]').first().isVisible().catch(() => false);
  if (qrImg) return true;
  const loginDialog = await page.locator('[role="dialog"]').filter({ hasText: /登录|扫码/ }).first().isVisible().catch(() => false);
  return loginDialog;
}
async function isCreatorBackendVisible(page) {
  const keywords = /数据概览|内容管理|作品管理|发布作品|创作服务平台|创作首页|数据中心|互动管理|直播管理|上传视频|发布视频|抖音号|粉丝数|累计粉丝/;
  const tab = await page.getByText(keywords).first().isVisible({ timeout: 800 }).catch(() => false);
  if (tab) return true;
  try {
    const { pathname } = new URL(page.url());
    if (/^\/(creator-micro\/)?(home|data|content|publish|upload)/i.test(pathname)) return true;
  } catch {
  }
  return false;
}
async function hasStrongCreatorSession(context) {
  const cookies = await context.cookies();
  for (const c of cookies) {
    if (!/douyin\.com|bytedance\.com/i.test(c.domain)) continue;
    if (/sessionid|session_ssid|passport_auth|passport_csrf|sid_guard|sso/i.test(c.name)) {
      return true;
    }
  }
  return false;
}
function isLikelyUserAvatarSrc(src) {
  const lower = src.toLowerCase();
  if (lower.includes("qrcode") || lower.includes("qr_code") || lower.includes("login")) return false;
  if (lower.includes("logo") && !lower.includes("avatar")) return false;
  return lower.includes("douyinpic.com") || lower.includes("byteimg.com") || lower.includes("p3-sign") || lower.includes("p26-sign") || /\/aweme\/avatar\//i.test(lower);
}
function extractUserFromApiJson(o, depth = 0) {
  if (depth > 28 || o === null || o === void 0) return {};
  if (Array.isArray(o)) {
    const m = {};
    for (const item of o) {
      Object.assign(m, extractUserFromApiJson(item, depth + 1));
    }
    return m;
  }
  if (typeof o !== "object") return {};
  const out = {};
  const obj = o;
  if (typeof obj.nickname === "string" && obj.nickname.length >= 1 && obj.nickname.length < 80) {
    if (!/^\d{8,}$/.test(obj.nickname)) out.nickname = obj.nickname;
  }
  if (typeof obj.screen_name === "string" && obj.screen_name.length >= 1 && obj.screen_name.length < 80) {
    out.nickname = out.nickname ?? obj.screen_name;
  }
  if (typeof obj.display_name === "string" && obj.display_name.length >= 1 && obj.display_name.length < 80) {
    out.nickname = out.nickname ?? obj.display_name;
  }
  const pickAvatarUrl = (x) => {
    if (typeof x === "string" && x.startsWith("http") && isLikelyUserAvatarSrc(x)) return x;
    if (x && typeof x === "object") {
      const u = x;
      const first = u.url_list?.[0];
      if (typeof first === "string" && isLikelyUserAvatarSrc(first)) return first;
    }
    return void 0;
  };
  for (const key of ["avatar_300x300", "avatar_thumb", "avatar_medium", "avatar_larger", "user_avatar", "avatar"]) {
    const a = obj[key];
    const url = pickAvatarUrl(a);
    if (url) {
      out.avatarUrl = url;
      break;
    }
  }
  if (typeof obj.avatar_url === "string" && isLikelyUserAvatarSrc(obj.avatar_url)) {
    out.avatarUrl = out.avatarUrl ?? obj.avatar_url;
  }
  for (const uk of ["unique_id", "short_id", "user_id", "uid", "douyin_id"]) {
    const v = obj[uk];
    if (v === null || v === void 0) continue;
    const s = String(v).replace(/\D/g, "");
    if (s.length >= 5 && s.length <= 20) {
      out.douyinId = s;
      break;
    }
  }
  const nestedKeys = ["user", "user_info", "userInfo", "profile", "data", "owner", "author"];
  for (const nk of nestedKeys) {
    const v = obj[nk];
    if (v !== null && typeof v === "object") {
      Object.assign(out, extractUserFromApiJson(v, depth + 1));
    }
  }
  return out;
}
async function collectNetworkUserHintsDuring(page, action) {
  const merged = {};
  const onResponse = async (response) => {
    try {
      const url = response.url();
      if (!/douyin\.com|snssdk\.com|bytedance\.com|amemv\.com/i.test(url)) return;
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      if (response.status() !== 200) return;
      const json = await response.json();
      const part = extractUserFromApiJson(json);
      if (part.nickname) merged.nickname = part.nickname;
      if (part.avatarUrl) merged.avatarUrl = part.avatarUrl;
      if (part.douyinId) merged.douyinId = part.douyinId;
    } catch {
    }
  };
  page.on("response", onResponse);
  try {
    await action();
    await delay(1400);
  } finally {
    page.off("response", onResponse);
  }
  return merged;
}
async function tryFetchUserApis(page) {
  const urls = [
    "https://creator.douyin.com/web/api/media/user/info/",
    "https://creator.douyin.com/aweme/v1/creator/user/info/",
    "https://creator.douyin.com/passport/account/info/v2/"
  ];
  const merged = {};
  for (const url of urls) {
    try {
      const res = await page.request.get(url, { timeout: 15e3 });
      if (!res.ok()) continue;
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("json")) continue;
      const json = await res.json();
      Object.assign(merged, extractUserFromApiJson(json));
      if (merged.nickname && merged.avatarUrl) break;
    } catch {
    }
  }
  return merged;
}
function buildTokenPreviewFromCookies(cookies) {
  const prefer = [/sessionid/i, /session_ssid/i, /sid_tt/i, /msToken/i, /passport_csrf_token/i];
  for (const re of prefer) {
    const c = cookies.find((x) => re.test(x.name) && /douyin|bytedance|\.com/i.test(x.domain));
    if (!c?.value || c.value.length < 4) continue;
    const v = c.value;
    const masked = v.length <= 16 ? `${v.slice(0, 3)}\u2026` : `${v.slice(0, 4)}\u2026${v.slice(-4)}`;
    return `${c.name}=${masked}`;
  }
  return void 0;
}
function buildTokenFullLineFromCookies(cookies) {
  const prefer = [/sessionid/i, /session_ssid/i, /sid_tt/i, /msToken/i, /passport_csrf_token/i];
  for (const re of prefer) {
    const c = cookies.find((x) => re.test(x.name) && /douyin|bytedance|\.com/i.test(x.domain));
    if (!c?.value) continue;
    return `${c.name}=${c.value}`;
  }
  return void 0;
}
function buildCookieHeaderForHost(cookies, host) {
  const hostLower = host.toLowerCase();
  const parts = [];
  for (const c of cookies) {
    const raw = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const d = raw.toLowerCase();
    if (hostLower === d || hostLower.endsWith(`.${d}`)) parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
}
async function fetchUserHintsWithCookieArray(cookies) {
  const merged = {};
  const urls = [
    "https://creator.douyin.com/web/api/media/user/info/",
    "https://creator.douyin.com/aweme/v1/creator/user/info/",
    "https://creator.douyin.com/passport/account/info/v2/"
  ];
  for (const url of urls) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const ch = buildCookieHeaderForHost(cookies, host);
    if (!ch) continue;
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: ch,
          Referer: "https://creator.douyin.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*"
        }
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue;
      const json = await res.json();
      const part = extractUserFromApiJson(json);
      if (part.nickname) merged.nickname = part.nickname;
      if (part.avatarUrl) merged.avatarUrl = part.avatarUrl;
      if (part.douyinId) merged.douyinId = part.douyinId;
      if (merged.nickname && merged.avatarUrl) break;
    } catch {
    }
  }
  merged.tokenPreview = buildTokenPreviewFromCookies(cookies);
  merged.tokenFullLine = buildTokenFullLineFromCookies(cookies);
  return merged;
}
async function importPlaywrightSessionFromTokens(raw) {
  prune();
  const cookies = parseDouyinCookiePaste(raw);
  if (cookies.length < 1) {
    return {
      ok: false,
      error: "\u672A\u80FD\u89E3\u6790\u51FA Cookie\u3002\u652F\u6301\uFF1A\u591A\u884C name=value\u3001\u5206\u53F7\u5206\u9694\u3001\u6216 JSON \u6570\u7EC4 [{name,value,domain?}]"
    };
  }
  if (!looksLikeDouyinAuthCookies(cookies)) {
    return {
      ok: false,
      error: "\u672A\u8BC6\u522B\u5230\u5E38\u89C1\u6296\u97F3\u767B\u5F55 Cookie\uFF08\u5982 sessionid\u3001sid_tt\u3001passport \u7B49\uFF09\u3002\u8BF7\u5728 Chrome \u5F00\u53D1\u8005\u5DE5\u5177 \u2192 Application \u2192 Cookies \u4E0B\u5BF9 creator.douyin.com / .douyin.com \u590D\u5236\u3002"
    };
  }
  const id = (0, import_node_crypto.randomUUID)();
  const user = await fetchUserHintsWithCookieArray(cookies);
  cookieVault.set(id, cookies);
  store.set(id, {
    id,
    phase: "logged_in",
    hint: "\u5DF2\u901A\u8FC7 Cookie / Token \u5BFC\u5165\uFF08\u5DF2\u5199\u5165\u670D\u52A1\u7AEF\u672C\u5730\uFF0C\u91CD\u542F\u540E\u81EA\u52A8\u6062\u590D\uFF09",
    createdAt: Date.now(),
    user,
    cookieCount: cookies.length
  });
  schedulePersistSessions();
  const hasProfile = Boolean(user.nickname?.trim() || user.douyinId?.trim() || user.avatarUrl?.trim());
  if (hasProfile) return { ok: true, sessionId: id, user };
  if (user.tokenPreview || user.tokenFullLine) return { ok: true, sessionId: id, user: { tokenPreview: user.tokenPreview, tokenFullLine: user.tokenFullLine } };
  return { ok: true, sessionId: id, user: null };
}
async function scrapeFromEmbeddedJson(page) {
  return page.evaluate(() => {
    function dig(obj, depth) {
      if (depth > 18 || obj === null || typeof obj !== "object") return {};
      const acc = {};
      const o = obj;
      for (const k of Object.keys(o)) {
        const v = o[k];
        const kl = k.toLowerCase();
        if (typeof v === "string") {
          if ((kl.includes("nickname") || kl === "nick_name" || kl === "screen_name" || kl === "user_name") && v.length > 0 && v.length < 80 && !/^[\d\s]+$/.test(v)) {
            if (!v.includes("\u767B\u5F55") && !v.includes("\u626B\u7801")) acc.n = v;
          }
          if (/^https?:\/\//.test(v) && (kl.includes("avatar") || kl.includes("avatarurl") || kl.includes("url") && kl.includes("user")) && !/qr|login|logo|qrcode/i.test(v)) {
            acc.a = v;
          }
        }
        if ((kl === "uid" || kl === "user_id" || kl === "user_unique_id" || kl === "short_id") && v !== null && v !== void 0) {
          const s = String(v).replace(/\D/g, "");
          if (s.length >= 5) acc.u = s;
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            const sub = dig(item, depth + 1);
            if (!acc.n && sub.n) acc.n = sub.n;
            if (!acc.a && sub.a) acc.a = sub.a;
            if (!acc.u && sub.u) acc.u = sub.u;
          }
        } else if (typeof v === "object" && v !== null) {
          const sub = dig(v, depth + 1);
          if (!acc.n && sub.n) acc.n = sub.n;
          if (!acc.a && sub.a) acc.a = sub.a;
          if (!acc.u && sub.u) acc.u = sub.u;
        }
      }
      return acc;
    }
    const out = {};
    const next = globalThis.document.getElementById(
      "__NEXT_DATA__"
    );
    if (next?.textContent) {
      try {
        const data = JSON.parse(next.textContent);
        const r = dig(data, 0);
        if (r.n) out.nickname = r.n;
        if (r.a) out.avatarUrl = r.a;
        if (r.u) out.douyinId = r.u;
      } catch {
      }
    }
    return out;
  });
}
async function scrapeCreatorUserProfile(page, cookies, preMerged) {
  try {
    await delay(600);
    const out = { ...preMerged };
    const embedded = await scrapeFromEmbeddedJson(page);
    if (!out.nickname && embedded.nickname) out.nickname = embedded.nickname;
    if (!out.avatarUrl && embedded.avatarUrl) out.avatarUrl = embedded.avatarUrl;
    if (!out.douyinId && embedded.douyinId) out.douyinId = embedded.douyinId;
    try {
      const headerUser = page.locator("header").locator('[class*="avatar" i], [class*="user" i]').first();
      if (await headerUser.isVisible({ timeout: 2e3 }).catch(() => false)) {
        await headerUser.click({ timeout: 2e3 }).catch(() => {
        });
        await delay(500);
        const pop = page.locator('[class*="popover" i], [class*="dropdown" i], [role="menu"]').first();
        const nickInMenu = await pop.locator("span, div").filter({ hasNotText: /设置|退出|管理/ }).first().textContent({ timeout: 1500 }).catch(() => null);
        const s = nickInMenu?.trim();
        if (s && s.length >= 2 && s.length < 50 && !out.nickname) out.nickname = s;
      }
    } catch {
    }
    if (!out.nickname) {
      const nickLocators = [
        page.locator('[class*="nickname" i]').first(),
        page.locator('[class*="userName" i]').first(),
        page.locator('[class*="user-name" i]').first(),
        page.locator("aside").locator('[class*="name" i]').first(),
        page.getByRole("navigation").locator("span").first()
      ];
      for (const loc of nickLocators) {
        const t = await loc.textContent({ timeout: 1e3 }).catch(() => null);
        const s = t?.trim();
        if (s && s.length >= 2 && s.length <= 80 && !/数据概览|内容管理/.test(s)) {
          out.nickname = s;
          break;
        }
      }
    }
    if (!out.avatarUrl) {
      const imgs = page.locator('img[src*="http"]');
      const n = await imgs.count();
      for (let i = 0; i < Math.min(n, 40); i++) {
        const src = await imgs.nth(i).getAttribute("src").catch(() => null);
        if (!src || src.startsWith("data:")) continue;
        if (!isLikelyUserAvatarSrc(src)) continue;
        try {
          out.avatarUrl = src.startsWith("http") ? src : new URL(src, page.url()).href;
          break;
        } catch {
          out.avatarUrl = src;
          break;
        }
      }
    }
    try {
      const { pathname } = new URL(page.url());
      const m = pathname.match(/\/(?:user\/)?(\d{5,})/);
      if (m && !out.douyinId) out.douyinId = m[1];
    } catch {
    }
    out.tokenPreview = buildTokenPreviewFromCookies(cookies);
    out.tokenFullLine = buildTokenFullLineFromCookies(cookies);
    return out;
  } catch {
    return {
      ...preMerged,
      tokenPreview: buildTokenPreviewFromCookies(cookies),
      tokenFullLine: buildTokenFullLineFromCookies(cookies)
    };
  }
}
async function tryExtractQrUrl(page) {
  const imgs = page.locator("img");
  const n = await imgs.count();
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    const src = await img.getAttribute("src").catch(() => null);
    if (!src) continue;
    const lower = src.toLowerCase();
    if (lower.includes("qrcode") || lower.includes("qr") || lower.includes("login")) {
      try {
        return src.startsWith("http") ? src : new URL(src, page.url()).href;
      } catch {
        return src;
      }
    }
  }
  const html = await page.content().catch(() => "");
  const m = html.match(/https?:\/\/[^\s"'<>]+(?:qrcode|qr)[^\s"'<>]*/i);
  return m?.[0];
}
async function captureQrForDisplay(page) {
  const shells = [
    page.locator('[role="dialog"]').first(),
    page.locator(".semi-modal").first(),
    page.locator('[class*="modal" i]').filter({ hasText: /扫码|登录|抖音/ }).first()
  ];
  for (const shell of shells) {
    if (!await shell.isVisible().catch(() => false)) continue;
    const imgs = shell.locator("img");
    const count = await imgs.count();
    for (let i = 0; i < count; i++) {
      const img = imgs.nth(i);
      if (!await img.isVisible().catch(() => false)) continue;
      try {
        const buf = await img.screenshot({ type: "png" });
        return `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
      }
    }
    const canvas = shell.locator("canvas").first();
    if (await canvas.isVisible().catch(() => false)) {
      try {
        const buf = await canvas.screenshot({ type: "png" });
        return `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
      }
    }
    try {
      const buf = await shell.screenshot({ type: "png" });
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
    }
  }
  return void 0;
}
async function fetchImageUrlAsDataUrl(page, href) {
  if (!href || href.startsWith("blob:") || href.startsWith("data:")) {
    return void 0;
  }
  try {
    const abs = href.startsWith("http") ? href : new URL(href, page.url()).href;
    const res = await page.request.get(abs);
    if (!res.ok()) return void 0;
    const buf = await res.body();
    if (buf.length === 0) return void 0;
    const rawCt = res.headers()["content-type"];
    const ct = typeof rawCt === "string" ? rawCt.split(";")[0]?.trim() ?? "image/png" : "image/png";
    if (!ct.startsWith("image/") && !ct.includes("octet-stream")) {
      return void 0;
    }
    const mime = ct.includes("octet-stream") ? "image/png" : ct;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return void 0;
  }
}
async function tryScreenshotQr(page) {
  const candidates = [
    page.locator('[class*="qrcode" i], [class*="qr-code" i]').first(),
    page.locator('img[src*="qr" i], img[src*="login" i]').first(),
    page.locator("canvas").first()
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 2e3 }).catch(() => false)) {
        const buf = await loc.screenshot({ type: "png" });
        return `data:image/png;base64,${buf.toString("base64")}`;
      }
    } catch {
    }
  }
  try {
    const buf = await page.screenshot({ type: "png", fullPage: true });
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return void 0;
  }
}
async function cleanup(browser) {
  try {
    await browser?.close();
  } catch {
  }
}
function runPlaywrightLoginJob(sessionId) {
  void (async () => {
    let browser;
    try {
      const { chromium } = await import("playwright");
      const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== "false";
      browser = await chromium.launch({
        headless,
        args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "zh-CN"
      });
      const page = await context.newPage();
      await page.goto(CREATOR_URL, { waitUntil: "domcontentloaded", timeout: 9e4 });
      await delay(5e3);
      try {
        const loginBtn = page.locator('button:has-text("\u767B\u5F55"), a:has-text("\u767B\u5F55")').first();
        await loginBtn.click({ timeout: 8e3 });
      } catch {
        try {
          await page.locator('[class*="login" i]').first().click({ timeout: 3e3 });
        } catch {
        }
      }
      await delay(3e3);
      const qrcodeUrl = await tryExtractQrUrl(page);
      let qrcodeDataUrl = await captureQrForDisplay(page) ?? (qrcodeUrl ? await fetchImageUrlAsDataUrl(page, qrcodeUrl) : void 0) ?? await tryScreenshotQr(page);
      if (!qrcodeUrl && !qrcodeDataUrl) {
        patch(sessionId, {
          phase: "error",
          hint: "",
          error: "\u672A\u627E\u5230\u4E8C\u7EF4\u7801\uFF08\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u66F4\uFF09\u3002\u53EF\u5C1D\u8BD5\u8BBE\u7F6E DOUYIN_PLAYWRIGHT_HEADLESS=false \u4F7F\u7528\u6709\u5934\u6A21\u5F0F\u3002"
        });
        await cleanup(browser);
        return;
      }
      patch(sessionId, {
        phase: "awaiting_scan",
        hint: "\u8BF7\u4F7F\u7528\u6296\u97F3 App \u626B\u7801\u767B\u5F55\u521B\u4F5C\u8005\u5E73\u53F0",
        qrcodeUrl,
        qrcodeDataUrl
      });
      const loginPollMs = 850;
      const maxTicks = 106;
      for (let i = 0; i < maxTicks; i++) {
        await page.waitForLoadState("domcontentloaded").catch(() => {
        });
        const loginUiOpen = await isQrOrLoginModalOpen(page);
        if (loginUiOpen) {
          await delay(loginPollMs);
          continue;
        }
        const onCreator = page.url().includes("creator.douyin.com");
        const backendVisible = onCreator && await isCreatorBackendVisible(page);
        const cookieOk = onCreator && await hasStrongCreatorSession(context);
        if (!backendVisible && !cookieOk) {
          await delay(loginPollMs);
          continue;
        }
        let cookies = await context.cookies();
        if (!store.get(sessionId)) {
          await context.close().catch(() => {
          });
          await cleanup(browser);
          return;
        }
        const netHints = await collectNetworkUserHintsDuring(page, async () => {
          try {
            await page.goto("https://creator.douyin.com/creator-micro/home", {
              waitUntil: "domcontentloaded",
              timeout: 25e3
            });
            await delay(320);
          } catch {
          }
        });
        cookies = await context.cookies();
        const apiHints = await tryFetchUserApis(page);
        const user = await scrapeCreatorUserProfile(page, cookies, { ...netHints, ...apiHints });
        if (!store.get(sessionId)) {
          await context.close().catch(() => {
          });
          await cleanup(browser);
          return;
        }
        cookieVault.set(sessionId, cookies);
        patch(sessionId, {
          phase: "logged_in",
          hint: "\u767B\u5F55\u6210\u529F\uFF08\u4F1A\u8BDD\u5DF2\u4FDD\u5B58\u5728\u670D\u52A1\u7AEF\uFF0C\u53EF\u7528\u4E8E\u540E\u7EED\u77E9\u9635\u63A5\u53E3\uFF09",
          cookieCount: cookies.length,
          user,
          qrcodeUrl: void 0,
          qrcodeDataUrl: void 0
        });
        await context.close().catch(() => {
        });
        await cleanup(browser);
        return;
      }
      patch(sessionId, {
        phase: "expired",
        hint: "\u7B49\u5F85\u626B\u7801\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"
      });
      await context.close().catch(() => {
      });
      await cleanup(browser);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = msg.includes("Executable doesn") || msg.includes("browserType.launch") ? "\u672A\u68C0\u6D4B\u5230 Chromium\uFF0C\u8BF7\u5728 backend \u76EE\u5F55\u6267\u884C\uFF1Anpx playwright install chromium" : msg;
      patch(sessionId, {
        phase: "error",
        hint: "",
        error: hint
      });
      await cleanup(browser);
    }
  })();
}

// src/douyin/creatorAccountStats.ts
var CREATOR_ORIGIN = "https://creator.douyin.com";
function buildCookieHeader(cookies, requestHost) {
  const host = requestHost.toLowerCase();
  return cookies.filter((c) => {
    const raw = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const d = raw.toLowerCase();
    if (host === d) return true;
    if (host.endsWith("." + d)) return true;
    return false;
  }).map((c) => `${c.name}=${c.value}`).join("; ");
}
function isNonNegInt(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}
function parseNonNegNumber(v) {
  if (isNonNegInt(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const x = parseInt(v, 10);
    if (x >= 0) return x;
  }
  return void 0;
}
function keyLooksLikeMutualFollowCount(key) {
  const k = key.toLowerCase();
  if (k.includes("\u4E92\u5173") || k.includes("\u4E92\u7C89")) return true;
  if (k.includes("mutually")) return false;
  if (/mutual[_\s]?follow|mutualfollow|mutual_cnt|mutual_count/i.test(k)) {
    if (/following|follower|fans/i.test(k) && !/mutual/i.test(k)) return false;
    return true;
  }
  if (/friend[_\s]?follow|friendfollow|follow[_\s]?friend/i.test(k)) return true;
  if (/bilateral|each[_\s]?other|双向关注/i.test(k)) return true;
  if (/mplatform.*mutual|^m_friend|^mfriend/i.test(k)) return true;
  if (/double_follow|双向好友|互相关注/i.test(k)) return true;
  if (/bi[_\s-]?follow|bifollow|two[_\s-]?way|双向互关|互关好友|互关数/i.test(k)) return true;
  return false;
}
function extractStatsFromJson(o, depth = 0) {
  if (depth > 32 || o === null || typeof o !== "object") return {};
  const acc = {};
  if (!Array.isArray(o)) {
    const r = o;
    const trySet = (key, ...names) => {
      if (acc[key] !== void 0) return;
      for (const n of names) {
        const v = r[n];
        const parsed = parseNonNegNumber(v);
        if (parsed !== void 0) {
          acc[key] = parsed;
          return;
        }
      }
    };
    trySet(
      "likes",
      "total_favorited",
      "total_favorited_count",
      "totalFavorited",
      "favorited_count",
      "digg_count",
      "like_count"
    );
    trySet("following", "following_count", "following_cnt", "follow_count", "followingCount", "mplatform_following_count");
    trySet(
      "followers",
      "follower_count",
      "followers_count",
      "mplatform_followers_count",
      "fans_count",
      "follower_cnt",
      "followerCount"
    );
    trySet(
      "mutual",
      "mutual_follow_count",
      "mutual_follow_cnt",
      "mutual_follow_num",
      "mutualFollowCount",
      "mutualFollowCnt",
      "friend_follow_count",
      "friendFollowCount",
      "friend_follow_cnt",
      "bilateral_follow_count",
      "bilateralFollowCount",
      "both_follow_count",
      "bothFollowCount",
      "each_follow_count",
      "mplatform_mutual_follow_count",
      "mplatform_friend_follow_count",
      "interaction_mutual_follow_count",
      "mutual_count",
      "mutual_friend_count",
      "mutualFriendCount",
      /** 抖音主站/部分接口用「双向关注」表示互关 */
      "bi_follow_count",
      "bi_follow_cnt",
      "biFollowCount",
      "bifollow_count",
      "two_way_follow_count",
      "twoWayFollowCount",
      "mate_follow_count",
      "friend_relation_count",
      "social_friend_count"
    );
    if (acc.mutual === void 0) {
      for (const key of Object.keys(r)) {
        if (!keyLooksLikeMutualFollowCount(key)) continue;
        const parsed = parseNonNegNumber(r[key]);
        if (parsed !== void 0) {
          acc.mutual = parsed;
          break;
        }
      }
    }
  }
  const nested = Array.isArray(o) ? o : Object.values(o);
  for (const v of nested) {
    if (v !== null && typeof v === "object") {
      Object.assign(acc, extractStatsFromJson(v, depth + 1));
    }
  }
  return acc;
}
async function tryFetchJsonFrom(cookies, origin, path5, referer) {
  const base = origin.replace(/\/$/, "");
  const url = `${base}${path5.startsWith("/") ? path5 : `/${path5}`}`;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { json: null, ok: false };
  }
  const cookie = buildCookieHeader(cookies, host);
  if (!cookie) return { json: null, ok: false };
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: cookie,
        Referer: referer ?? `${base}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*"
      }
    });
    if (!res.ok) return { json: null, ok: false };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return { json: null, ok: false };
    const json = await res.json();
    return { json, ok: true };
  } catch {
    return { json: null, ok: false };
  }
}
function tryFetchJson(cookies, path5) {
  return tryFetchJsonFrom(cookies, CREATOR_ORIGIN, path5, `${CREATOR_ORIGIN}/`);
}
function extractMutualByRegexFromJsonBodies(bodies) {
  const patterns = [
    /"friend_follow_count"\s*:\s*(\d+)/,
    /"friendFollowCount"\s*:\s*(\d+)/,
    /"mutual_follow_count"\s*:\s*(\d+)/,
    /"mutualFollowCount"\s*:\s*(\d+)/,
    /"bi_follow_count"\s*:\s*(\d+)/,
    /"biFollowCount"\s*:\s*(\d+)/,
    /"interaction_friend_follow_count"\s*:\s*(\d+)/,
    /"mplatform_friend_follow_count"\s*:\s*(\d+)/,
    /"mate_follow_count"\s*:\s*(\d+)/,
    /"two_way_follow_count"\s*:\s*(\d+)/
  ];
  for (const body of bodies) {
    try {
      const s = JSON.stringify(body);
      for (const re of patterns) {
        const m = s.match(re);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && n >= 0) return n;
        }
      }
    } catch {
    }
  }
  return null;
}
async function fetchCreatorAccountStats(sessionId) {
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return null;
  const paths = [
    "/web/api/media/user/info/",
    "/aweme/v1/creator/user/info/",
    "/passport/account/info/v2/",
    /** 部分账号互关仅出现在创作者聚合接口 */
    "/web/api/creator/user/info/",
    "/web/api/creator/user/detail/"
  ];
  const merged = {};
  const rawBodies = [];
  for (const path5 of paths) {
    const { json, ok } = await tryFetchJson(cookies, path5);
    if (!ok || json === null) continue;
    rawBodies.push(json);
    Object.assign(merged, extractStatsFromJson(json));
  }
  const wwwPaths = [
    "/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2&source=channel_pc_web&pc_client_type=1&version_code=170400&cookie_enabled=true&platform=PC&downlink=10",
    "/aweme/v1/web/user/profile/self/"
  ];
  for (const path5 of wwwPaths) {
    const { json, ok } = await tryFetchJsonFrom(
      cookies,
      "https://www.douyin.com",
      path5,
      "https://www.douyin.com/"
    );
    if (!ok || json === null) continue;
    rawBodies.push(json);
    const part = extractStatsFromJson(json);
    const keys = ["likes", "mutual", "following", "followers"];
    for (const k of keys) {
      if (merged[k] == null && part[k] != null) merged[k] = part[k];
    }
  }
  if (merged.mutual == null) {
    const fromRe = extractMutualByRegexFromJsonBodies(rawBodies);
    if (fromRe != null) merged.mutual = fromRe;
  }
  const likes = merged.likes ?? null;
  const mutual = merged.mutual ?? null;
  const following = merged.following ?? null;
  const followers = merged.followers ?? null;
  const parsed = [likes, mutual, following, followers].some((x) => x !== null);
  return {
    likes,
    mutual,
    following,
    followers,
    parsed
  };
}

// src/lib/snapshotCalendar.ts
function snapshotTimezone() {
  return process.env.SNAPSHOT_TZ?.trim() || "Asia/Shanghai";
}
function ymdInTz(date, tz) {
  return date.toLocaleDateString("en-CA", { timeZone: tz });
}
function addCalendarDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + deltaDays);
  const y2 = t.getUTCFullYear();
  const m2 = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(t.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

// src/jobs/dailyDouyinSnapshot.ts
var jobRunning = false;
async function runDailyDouyinSnapshotJob() {
  if (jobRunning) {
    console.warn("[snapshot] \u4E0A\u4E00\u6B21\u5F52\u6863\u5C1A\u672A\u7ED3\u675F\uFF0C\u8DF3\u8FC7");
    return;
  }
  jobRunning = true;
  const tz = snapshotTimezone();
  const dateStr = ymdInTz(/* @__PURE__ */ new Date(), tz);
  try {
    console.log(`[snapshot] \u5F00\u59CB\u5F52\u6863 ${dateStr}\uFF08${tz}\uFF09`);
    const bindings = await listAllDouyinBindings();
    let ok = 0;
    let skip = 0;
    let bad = 0;
    for (const { user_id, session_id } of bindings) {
      const s = getPlaywrightSession(session_id);
      if (!s || s.phase !== "logged_in") {
        skip++;
        continue;
      }
      try {
        const stats = await fetchCreatorAccountStats(session_id);
        if (!stats || !stats.parsed) {
          bad++;
          continue;
        }
        await upsertDailySnapshot(user_id, session_id, dateStr, {
          likes: stats.likes,
          mutual: stats.mutual,
          following: stats.following,
          followers: stats.followers,
          parsed: stats.parsed
        });
        ok++;
      } catch (e) {
        console.warn("[snapshot] \u4F1A\u8BDD\u5F52\u6863\u5931\u8D25", session_id, e);
        bad++;
      }
    }
    console.log(`[snapshot] \u5B8C\u6210 ${dateStr}\uFF1A\u5199\u5165=${ok} \u8DF3\u8FC7=${skip} \u672A\u89E3\u6790/\u5931\u8D25=${bad}`);
  } finally {
    jobRunning = false;
  }
}
function startDailyDouyinSnapshotScheduler() {
  const tz = snapshotTimezone();
  import_node_cron.default.schedule(
    "59 23 * * *",
    () => {
      void runDailyDouyinSnapshotJob().catch((e) => console.error("[snapshot]", e));
    },
    { timezone: tz }
  );
  console.log(`[snapshot] \u5DF2\u5B9A\u65F6\uFF1A\u6BCF\u65E5 23:59\uFF08${tz}\uFF09\u81EA\u52A8\u5F52\u6863\u6296\u97F3\u6570\u636E\uFF1B\u5BF9\u6BD4\u63A5\u53E3\u89C1 GET /api/me/douyin/daily-compare`);
}

// src/xiaohongshu/xhsStore.ts
var import_promises2 = require("node:fs/promises");
var import_node_crypto2 = require("node:crypto");
var import_node_path3 = __toESM(require("node:path"), 1);
var store2 = /* @__PURE__ */ new Map();
var cookieVault2 = /* @__PURE__ */ new Map();
var removedSessionIds = /* @__PURE__ */ new Set();
var DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
var MIN_TTL_MS = 6e4;
var MAX_TTL_MS = 3650 * 24 * 60 * 60 * 1e3;
function getTtlMs() {
  const raw = process.env.XHS_SESSION_TTL_MS ?? process.env.DOUYIN_PLAYWRIGHT_SESSION_TTL_MS;
  if (!raw?.trim()) return DEFAULT_TTL_MS;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_TTL_MS;
  return Math.min(Math.max(n, MIN_TTL_MS), MAX_TTL_MS);
}
var persistTimer2 = null;
function schedulePersist() {
  if (persistTimer2) clearTimeout(persistTimer2);
  persistTimer2 = setTimeout(() => {
    persistTimer2 = null;
    void flushDisk();
  }, 2e3);
}
async function flushDisk() {
  const ttl = getTtlMs();
  const now = Date.now();
  const rows = [];
  for (const [id, s] of store2) {
    if (now - s.createdAt > ttl) continue;
    const cookies = cookieVault2.get(id);
    if (!cookies?.length) continue;
    rows.push({
      id,
      createdAt: s.createdAt,
      user: s.user,
      cookies
    });
  }
  try {
    await writeDiskSessionsToXhs(rows);
  } catch (e) {
    console.error("[xhs] persist failed", e);
  }
}
var XHS_FILE = import_node_path3.default.join(process.cwd(), "data", "xiaohongshu-sessions.json");
async function writeDiskSessionsToXhs(rows) {
  await (0, import_promises2.mkdir)(import_node_path3.default.dirname(XHS_FILE), { recursive: true });
  const payload = { version: 1, sessions: rows };
  await (0, import_promises2.writeFile)(XHS_FILE, JSON.stringify(payload), "utf8");
}
async function readDiskSessionsXhs() {
  try {
    const buf = await (0, import_promises2.readFile)(XHS_FILE, "utf8");
    const parsed = JSON.parse(buf);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.filter(
      (r) => r && typeof r.id === "string" && typeof r.createdAt === "number" && Array.isArray(r.cookies) && r.cookies.length > 0
    );
  } catch {
    return [];
  }
}
function touchTtl(id) {
  const s = store2.get(id);
  if (s) {
    s.createdAt = Date.now();
    store2.set(id, s);
    schedulePersist();
  }
}
function prune2() {
  const now = Date.now();
  const ttl = getTtlMs();
  let removed = false;
  for (const [id, s] of store2) {
    if (now - s.createdAt > ttl) {
      store2.delete(id);
      cookieVault2.delete(id);
      removed = true;
    }
  }
  if (removed) schedulePersist();
}
async function initXhsSessionsFromDisk() {
  const rows = await readDiskSessionsXhs();
  const ttl = getTtlMs();
  const now = Date.now();
  let n = 0;
  for (const row of rows) {
    if (now - row.createdAt > ttl) continue;
    store2.set(row.id, {
      id: row.id,
      phase: "logged_in",
      hint: "\u5DF2\u4ECE\u672C\u5730\u6062\u590D\uFF08\u5C0F\u7EA2\u4E66 Cookie\uFF09",
      createdAt: row.createdAt,
      user: row.user,
      cookieCount: row.cookies.length
    });
    cookieVault2.set(row.id, row.cookies);
    n++;
  }
  if (n > 0) console.log(`[xhs] restored ${n} session(s) from disk`);
}
function getXhsSession(id) {
  prune2();
  const s = store2.get(id);
  if (s) touchTtl(id);
  return s;
}
function putXhsLoggedInSession(id, cookies, user) {
  if (removedSessionIds.has(id)) {
    removedSessionIds.delete(id);
    return;
  }
  store2.set(id, {
    id,
    phase: "logged_in",
    hint: "Cookie \u5DF2\u7ED1\u5B9A",
    createdAt: Date.now(),
    user,
    cookieCount: cookies.length
  });
  cookieVault2.set(id, cookies);
  schedulePersist();
}
function createXhsSessionId() {
  return (0, import_node_crypto2.randomUUID)();
}
function deletePersistedXhsSession(id) {
  removedSessionIds.add(id);
  const hadStore = store2.delete(id);
  const hadVault = cookieVault2.delete(id);
  schedulePersist();
  return hadStore || hadVault;
}

// src/auth/jwt.ts
var import_jsonwebtoken = __toESM(require("jsonwebtoken"), 1);
function jwtSecret() {
  const s = process.env.JWT_SECRET?.trim();
  if (s) return s;
  console.warn("[auth] JWT_SECRET \u672A\u8BBE\u7F6E\uFF0C\u4F7F\u7528\u4E0D\u5B89\u5168\u7684\u5F00\u53D1\u9ED8\u8BA4\u503C");
  return "dev-insecure-jwt-secret";
}
function signAuthToken(userId, username) {
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim() || "7d";
  const opts = { expiresIn };
  return import_jsonwebtoken.default.sign({ sub: String(userId), username }, jwtSecret(), opts);
}
function verifyAuthToken(token) {
  const payload = import_jsonwebtoken.default.verify(token, jwtSecret());
  const sub = payload.sub;
  const userId = typeof sub === "string" ? Number(sub) : Number(sub);
  if (!Number.isFinite(userId)) throw new Error("invalid token");
  const username = typeof payload.username === "string" ? payload.username : "";
  return { userId, username };
}

// src/middleware/requireAuth.ts
var requireAuth = (req, res, next) => {
  const raw = req.headers.authorization;
  const m = typeof raw === "string" ? raw.match(/^Bearer\s+(.+)$/i) : null;
  const token = m?.[1]?.trim();
  if (!token) {
    res.status(401).json({ error: "\u672A\u767B\u5F55\u6216\u7F3A\u5C11\u4EE4\u724C" });
    return;
  }
  try {
    const { userId, username } = verifyAuthToken(token);
    req.userId = userId;
    req.authUsername = username;
    next();
  } catch {
    res.status(401).json({ error: "\u4EE4\u724C\u65E0\u6548\u6216\u5DF2\u8FC7\u671F" });
  }
};

// src/routes/authRoutes.ts
var import_express = require("express");
var router = (0, import_express.Router)();
router.get("/capabilities", (_req, res) => {
  res.json({ registerEnabled: process.env.REGISTER_ENABLED === "true" });
});
router.post("/login", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (username.length < 1 || password.length < 1) {
    res.status(400).json({ error: "\u8BF7\u586B\u5199\u8D26\u53F7\u548C\u5BC6\u7801" });
    return;
  }
  const row = await getUserByUsername(username);
  if (!row || !verifyPassword(row, password)) {
    res.status(401).json({ error: "\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF" });
    return;
  }
  const token = signAuthToken(row.id, row.username);
  res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
});
function validUsername(u) {
  return /^[a-zA-Z0-9_\u4e00-\u9fff]{2,32}$/.test(u);
}
router.post("/register", async (req, res) => {
  if (process.env.REGISTER_ENABLED !== "true") {
    res.status(403).json({ error: "\u5F53\u524D\u672A\u5F00\u653E\u6CE8\u518C" });
    return;
  }
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!validUsername(username)) {
    res.status(400).json({ error: "\u7528\u6237\u540D\u9700\u4E3A 2\uFF5E32 \u4F4D\u5B57\u6BCD\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u6216\u4E2D\u6587" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "\u5BC6\u7801\u81F3\u5C11 6 \u4F4D" });
    return;
  }
  if (await getUserByUsername(username)) {
    res.status(409).json({ error: "\u7528\u6237\u540D\u5DF2\u5B58\u5728" });
    return;
  }
  const id = await createUser(username, password, "user");
  const token = signAuthToken(id, username);
  res.json({ token, user: { id, username, role: "user" } });
});
router.get("/me", requireAuth, async (req, res) => {
  const row = await getUserById(req.userId);
  if (!row) {
    res.status(401).json({ error: "\u7528\u6237\u4E0D\u5B58\u5728" });
    return;
  }
  res.json(row);
});

// src/routes/douyinPlaywright.ts
var import_node_fs2 = require("node:fs");
var import_promises3 = __toESM(require("node:fs/promises"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var import_express2 = require("express");
var import_multer = __toESM(require("multer"), 1);

// src/douyin/importDouyinSessionWithLogs.ts
function ts() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
}
async function importDouyinSessionWithLogs(raw) {
  const logs = [];
  const log = (msg) => logs.push(`[${ts()}] ${msg}`);
  log("\u2460 \u89E3\u6790 Cookie \u6587\u672C\u2026");
  const pre = parseDouyinCookiePaste(raw);
  if (pre.length < 1) {
    log("\u89E3\u6790\u5931\u8D25\uFF1A\u672A\u8BC6\u522B\u5230\u4EFB\u4F55 name=value");
    return { ok: false, error: "\u672A\u80FD\u89E3\u6790\u51FA Cookie", logs };
  }
  log(`\u5DF2\u89E3\u6790 ${pre.length} \u6761 Cookie`);
  log("\u2461 \u6821\u9A8C\u6296\u97F3\u767B\u5F55\u7279\u5F81\uFF08sessionid / sid_tt \u7B49\uFF09\u2026");
  if (!looksLikeDouyinAuthCookies(pre)) {
    log("\u6821\u9A8C\u672A\u901A\u8FC7");
    return {
      ok: false,
      error: "\u672A\u8BC6\u522B\u5230\u5E38\u89C1\u6296\u97F3\u767B\u5F55 Cookie\u3002\u8BF7\u5728\u6D4F\u89C8\u5668\u5F00\u53D1\u8005\u5DE5\u5177\u4E2D\u4ECE creator.douyin.com \u6216 .douyin.com \u590D\u5236\u5B8C\u6574 Cookie\u3002",
      logs
    };
  }
  log("\u6821\u9A8C\u901A\u8FC7");
  log("\u2462 \u521B\u5EFA\u670D\u52A1\u7AEF\u4F1A\u8BDD\u5E76\u62C9\u53D6\u8D26\u53F7\u57FA\u7840\u4FE1\u606F\uFF08\u6635\u79F0/\u5934\u50CF\u7B49\uFF09\u2026");
  const created = await importPlaywrightSessionFromTokens(raw);
  if (!created.ok) {
    log(`\u5931\u8D25\uFF1A${created.error}`);
    return { ok: false, error: created.error, logs };
  }
  log("\u57FA\u7840\u4FE1\u606F\u5DF2\u5199\u5165\u4F1A\u8BDD");
  log("\u2463 \u8BF7\u6C42\u521B\u4F5C\u8005\u6570\u636E\u4E2D\u5FC3\uFF08\u83B7\u8D5E\u3001\u7C89\u4E1D\u3001\u5173\u6CE8\u3001\u4E92\u5173\u7B49\uFF09\u2026");
  let stats = null;
  try {
    stats = await fetchCreatorAccountStats(created.sessionId);
    if (stats?.parsed) log("\u8D26\u53F7\u6570\u636E\u7EDF\u8BA1\u62C9\u53D6\u6210\u529F");
    else log("\u90E8\u5206\u6307\u6807\u672A\u80FD\u89E3\u6790\uFF08\u63A5\u53E3\u5B57\u6BB5\u53EF\u80FD\u53D8\u66F4\uFF09\uFF0C\u4F1A\u8BDD\u4ECD\u53EF\u7528\u4E8E\u77E9\u9635\u80FD\u529B");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`\u6570\u636E\u7EDF\u8BA1\u8BF7\u6C42\u5F02\u5E38\uFF1A${msg}\uFF08\u4F1A\u8BDD\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u7A0D\u540E\u91CD\u8BD5\uFF09`);
  }
  log("\u2464 \u5168\u90E8\u5B8C\u6210");
  return {
    ok: true,
    sessionId: created.sessionId,
    user: created.user,
    stats,
    logs
  };
}

// src/douyin/playwrightChat.ts
var delay2 = (ms) => new Promise((r) => setTimeout(r, ms));
function recordPeer(map, id, label, weight) {
  const trimmed = label.replace(/\s+/g, " ").trim().slice(0, 64);
  if (!trimmed || id.length < 4) return;
  const prev = map.get(id);
  if (!prev || weight > prev.weight) map.set(id, { peer: { id, label: trimmed }, weight });
}
function networkWeightForUrl(url) {
  if (/\/friend|m_friend|mutual|relation|follow_list|following|follower|\/im\/|message|conversation|stranger|contact|social|chat_list|cfriend/i.test(url))
    return 22;
  if (/\/user\/(profile|detail)|passport|\/aweme\/v1\/web\/user\//i.test(url)) return 14;
  if (/\/aweme\/v1\/web\//i.test(url)) return 5;
  return 2;
}
function extractPeersFromApiJson(o, acc, weight, depth = 0) {
  if (depth > 26 || o === null || o === void 0) return;
  if (Array.isArray(o)) {
    for (const item of o) extractPeersFromApiJson(item, acc, weight, depth + 1);
    return;
  }
  if (typeof o !== "object") return;
  const obj = o;
  const secRaw = obj.sec_user_id ?? obj.sec_uid ?? obj.secUid;
  const sec = typeof secRaw === "string" && secRaw.length >= 8 ? secRaw : void 0;
  const nickRaw = obj.nickname ?? obj.nick_name ?? obj.nickName ?? obj.display_name ?? obj.displayName ?? obj.name;
  const nick = typeof nickRaw === "string" ? nickRaw : void 0;
  if (sec && nick && nick.length >= 1 && nick.length < 80) {
    const rel = obj.follow_status ?? obj.followStatus ?? obj.follow_relation ?? obj.relation_type ?? obj.is_friend ?? obj.isFriend ?? obj.muf_relation ?? obj.card_type;
    const strongRel = rel !== null && rel !== void 0 && String(rel).length > 0;
    const w = strongRel ? weight + 6 : weight;
    recordPeer(acc, sec, nick, w);
  }
  const uniq = obj.unique_id ?? obj.uniqueId;
  if (typeof uniq === "string" && /^[\w.]+$/.test(uniq) && uniq.length >= 2 && nick) {
    recordPeer(acc, uniq, nick, Math.max(1, weight - 4));
  }
  for (const k of Object.keys(obj)) {
    if (k === "log_pb" || k === "logPassback") continue;
    extractPeersFromApiJson(obj[k], acc, weight, depth + 1);
  }
}
function attachPeerNetworkCollector(page, acc) {
  const onResponse = async (response) => {
    try {
      const url = response.url();
      if (!/(douyin\.com|snssdk\.com|bytedance\.com|amemv\.com|ixigua\.com)/i.test(url)) return;
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json") || response.status() !== 200) return;
      const w = networkWeightForUrl(url);
      if (w <= 2) return;
      const json = await response.json();
      extractPeersFromApiJson(json, acc, w, 0);
    } catch {
    }
  };
  page.on("response", onResponse);
  return () => page.off("response", onResponse);
}
async function scrollPageGradually(page, rounds) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 900).catch(() => {
    });
    await delay2(650);
  }
}
async function cleanup2(browser) {
  try {
    await browser?.close();
  } catch {
  }
}
function extractPeersFromPage(page) {
  return page.evaluate(`(() => {
    const out = []
    const seen = new Set()
    const anchors = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="sec_user"]'))
    for (const a of anchors) {
      try {
        const u = new URL(a.href, window.location.origin)
        let id = null
        const pm = u.pathname.match(new RegExp('/user/([^/?#]+)'))
        if (pm && pm[1]) id = decodeURIComponent(pm[1])
        if (!id) {
          const sm = u.searchParams.get('sec_user_id') || u.searchParams.get('sec_uid')
          if (sm) id = decodeURIComponent(sm)
        }
        if (!id || seen.has(id) || id === 'self') continue
        const label = (a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || id)
          .replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 64)
        if (!label) continue
        seen.add(id)
        out.push({ id, label })
      } catch {
        /* */
      }
    }
    return out.slice(0, 120)
  })()`);
}
function extractPeersFromNextData(page) {
  return page.evaluate(`(() => {
    const out = []
    const seen = new Set()
    const el = document.getElementById('__NEXT_DATA__')
    if (!el || !el.textContent) return out
    try {
      const d = JSON.parse(el.textContent)
      const walk = (x) => {
        if (!x || typeof x !== 'object') return
        const sec = x.sec_user_id
        const nick = x.nickname || x.nick_name || x.display_name
        if (typeof sec === 'string' && typeof nick === 'string' && sec.length >= 8 && !seen.has(sec)) {
          seen.add(sec)
          out.push({ id: sec, label: nick.replace(/\\s+/g, ' ').trim().slice(0, 64) })
        }
        for (const k of Object.keys(x)) walk(x[k])
      }
      walk(d)
    } catch {
      /* */
    }
    return out.slice(0, 120)
  })()`);
}
function peersFromMergedMap(merged) {
  const arr = Array.from(merged.values()).sort((a, b) => b.weight - a.weight);
  const peers = arr.slice(0, 80).map((x) => x.peer);
  const maxWeight = arr[0]?.weight ?? 0;
  return { peers, maxWeight };
}
async function collectPeersOnPage(page, merged, domWeight, nextWeight) {
  for (const p of await extractPeersFromPage(page)) recordPeer(merged, p.id, p.label, domWeight);
  for (const p of await extractPeersFromNextData(page)) recordPeer(merged, p.id, p.label, nextWeight);
}
async function listChatPeers(sessionId) {
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return { peers: [], hint: "\u65E0\u767B\u5F55 Cookie" };
  const { chromium } = await import("playwright");
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== "false";
  let browser;
  try {
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: "zh-CN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const merged = /* @__PURE__ */ new Map();
    const detachNet = attachPeerNetworkCollector(page, merged);
    try {
      await page.goto("https://www.douyin.com/friend", {
        waitUntil: "domcontentloaded",
        timeout: 6e4
      });
      await delay2(4e3);
      await scrollPageGradually(page, 7);
      await delay2(2200);
      await collectPeersOnPage(page, merged, 30, 26);
      if (merged.size === 0) {
        await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 45e3 }).catch(() => {
        });
        await delay2(3500);
        await scrollPageGradually(page, 5);
        await delay2(2e3);
        await collectPeersOnPage(page, merged, 20, 18);
      }
      if (merged.size === 0) {
        await page.goto("https://www.douyin.com/user/self", { waitUntil: "domcontentloaded", timeout: 35e3 }).catch(() => {
        });
        await delay2(3500);
        await scrollPageGradually(page, 4);
        await collectPeersOnPage(page, merged, 22, 19);
      }
    } finally {
      detachNet();
    }
    const { peers, maxWeight } = peersFromMergedMap(merged);
    await context.close().catch(() => {
    });
    await cleanup2(browser);
    if (peers.length === 0) {
      return {
        peers: [],
        hint: "\u4ECD\u672A\u89E3\u6790\u5230\u7528\u6237\uFF08\u5E38\u89C1\u539F\u56E0\uFF1A\u7F51\u9875\u98CE\u63A7\u9A8C\u8BC1\u3001\u9700\u6709\u5934\u6A21\u5F0F DOUYIN_PLAYWRIGHT_HEADLESS=false\u3001\u6216\u63A5\u53E3\u5DF2\u6539\u7248\uFF09\u3002\u53EF\u6539\u7528\u6296\u97F3 App\uFF1B\u4E5F\u53EF\u5728\u300C\u57FA\u7840\u4FE1\u606F\u300D\u6838\u5BF9 Cookie \u662F\u5426\u4ECD\u6709\u6548\u3002"
      };
    }
    let hint;
    if (maxWeight < 20) {
      hint = "\u4E0B\u5217\u7528\u6237\u90E8\u5206\u53EF\u80FD\u6765\u81EA\u9996\u9875\u63A8\u8350\u6216\u63A5\u53E3\u6CDB\u6570\u636E\uFF0C\u672A\u5FC5\u662F\u4E92\u5173\u597D\u53CB\uFF1B\u53D1\u79C1\u4FE1\u524D\u8BF7\u5728\u6296\u97F3 App \u5185\u786E\u8BA4\u5BF9\u65B9\u8EAB\u4EFD\u3002";
    }
    return { peers, hint };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await cleanup2(browser);
    return { peers: [], hint: msg };
  }
}
async function tryLocateMessageComposer(ctx) {
  const candidates = [
    ctx.getByPlaceholder(/消息|私信|输入|内容|打个招呼|说点什么|和对方|聊聊|发私信|聊天|想说|回复/i),
    ctx.locator('[role="dialog"] textarea'),
    ctx.locator('[role="dialog"] [contenteditable="true"]'),
    ctx.locator('[class*="modal" i] textarea'),
    ctx.locator('[class*="modal" i] [contenteditable="true"]'),
    ctx.locator("textarea:not([readonly]):visible"),
    ctx.locator('div[contenteditable="true"]:visible'),
    ctx.getByRole("textbox")
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if (await first.isVisible({ timeout: 1e3 }).catch(() => false)) return first;
  }
  return null;
}
async function findMessageComposerWithRetry(page) {
  const deadline = Date.now() + 24e3;
  while (Date.now() < deadline) {
    const onMain = await tryLocateMessageComposer(page);
    if (onMain) return onMain;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const hit = await tryLocateMessageComposer(frame);
        if (hit) return hit;
      } catch {
      }
    }
    await delay2(500);
  }
  return null;
}
async function sendChatMessage(sessionId, params) {
  const text = params.text.trim();
  if (!text) return { ok: false, message: "\u6D88\u606F\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" };
  const uid = params.userId.trim();
  if (!uid) return { ok: false, message: "\u7F3A\u5C11\u597D\u53CB\u6807\u8BC6" };
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return { ok: false, message: "\u65E0\u767B\u5F55 Cookie" };
  const { chromium } = await import("playwright");
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== "false";
  let browser;
  try {
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      locale: "zh-CN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    const userUrl = `https://www.douyin.com/user/${encodeURIComponent(uid)}`;
    await page.goto(userUrl, { waitUntil: "domcontentloaded", timeout: 6e4 });
    await delay2(3200);
    const dmBtn = page.getByRole("button", { name: /私信|发消息|聊天/ }).or(page.locator('div[role="button"]:has-text("\u79C1\u4FE1"), div[role="button"]:has-text("\u53D1\u6D88\u606F")')).or(page.locator('button:has-text("\u79C1\u4FE1"), a:has-text("\u79C1\u4FE1"), span:has-text("\u79C1\u4FE1")')).or(page.locator('[class*="message" i], [class*="Message" i]').filter({ hasText: /私信|发消息/ })).first();
    const visible = await dmBtn.isVisible({ timeout: 12e3 }).catch(() => false);
    if (!visible) {
      await context.close().catch(() => {
      });
      await cleanup2(browser);
      return { ok: false, message: "\u672A\u627E\u5230\u300C\u79C1\u4FE1\u300D\u5165\u53E3\uFF0C\u53EF\u80FD\u8BE5\u7528\u6237\u4E0D\u5141\u8BB8\u79C1\u4FE1\u6216\u9875\u9762\u5DF2\u6539\u7248" };
    }
    await dmBtn.click({ timeout: 5e3 }).catch(() => {
    });
    await delay2(4500);
    let box = await findMessageComposerWithRetry(page);
    if (!box) {
      await dmBtn.click({ timeout: 4e3 }).catch(() => {
      });
      await delay2(4e3);
      box = await findMessageComposerWithRetry(page);
    }
    if (!box) {
      await context.close().catch(() => {
      });
      await cleanup2(browser);
      return {
        ok: false,
        message: "\u672A\u627E\u5230\u6D88\u606F\u8F93\u5165\u6846\uFF08\u79C1\u4FE1\u5C42\u53EF\u80FD\u672A\u5B8C\u5168\u6253\u5F00\u3001\u5728 iframe \u5185\u6216\u9700\u7F51\u9875\u9A8C\u8BC1\uFF09\u3002\u53EF\u8BBE\u7F6E DOUYIN_PLAYWRIGHT_HEADLESS=false \u540E\u91CD\u8BD5\uFF0C\u6216\u4F7F\u7528\u6296\u97F3 App \u53D1\u79C1\u4FE1\u3002"
      };
    }
    await box.click({ timeout: 4e3 }).catch(() => {
    });
    await box.fill(text).catch(async () => {
      await page.keyboard.press("Control+A").catch(() => {
      });
      await page.keyboard.type(text, { delay: 15 }).catch(() => {
      });
    });
    await delay2(400);
    const sendBtn = page.getByRole("button", { name: /发送|发 送/ }).or(page.locator('button:has-text("\u53D1\u9001")')).first();
    if (await sendBtn.isVisible({ timeout: 4e3 }).catch(() => false)) {
      await sendBtn.click({ timeout: 5e3 }).catch(() => {
      });
    } else {
      await page.keyboard.press("Enter").catch(() => {
      });
    }
    await delay2(2e3);
    await context.close().catch(() => {
    });
    await cleanup2(browser);
    return { ok: true, message: "\u5DF2\u5C1D\u8BD5\u53D1\u9001\uFF08\u8BF7\u5728\u6296\u97F3\u7F51\u9875\u6216 App \u786E\u8BA4\u662F\u5426\u9001\u8FBE\uFF09" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await cleanup2(browser);
    return { ok: false, message: msg };
  }
}

// src/douyin/playwrightPublish.ts
var PUBLISH_URL = "https://creator.douyin.com/publish";
var delay3 = (ms) => new Promise((r) => setTimeout(r, ms));
async function cleanup3(browser) {
  try {
    await browser?.close();
  } catch {
  }
}
async function fillTitle(page, title) {
  const locators = [
    page.locator('textarea[placeholder*="\u6807\u9898"]').first(),
    page.locator('input[placeholder*="\u6807\u9898"]').first(),
    page.locator('[contenteditable="true"]').first()
  ];
  for (const el of locators) {
    const ok = await el.isVisible({ timeout: 2500 }).catch(() => false);
    if (!ok) continue;
    await el.click({ timeout: 3e3 }).catch(() => {
    });
    await el.fill("").catch(() => {
    });
    await el.fill(title).catch(() => {
    });
    return;
  }
}
async function addTopics(page, topics) {
  for (const topic of topics) {
    const t = topic.replace(/^#/, "").trim();
    if (!t) continue;
    const topicInput = page.locator('input[placeholder*="\u8BDD\u9898"], input[placeholder*="#"]').first();
    const vis = await topicInput.isVisible({ timeout: 2e3 }).catch(() => false);
    if (!vis) continue;
    await topicInput.click().catch(() => {
    });
    await topicInput.fill(`#${t}`).catch(() => {
    });
    await delay3(300);
    await page.keyboard.press("Enter").catch(() => {
    });
    await delay3(400);
  }
}
async function clickPublish(page) {
  const candidates = [
    page.getByRole("button", { name: /发布/ }).first(),
    page.locator('button:has-text("\u53D1\u5E03")').first()
  ];
  for (const btn of candidates) {
    const ok = await btn.isVisible({ timeout: 4e3 }).catch(() => false);
    if (!ok) continue;
    const en = await btn.isEnabled().catch(() => false);
    if (en) {
      await btn.click({ timeout: 1e4 }).catch(() => {
      });
      return true;
    }
  }
  return false;
}
async function runCarouselPublish(sessionId, params) {
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return { ok: false, message: "\u65E0\u767B\u5F55 Cookie\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801\u767B\u5F55" };
  if (params.imagePaths.length < 1) return { ok: false, message: "\u8BF7\u81F3\u5C11\u9009\u62E9 1 \u5F20\u56FE\u7247" };
  const { chromium } = await import("playwright");
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== "false";
  let browser;
  try {
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN"
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 9e4 });
    await delay3(2500);
    if (/login/i.test(page.url())) {
      await cleanup3(browser);
      return { ok: false, message: "\u53D1\u5E03\u9875\u5224\u5B9A\u4E3A\u672A\u767B\u5F55\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801" };
    }
    const storyTab = page.getByRole("tab", { name: /图文|图片/ }).first();
    if (await storyTab.isVisible({ timeout: 4e3 }).catch(() => false)) {
      await storyTab.click().catch(() => {
      });
      await delay3(900);
    }
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(params.imagePaths, { timeout: 6e4 });
    await delay3(4e3);
    await fillTitle(page, params.title);
    await delay3(600);
    if (params.topics.length) await addTopics(page, params.topics);
    await delay3(800);
    const clicked = await clickPublish(page);
    await delay3(5e3);
    await context.close().catch(() => {
    });
    await cleanup3(browser);
    return {
      ok: clicked,
      message: clicked ? "\u5DF2\u63D0\u4EA4\u53D1\u5E03\uFF08\u6296\u97F3\u4FA7\u53EF\u80FD\u5BA1\u6838\u4E2D\uFF0C\u8BF7\u5728\u521B\u4F5C\u8005\u4E2D\u5FC3\u786E\u8BA4\uFF09" : "\u672A\u627E\u5230\u53EF\u7528\u300C\u53D1\u5E03\u300D\u6309\u94AE\uFF0C\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u66F4"
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await cleanup3(browser);
    return { ok: false, message: msg };
  }
}
async function runVideoPublish(sessionId, params) {
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return { ok: false, message: "\u65E0\u767B\u5F55 Cookie\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801\u767B\u5F55" };
  const { chromium } = await import("playwright");
  const headless = process.env.DOUYIN_PLAYWRIGHT_HEADLESS !== "false";
  let browser;
  try {
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN"
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 9e4 });
    await delay3(2500);
    if (/login/i.test(page.url())) {
      await cleanup3(browser);
      return { ok: false, message: "\u53D1\u5E03\u9875\u5224\u5B9A\u4E3A\u672A\u767B\u5F55\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801" };
    }
    const videoTab = page.getByRole("tab", { name: /视频/ }).first();
    if (await videoTab.isVisible({ timeout: 5e3 }).catch(() => false)) {
      await videoTab.click().catch(() => {
      });
      await delay3(1200);
    }
    const videoInput = page.locator('input[type="file"]').first();
    await videoInput.setInputFiles(params.videoPath, { timeout: 12e4 });
    await delay3(8e3);
    if (params.coverPath) {
      const coverBtn = page.locator('button:has-text("\u5C01\u9762")').first();
      if (await coverBtn.isVisible({ timeout: 4e3 }).catch(() => false)) {
        await coverBtn.click().catch(() => {
        });
        await delay3(600);
        const coverInput = page.locator('input[type="file"]').first();
        if (await coverInput.isVisible({ timeout: 4e3 }).catch(() => false)) {
          await coverInput.setInputFiles(params.coverPath).catch(() => {
          });
          await delay3(1500);
          const confirm = page.locator('button:has-text("\u786E\u5B9A"), button:has-text("\u786E\u8BA4")').first();
          if (await confirm.isVisible({ timeout: 3e3 }).catch(() => false)) {
            await confirm.click().catch(() => {
            });
          }
        }
      }
    }
    await fillTitle(page, params.title);
    await delay3(600);
    if (params.topics.length) await addTopics(page, params.topics);
    await delay3(800);
    const clicked = await clickPublish(page);
    await delay3(6e3);
    await context.close().catch(() => {
    });
    await cleanup3(browser);
    return {
      ok: clicked,
      message: clicked ? "\u5DF2\u63D0\u4EA4\u89C6\u9891\u53D1\u5E03\uFF08\u8BF7\u5728\u521B\u4F5C\u8005\u4E2D\u5FC3\u786E\u8BA4\u8FDB\u5EA6\uFF09" : "\u672A\u627E\u5230\u53EF\u7528\u300C\u53D1\u5E03\u300D\u6309\u94AE\uFF0C\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u53D8\u66F4"
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await cleanup3(browser);
    return { ok: false, message: msg };
  }
}

// src/routes/douyinPlaywright.ts
var router2 = (0, import_express2.Router)();
var uploadDir = import_node_path4.default.join(import_node_os.default.tmpdir(), "matrix-douyin-upload");
(0, import_node_fs2.mkdirSync)(uploadDir, { recursive: true });
var storage = import_multer.default.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = import_node_path4.default.extname(file.originalname) || ".bin";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});
var uploadCarousel = (0, import_multer.default)({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 9 }
});
var uploadVideo = (0, import_multer.default)({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 2 }
});
async function unlinkPaths(paths) {
  await Promise.all(paths.map((p) => import_promises3.default.unlink(p).catch(() => {
  })));
}
function sessionParamId(req) {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}
router2.post("/playwright/sessions", (_req, res) => {
  try {
    const session = createPlaywrightSessionRecord();
    runPlaywrightLoginJob(session.id);
    res.json({ sessionId: session.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
router2.post("/playwright/sessions/import", async (req, res) => {
  const tokens = typeof req.body?.tokens === "string" ? req.body.tokens : "";
  if (!tokens.trim()) {
    res.status(400).json({ error: "\u8BF7\u5728 JSON \u4F53\u4E2D\u63D0\u4F9B tokens \u5B57\u6BB5\uFF08Cookie \u539F\u59CB\u6587\u672C\uFF09" });
    return;
  }
  try {
    const result = await importPlaywrightSessionFromTokens(tokens);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ sessionId: result.sessionId, user: result.user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
router2.post("/playwright/sessions/import-with-logs", async (req, res) => {
  const tokens = typeof req.body?.tokens === "string" ? req.body.tokens : "";
  if (!tokens.trim()) {
    res.status(400).json({ error: "\u8BF7\u5728 JSON \u4F53\u4E2D\u63D0\u4F9B tokens \u5B57\u6BB5", logs: [] });
    return;
  }
  try {
    const result = await importDouyinSessionWithLogs(tokens);
    if (!result.ok) {
      res.status(400).json({ error: result.error, logs: result.logs });
      return;
    }
    res.json({
      sessionId: result.sessionId,
      user: result.user,
      stats: result.stats,
      logs: result.logs
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg, logs: [] });
  }
});
router2.get("/playwright/sessions/:id", (req, res) => {
  const s = getPlaywrightSession(req.params.id);
  if (!s) {
    res.status(404).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" });
    return;
  }
  res.json({
    phase: s.phase,
    hint: s.error ?? s.hint,
    qrcodeUrl: s.qrcodeUrl,
    qrcodeDataUrl: s.qrcodeDataUrl,
    loggedIn: s.phase === "logged_in",
    cookieCount: s.cookieCount,
    user: s.user ?? null
  });
});
router2.delete("/playwright/sessions/:id", (req, res) => {
  const id = sessionParamId(req);
  if (!id.trim()) {
    res.status(400).json({ error: "\u7F3A\u5C11\u4F1A\u8BDD id" });
    return;
  }
  const removed = deletePlaywrightSession(id);
  if (!removed) {
    res.status(404).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664" });
    return;
  }
  res.status(204).end();
});
router2.get("/playwright/sessions/:id/account-stats", async (req, res) => {
  const s = getPlaywrightSession(req.params.id);
  if (!s || s.phase !== "logged_in") {
    res.status(404).json({ error: "\u4F1A\u8BDD\u65E0\u6548\u6216\u672A\u767B\u5F55" });
    return;
  }
  try {
    const stats = await fetchCreatorAccountStats(req.params.id);
    if (!stats) {
      res.status(404).json({ error: "\u65E0\u6CD5\u8BFB\u53D6\u767B\u5F55 Cookie\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801\u767B\u5F55" });
      return;
    }
    res.json(stats);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
router2.post(
  "/playwright/sessions/:id/publish/carousel",
  uploadCarousel.array("images", 9),
  async (req, res) => {
    const sid = sessionParamId(req);
    const s = getPlaywrightSession(sid);
    const files = req.files ?? [];
    const paths = files.map((f) => f.path);
    if (!s || s.phase !== "logged_in") {
      await unlinkPaths(paths);
      res.status(404).json({ error: "\u4F1A\u8BDD\u65E0\u6548\u6216\u672A\u767B\u5F55" });
      return;
    }
    const title = String(req.body?.title ?? "").trim();
    const topicsRaw = String(req.body?.topics ?? "");
    const topics = topicsRaw.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!title) {
      await unlinkPaths(paths);
      res.status(400).json({ error: "\u8BF7\u586B\u5199\u6807\u9898" });
      return;
    }
    if (paths.length < 1) {
      await unlinkPaths(paths);
      res.status(400).json({ error: "\u8BF7\u81F3\u5C11\u4E0A\u4F20 1 \u5F20\u56FE\u7247" });
      return;
    }
    try {
      const result = await runCarouselPublish(sid, { title, topics, imagePaths: paths });
      await unlinkPaths(paths);
      res.json(result);
    } catch (e) {
      await unlinkPaths(paths);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  }
);
router2.post(
  "/playwright/sessions/:id/publish/video",
  uploadVideo.fields([
    { name: "video", maxCount: 1 },
    { name: "cover", maxCount: 1 }
  ]),
  async (req, res) => {
    const sid = sessionParamId(req);
    const s = getPlaywrightSession(sid);
    const map = req.files;
    const videoFile = map?.video?.[0];
    const coverFile = map?.cover?.[0];
    const paths = [videoFile?.path, coverFile?.path].filter(Boolean);
    if (!s || s.phase !== "logged_in") {
      await unlinkPaths(paths);
      res.status(404).json({ error: "\u4F1A\u8BDD\u65E0\u6548\u6216\u672A\u767B\u5F55" });
      return;
    }
    if (!videoFile?.path) {
      await unlinkPaths(paths);
      res.status(400).json({ error: "\u8BF7\u4E0A\u4F20\u89C6\u9891\u6587\u4EF6" });
      return;
    }
    const title = String(req.body?.title ?? "").trim();
    const topicsRaw = String(req.body?.topics ?? "");
    const topics = topicsRaw.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!title) {
      await unlinkPaths(paths);
      res.status(400).json({ error: "\u8BF7\u586B\u5199\u6807\u9898" });
      return;
    }
    try {
      const result = await runVideoPublish(sid, {
        title,
        topics,
        videoPath: videoFile.path,
        coverPath: coverFile?.path
      });
      await unlinkPaths(paths);
      res.json(result);
    } catch (e) {
      await unlinkPaths(paths);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  }
);
router2.get("/playwright/sessions/:id/chat/peers", async (req, res) => {
  const sid = sessionParamId(req);
  const s = getPlaywrightSession(sid);
  if (!s || s.phase !== "logged_in") {
    res.status(404).json({ error: "\u4F1A\u8BDD\u65E0\u6548\u6216\u672A\u767B\u5F55" });
    return;
  }
  try {
    const { peers, hint } = await listChatPeers(sid);
    res.json({ peers, hint });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
router2.post("/playwright/sessions/:id/chat/send", async (req, res) => {
  const sid = sessionParamId(req);
  const s = getPlaywrightSession(sid);
  if (!s || s.phase !== "logged_in") {
    res.status(404).json({ error: "\u4F1A\u8BDD\u65E0\u6548\u6216\u672A\u767B\u5F55" });
    return;
  }
  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!userId || !text) {
    res.status(400).json({ error: "\u8BF7\u63D0\u4F9B userId \u4E0E text" });
    return;
  }
  try {
    const result = await sendChatMessage(sid, { userId, text });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// src/routes/meRoutes.ts
var import_express3 = require("express");

// src/douyin/creatorVideos.ts
function buildCookieHeader2(cookies, requestHost) {
  const host = requestHost.toLowerCase();
  return cookies.filter((c) => {
    const raw = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const d = raw.toLowerCase();
    if (host === d) return true;
    if (host.endsWith("." + d)) return true;
    return false;
  }).map((c) => `${c.name}=${c.value}`).join("; ");
}
async function tryFetchJsonFrom2(cookies, origin, path5, referer) {
  const base = origin.replace(/\/$/, "");
  const url = `${base}${path5.startsWith("/") ? path5 : `/${path5}`}`;
  const host = new URL(url).hostname;
  const cookie = buildCookieHeader2(cookies, host);
  if (!cookie) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Cookie: cookie,
        Referer: referer ?? `${base}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*"
      }
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function tryFetchCreatorJson(cookies, path5) {
  return tryFetchJsonFrom2(cookies, "https://creator.douyin.com", path5, "https://creator.douyin.com/");
}
function parseNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return null;
}
function pickCoverUrl(o) {
  const direct = [o.cover_url, o.coverUrl, o.thumbnail_url, o.poster_url];
  for (const v of direct) if (typeof v === "string" && v.trim()) return v;
  const nested = o.cover;
  const list = nested?.url_list;
  if (Array.isArray(list)) {
    for (const x of list) if (typeof x === "string" && x.trim()) return x;
  }
  return null;
}
function normalizeVideo(o, source) {
  const idRaw = o.aweme_id ?? o.awemeId ?? o.item_id ?? o.itemId ?? o.video_id ?? o.videoId ?? o.id;
  const id = typeof idRaw === "string" ? idRaw : typeof idRaw === "number" ? String(idRaw) : "";
  if (!id) return null;
  const titleRaw = o.desc ?? o.title ?? o.caption ?? o.name;
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : "(\u65E0\u6807\u9898)";
  const stat = o.statistics ?? {};
  return {
    id,
    title,
    coverUrl: pickCoverUrl(o),
    source,
    createTime: parseNum(o.create_time ?? o.createTime ?? o.publish_time ?? o.publishTime),
    diggCount: parseNum(stat.digg_count ?? stat.diggCount ?? o.digg_count),
    commentCount: parseNum(stat.comment_count ?? stat.commentCount ?? o.comment_count),
    shareCount: parseNum(stat.share_count ?? stat.shareCount ?? o.share_count),
    playCount: parseNum(stat.play_count ?? stat.playCount ?? stat.play_cnt ?? o.play_count)
  };
}
function extractListFromJson(json, source) {
  if (!json || typeof json !== "object") return [];
  const root = json;
  const candidates = [
    root.aweme_list,
    root.awemeList,
    root.data?.aweme_list,
    root.data?.list,
    root.list,
    root.items
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out = [];
    for (const row of c) {
      if (!row || typeof row !== "object") continue;
      const v = normalizeVideo(row, source);
      if (v) out.push(v);
    }
    if (out.length > 0) return out;
  }
  return [];
}
function extractListsRecursively(node, source, depth = 0) {
  if (depth > 10 || node === null || node === void 0) return [];
  if (Array.isArray(node)) {
    const out = [];
    for (const x of node) {
      if (!x || typeof x !== "object") continue;
      const v = normalizeVideo(x, source);
      if (v) out.push(v);
    }
    return out;
  }
  if (typeof node !== "object") return [];
  const obj = node;
  const keys = Object.keys(obj);
  for (const k of keys) {
    const v = obj[k];
    if (!Array.isArray(v)) continue;
    if (!/aweme|item|video|post|works|content|list/i.test(k)) continue;
    const got = extractListsRecursively(v, source, depth + 1);
    if (got.length > 0) return got;
  }
  for (const v of Object.values(obj)) {
    if (!v || typeof v !== "object") continue;
    const got = extractListsRecursively(v, source, depth + 1);
    if (got.length > 0) return got;
  }
  return [];
}
function mergeUniqueVideos(target, source) {
  const seen = new Set(target.map((x) => x.id));
  for (const row of source) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    target.push(row);
  }
  return target;
}
function extractSecUserId(json, depth = 0) {
  if (depth > 16 || json === null || typeof json !== "object") return null;
  const o = json;
  const candidate = o.sec_user_id ?? o.secUserId ?? o.sec_uid ?? o.secUid;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  for (const v of Object.values(o)) {
    if (!v || typeof v !== "object") continue;
    const got = extractSecUserId(v, depth + 1);
    if (got) return got;
  }
  return null;
}
async function tryResolveSecUserId(cookies) {
  const infoPaths = [
    "/web/api/media/user/info/",
    "/aweme/v1/creator/user/info/",
    "/passport/account/info/v2/"
  ];
  for (const p of infoPaths) {
    const json = await tryFetchCreatorJson(cookies, p);
    if (!json) continue;
    const sid = extractSecUserId(json);
    if (sid) return sid;
  }
  return null;
}
async function listCreatorVideos(sessionId) {
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) return null;
  const creatorPaths = [
    "/web/api/media/aweme/list/?count=30&cursor=0",
    "/web/api/media/aweme/list/?count=30&max_cursor=0",
    "/aweme/v1/creator/aweme/list/?count=30&cursor=0",
    "/web/api/creator/aweme/list/?count=30&cursor=0",
    "/web/api/media/content/list/?count=30&cursor=0",
    "/web/api/media/content/list/?count=30&page=1",
    "/web/api/media/video/list/?count=30&cursor=0",
    "/web/api/media/item/list/?count=30&cursor=0"
  ];
  const merged = [];
  for (const p of creatorPaths) {
    const json = await tryFetchCreatorJson(cookies, p);
    if (!json) continue;
    const source = `creator:${p}`;
    const direct = extractListFromJson(json, source);
    const fallback = direct.length > 0 ? direct : extractListsRecursively(json, source);
    mergeUniqueVideos(merged, fallback);
    if (merged.length >= 12) return merged.slice(0, 60);
  }
  const secUserId = await tryResolveSecUserId(cookies);
  if (secUserId) {
    const webPaths = [
      `/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=30`,
      `/aweme/v1/web/aweme/post/?sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=0&count=20`
    ];
    for (const p of webPaths) {
      const json = await tryFetchJsonFrom2(cookies, "https://www.douyin.com", p, "https://www.douyin.com/");
      if (!json) continue;
      const source = `web:${p}`;
      const direct = extractListFromJson(json, source);
      const fallback = direct.length > 0 ? direct : extractListsRecursively(json, source);
      mergeUniqueVideos(merged, fallback);
      if (merged.length >= 1) break;
    }
  }
  return merged.slice(0, 60);
}

// src/lib/snapshotDebug.ts
function isSnapshotDebugEnabled() {
  const v = process.env.SNAPSHOT_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
function resolveBaselineYmd(todayYmd) {
  const o = process.env.SNAPSHOT_DEBUG_BASELINE_YMD?.trim();
  if (isSnapshotDebugEnabled() && o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  return addCalendarDaysYmd(todayYmd, -1);
}
function numOrNull(v) {
  if (v === void 0) return void 0;
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return void 0;
}
function parseBaselineJsonOverride() {
  if (!isSnapshotDebugEnabled()) return null;
  const raw = process.env.SNAPSHOT_DEBUG_BASELINE_JSON?.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const patch3 = {};
    const lk = numOrNull(o.likes);
    if (lk !== void 0) patch3.likes = lk;
    const m = numOrNull(o.mutual);
    if (m !== void 0) patch3.mutual = m;
    const f = numOrNull(o.following);
    if (f !== void 0) patch3.following = f;
    const fo = numOrNull(o.followers);
    if (fo !== void 0) patch3.followers = fo;
    if (typeof o.parsed === "boolean") patch3.parsed = o.parsed;
    return Object.keys(patch3).length > 0 ? patch3 : null;
  } catch {
    return null;
  }
}
function mergeDebugIntoBaseline(dbRow, baselineYmd) {
  const patch3 = parseBaselineJsonOverride();
  if (!dbRow && !patch3) return void 0;
  const base = dbRow ?? {
    snapshot_date: baselineYmd,
    likes: null,
    mutual: null,
    following: null,
    followers: null,
    parsed: false
  };
  if (!patch3) return base;
  return {
    snapshot_date: base.snapshot_date,
    likes: patch3.likes !== void 0 ? patch3.likes : base.likes,
    mutual: patch3.mutual !== void 0 ? patch3.mutual : base.mutual,
    following: patch3.following !== void 0 ? patch3.following : base.following,
    followers: patch3.followers !== void 0 ? patch3.followers : base.followers,
    parsed: patch3.parsed !== void 0 ? patch3.parsed : base.parsed
  };
}
function parseViewOverridesMap() {
  if (!isSnapshotDebugEnabled()) return null;
  const raw = process.env.SNAPSHOT_DEBUG_VIEW_OVERRIDES?.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const out = {};
    for (const [ymd, val] of Object.entries(o)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !val || typeof val !== "object" || Array.isArray(val)) continue;
      const rec = val;
      const patch3 = {};
      const lk = numOrNull(rec.likes);
      if (lk !== void 0) patch3.likes = lk;
      const m = numOrNull(rec.mutual);
      if (m !== void 0) patch3.mutual = m;
      const f = numOrNull(rec.following);
      if (f !== void 0) patch3.following = f;
      const fo = numOrNull(rec.followers);
      if (fo !== void 0) patch3.followers = fo;
      if (typeof rec.parsed === "boolean") patch3.parsed = rec.parsed;
      if (Object.keys(patch3).length > 0) out[ymd] = patch3;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
function mergeDebugIntoSnapshotView(dbRow, ymd) {
  const map = parseViewOverridesMap();
  const patch3 = map?.[ymd];
  if (!dbRow && !patch3) return null;
  const base = dbRow ?? {
    snapshot_date: ymd,
    likes: null,
    mutual: null,
    following: null,
    followers: null,
    parsed: false
  };
  if (!patch3) return base;
  return {
    snapshot_date: base.snapshot_date,
    likes: patch3.likes !== void 0 ? patch3.likes : base.likes,
    mutual: patch3.mutual !== void 0 ? patch3.mutual : base.mutual,
    following: patch3.following !== void 0 ? patch3.following : base.following,
    followers: patch3.followers !== void 0 ? patch3.followers : base.followers,
    parsed: patch3.parsed !== void 0 ? patch3.parsed : base.parsed
  };
}

// src/routes/meRoutes.ts
var router3 = (0, import_express3.Router)();
router3.get("/douyin-accounts", async (req, res) => {
  const userId = req.userId;
  const rows = await listDouyinBindingsForUser(userId);
  res.json({
    list: rows.map((r) => ({
      sessionId: r.session_id,
      user: r.nickname || r.douyin_id || r.avatar_url ? {
        nickname: r.nickname ?? void 0,
        douyinId: r.douyin_id ?? void 0,
        avatarUrl: r.avatar_url ?? void 0
      } : null
    }))
  });
});
router3.post("/douyin/bind", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  const s = getPlaywrightSession(sessionId);
  if (!s || s.phase !== "logged_in") {
    res.status(400).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u672A\u767B\u5F55" });
    return;
  }
  const existing = await getDouyinBindingBySession(sessionId);
  if (existing && existing.user_id !== userId) {
    res.status(403).json({ error: "\u8BE5\u6296\u97F3\u4F1A\u8BDD\u5DF2\u7ED1\u5B9A\u5230\u5176\u4ED6\u7528\u6237" });
    return;
  }
  const u = s.user;
  await upsertDouyinBinding(userId, sessionId, {
    nickname: u?.nickname,
    douyinId: u?.douyinId,
    avatarUrl: u?.avatarUrl
  });
  res.json({ ok: true });
});
function statDelta(cur, prev) {
  if (cur == null || prev == null) return null;
  return cur - prev;
}
function parseOptNonNegInt(v) {
  if (v === null || v === void 0 || v === "") return null;
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
router3.get("/douyin/daily-compare", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD" });
    return;
  }
  const tz = snapshotTimezone();
  const todayYmd = ymdInTz(/* @__PURE__ */ new Date(), tz);
  const baselineYmd = resolveBaselineYmd(todayYmd);
  const baselineRaw = await getDailySnapshot(userId, sessionId, baselineYmd);
  const baseline = mergeDebugIntoBaseline(baselineRaw, baselineYmd);
  const current = await fetchCreatorAccountStats(sessionId);
  if (!current) {
    res.status(400).json({ error: "\u65E0\u6CD5\u62C9\u53D6\u5F53\u524D\u8D26\u53F7\u6570\u636E\uFF08\u4F1A\u8BDD\u53EF\u80FD\u5DF2\u5931\u6548\uFF09" });
    return;
  }
  res.json({
    timezone: tz,
    todayYmd,
    baselineYmd,
    baseline: baseline ? {
      likes: baseline.likes,
      mutual: baseline.mutual,
      following: baseline.following,
      followers: baseline.followers,
      parsed: baseline.parsed
    } : null,
    current: {
      likes: current.likes,
      mutual: current.mutual,
      following: current.following,
      followers: current.followers,
      parsed: current.parsed
    },
    delta: {
      likes: statDelta(current.likes, baseline?.likes ?? null),
      mutual: statDelta(current.mutual, baseline?.mutual ?? null),
      following: statDelta(current.following, baseline?.following ?? null),
      followers: statDelta(current.followers, baseline?.followers ?? null)
    },
    snapshotDebug: isSnapshotDebugEnabled()
  });
});
router3.get("/douyin/snapshot-dates", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD" });
    return;
  }
  const dates = await listDailySnapshotDates(userId, sessionId);
  const u = await getUserById(userId);
  res.json({
    dates,
    timezone: snapshotTimezone(),
    snapshotDebug: isSnapshotDebugEnabled(),
    snapshotAdmin: u?.role === "admin"
  });
});
router3.get("/douyin/snapshot", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date \u987B\u4E3A YYYY-MM-DD" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD" });
    return;
  }
  const raw = await getDailySnapshot(userId, sessionId, date);
  const merged = isSnapshotDebugEnabled() ? mergeDebugIntoSnapshotView(raw, date) : raw ?? null;
  res.json({
    timezone: snapshotTimezone(),
    snapshot: merged ? {
      snapshotDate: merged.snapshot_date,
      likes: merged.likes,
      mutual: merged.mutual,
      following: merged.following,
      followers: merged.followers,
      parsed: merged.parsed
    } : null,
    snapshotDebug: isSnapshotDebugEnabled()
  });
});
router3.get("/douyin/videos", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD" });
    return;
  }
  const s = getPlaywrightSession(sessionId);
  if (!s || s.phase !== "logged_in") {
    res.status(400).json({ error: "\u4F1A\u8BDD\u672A\u767B\u5F55\u6216\u5DF2\u5931\u6548" });
    return;
  }
  const items = await listCreatorVideos(sessionId);
  if (items === null) {
    res.status(400).json({ error: "\u65E0\u6CD5\u8BFB\u53D6\u767B\u5F55 Cookie\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55" });
    return;
  }
  const sources = Array.from(new Set(items.map((x) => x.source))).sort();
  res.json({ items, sources });
});
router3.get("/douyin/video-cover", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!sessionId || !url) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId \u6216 url" });
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: "url \u65E0\u6548" });
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    res.status(400).json({ error: "\u4EC5\u652F\u6301 http/https" });
    return;
  }
  const h = parsed.hostname.toLowerCase();
  if (!(h.includes("douyinpic.com") || h.includes("byteimg.com") || h.includes("ibytedtos.com") || h.includes("douyin.com"))) {
    res.status(400).json({ error: "\u4E0D\u652F\u6301\u8BE5\u5C01\u9762\u57DF\u540D" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD" });
    return;
  }
  const cookies = getPlaywrightCookieVault(sessionId);
  if (!cookies?.length) {
    res.status(400).json({ error: "\u4F1A\u8BDD Cookie \u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55" });
    return;
  }
  const host = parsed.hostname.toLowerCase();
  const cookieHeader = cookies.filter((c) => {
    const raw = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const d = raw.toLowerCase();
    return host === d || host.endsWith("." + d);
  }).map((c) => `${c.name}=${c.value}`).join("; ");
  try {
    const r = await fetch(parsed.toString(), {
      headers: {
        Cookie: cookieHeader,
        Referer: "https://www.douyin.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!r.ok) {
      res.status(404).json({ error: "\u62C9\u53D6\u5C01\u9762\u5931\u8D25" });
      return;
    }
    const ct = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "private, max-age=120");
    res.end(buf);
  } catch {
    res.status(500).json({ error: "\u5C01\u9762\u4EE3\u7406\u5931\u8D25" });
  }
});
router3.post("/douyin/snapshot", async (req, res) => {
  const userId = req.userId;
  const actor = await getUserById(userId);
  if (!actor || actor.role !== "admin") {
    res.status(403).json({ error: "\u9700\u8981\u7BA1\u7406\u5458\u8D26\u53F7\u624D\u80FD\u5199\u5165\u5F52\u6863" });
    return;
  }
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date \u987B\u4E3A YYYY-MM-DD" });
    return;
  }
  const binding = await getDouyinBindingBySession(sessionId);
  if (!binding || binding.user_id !== userId) {
    res.status(403).json({ error: "\u65E0\u6743\u4E3A\u8BE5\u4F1A\u8BDD\u5199\u5165\u5F52\u6863" });
    return;
  }
  const likes = parseOptNonNegInt(req.body?.likes);
  const mutual = parseOptNonNegInt(req.body?.mutual);
  const following = parseOptNonNegInt(req.body?.following);
  const followers = parseOptNonNegInt(req.body?.followers);
  const parsed = req.body?.parsed === false ? false : true;
  await upsertDailySnapshot(userId, sessionId, date, {
    likes,
    mutual,
    following,
    followers,
    parsed
  });
  res.json({ ok: true });
});
router3.get("/douyin/cards-metrics", async (req, res) => {
  const userId = req.userId;
  const rows = await listDouyinBindingsForUser(userId);
  const tz = snapshotTimezone();
  const todayYmd = ymdInTz(/* @__PURE__ */ new Date(), tz);
  const baselineYmd = resolveBaselineYmd(todayYmd);
  const items = await Promise.all(
    rows.map(async (r) => {
      const sessionId = r.session_id;
      const s = getPlaywrightSession(sessionId);
      if (!s || s.phase !== "logged_in") {
        return { sessionId, ok: false, error: "\u4F1A\u8BDD\u672A\u767B\u5F55\u6216\u5DF2\u5931\u6548" };
      }
      const current = await fetchCreatorAccountStats(sessionId);
      if (!current) {
        return { sessionId, ok: false, error: "\u65E0\u6CD5\u62C9\u53D6\u7EDF\u8BA1\u6570\u636E" };
      }
      const baselineRaw = await getDailySnapshot(userId, sessionId, baselineYmd);
      const baseline = mergeDebugIntoBaseline(baselineRaw, baselineYmd);
      return {
        sessionId,
        ok: true,
        parsed: current.parsed,
        likes: current.likes,
        mutual: current.mutual,
        following: current.following,
        followers: current.followers,
        baselineAvailable: Boolean(baseline?.parsed),
        delta: {
          likes: statDelta(current.likes, baseline?.likes ?? null),
          mutual: statDelta(current.mutual, baseline?.mutual ?? null),
          following: statDelta(current.following, baseline?.following ?? null),
          followers: statDelta(current.followers, baseline?.followers ?? null)
        }
      };
    })
  );
  res.json({
    items,
    serverTimeYmd: todayYmd,
    baselineYmd,
    timezone: tz,
    snapshotDebug: isSnapshotDebugEnabled()
  });
});
router3.delete("/douyin-accounts/:sessionId", async (req, res) => {
  const userId = req.userId;
  const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId : "";
  if (!sessionId) {
    res.status(400).json({ error: "\u7F3A\u5C11 sessionId" });
    return;
  }
  const n = await deleteDouyinBinding(userId, sessionId);
  if (n < 1) {
    res.status(404).json({ error: "\u672A\u627E\u5230\u7ED1\u5B9A" });
    return;
  }
  deletePlaywrightSession(sessionId);
  res.json({ ok: true });
});

// src/routes/xhsRoutes.ts
var import_express4 = require("express");

// src/xiaohongshu/xhsCookie.ts
var DEFAULT_DOMAIN2 = ".xiaohongshu.com";
var DEFAULT_PATH2 = "/";
function parseXhsCookiePaste(raw) {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return [];
      const out2 = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const o = item;
        const name = typeof o.name === "string" ? o.name : "";
        const value = typeof o.value === "string" ? o.value : String(o.value ?? "");
        if (!name) continue;
        out2.push({
          name,
          value,
          domain: typeof o.domain === "string" && o.domain.trim() ? o.domain.trim() : DEFAULT_DOMAIN2,
          path: typeof o.path === "string" && o.path.trim() ? o.path.trim() : DEFAULT_PATH2,
          expires: typeof o.expires === "number" ? o.expires : -1,
          httpOnly: o.httpOnly === true,
          secure: o.secure !== false,
          sameSite: o.sameSite ?? "Lax"
        });
      }
      return dedupe(out2);
    } catch {
      return [];
    }
  }
  let lineSource = text;
  const m = /(?:^|\n)\s*Cookie:\s*(.+)/i.exec(text);
  if (m?.[1]) lineSource = m[1].trim();
  const segments = lineSource.split(/[\n\r]+|;/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of segments) {
    if (seg.startsWith("#")) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    let value = seg.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!name) continue;
    out.push({
      name,
      value,
      domain: DEFAULT_DOMAIN2,
      path: DEFAULT_PATH2,
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    });
  }
  return dedupe(out);
}
function dedupe(cookies) {
  const map = /* @__PURE__ */ new Map();
  for (const c of cookies) {
    map.set(`${c.domain}|${c.path}|${c.name}`, c);
  }
  return [...map.values()];
}
function looksLikeXhsAuthCookies(cookies) {
  if (cookies.length < 2) return false;
  const names = cookies.map((c) => c.name.toLowerCase());
  return names.some(
    (n) => n.includes("web_session") || n.includes("a1") || n.includes("websectiga") || n.includes("acw_tc") || n.includes("customer-sso-sid")
  );
}

// src/xiaohongshu/xhsFetch.ts
function buildCookieHeader3(cookies, host) {
  const hostLower = host.toLowerCase();
  const parts = [];
  for (const c of cookies) {
    const raw = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    const d = raw.toLowerCase();
    if (hostLower === d || hostLower.endsWith(`.${d}`)) parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
}
function maskTokenPreview(cookies) {
  const c = cookies.find((x) => /web_session|a1/i.test(x.name));
  if (!c?.value || c.value.length < 4) return void 0;
  const v = c.value;
  const masked = v.length <= 12 ? `${v.slice(0, 2)}\u2026` : `${v.slice(0, 4)}\u2026${v.slice(-3)}`;
  return `${c.name}=${masked}`;
}
function readUserShape(obj) {
  const nickname = typeof obj.nickname === "string" ? obj.nickname : typeof obj.nick_name === "string" ? obj.nick_name : typeof obj.nickName === "string" ? obj.nickName : void 0;
  let userId;
  if (typeof obj.user_id === "string") userId = obj.user_id;
  else if (typeof obj.userId === "string") userId = obj.userId;
  else if (typeof obj.userid === "string") userId = obj.userid;
  else if (typeof obj.userId === "number" && Number.isFinite(obj.userId)) userId = String(obj.userId);
  const redId = typeof obj.red_id === "string" ? obj.red_id : typeof obj.redId === "string" ? obj.redId : void 0;
  let avatarUrl;
  const img = obj.imageb || obj.images || obj.avatar;
  if (typeof img === "string" && img.startsWith("http")) avatarUrl = img;
  if (nickname || userId || redId) {
    return { nickname, userId, redId, avatarUrl };
  }
  return null;
}
function extractUserFromXhsJson(o, depth = 0) {
  if (depth > 6 || o === null || typeof o !== "object") return null;
  const obj = o;
  const direct = readUserShape(obj);
  if (direct) return direct;
  const data = obj.data;
  if (data && typeof data === "object") {
    const fromData = readUserShape(data);
    if (fromData) return fromData;
    const d = data;
    for (const k of ["user", "userInfo", "account", "user_info"]) {
      const v = d[k];
      if (v && typeof v === "object") {
        const inner = readUserShape(v);
        if (inner) return inner;
      }
    }
  }
  for (const k of ["user", "userInfo", "account"]) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const inner = readUserShape(v);
      if (inner) return inner;
    }
  }
  return null;
}
function isNoiseNickname(s) {
  const t = s.trim();
  if (t.length < 2) return true;
  return /^(游客|未登录|默认用户|小红书用户|用户\d*|Guest|test)$/i.test(t);
}
function isPlausibleUserId(s) {
  const t = s.trim();
  if (t.length < 6) return false;
  if (/^0+$/.test(t)) return false;
  return true;
}
function isPlausibleRedId(s) {
  const t = s.trim();
  return t.length >= 4 && /^[a-zA-Z0-9_]+$/.test(t);
}
function hasConfirmedXhsProfile(u) {
  if (!u) return false;
  const nick = u.nickname?.trim();
  if (nick && !isNoiseNickname(nick)) return true;
  if (u.redId?.trim() && isPlausibleRedId(u.redId.trim())) return true;
  if (u.userId != null && isPlausibleUserId(String(u.userId))) return true;
  return false;
}
async function tryFetchXhsUserInfo(cookies) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const endpoints = [
    "https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo",
    "https://edith.xiaohongshu.com/api/sns/web/v2/user/me"
  ];
  for (const url of endpoints) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const ch = buildCookieHeader3(cookies, host);
    if (!ch) continue;
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: ch,
          "User-Agent": ua,
          Referer: "https://www.xiaohongshu.com/",
          Origin: "https://www.xiaohongshu.com",
          Accept: "application/json, text/plain, */*"
        }
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) continue;
      const json = await res.json();
      const u = extractUserFromXhsJson(json);
      if (u) {
        u.tokenPreview = maskTokenPreview(cookies) ?? u.tokenPreview;
        return u;
      }
    } catch {
    }
  }
  const fallback = {};
  const tp = maskTokenPreview(cookies);
  if (tp) fallback.tokenPreview = tp;
  return tp ? fallback : null;
}

// src/xiaohongshu/xhsImportWithLogs.ts
function ts2() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false });
}
async function importXhsSessionWithLogs(raw) {
  const logs = [];
  const log = (msg) => logs.push(`[${ts2()}] ${msg}`);
  log("\u2460 \u89E3\u6790\u5C0F\u7EA2\u4E66 Cookie\u2026");
  const cookies = parseXhsCookiePaste(raw);
  if (cookies.length < 1) {
    log("\u89E3\u6790\u5931\u8D25");
    return { ok: false, error: "\u672A\u80FD\u89E3\u6790\u51FA Cookie", logs };
  }
  log(`\u5DF2\u89E3\u6790 ${cookies.length} \u6761`);
  log("\u2461 \u6821\u9A8C\u767B\u5F55\u7279\u5F81\uFF08web_session / a1 \u7B49\uFF09\u2026");
  if (!looksLikeXhsAuthCookies(cookies)) {
    log("\u6821\u9A8C\u672A\u901A\u8FC7");
    return {
      ok: false,
      error: "\u672A\u8BC6\u522B\u5230\u5E38\u89C1\u5C0F\u7EA2\u4E66\u767B\u5F55 Cookie\uFF0C\u8BF7\u4ECE www.xiaohongshu.com \u57DF\u540D\u4E0B\u590D\u5236",
      logs
    };
  }
  log("\u6821\u9A8C\u901A\u8FC7");
  log("\u2462 \u5C1D\u8BD5\u62C9\u53D6\u8D26\u53F7\u57FA\u7840\u4FE1\u606F\uFF08\u63A5\u53E3\u53EF\u80FD\u9700\u989D\u5916\u7B7E\u540D\uFF0C\u5931\u8D25\u4ECD\u4F1A\u4FDD\u5B58 Cookie\uFF09\u2026");
  let user = await tryFetchXhsUserInfo(cookies);
  if (user?.nickname || user?.userId) log("\u5DF2\u83B7\u53D6\u5230\u8D26\u53F7\u8D44\u6599");
  else log("\u63A5\u53E3\u672A\u8FD4\u56DE\u5B8C\u6574\u8D44\u6599\uFF08\u53EF\u7EE7\u7EED\u4F7F\u7528\u65E0\u5934\u53D1\u5E03\u811A\u672C\u6216\u53C2\u8003 clawra-xiaohongshu\uFF09");
  const id = createXhsSessionId();
  putXhsLoggedInSession(id, cookies, user ?? void 0);
  log("\u2463 \u4F1A\u8BDD\u5DF2\u5199\u5165\u670D\u52A1\u7AEF data/xiaohongshu-sessions.json");
  log("\u2464 \u5B8C\u6210");
  return { ok: true, sessionId: id, user, logs };
}

// src/xiaohongshu/xhsPlaywrightLogin.ts
var import_node_crypto3 = require("node:crypto");
var XHS_EXPLORE = "https://www.xiaohongshu.com/explore";
var pwStore = /* @__PURE__ */ new Map();
var PW_TTL_MS = 15 * 60 * 1e3;
function prunePw() {
  const now = Date.now();
  for (const [id, s] of pwStore) {
    if (now - s.createdAt > PW_TTL_MS && s.phase !== "logged_in") {
      pwStore.delete(id);
    }
  }
}
function patch2(id, partial) {
  const cur = pwStore.get(id);
  if (!cur) return;
  Object.assign(cur, partial);
  pwStore.set(id, cur);
}
var delay4 = (ms) => new Promise((r) => setTimeout(r, ms));
async function cleanup4(browser) {
  try {
    await browser?.close();
  } catch {
  }
}
function hasWebSession(cookies) {
  return cookies.some((c) => c.name === "web_session" && (c.value?.length ?? 0) > 8);
}
async function isLikelyAwaitingQrScan(page) {
  const dialog = page.locator('[role="dialog"]').first();
  const visible = await dialog.isVisible().catch(() => false);
  if (!visible) return false;
  const scanCopy = await dialog.getByText(/扫码|二维码|请使用小红书/).first().isVisible().catch(() => false);
  const canvas = await dialog.locator("canvas").first().isVisible().catch(() => false);
  return scanCopy || canvas;
}
function toDataUrlPng(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}
async function captureQrForDisplay2(page) {
  try {
    await page.getByText(/扫码登录/).first().click({ timeout: 6e3 }).catch(() => {
    });
    await delay4(1200);
    const dialog = page.locator('[role="dialog"]').first();
    const tryImgSrcFromPage = async () => {
      const src = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"]') ?? document.querySelector('[class*="login" i]') ?? document.body;
        const imgs = Array.from(root.querySelectorAll("img"));
        for (const img of imgs) {
          const s = img.getAttribute("src") ?? "";
          if (s.startsWith("data:image") && s.length > 200) return s;
        }
        return "";
      }).catch(() => "");
      return src || void 0;
    };
    const tryScreenshotLocator = async (loc) => {
      if (!await loc.isVisible({ timeout: 2500 }).catch(() => false)) return void 0;
      await loc.scrollIntoViewIfNeeded().catch(() => {
      });
      await delay4(150);
      const buf = await loc.screenshot({ type: "png" }).catch(() => void 0);
      if (buf && buf.length > 400) return buf;
      return void 0;
    };
    const qrCandidates = [
      dialog.locator("canvas").first(),
      page.locator('[role="dialog"] canvas').first(),
      dialog.locator('img[src*="qrcode" i], img[src*="qr/"], img[src*="/qr"]').first(),
      page.locator('img[alt*="\u4E8C\u7EF4\u7801" i], img[alt*="\u626B\u7801" i]').first(),
      page.locator('[class*="qrcode" i], [class*="qr-code" i], [class*="QRCode" i]').first()
    ];
    for (const loc of qrCandidates) {
      const buf = await tryScreenshotLocator(loc);
      if (buf) return toDataUrlPng(buf);
    }
    const inline = await tryImgSrcFromPage();
    if (inline?.startsWith("data:image")) return inline;
    const clip = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      const nodes = [
        ...Array.from(d.querySelectorAll("img")),
        ...Array.from(d.querySelectorAll("canvas"))
      ];
      let best = null;
      let bestScore = 0;
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width < 72 || r.height < 72) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const isCanvas = el instanceof HTMLCanvasElement;
        const src = el instanceof HTMLImageElement ? el.src : "";
        const alt = el.getAttribute("alt") || "";
        const cls = el instanceof HTMLElement && typeof el.className === "string" ? el.className : "";
        const qrHint = /qr|qrcode|二维码|扫码|barcode/i.test(`${src}${cls}${alt}`);
        const logoGuess = /logo|brand|favicon|watermark|\/icon|头像|小红书logo/i.test(`${src}${alt}${cls}`) && !/qr|qrcode/i.test(`${src}${cls}`);
        if (!isCanvas && logoGuess) continue;
        if (!isCanvas && !qrHint) {
          const maxSide = Math.max(r.width, r.height);
          if (maxSide > 420) continue;
        }
        const a = r.width * r.height;
        const ar = r.width / Math.max(r.height, 1);
        const squareish = ar > 0.75 && ar < 1.35;
        if (!isCanvas && !qrHint && !squareish) continue;
        let score = squareish ? a * 1.15 : a * 0.85;
        if (qrHint) score *= 2.2;
        if (isCanvas) score *= 1.35;
        if (score > bestScore) {
          bestScore = score;
          best = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      if (!best) return null;
      const pad = 12;
      const x = Math.max(0, Math.floor(best.x - pad));
      const y = Math.max(0, Math.floor(best.y - pad));
      const w = Math.min(Math.ceil(best.width + pad * 2), window.innerWidth - x);
      const h = Math.min(Math.ceil(best.height + pad * 2), window.innerHeight - y);
      if (w < 80 || h < 80) return null;
      return { x, y, width: w, height: h };
    }).catch(() => null);
    if (clip) {
      const buf = await page.screenshot({ type: "png", clip });
      if (buf.length > 800) return toDataUrlPng(buf);
    }
    const modal = page.locator('[role="dialog"], [class*="login" i], [class*="Login" i], [class*="modal" i]').first();
    if (await modal.isVisible({ timeout: 2e3 }).catch(() => false)) {
      const buf = await modal.screenshot({ type: "png" });
      if (buf.length > 500) return toDataUrlPng(buf);
    }
    return void 0;
  } catch {
    return void 0;
  }
}
function getXhsPlaywrightSessionForApi(id) {
  prunePw();
  const persisted = getXhsSession(id);
  if (persisted) {
    return {
      phase: "logged_in",
      loggedIn: true,
      hint: persisted.hint,
      user: persisted.user ?? null,
      cookieCount: persisted.cookieCount
    };
  }
  const p = pwStore.get(id);
  if (!p) return void 0;
  return {
    phase: p.phase,
    loggedIn: p.phase === "logged_in",
    hint: p.hint,
    qrcodeUrl: p.qrcodeUrl,
    qrcodeDataUrl: p.qrcodeDataUrl,
    error: p.error
  };
}
function removeXhsSessionEverywhere(id) {
  prunePw();
  const hadPw = pwStore.has(id);
  pwStore.delete(id);
  return deletePersistedXhsSession(id) || hadPw;
}
function createXhsPlaywrightSessionRecord() {
  prunePw();
  const id = (0, import_node_crypto3.randomUUID)();
  const s = {
    id,
    phase: "preparing",
    hint: "\u6B63\u5728\u542F\u52A8\u6D4F\u89C8\u5668\u5E76\u6253\u5F00\u5C0F\u7EA2\u4E66\u2026",
    createdAt: Date.now()
  };
  pwStore.set(id, s);
  return s;
}
function runXhsPlaywrightLoginJob(sessionId) {
  void (async () => {
    let browser;
    try {
      const { chromium } = await import("playwright");
      const headless = process.env.XHS_PLAYWRIGHT_HEADLESS !== "false";
      browser = await chromium.launch({
        headless,
        args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
      });
      const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        locale: "zh-CN",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      });
      const page = await context.newPage();
      await page.goto(XHS_EXPLORE, { waitUntil: "domcontentloaded", timeout: 9e4 });
      await delay4(3500);
      const loginEntry = page.getByRole("button", { name: /登录/ }).or(page.locator('a:has-text("\u767B\u5F55")')).first();
      await loginEntry.click({ timeout: 12e3 }).catch(() => {
      });
      await delay4(2500);
      const qrcodeDataUrl = await captureQrForDisplay2(page);
      if (!qrcodeDataUrl) {
        patch2(sessionId, {
          phase: "error",
          hint: "",
          error: "\u672A\u627E\u5230\u767B\u5F55\u4E8C\u7EF4\u7801\u3002\u53EF\u5C1D\u8BD5\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF XHS_PLAYWRIGHT_HEADLESS=false \u4F7F\u7528\u6709\u5934\u6A21\u5F0F\u3002"
        });
        await context.close().catch(() => {
        });
        await cleanup4(browser);
        return;
      }
      patch2(sessionId, {
        phase: "awaiting_scan",
        hint: "\u8BF7\u4F7F\u7528\u5C0F\u7EA2\u4E66 App \u626B\u7801\u767B\u5F55",
        qrcodeDataUrl
      });
      const loginPollMs = 1e3;
      const maxTicks = 120;
      for (let i = 0; i < maxTicks; i++) {
        await delay4(loginPollMs);
        await page.waitForLoadState("domcontentloaded").catch(() => {
        });
        const cookies = await context.cookies();
        if (hasWebSession(cookies)) {
          const awaitingQr = await isLikelyAwaitingQrScan(page);
          const user = await tryFetchXhsUserInfo(cookies);
          if (!awaitingQr && hasConfirmedXhsProfile(user)) {
            putXhsLoggedInSession(sessionId, cookies, user ?? void 0);
            pwStore.delete(sessionId);
            await context.close().catch(() => {
            });
            await cleanup4(browser);
            return;
          }
        }
      }
      patch2(sessionId, {
        phase: "expired",
        hint: "\u7B49\u5F85\u626B\u7801\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"
      });
      await context.close().catch(() => {
      });
      await cleanup4(browser);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = msg.includes("Executable") || msg.includes("browserType.launch") ? "\u672A\u68C0\u6D4B\u5230 Chromium\uFF0C\u8BF7\u5728 backend \u76EE\u5F55\u6267\u884C\uFF1Anpx playwright install chromium" : msg;
      patch2(sessionId, {
        phase: "error",
        hint: "",
        error: hint
      });
      await cleanup4(browser);
    }
  })();
}

// src/routes/xhsRoutes.ts
var router4 = (0, import_express4.Router)();
router4.post("/playwright/sessions", (_req, res) => {
  try {
    const session = createXhsPlaywrightSessionRecord();
    runXhsPlaywrightLoginJob(session.id);
    res.json({ sessionId: session.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
router4.get("/playwright/sessions/:id", (req, res) => {
  const data = getXhsPlaywrightSessionForApi(req.params.id);
  if (!data) {
    res.status(404).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" });
    return;
  }
  res.json({
    phase: data.phase,
    hint: data.hint,
    qrcodeUrl: data.qrcodeUrl,
    qrcodeDataUrl: data.qrcodeDataUrl,
    loggedIn: data.loggedIn,
    user: data.user ?? null,
    cookieCount: data.cookieCount,
    error: data.error
  });
});
router4.get("/capabilities", (_req, res) => {
  res.json({
    reference: "https://github.com/AI-Scarlett/clawra-xiaohongshu",
    features: [
      { id: "qr_login", name: "\u7F51\u9875\u626B\u7801\u767B\u5F55\uFF08Playwright\uFF09", ready: true },
      { id: "cookie_persist", name: "Cookie \u6301\u4E45\u5316", ready: true },
      { id: "ai_image", name: "\u963F\u91CC\u4E91\u767E\u70BC\u751F\u6210\u56FE\u7247", ready: Boolean(process.env.DASHSCOPE_API_KEY?.trim()) },
      { id: "ai_caption", name: "\u667A\u80FD\u6587\u6848", ready: Boolean(process.env.DASHSCOPE_API_KEY?.trim()) },
      { id: "playwright_publish", name: "\u65E0\u5934\u6D4F\u89C8\u5668\u53D1\u5E03", ready: false, note: "\u53EF\u5BF9\u63A5 clawra \u811A\u672C\u6216\u540E\u7EED\u63A5\u5165" },
      { id: "cron", name: "\u5B9A\u65F6\u53D1\u5E03", ready: false, note: "\u5EFA\u8BAE\u7528\u7CFB\u7EDF\u8BA1\u5212\u4EFB\u52A1\u8C03\u7528 npm \u811A\u672C" },
      {
        id: "qq_notify",
        name: "\u5931\u8D25 QQ \u901A\u77E5",
        ready: Boolean(process.env.QQ_NOTIFY_WEBHOOK_URL?.trim() || process.env.QQBOT_USER_ID?.trim())
      }
    ],
    envHints: {
      DASHSCOPE_API_KEY: "\u963F\u91CC\u4E91\u767E\u70BC\uFF08\u56FE/\u6587\uFF09",
      QQ_NOTIFY_WEBHOOK_URL: "\u53EF\u9009\uFF1A\u5931\u8D25\u901A\u77E5 Webhook"
    }
  });
});
router4.post("/sessions/import-with-logs", async (req, res) => {
  const tokens = typeof req.body?.tokens === "string" ? req.body.tokens : "";
  if (!tokens.trim()) {
    res.status(400).json({ error: "\u8BF7\u63D0\u4F9B tokens", logs: [] });
    return;
  }
  try {
    const result = await importXhsSessionWithLogs(tokens);
    if (!result.ok) {
      res.status(400).json({ error: result.error, logs: result.logs });
      return;
    }
    res.json({ sessionId: result.sessionId, user: result.user, logs: result.logs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg, logs: [] });
  }
});
router4.get("/sessions/:id", (req, res) => {
  const s = getXhsSession(req.params.id);
  if (!s) {
    res.status(404).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" });
    return;
  }
  res.json({
    loggedIn: true,
    hint: s.hint,
    user: s.user ?? null,
    cookieCount: s.cookieCount
  });
});
router4.delete("/sessions/:id", (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id.trim()) {
    res.status(400).json({ error: "\u7F3A\u5C11\u4F1A\u8BDD id" });
    return;
  }
  const removed = removeXhsSessionEverywhere(id);
  if (!removed) {
    res.status(404).json({ error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664" });
    return;
  }
  res.status(204).end();
});

// src/index.ts
async function main() {
  await initDatabase();
  await seedAdminUser();
  {
    const nu = await countUsers();
    const nd = await countDouyinBindings();
    console.log(`[db] \u6570\u636E\u5FEB\u7167\uFF1Ausers=${nu} \u884C\uFF0Cdouyin_bindings=${nd} \u884C`);
    if ((process.env.DB_TYPE || "sqlite").trim().toLowerCase() === "mysql") {
      const name = process.env.DB_NAME?.trim() || "matrix_data";
      console.log(`[db] \u8BF7\u5728\u6570\u636E\u5E93\u5BA2\u6237\u7AEF\u9009\u4E2D\u5E93\u300C${name}\u300D\uFF0C\u518D\u6253\u5F00\u8868 users\uFF08\u767B\u5F55\u8D26\u53F7\uFF09\u4E0E douyin_bindings\uFF08\u6296\u97F3\u6388\u6743\u540E\u624D\u6709\uFF09`);
    } else {
      console.log(`[db] SQLite \u6587\u4EF6\uFF1A${process.env.DATABASE_PATH?.trim() || "data/matrix.db"}`);
    }
  }
  const app = (0, import_express5.default)();
  const port = Number(process.env.PORT) || 3e3;
  app.use((0, import_cors.default)({ origin: true }));
  app.use(import_express5.default.json({ limit: "4mb" }));
  app.use("/api/auth", router);
  app.use("/api/me", requireAuth, router3);
  app.use("/api/douyin", requireAuth, router2);
  app.use("/api/xhs", requireAuth, router4);
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "matrix-data-api" });
  });
  app.get("/api/platforms", (_req, res) => {
    res.json({
      platforms: [
        { id: "douyin", name: "\u6296\u97F3" },
        { id: "xiaohongshu", name: "\u5C0F\u7EA2\u4E66" },
        { id: "channels", name: "\u89C6\u9891\u53F7" }
      ]
    });
  });
  const staticDir = process.env.FRONTEND_DIST_DIR?.trim() ? import_node_path5.default.resolve(process.env.FRONTEND_DIST_DIR.trim()) : import_node_path5.default.resolve(process.cwd(), "public");
  const indexHtmlPath = import_node_path5.default.join(staticDir, "index.html");
  if (import_node_fs3.default.existsSync(indexHtmlPath)) {
    app.use(import_express5.default.static(staticDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
    console.log(`[web] \u9759\u6001\u7AD9\u70B9\u76EE\u5F55\uFF1A${staticDir}`);
  } else {
    console.log(`[web] \u672A\u627E\u5230\u524D\u7AEF\u9759\u6001\u76EE\u5F55\uFF1A${staticDir}\uFF08\u4EC5\u63D0\u4F9B API\uFF09`);
  }
  await initPlaywrightSessionsFromDisk();
  await initXhsSessionsFromDisk();
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
    startDailyDouyinSnapshotScheduler();
  });
}
void main().catch((e) => {
  console.error("[boot] \u542F\u52A8\u5931\u8D25", e);
  process.exit(1);
});
