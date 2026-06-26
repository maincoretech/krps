// ═══ krps Server: Match API ═══
// Wraps shared game engine with persistence, auth, and WS broadcasting.

import { randomUUID } from "node:crypto";
import logger from "./logger.js";
import {
  findMatchById as dbFind, findMatchByInviteCode as dbFindByCode,
  insertMatch as dbInsert, listMatchesByOwner as dbByOwner,
  listMatchesByUser as dbByUser, updateMatch as dbUpdate, deleteMatch as dbDelete,
} from "./db.js";
import { R, P, S, CARDS, HAND, POOL, has, add, rem, cnt, cnts, unpack, first, draw, infer } from "../../shared/cards.js";
import { botPick, STRATEGIES, getStrategy } from "../../shared/ai.js";
import { resolveRound as doRound, createState } from "../../shared/game.js";

// ═══ Match Cache ════════════════════════════════════════

const active = new Map();
const pend = new Map();
const pendSet = new Set();
let flushT = null;
const DB_MS = 150;

const schedFlush = () => { if (!flushT) flushT = setTimeout(doFlush, DB_MS); };
function doFlush() {
  flushT = null;
  for (const id of pendSet) {
    const m = pend.get(id);
    if (!m) { pendSet.delete(id); continue; }
    try { dbUpdate(m); pend.delete(id); pendSet.delete(id); }
    catch (e) { logger.error(`Persist ${id}: ${e.message}`); }
  }
  if (pendSet.size) schedFlush();
}
const qPersist = (m) => { pend.set(m.id, m); pendSet.add(m.id); schedFlush(); };
const cacheGet = (id) => active.get(id) ?? ((m) => { if (m && m.status !== "finished") active.set(id, m); return m; })(dbFind(id));
const findByCode = (c) => [...active.values()].find(m => m.inviteCode === c && m.mode === "human-vs-human") ?? dbFindByCode(c);
const upd = (m) => (m.status === "finished") ? (pend.delete(m.id), pendSet.delete(m.id), dbUpdate(m), active.delete(m.id)) : (active.set(m.id, m), qPersist(m));
const ins = (m) => { dbInsert(m); if (m.status !== "finished") active.set(m.id, m); };
const del = (id) => { active.delete(id); pend.delete(id); pendSet.delete(id); dbDelete(id); };
const merge = (dbFn, memFn) => { const m = new Map(); [...dbFn(), ...memFn()].forEach(v => m.set(v.id, v)); return [...m.values()]; };
const byUser = (uid) => merge(() => dbByUser(uid), () => [...active.values()].filter(m => m.players?.A?.userId === uid || m.players?.B?.userId === uid));
const byOwner = (uid) => merge(() => dbByOwner(uid), () => [...active.values()].filter(m => m.ownerId === uid || m.hostUserId === uid));

// ═══ Shape & Serialize ══════════════════════════════════

const mkSeat = (uid = null, un = "") => ({ userId: uid ? String(uid) : null, username: String(un), hand: HAND, losses: 0, tieEx: 0 });

const normSeat = (p) => {
  p.userId = p.userId ? String(p.userId) : null;
  p.username = String(p.username ?? "");
  p.hand = Array.isArray(p.hand) ? p.hand.reduce((b, c) => b + ([1, 8, 64][c] || 0), 0) || HAND : (typeof p.hand === "number" && p.hand >= 0 ? p.hand : HAND);
  p.losses = Math.max(0, Math.min(15, +p.losses || +p.consecutiveLosses || 0));
  p.tieEx = (p.tieEx || p.tieExchangeReady) ? 1 : 0;
};

