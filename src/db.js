import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
const storePath = path.join(dataDir, "store.sqlite");

function ensureDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

ensureDir();

export const db = new Database(storePath, { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -20000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role INTEGER NOT NULL DEFAULT 2,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_matches_owner_id ON matches(owner_id);
  CREATE INDEX IF NOT EXISTS idx_matches_updated_at ON matches(updated_at);

  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapMatchRow(row) {
  if (!row) return null;

  let data = {};
  try {
    data = JSON.parse(row.data);
  } catch {
    data = {};
  }

  return {
    ...data,
    id: row.id,
    ownerId: row.owner_id,
    mode: row.mode,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

const countUsersByRoleStmt = db.query(
  "SELECT COUNT(*) AS count FROM users WHERE role = ?"
);
const countUsersStmt = db.query("SELECT COUNT(*) AS count FROM users");
const countSessionsStmt = db.query("SELECT COUNT(*) AS count FROM sessions");
const countMatchesStmt = db.query("SELECT COUNT(*) AS count FROM matches");
const countGamesStmt = db.query("SELECT COUNT(*) AS count FROM matches WHERE mode = 'human-vs-bot'");
const countRoomsStmt = db.query("SELECT COUNT(*) AS count FROM matches WHERE mode = 'human-vs-human'");
const findUserByIdStmt = db.query(
  "SELECT * FROM users WHERE id = ? LIMIT 1"
);
const findUserByUsernameStmt = db.query(
  "SELECT * FROM users WHERE username_lower = ? LIMIT 1"
);
const findUserByUsernameExcludingStmt = db.query(
  "SELECT * FROM users WHERE username_lower = ? AND id != ? LIMIT 1"
);
const listUsersStmt = db.query(
  "SELECT * FROM users ORDER BY role ASC, created_at ASC, username_lower ASC"
);
const findFirstUserByRoleStmt = db.query(
  "SELECT * FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1"
);
const insertUserStmt = db.query(`
  INSERT INTO users (id, username, username_lower, password_hash, role, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateUserStmt = db.query(`
  UPDATE users
  SET username = ?, username_lower = ?, password_hash = ?, role = ?, created_at = ?
  WHERE id = ?
`);
const upsertUserStmt = db.query(`
  INSERT INTO users (id, username, username_lower, password_hash, role, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    username_lower = excluded.username_lower,
    password_hash = excluded.password_hash,
    role = excluded.role,
    created_at = excluded.created_at
`);
const deleteExpiredSessionsStmt = db.query(
  "DELETE FROM sessions WHERE expires_at < ?"
);
const findSessionByTokenHashStmt = db.query(
  "SELECT * FROM sessions WHERE token_hash = ? LIMIT 1"
);
const insertSessionStmt = db.query(`
  INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);
const deleteSessionsByTokenHashStmt = db.query(
  "DELETE FROM sessions WHERE token_hash = ?"
);
const deleteSessionsByUserIdStmt = db.query(
  "DELETE FROM sessions WHERE user_id = ?"
);
const deleteUserStmt = db.query(
  "DELETE FROM users WHERE id = ?"
);

const insertMatchStmt = db.query(`
  INSERT INTO matches (
    id, owner_id, mode, status, updated_at, data
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const updateMatchStmt = db.query(`
  UPDATE matches
  SET owner_id = ?, mode = ?, status = ?, updated_at = ?, data = ?
  WHERE id = ?
`);
const findMatchByIdStmt = db.query(
  "SELECT * FROM matches WHERE id = ? LIMIT 1"
);
const listMatchesByOwnerStmt = db.query(
  "SELECT * FROM matches WHERE owner_id = ? ORDER BY updated_at DESC"
);
const findMatchByInviteCodeStmt = db.query(
  "SELECT * FROM matches WHERE json_extract(data, '$.inviteCode') = ? LIMIT 1"
);
const listVisibleMatchesStmt = db.query(`
  SELECT * FROM matches 
  WHERE owner_id = ? 
     OR json_extract(data, '$.guestUserId') = ? 
     OR (status = 'waiting' AND json_extract(data, '$.guestUserId') IS NULL AND COALESCE(json_extract(data, '$.isPublic'), true) = 1)
  ORDER BY updated_at DESC
`);
const deleteMatchStmt = db.query(
  "DELETE FROM matches WHERE id = ?"
);
const getSystemConfigValueStmt = db.query(
  "SELECT value FROM system_config WHERE key = ? LIMIT 1"
);
const listSystemConfigStmt = db.query(
  "SELECT key, value, updated_at FROM system_config ORDER BY key ASC"
);
const upsertSystemConfigStmt = db.query(`
  INSERT INTO system_config (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getStorePath() {
  return storePath;
}

export function countUsersByRole(role) {
  return Number(countUsersByRoleStmt.get(role)?.count ?? 0);
}

export function countUsers() {
  return Number(countUsersStmt.get()?.count ?? 0);
}

export function countSessions() {
  return Number(countSessionsStmt.get()?.count ?? 0);
}

export function countGames() {
  return Number(countGamesStmt.get()?.count ?? 0);
}

export function countRooms() {
  return Number(countRoomsStmt.get()?.count ?? 0);
}

export function findUserById(userId) {
  return mapUserRow(findUserByIdStmt.get(userId));
}

export function findUserByUsername(username) {
  return mapUserRow(findUserByUsernameStmt.get(String(username).toLowerCase()));
}

export function findUserByUsernameExcludingId(username, excludedUserId) {
  return mapUserRow(
    findUserByUsernameExcludingStmt.get(String(username).toLowerCase(), excludedUserId)
  );
}

export function listUsers() {
  return listUsersStmt.all().map(mapUserRow);
}

export function findFirstUserByRole(role) {
  return mapUserRow(findFirstUserByRoleStmt.get(role));
}

export function insertUser(user) {
  insertUserStmt.run(
    user.id,
    user.username,
    user.username.toLowerCase(),
    user.passwordHash,
    user.role,
    user.createdAt
  );
}

export function updateUser(user) {
  updateUserStmt.run(
    user.username,
    user.username.toLowerCase(),
    user.passwordHash,
    user.role,
    user.createdAt,
    user.id
  );
}

export function upsertUser(user) {
  upsertUserStmt.run(
    user.id,
    user.username,
    user.username.toLowerCase(),
    user.passwordHash,
    user.role,
    user.createdAt
  );
}

export function deleteSessionsByUserId(userId) {
  return Number(deleteSessionsByUserIdStmt.run(userId).changes ?? 0);
}

export function deleteUser(userId) {
  return Number(deleteUserStmt.run(userId).changes ?? 0);
}

export function deleteExpiredSessions(now) {
  deleteExpiredSessionsStmt.run(now);
}

export function insertSession(session) {
  insertSessionStmt.run(
    session.id,
    session.userId,
    session.tokenHash,
    session.createdAt,
    session.expiresAt
  );
}

export function findSessionByTokenHash(tokenHash) {
  return mapSessionRow(findSessionByTokenHashStmt.get(tokenHash));
}

export function deleteSessionsByTokenHash(tokenHash) {
  return Number(deleteSessionsByTokenHashStmt.run(tokenHash).changes ?? 0);
}

export function insertMatch(match) {
  insertMatchStmt.run(
    match.id,
    match.ownerId || match.hostUserId,
    match.mode,
    match.status,
    match.updatedAt,
    JSON.stringify(match)
  );
}

export function updateMatch(match) {
  updateMatchStmt.run(
    match.ownerId || match.hostUserId,
    match.mode,
    match.status,
    match.updatedAt,
    JSON.stringify(match),
    match.id
  );
}

export function findMatchById(matchId) {
  return mapMatchRow(findMatchByIdStmt.get(matchId));
}

export function listMatchesByOwner(ownerId) {
  return listMatchesByOwnerStmt.all(ownerId).map(mapMatchRow);
}

export function findMatchByInviteCode(inviteCode) {
  return mapMatchRow(findMatchByInviteCodeStmt.get(inviteCode));
}

export function listMatchesByUser(userId) {
  return listVisibleMatchesStmt.all(userId, userId).map(mapMatchRow);
}

export function deleteMatch(matchId) {
  deleteMatchStmt.run(matchId);
}

export function getSystemConfigValue(key) {
  return getSystemConfigValueStmt.get(key)?.value ?? null;
}

export function listSystemConfig() {
  return listSystemConfigStmt.all().map((item) => ({
    key: item.key,
    value: item.value,
    updatedAt: item.updated_at,
  }));
}

export function setSystemConfigValue(key, value) {
  upsertSystemConfigStmt.run(key, String(value), new Date().toISOString());
}

const getLeaderboardStmt = db.query(`
  SELECT 
    u.id, 
    u.username,
    (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-bot' AND owner_id = u.id AND json_extract(data, '$.winner') = 'A'
    ) AS bot_wins,
    (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-bot' AND owner_id = u.id AND json_extract(data, '$.winner') = 'B'
    ) AS bot_losses,
    (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-human' AND json_extract(data, '$.hostUserId') = u.id AND json_extract(data, '$.winner') = 'A'
    ) + (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-human' AND json_extract(data, '$.guestUserId') = u.id AND json_extract(data, '$.winner') = 'B'
    ) AS pvp_wins,
    (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-human' AND json_extract(data, '$.hostUserId') = u.id AND json_extract(data, '$.winner') = 'B'
    ) + (
      SELECT COUNT(*) FROM matches WHERE mode = 'human-vs-human' AND json_extract(data, '$.guestUserId') = u.id AND json_extract(data, '$.winner') = 'A'
    ) AS pvp_losses
  FROM users u
  WHERE u.role >= 0
`);

export function getLeaderboard() {
  const rows = getLeaderboardStmt.all();
  return rows.map(row => {
    const botWins = Number(row.bot_wins || 0);
    const botLosses = Number(row.bot_losses || 0);
    const pvpWins = Number(row.pvp_wins || 0);
    const pvpLosses = Number(row.pvp_losses || 0);
    
    // Simple scoring system
    const score = (botWins * 10) - (botLosses * 2) + (pvpWins * 20) - (pvpLosses * 5);
    
    return {
      id: row.id,
      username: row.username,
      botWins,
      botLosses,
      pvpWins,
      pvpLosses,
      score,
      totalGames: botWins + botLosses + pvpWins + pvpLosses
    };
  }).sort((a, b) => b.score - a.score).slice(0, 100);
}
