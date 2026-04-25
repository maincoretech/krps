import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  authenticateToken,
  AuthError,
  createManagedUser,
  deleteManagedUser,
  loginUser,
  loginAdminUser,
  registerUser,
  requireMinRole,
  resetManagedUserPassword,
  updateUserCredentials,
  updateManagedUser,
  listManagedUsers,
  promoteUser,
  logoutToken
} from "./auth.js";
import { getAdminConfig, getAdminLogs, getAdminOverview, saveAdminConfig, getRuntimeConfig } from "./system.js";
import {
  createGame,
  createRoom,
  deleteRoom,
  exchangeOnTie,
  exchangeRoomOnTie,
  GameError,
  refreshRoomInviteCode,
  getGameState,
  exportGame,
  getRoomState,
  joinRoomByCode,
  listBotStrategies,
  listGames,
  listRooms,
  playRound,
  renameRoom,
  requestRoomRematch,
  RoomError,
  setRoomReady,
  submitRoomMove,
} from "./match.js";
import { getStorePath, getLeaderboard } from "./db.js";
import logger from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Note: We are in src/, so public is one level up
const adminStaticDir = path.join(__dirname, "..", "public", "admin");
const startedAt = Date.now();

export const app = express();
export const adminApp = express();

function getBearerToken(source) {
  if (typeof source === "string") {
    const value = source.trim();
    if (!value) return null;
    if (!value.includes(" ")) return value;
    const [scheme, token] = value.split(" ");
    return scheme === "Bearer" && token ? token : null;
  }

  const header = source?.headers?.authorization ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function sendDownload(res, filename, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(JSON.stringify(payload, null, 2));
}

function sendOk(res, data, statusCode = 200) {
  res.status(statusCode).json({ status: true, data });
}

app.use(
  cors({
    origin(origin, callback) {
      const { allowedOrigins } = getRuntimeConfig();
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

adminApp.use(cors());
adminApp.use(express.json({ limit: "1mb" }));

adminApp.use((req, res, next) => {
  logger.info(`[ADMIN] ${req.method} ${req.url}`);
  next();
});

async function requireAuth(req, res, next) {
  try {
    req.auth = await authenticateToken(getBearerToken(req));
    req.token = getBearerToken(req);
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdminAuth(req, res, next) {
  try {
    req.auth = await authenticateToken(getBearerToken(req));
    req.token = getBearerToken(req);
    requireMinRole(req.auth.user, 1);
    next();
  } catch (error) {
    next(error);
  }
}

function requireSuperAdmin(req, res, next) {
  try {
    requireMinRole(req.auth.user, 0);
    next();
  } catch (error) {
    next(error);
  }
}

app.get("/leaderboard", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await getLeaderboard());
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const config = getRuntimeConfig();
    const info = {
      serverName: config.serverName,
      serverDescription: config.serverDescription,
      botStrategies: listBotStrategies(),
      modes: [
        { id: "human-vs-bot", name: "Human vs Bot" },
        { id: "human-vs-human", name: "Human vs Human" },
      ],
      server: {
        name: config.serverName,
        description: config.serverDescription,
        host: config.hostname,
        port: config.serverPort,
        storage: getStorePath(),
      },
      auth: {
        tokenTtlHours: config.authTokenTtlHours,
      },
    };
    
    const games = await listGames(req.auth.user.id);
    const rooms = await listRooms(req.auth.user.id);
    
    sendOk(res, { info, games, rooms });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/register", async (req, res, next) => {
  try {
    sendOk(res, await registerUser(req.body), 201);
  } catch (error) {
    next(error);
  }
});

app.post("/auth/login", async (req, res, next) => {
  try {
    sendOk(res, await loginUser(req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/auth/logout", async (req, res, next) => {
  try {
    await logoutToken(getBearerToken(req));
    sendOk(res, null);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/me", requireAuth, (req, res) => {
  sendOk(res, req.auth);
});

app.put("/auth/me", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await updateUserCredentials(req.auth.user.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.post("/auth/promote", requireAuth, async (req, res, next) => {
  try {
    if (!req.body.username) {
      throw new AuthError(400, "Missing username.");
    }
    await promoteUser(req.auth.user.id, req.body.username);
    sendOk(res, { promoted: req.body.username });
  } catch (error) {
    next(error);
  }
});

app.get("/games", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await listGames(req.auth.user.id));
  } catch (error) {
    next(error);
  }
});

app.post("/games", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await createGame(req.auth.user.id, req.body), 201);
  } catch (error) {
    next(error);
  }
});

app.get("/games/:gameId", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await getGameState(req.params.gameId, req.auth.user.id));
  } catch (error) {
    next(error);
  }
});

app.get("/games/:gameId/export", requireAuth, async (req, res, next) => {
  try {
    const game = await exportGame(req.params.gameId, req.auth.user.id);
    sendDownload(res, `game-${req.params.gameId}.json`, game);
  } catch (error) {
    next(error);
  }
});

app.get("/games-export", requireAuth, async (req, res, next) => {
  try {
    const games = await exportAllGames(req.auth.user.id);
    sendDownload(res, `games-${req.auth.user.id}.json`, games);
  } catch (error) {
    next(error);
  }
});

app.get("/rooms", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await listRooms(req.auth.user.id));
  } catch (error) {
    next(error);
  }
});