const normMatch = (m) => {
  m.mode = m.mode === "human-vs-human" ? "human-vs-human" : "human-vs-bot";
  m.name = String(m.name ?? "").trim() || `Match ${m.id}`;
  m.status = ["waiting", "playing", "finished"].includes(m.status) ? m.status : "playing";
  m.winner = ["A", "B", null].includes(m.winner) ? m.winner : null;
  m.version = Math.max(1, +m.version || 1);
  m.roundCount = Math.max(0, +m.roundCount || 0);
  m.tieCount = Math.max(0, +m.tieCount || 0);
  m.pool = Array.isArray(m.pool) ? m.pool.reduce((b, c) => b + ([1, 8, 64][c] || 0), 0) || POOL : (typeof m.pool === "number" && m.pool >= 0 ? m.pool : POOL);
  m.history = Array.isArray(m.history) ? m.history : [];
  m.createdAt = m.createdAt ?? new Date().toISOString();
  m.updatedAt = m.updatedAt ?? m.createdAt;
  m.players = m.players || {};
  m.players.A = m.players.A || mkSeat(m.hostUserId);
  m.players.B = m.players.B || mkSeat(m.guestUserId);
  normSeat(m.players.A); normSeat(m.players.B);
  if (m.mode === "human-vs-human") {
    m.isPublic = m.isPublic !== false; m.hostUserId = m.hostUserId ?? m.players.A.userId;
    m.guestUserId = m.guestUserId ?? m.players.B.userId;
    m.inviteCode = String(m.inviteCode ?? "").slice(0, 6) || String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
    m.matchNumber = Math.max(1, +m.matchNumber || 1);
    m.startVotes = { A: !!m.startVotes?.A, B: !!m.startVotes?.B };
    m.rematchVotes = { A: !!m.rematchVotes?.A, B: !!m.rematchVotes?.B };
    m.pendingMoves = { A: CARDS.includes(m.pendingMoves?.A) ? m.pendingMoves.A : null, B: CARDS.includes(m.pendingMoves?.B) ? m.pendingMoves.B : null };
  } else { m.botStrategy = getStrategy(String(m.botStrategy ?? "random").trim().toLowerCase()).id; }
};

const serPlayer = (p) => ({ userId: p.userId, username: p.username, role: p.userId ? "human" : "bot", handBits: p.hand, handSize: cnt(p.hand), losses: p.losses, canExchangeOnTie: !!p.tieEx });

const serMatch = (m, uid = null) => {
  const d = {
    id: m.id, version: m.version, name: m.name, ownerId: m.ownerId ?? m.hostUserId,
    mode: m.mode, status: m.status, winner: m.winner, roundCount: m.roundCount, tieCount: m.tieCount,
    poolBits: m.pool, createdAt: m.createdAt, updatedAt: m.updatedAt,
    players: { A: serPlayer(m.players.A), B: serPlayer(m.players.B) },
    history: [...m.history],
  };
  if (m.mode === "human-vs-bot") {
    const s = getStrategy(m.botStrategy);
    d.humanPlayerId = "A";
    d.bot = { playerId: "B", strategy: s.id, strategyName: s.name, strategyDescription: s.desc };
  } else {
    Object.assign(d, { isPublic: m.isPublic, hostUserId: m.hostUserId, guestUserId: m.guestUserId, inviteCode: m.inviteCode, matchNumber: m.matchNumber, startVotes: { ...m.startVotes }, rematchVotes: { ...m.rematchVotes }, pendingMoves: { A: null, B: null } });
    if (m.pendingMoves.A != null) d.pendingMoves.A = uid === m.players.A.userId ? m.pendingMoves.A : -1;
    if (m.pendingMoves.B != null) d.pendingMoves.B = uid === m.players.B.userId ? m.pendingMoves.B : -1;
    d.selfPlayerId = uid === m.players.A.userId ? "A" : uid === m.players.B.userId ? "B" : null;
    d.opponentPlayerId = d.selfPlayerId ? (d.selfPlayerId === "A" ? "B" : "A") : null;
    if (d.opponentPlayerId) {
      d.players[d.opponentPlayerId].handBits = undefined;
      d.players[d.opponentPlayerId].handSize = cnt(m.players[d.opponentPlayerId === "A" ? "A" : "B"].hand);
      // Hide pool during live play (prevents deducing opponent's hand)
      if (m.status !== "finished") {
        d.poolBits = undefined;
        // Per-round snap: only own hand, no pool, no opponent
        const isA = d.selfPlayerId === "A";
        d.history = d.history.map(h => {
          if (h.type === "round" && h.snap != null) {
            const own = isA ? ((h.snap >>> 9) & 0x1FF) : ((h.snap >>> 18) & 0x1FF);
            return { ...h, snap: own << 9 };
          }
          return h;
        });
      }
    }
  }
  return d;
};

