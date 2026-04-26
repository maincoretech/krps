import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  exportAllGames,
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
const adminStaticDir = path.join(__dirname, "..", "public", "admin");
const startedAt = Date.now();

global.wsClients = new Set();

export async function broadcastGameState(gameId, result) {
  if (!global.wsClients) return;
  for (const ws of global.wsClients) {
    if (ws.data && ws.data.userId) {
      try {
        const gameState = await getGameState(gameId, ws.data.userId);
        ws.send(JSON.stringify({ action: "game", data: gameState }));
      } catch (e) {}
    }
  }
}

export async function broadcastRoomState(roomId, result) {
  if (!global.wsClients) return;
  for (const ws of global.wsClients) {
    if (ws.data && ws.data.userId) {
      try {
        const roomState = await getRoomState(roomId, ws.data.userId);
        ws.send(JSON.stringify({ action: "room", data: roomState }));
      } catch (e) {}
    }
  }
}

function getBearerToken(reqOrString) {
  if (typeof reqOrString === "string") {
    const value = reqOrString.trim();
    if (!value) return null;
    if (!value.includes(" ")) return value;
    const [scheme, token] = value.split(" ");
    return scheme === "Bearer" && token ? token : null;
  }
  const header = reqOrString?.headers?.authorization ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function sendOk(data) {
  return { status: true, data };
}

function errorHandler({ code, error, set }) {
  const status =
    error instanceof AuthError || error instanceof GameError || error instanceof RoomError
      ? error.status
      : error.status || 500;
  set.status = status;
  return { status: false, message: error.message || "Server error." };
}

export const app = new Elysia()
  .use(cors({
    origin: (request) => {
      const { allowedOrigins } = getRuntimeConfig();
      const origin = request.headers.get("origin");
      if (!origin || allowedOrigins.includes(origin)) return true;
      return false;
    }
  }))
  .onRequest(({ request }) => {
    logger.info(`${request.method} ${new URL(request.url).pathname}`);
  })
  .onError(errorHandler)
  .ws("/ws", {
    open(ws) {
      global.wsClients.add(ws);
    },
    close(ws) {
      global.wsClients.delete(ws);
    },
    async message(ws, rawMessage) {
      try {
        const message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
        const auth = await authenticateToken(getBearerToken(message.token));
        ws.data = ws.data || {};
        ws.data.userId = auth.user.id;

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
    }
  })
  .group("/auth", app => app
    .post("/register", async ({ body, set }) => {
      set.status = 201;
      return sendOk(await registerUser(body));
    })
    .post("/login", async ({ body }) => {
      return sendOk(await loginUser(body));
    })
    .post("/logout", async ({ headers }) => {
      await logoutToken(getBearerToken(headers));
      return sendOk(null);
    })
    .derive(async ({ headers }) => {
      const token = getBearerToken(headers);
      const auth = await authenticateToken(token);
      return { auth, token };
    })
    .get("/me", ({ auth }) => sendOk(auth))
    .put("/me", async ({ auth, body }) => sendOk(await updateUserCredentials(auth.user.id, body)))
    .post("/promote", async ({ auth, body }) => {
      if (!body.username) throw new AuthError(400, "Missing username.");
      await promoteUser(auth.user.id, body.username);
      return sendOk({ promoted: body.username });
    })
  )
  .derive(async ({ headers }) => {
    const token = getBearerToken(headers);
    const auth = await authenticateToken(token);
    return { auth, token };
  })
  .get("/leaderboard", async () => sendOk(await getLeaderboard()))
  .get("/dashboard", async ({ auth }) => {
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
      auth: { tokenTtlHours: config.authTokenTtlHours },
    };
    const games = await listGames(auth.user.id);
    const rooms = await listRooms(auth.user.id);
    return sendOk({ info, games, rooms });
  })
  .group("/games", app => app
    .get("/", async ({ auth }) => sendOk(await listGames(auth.user.id)))
    .post("/", async ({ auth, body, set }) => {
      set.status = 201;
      return sendOk(await createGame(auth.user.id, body));
    })
    .get("/:gameId", async ({ auth, params: { gameId } }) => sendOk(await getGameState(gameId, auth.user.id)))
    .get("/:gameId/export", async ({ auth, params: { gameId }, set }) => {
      const game = await exportGame(gameId, auth.user.id);
      set.headers["Content-Type"] = "application/json; charset=utf-8";
      set.headers["Content-Disposition"] = `attachment; filename="game-${gameId}.json"`;
      return game;
    })
  )
  .get("/games-export", async ({ auth, set }) => {
    const games = await exportAllGames(auth.user.id);
    set.headers["Content-Type"] = "application/json; charset=utf-8";
    set.headers["Content-Disposition"] = `attachment; filename="games-${auth.user.id}.json"`;
    return games;
  })
  .group("/rooms", app => app
    .get("/", async ({ auth }) => sendOk(await listRooms(auth.user.id)))
    .post("/", async ({ auth, body, set }) => {
      set.status = 201;
      return sendOk(await createRoom(auth.user, body));
    })
    .post("/join", async ({ auth, body }) => sendOk(await joinRoomByCode(auth.user, body)))
    .get("/:roomId", async ({ auth, params: { roomId } }) => sendOk(await getRoomState(roomId, auth.user.id)))
    .post("/:roomId/refresh-code", async ({ auth, params: { roomId } }) => {
      const result = await refreshRoomInviteCode(roomId, auth.user.id);
      broadcastRoomState(roomId, result);
      return sendOk(result);
    })
    .post("/:roomId/start", async ({ auth, params: { roomId }, body }) => {
      const result = await setRoomReady(roomId, auth.user.id, body);
      broadcastRoomState(roomId, result);
      return sendOk(result);
    })
    .put("/:roomId/name", async ({ auth, params: { roomId }, body }) => sendOk(await renameRoom(roomId, auth.user.id, body)))
    .delete("/:roomId", async ({ auth, params: { roomId } }) => sendOk(await deleteRoom(roomId, auth.user.id)))
  );

export const adminApp = new Elysia()
  .use(cors())
  .onRequest(({ request }) => {
    logger.info(`[ADMIN] ${request.method} ${new URL(request.url).pathname}`);
  })
  .onError(({ code, error, set, request }) => {
    if (code === 'NOT_FOUND') {
      const url = new URL(request.url);
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        set.status = 200;
        return Bun.file(path.join(adminStaticDir, "index.html"));
      }
    }
    return errorHandler({ code, error, set });
  })
  .group("/api", app => app
    .group("/auth", app => app
      .post("/login", async ({ body }) => sendOk(await loginAdminUser(body)))
      .derive(async ({ headers }) => {
        const token = getBearerToken(headers);
        const auth = await authenticateToken(token);
        requireMinRole(auth.user, 1);
        return { auth, token };
      })
      .post("/logout", async ({ token }) => {
        await logoutToken(token);
        return sendOk(null);
      })
      .get("/me", ({ auth }) => sendOk(auth))
    )
    .derive(async ({ headers }) => {
      const token = getBearerToken(headers);
      const auth = await authenticateToken(token);
      requireMinRole(auth.user, 1);
      return { auth, token };
    })
    .get("/overview", () => sendOk(getAdminOverview(startedAt)))
    .get("/logs", ({ query }) => sendOk(getAdminLogs(query)))
    .get("/config", () => sendOk(getAdminConfig()))
    .put("/config", ({ auth, body }) => {
      requireMinRole(auth.user, 0);
      return sendOk(saveAdminConfig(body));
    })
    .group("/users", app => app
      .get("/", async ({ query }) => {
        const search = String(query.search ?? "").trim().toLowerCase();
        const role = query.role == null ? null : Number(query.role);
        const items = (await listManagedUsers()).filter((user) => {
          if (role != null && Number.isInteger(role) && user.role !== role) return false;
          if (search && !user.username.toLowerCase().includes(search)) return false;
          return true;
        });
        return sendOk(items);
      })
      .post("/", async ({ auth, body, set }) => {
        set.status = 201;
        return sendOk(await createManagedUser(auth.user.id, body));
      })
      .patch("/:userId", async ({ auth, params: { userId }, body }) => sendOk(await updateManagedUser(auth.user.id, userId, body)))
      .post("/:userId/reset-password", async ({ auth, params: { userId } }) => sendOk(await resetManagedUserPassword(auth.user.id, userId)))
      .delete("/:userId", async ({ auth, params: { userId } }) => {
        await deleteManagedUser(auth.user.id, userId);
        return sendOk(true);
      })
    )
  )
  .use(staticPlugin({ assets: adminStaticDir, prefix: "/" }));
