// E2E test using Playwright — requires server on :3000 and client on :47808
import { test, expect } from "bun:test";

const API = "http://localhost:3000";
const APP = "http://localhost:47808";

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

// ─── Auth ──────────────────────────────────────

const user = "e2e_" + Date.now().toString(36);
const pass = "test123456";
let token = "";
let gameId = "";
let roomId = "";

test("Register", async () => {
  const r = await api("/auth/register", {
    method: "POST",
    body: { username: user, password: pass, turnstileToken: "test" },
  });
  expect(r.status).toBe(201);
  expect(r.data.data.user.username).toBe(user);
});

test("Login", async () => {
  const r = await api("/auth/login", {
    method: "POST",
    body: { username: user, password: pass },
  });
  expect(r.status).toBe(200);
  token = r.data.data.token;
  expect(token).toBeTruthy();
});

// ─── Dashboard ─────────────────────────────────

test("Dashboard returns games and rooms", async () => {
  const r = await api("/dashboard", {
    headers: { Authorization: "Bearer " + token },
  });
  expect(r.status).toBe(200);
  expect(r.data.data.info).toBeDefined();
  expect(Array.isArray(r.data.data.games)).toBe(true);
  expect(Array.isArray(r.data.data.rooms)).toBe(true);
});

// ─── Bot Game ──────────────────────────────────

test("Create bot match", async () => {
  const r = await api("/matches", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: { mode: "human-vs-bot", name: "E2E Bot", botStrategy: "random" },
  });
  expect(r.status).toBe(201);
  gameId = r.data.data.id;
  expect(gameId).toBeTruthy();
});

test("Get match state", async () => {
  const r = await api(`/matches/${gameId}`, {
    headers: { Authorization: "Bearer " + token },
  });
  expect(r.status).toBe(200);
  expect(r.data.data.status).toBe("playing");
  expect(r.data.data.players.A.handSize).toBe(3);
});

// ─── Leaderboard ───────────────────────────────

test("Leaderboard", async () => {
  const r = await api("/leaderboard");
  expect(r.status).toBe(200);
  expect(Array.isArray(r.data.data)).toBe(true);
});

// ─── PVP Room ──────────────────────────────────

test("Create PVP room", async () => {
  const r = await api("/matches", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: { mode: "human-vs-human", name: "E2E Room", isPublic: true, username: user },
  });
  expect(r.status).toBe(201);
  roomId = r.data.data.id;
  expect(roomId).toBeTruthy();
  expect(r.data.data.status).toBe("waiting");
});

test("Get PVP room", async () => {
  const r = await api(`/matches/${roomId}`, {
    headers: { Authorization: "Bearer " + token },
  });
  expect(r.status).toBe(200);
  expect(r.data.data.mode).toBe("human-vs-human");
  expect(r.data.data.isPublic).toBe(true);
});

test("Toggle ready in room", async () => {
  const r = await api(`/matches/${roomId}/start`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: { ready: true },
  });
  expect(r.status).toBe(200);
  expect(r.data.data.startVotes.A).toBe(true);
});

// ─── Cleanup ───────────────────────────────────

test("Delete room", async () => {
  const r = await api(`/matches/${roomId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  expect(r.status).toBe(200);
});

test("Delete bot game", async () => {
  const r = await api(`/matches/${gameId}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + token },
  });
  expect(r.status).toBe(200);
});