const sumMatch = (m, uid = null) => ({
  id: m.id, version: m.version, name: m.name, mode: m.mode, status: m.status, winner: m.winner,
  roundCount: m.roundCount, tieCount: m.tieCount, updatedAt: m.updatedAt, createdAt: m.createdAt,
  ...(m.mode === "human-vs-bot" ? { botStrategy: m.botStrategy } : { isPublic: m.isPublic, hostUserId: m.hostUserId, guestUserId: m.guestUserId, matchNumber: m.matchNumber, inviteCode: m.inviteCode }),
  players: m.players ? { A: { userId: m.players.A?.userId, username: m.players.A?.username }, B: { userId: m.players.B?.userId, username: m.players.B?.username }, ...(uid ? { selfPlayerId: uid === m.players.A?.userId ? "A" : uid === m.players.B?.userId ? "B" : null } : {}) } : undefined,
});

const commit = (m) => { m.version++; m.updatedAt = new Date().toISOString(); upd(m); };

// ═══ Server-side round resolution ══════════════════════

const resolveServerRound = (m) => {
  const ca = m.pendingMoves?.A ?? m.pendingMoves?.cardA;
  const cb = m.pendingMoves?.B ?? m.pendingMoves?.cardB;

  // Build a compatible state object for the shared engine
  const st = { pool: m.pool, roundCount: m.roundCount, tieCount: m.tieCount, status: m.status, winner: m.winner, history: m.history, players: m.players };
  const result = doRound(st, ca, cb, m.mode === "human-vs-bot" ? m.botStrategy : null);

  // Sync back
  m.pool = st.pool; m.roundCount = st.roundCount; m.tieCount = st.tieCount;
  m.status = st.status; m.winner = st.winner; m.history = st.history;
  m.players = st.players;
  // Record per-round snapshot as a single packed u32 (pool:bits 0-8, handA:9-17, handB:18-26)
  const lastEntry = m.history[m.history.length - 1];
  if (lastEntry && lastEntry.type === "round") {
    lastEntry.snap = m.pool | (m.players.A.hand << 9) | (m.players.B.hand << 18);
  }
  m.pendingMoves = m.mode === "human-vs-human" ? { A: null, B: null } : null;
  commit(m);
  return { round: result.round, match: serMatch(m) };
};

const serverTieExchange = (m, seat, card) => {
  const p = m.players[seat];
  if (!p.tieEx) throw new MatchError(400, "Tie exchange not available.");
  p.hand = rem(p.hand, card);
  m.pool = add(m.pool, card);
  const d = draw(m.pool);
  p.hand = add(p.hand, d.card);
  m.pool = d.np;
  p.tieEx = 0; m.tieCount = 0;
  return { type: "tie-exchange", afterRound: m.roundCount, playerId: seat, putIntoPool: card, drew: d.card, poolAfterExchange: unpack(m.pool), handAfterExchange: unpack(p.hand) };
};

// ═══ Public API ═════════════════════════════════════════

export class MatchError extends Error { constructor(s, m) { super(m); this.name = "MatchError"; this.status = s; } }
export const listBotStrategies = () => STRATEGIES.map(s => ({ id: s.id, name: s.name, description: s.desc }));
export const sortCards = unpack;
export const getInferredHumanHand = (m) => unpack(infer(m.pool, m.players.B.hand));
// Legacy test support
export const resolveRound = (m) => { normMatch(m); return resolveServerRound(m); };

const nCard = (c) => { const n = +c; if (n !== R && n !== P && n !== S) throw new MatchError(400, "Card 0/1/2."); return n; };
const nInvite = (c) => { const n = String(c ?? "").trim(); if (!/^\d{6}$/.test(n)) throw new MatchError(400, "Invite 6 digits."); return n; };

