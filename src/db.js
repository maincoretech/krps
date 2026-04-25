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

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    bot_strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    winner TEXT,
    round_count INTEGER NOT NULL DEFAULT 0,
    tie_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_games_owner_updated ON games(owner_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    guest_id TEXT,
    invite_code TEXT UNIQUE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (guest_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_host_updated ON rooms(host_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rooms_guest_updated ON rooms(guest_id, updated_at DESC);

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

function mapGameRow(row) {
  if (!row) return null;

  let payload = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = {};
  }

  return {
    ...payload,
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    mode: row.mode,
    botStrategy: row.bot_strategy,
    status: row.status,
    winner: row.winner,
    roundCount: row.round_count,
    tieCount: row.tie_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoomRow(row) {
  if (!row) return null;

  let payload = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = {};
  }

  return {
    ...payload,
    id: row.id,
    hostUserId: row.host_id,
    guestUserId: row.guest_id,
    inviteCode: row.invite_code,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const countUsersByRoleStmt = db.query(
  "SELECT COUNT(*) AS count FROM users WHERE role = ?"
);
const countUsersStmt = db.query("SELECT COUNT(*) AS count FROM users");
const countSessionsStmt = db.query("SELECT COUNT(*) AS count FROM sessions");
const countGamesStmt = db.query("SELECT COUNT(*) AS count FROM games");
const countRoomsStmt = db.query("SELECT COUNT(*) AS count FROM rooms");
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

const insertGameStmt = db.query(`
  INSERT INTO games (
    id, owner_id, name, mode, bot_strategy, status, winner,
    round_count, tie_count, created_at, updated_at, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateGameStmt = db.query(`
  UPDATE games
  SET owner_id = ?, name = ?, mode = ?, bot_strategy = ?, status = ?, winner = ?,
      round_count = ?, tie_count = ?, created_at = ?, updated_at = ?, payload = ?
  WHERE id = ?
`);
const findGameByIdStmt = db.query(
  "SELECT * FROM games WHERE id = ? LIMIT 1"
);
const listGamesByOwnerStmt = db.query(
  "SELECT * FROM games WHERE owner_id = ? ORDER BY updated_at DESC"
);
const insertRoomStmt = db.query(`
  INSERT INTO rooms (id, host_id, guest_id, invite_code, status, created_at, updated_at, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateRoomStmt = db.query(`
  UPDATE rooms
  SET host_id = ?, guest_id = ?, invite_code = ?, status = ?, created_at = ?, updated_at = ?, payload = ?
  WHERE id = ?
`);
const findRoomByIdStmt = db.query(
  "SELECT * FROM rooms WHERE id = ? LIMIT 1"
);
const findRoomByInviteCodeStmt = db.query(
  "SELECT * FROM rooms WHERE invite_code = ? LIMIT 1"
);
const listVisibleRoomsStmt = db.query(`
  SELECT * FROM rooms 
  WHERE host_id = ? 
     OR guest_id = ? 
     OR (status = 'waiting' AND guest_id IS NULL AND COALESCE(json_extract(payload, '$.isPublic'), true) = 1)
  ORDER BY updated_at DESC
`);
const deleteRoomStmt = db.query(
  "DELETE FROM rooms WHERE id = ?"
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

function serializeGamePayload(game) {
  return JSON.stringify(game);
}

export function insertGame(game) {
  insertGameStmt.run(
    game.id,
    game.ownerId,
    game.name,
    game.mode,
    game.botStrategy,
    game.status,
    game.winner,
    game.roundCount,
    game.tieCount,
    game.createdAt,
    game.updatedAt,
    serializeGamePayload(game)
  );
}

export function updateGame(game) {
  updateGameStmt.run(
    game.ownerId,
    game.name,
    game.mode,
    game.botStrategy,
    game.status,
    game.winner,
    game.roundCount,
    game.tieCount,
    game.createdAt,
    game.updatedAt,
    serializeGamePayload(game),
    game.id
  );
}

export function findGameById(gameId) {
  return mapGameRow(findGameByIdStmt.get(gameId));
}

export function listGamesByOwner(ownerId) {
  return listGamesByOwnerStmt.all(ownerId).map(mapGameRow);
}

function serializeRoomPayload(room) {
  return JSON.stringify(room);
}

export function insertRoom(room) {
  insertRoomStmt.run(
    room.id,
    room.hostUserId,
    room.guestUserId ?? null,
    room.inviteCode ?? null,
    room.status,
    room.createdAt,
    room.updatedAt,
    serializeRoomPayload(room)
  );
}

export function updateRoom(room) {
  updateRoomStmt.run(
    room.hostUserId,
    room.guestUserId ?? null,
    room.inviteCode ?? null,
    room.status,
    room.createdAt,
    room.updatedAt,
    serializeRoomPayload(room),
    room.id
  );
}

export function findRoomById(roomId) {
  return mapRoomRow(findRoomByIdStmt.get(roomId));
}

export function findRoomByInviteCode(inviteCode) {
  return mapRoomRow(findRoomByInviteCodeStmt.get(inviteCode));
}

export function listRoomsByUser(userId) {
  return listVisibleRoomsStmt.all(userId, userId).map(mapRoomRow);
}

export function deleteRoom(roomId) {
  deleteRoomStmt.run(roomId);
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
      SELECT COUNT(*) FROM games WHERE owner_id = u.id AND winner = 'A'
    ) AS bot_wins,
    (
      SELECT COUNT(*) FROM games WHERE owner_id = u.id AND winner = 'B'
    ) AS bot_losses,
    (
      SELECT COUNT(*) FROM rooms WHERE host_id = u.id AND json_extract(payload, '$.winner') = 'A'
    ) + (
      SELECT COUNT(*) FROM rooms WHERE guest_id = u.id AND json_extract(payload, '$.winner') = 'B'
    ) AS pvp_wins,
    (
      SELECT COUNT(*) FROM rooms WHERE host_id = u.id AND json_extract(payload, '$.winner') = 'B'
    ) + (
      SELECT COUNT(*) FROM rooms WHERE guest_id = u.id AND json_extract(payload, '$.winner') = 'A'
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