app.post("/rooms", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await createRoom(req.auth.user, req.body), 201);
  } catch (error) {
    next(error);
  }
});

app.post("/rooms/join", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await joinRoomByCode(req.auth.user, req.body));
  } catch (error) {
    next(error);
  }
});

app.get("/rooms/:roomId", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await getRoomState(req.params.roomId, req.auth.user.id));
  } catch (error) {
    next(error);
  }
});

app.post("/rooms/:roomId/refresh-code", requireAuth, async (req, res, next) => {
  try {
    const result = await refreshRoomInviteCode(req.params.roomId, req.auth.user.id);
    broadcastRoomState(req.params.roomId, result);
    sendOk(res, result);
  } catch (error) {
    next(error);
  }
});

app.post("/rooms/:roomId/start", requireAuth, async (req, res, next) => {
  try {
    const result = await setRoomReady(req.params.roomId, req.auth.user.id, req.body);
    sendOk(res, result);
    broadcastRoomState(req.params.roomId, result);
  } catch (error) {
    next(error);
  }
});

app.put("/rooms/:roomId/name", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await renameRoom(req.params.roomId, req.auth.user.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.delete("/rooms/:roomId", requireAuth, async (req, res, next) => {
  try {
    sendOk(res, await deleteRoom(req.params.roomId, req.auth.user.id));
  } catch (error) {
    next(error);
  }
});

adminApp.post("/api/auth/login", async (req, res, next) => {
  try {
    sendOk(res, await loginAdminUser(req.body));
  } catch (error) {
    next(error);
  }
});

adminApp.post("/api/auth/logout", requireAdminAuth, async (req, res, next) => {
  try {
    await logoutToken(req.token);
    sendOk(res, null);
  } catch (error) {
    next(error);
  }
});

adminApp.get("/api/auth/me", requireAdminAuth, (req, res) => {
  sendOk(res, req.auth);
});

adminApp.get("/api/overview", requireAdminAuth, (req, res) => {
  sendOk(res, getAdminOverview(startedAt));
});

adminApp.get("/api/users", requireAdminAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim().toLowerCase();
    const role = req.query.role == null ? null : Number(req.query.role);
    const items = (await listManagedUsers()).filter((user) => {
      if (role != null && Number.isInteger(role) && user.role !== role) {
        return false;
      }
      if (search && !user.username.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });
    sendOk(res, items);
  } catch (error) {
    next(error);
  }
});

adminApp.post("/api/users", requireAdminAuth, async (req, res, next) => {
  try {
    sendOk(res, await createManagedUser(req.auth.user.id, req.body), 201);
  } catch (error) {
    next(error);
  }
});

adminApp.patch("/api/users/:userId", requireAdminAuth, async (req, res, next) => {
  try {
    sendOk(res, await updateManagedUser(req.auth.user.id, req.params.userId, req.body));
  } catch (error) {
    next(error);
  }
});

adminApp.post("/api/users/:userId/reset-password", requireAdminAuth, async (req, res, next) => {
  try {
    sendOk(res, await resetManagedUserPassword(req.auth.user.id, req.params.userId));
  } catch (error) {
    next(error);
  }
});

adminApp.delete("/api/users/:userId", requireAdminAuth, async (req, res, next) => {
  try {
    await deleteManagedUser(req.auth.user.id, req.params.userId);
    sendOk(res, true);
  } catch (error) {
    next(error);
  }
});

adminApp.get("/api/logs", requireAdminAuth, (req, res) => {
  sendOk(res, getAdminLogs(req.query));
});

adminApp.get("/api/config", requireAdminAuth, (req, res) => {
  sendOk(res, getAdminConfig());
});

adminApp.put("/api/config", requireAdminAuth, requireSuperAdmin, (req, res) => {
  sendOk(res, saveAdminConfig(req.body));
});

adminApp.use(express.static(adminStaticDir));
adminApp.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(adminStaticDir, "index.html"));
});

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  
  // Store connected clients
  global.wsClients = new Set();

  wss.on("connection", (ws) => {
    global.wsClients.add(ws);
    
    ws.on("close", () => {
      global.wsClients.delete(ws);
    });
    
    ws.on("message", async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage);
        const auth = await authenticateToken(getBearerToken(message.token));
        
        ws.userId = auth.user.id;

        if (message.action === "getGame") {
          ws.send(JSON.stringify({ action: "game", data: await getGameState(message.gameId, auth.user.id) }));
          return;
        }
        if (message.action === "playRound") {
          const result = await playRound(message.gameId, auth.user.id, message.payload);
          ws.send(JSON.stringify({ action: "playRoundResult", data: result }));
          broadcastGameState(message.gameId, result);
          return;
        }
        if (message.action === "exchange") {
          const result = await exchangeOnTie(message.gameId, auth.user.id, message.payload);
          ws.send(JSON.stringify({ action: "exchangeResult", data: result }));
          broadcastGameState(message.gameId, result);
          return;
        }
        if (message.action === "getRoom") {
          ws.send(JSON.stringify({ action: "room", data: await getRoomState(message.roomId, auth.user.id) }));
          return;
        }
        if (message.action === "roomRound") {
          const result = await submitRoomMove(message.roomId, auth.user.id, message.payload);
          broadcastRoomState(message.roomId, result);
          return;
        }
        if (message.action === "roomExchange") {
          const result = await exchangeRoomOnTie(message.roomId, auth.user.id, message.payload);
          broadcastRoomState(message.roomId, result);
          return;
        }
        if (message.action === "roomRematch") {
          const result = await requestRoomRematch(message.roomId, auth.user.id, message.payload);
          broadcastRoomState(message.roomId, result);
          return;
        }

        ws.send(JSON.stringify({ error: "Unsupported action." }));
      } catch (error) {
        ws.send(JSON.stringify({ error: error.message || "WebSocket Error" }));
      }
    });
  });

  return wss;
}

export async function broadcastGameState(gameId, result) {
  if (!global.wsClients) return;
  
  for (const ws of global.wsClients) {
    if (ws.readyState === 1 && ws.userId) {
      try {
        const gameState = await getGameState(gameId, ws.userId);
        ws.send(JSON.stringify({ action: "game", data: gameState }));
      } catch (e) {
        // Ignore
      }
    }
  }
}

export async function broadcastRoomState(roomId, result) {
  if (!global.wsClients) return;
  
  for (const ws of global.wsClients) {
    if (ws.readyState === 1 && ws.userId) { // OPEN
      try {
        const roomState = await getRoomState(roomId, ws.userId);
        ws.send(JSON.stringify({ action: "room", data: roomState }));
      } catch (e) {
        // Ignore errors for users who can't access this room
      }
    }
  }
}

function apiErrorHandler(error, req, res, next) {
  const status =
    error instanceof AuthError || error instanceof GameError || error instanceof RoomError
      ? error.status
      : error.status || 500;
  res.status(status).json({ status: false, message: error.message || "Server error." });
}

app.use(apiErrorHandler);
adminApp.use(apiErrorHandler);