export async function getOwnedMatch(mid, uid) {
  const m = cacheGet(mid); if (!m) throw new MatchError(404, "Not found."); normMatch(m);
  if (m.mode === "human-vs-bot" && m.ownerId !== uid) throw new MatchError(403, "Denied.");
  if (m.mode === "human-vs-human" && m.players.A.userId !== uid && m.players.B.userId !== uid) throw new MatchError(403, "Not a player.");
  return m;
}

export async function createMatch(uid, p) {
  const now = new Date().toISOString(), isPVP = p?.mode === "human-vs-human";
  const m = { id: randomUUID(), ownerId: uid, mode: isPVP ? "human-vs-human" : "human-vs-bot", status: isPVP ? "waiting" : "playing", version: 1, createdAt: now, updatedAt: now, history: [], pool: POOL, roundCount: 0, tieCount: 0, players: { A: mkSeat(), B: mkSeat() } };
  if (isPVP) {
    Object.assign(m, { name: String(p?.name ?? "").trim().slice(0, 64) || `Room ${m.id.slice(0, 4).toUpperCase()}`, isPublic: p?.isPublic !== false, inviteCode: String(Math.floor(Math.random() * 1e6)).padStart(6, "0"), hostUserId: uid, guestUserId: null, matchNumber: 1, startVotes: { A: false, B: false }, rematchVotes: { A: false, B: false }, pendingMoves: { A: null, B: null } });
    m.players.A = mkSeat(uid, p?.username ?? "Host");
  } else { m.botStrategy = getStrategy(String(p?.botStrategy ?? "random").trim().toLowerCase()).id; m.name = String(p?.name ?? "").trim().slice(0, 64) || `Game ${now.slice(0, 10)}`; m.players.A.userId = uid; }
  normMatch(m); ins(m); return serMatch(m, uid);
}

export const listMatches = async (uid) => {
  const all = [...byOwner(uid).filter(m => m.mode === "human-vs-bot"), ...byUser(uid).filter(m => m.mode === "human-vs-human")];
  return all.map(m => { normMatch(m); return m; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(m => sumMatch(m, uid));
};

export const getMatchState = async (mid, uid) => { const m = cacheGet(mid); if (!m) throw new MatchError(404, "Not found."); normMatch(m); return serMatch(m, uid); };

export async function submitMove(mid, uid, p) {
  const m = await getOwnedMatch(mid, uid);
  if (m.status !== "playing") throw new MatchError(400, "Not playing.");
  if (m.mode === "human-vs-bot") {
    const ca = nCard(p?.cardA ?? p?.card);
    let cb = botPick(m.players.B.hand, m.pool, m.history, m.botStrategy);
    if (cb !== R && cb !== P && cb !== S) cb = first(m.players.B.hand);
    m.pendingMoves = { cardA: ca, cardB: cb };
    return resolveServerRound(m);
  }
  const seat = m.players.A.userId === uid ? "A" : "B", card = nCard(p?.card);
  if (m.pendingMoves[seat] != null) throw new MatchError(400, "Already submitted.");
  if (!has(m.players[seat].hand, card)) throw new MatchError(400, "Not in hand.");
  m.pendingMoves[seat] = card; commit(m);
  return (m.pendingMoves.A != null && m.pendingMoves.B != null) ? resolveServerRound(m) : { match: serMatch(m, uid) };
}

export async function exchangeCard(mid, uid) {
  const m = await getOwnedMatch(mid, uid);
  if (m.status !== "playing") throw new MatchError(400, "Finished.");
  const seat = m.mode === "human-vs-bot" ? "A" : (m.players.A.userId === uid ? "A" : "B");
  const c = first(m.players[seat].hand);
  const ex = serverTieExchange(m, seat, c);
  m.history.push(ex); commit(m);
  return { exchange: { ...ex }, match: serMatch(m, uid) };
}

export const joinMatchByCode = async (code, uid, un) => {
  const n = nInvite(code), m = findByCode(n);
  if (!m || m.mode !== "human-vs-human") throw new MatchError(404, "Invalid code."); normMatch(m);
  if (m.players.A.userId === uid || m.players.B.userId === uid) return serMatch(m, uid);
  if (m.status !== "waiting" || m.guestUserId) throw new MatchError(400, "Full/started.");
  m.guestUserId = uid; m.players.B = mkSeat(uid, un); commit(m); return serMatch(m, uid);
};

export const joinPublicMatch = async (rid, uid, un) => {
  const m = cacheGet(rid); if (!m || m.mode !== "human-vs-human" || !m.isPublic) throw new MatchError(404, "Not found."); normMatch(m);
  if (m.players.A.userId === uid || m.players.B.userId === uid) return serMatch(m, uid);
  if (m.status !== "waiting" || m.guestUserId) throw new MatchError(400, "Full/started.");
  m.guestUserId = uid; m.players.B = mkSeat(uid, un); commit(m); return serMatch(m, uid);
};

export const leaveMatch = async (rid, uid) => {
  const m = cacheGet(rid); if (!m || m.mode !== "human-vs-human") return; normMatch(m);
  const seat = m.players.A.userId === uid ? "A" : m.players.B.userId === uid ? "B" : null; if (!seat) return;
  if (m.status === "waiting") { if (seat === "A") del(m.id); else { m.guestUserId = null; m.players.B = mkSeat(); m.startVotes.B = false; commit(m); } }
  else { m.status = "finished"; m.winner = seat === "A" ? "B" : "A"; m.history.push({ type: "player-left", round: m.roundCount, playerId: seat }); commit(m); }
  return serMatch(m, uid);
};

export const setMatchReady = async (rid, uid, p) => {
  const m = await getOwnedMatch(rid, uid); if (m.status !== "waiting") throw new MatchError(400, "Not waiting.");
  const seat = m.players.A.userId === uid ? "A" : "B";
  m.startVotes[seat] = p?.ready !== undefined ? !!p.ready : !m.startVotes[seat];
  if (m.startVotes.A && m.startVotes.B) { m.status = "playing"; logger.match(`[${m.name}] PVP started`); }
  commit(m); return serMatch(m, uid);
};

export const requestMatchRematch = async (rid, uid, p) => {
  const m = await getOwnedMatch(rid, uid); if (m.status !== "finished") throw new MatchError(400, "Not finished.");
  const seat = m.players.A.userId === uid ? "A" : "B";
  m.rematchVotes[seat] = p?.ready !== undefined ? !!p.ready : !m.rematchVotes[seat];
  if (m.rematchVotes.A && m.rematchVotes.B) {
    m.matchNumber++; m.status = "playing"; m.winner = null; m.roundCount = 0; m.tieCount = 0;
    m.pool = POOL; m.history = []; m.rematchVotes = { A: false, B: false }; m.pendingMoves = { A: null, B: null };
    m.players.A.hand = HAND; m.players.B.hand = HAND;
    m.players.A.losses = 0; m.players.B.losses = 0; m.players.A.tieEx = 0; m.players.B.tieEx = 0;
    logger.match(`[${m.name}] PVP rematch #${m.matchNumber}`);
  }
  commit(m); return serMatch(m, uid);
};

export const exportMatch = getMatchState;

export const refreshMatchInviteCode = async (rid, uid) => {
  const m = await getOwnedMatch(rid, uid); if (m.mode !== "human-vs-human") throw new MatchError(400, "Not a room.");
  m.inviteCode = String(Math.floor(Math.random() * 1e6)).padStart(6, "0"); commit(m); return serMatch(m, uid);
};

export const renameMatch = async (rid, uid, p) => {
  const m = await getOwnedMatch(rid, uid); if (m.mode !== "human-vs-human") throw new MatchError(400, "Not a room.");
  m.name = String(p?.name ?? "").trim().slice(0, 64) || m.name; commit(m); return serMatch(m, uid);
};

export const deleteMatchData = async (rid, uid) => { await getOwnedMatch(rid, uid); del(rid); return { deleted: true }; };
