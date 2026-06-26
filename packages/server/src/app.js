import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { bearer } from "@elysiajs/bearer";
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
import { getAdminBackupConfig, getAdminConfig, getAdminLogs, getAdminOverview, saveAdminConfig, getRuntimeConfig } from "./system.js";
import adminHtmlPath from "../public/admin/index.html" with { type: "file" };
import adminJsPath from "../public/admin/app.js" with { type: "file" };
import adminCssPath from "../public/admin/styles.css" with { type: "file" };
import {
  createMatch,
  deleteMatchData,
  exchangeCard,
  leaveMatch,
  MatchError,
  refreshMatchInviteCode,
  getMatchState,
  exportMatch,
  joinMatchByCode,
  joinPublicMatch,
  listBotStrategies,
  listMatches,
  submitMove,
  renameMatch,
  requestMatchRematch,
  setMatchReady,
} from "./match.js";
import { getStorePath, getLeaderboard, db, upsertUser } from "./db.js";
import logger from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const startedAt = Date.now();

global.wsClients = new Set();

export async function broadcastMatchState(matchId, result, asDiff = false) {
  if (!global.wsClients) return;
  for (const ws of global.wsClients) {
    if (ws.data && ws.data.userId) {
      try {
        const matchStateRaw = await getMatchState(matchId, ws.data.userId); // getMatchState calls serializeMatch which strips secrets
        if (asDiff) {
          // Instead of fetching again, we can just pick the fields from the already serialized full state
          // to create the diff payload, but without the full history.
          const diff = {
            id: matchStateRaw.id,
            version: matchStateRaw.version,
            status: matchStateRaw.status,
            winner: matchStateRaw.winner,
            roundCount: matchStateRaw.roundCount,
            tieCount: matchStateRaw.tieCount,
            poolBits: matchStateRaw.poolBits,
            updatedAt: matchStateRaw.updatedAt,
            players: matchStateRaw.players,
            startVotes: matchStateRaw.startVotes,
            rematchVotes: matchStateRaw.rematchVotes,
            pendingMoves: matchStateRaw.pendingMoves,
            newHistoryItem: matchStateRaw.history.length > 0 ? matchStateRaw.history[matchStateRaw.history.length - 1] : null
          };
          ws.send(JSON.stringify({ action: "matchUpdate", data: diff }));
        } else {
          ws.send(JSON.stringify({ action: "match", data: matchStateRaw }));
        }
      } catch (e) {}
    }
  }
}

function sendOk(data) {
  return { status: true, data };
}

function errorHandler({ code, error, set }) {
  const status =
    error instanceof AuthError || error instanceof MatchError
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
  .use(bearer())
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/" || path.startsWith("/auth") || path.startsWith("/matches") || path.startsWith("/leaderboard") || path.startsWith("/dashboard")) {
      logger.info(`${request.method} ${path}`);
    }
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
        let wsToken = message.token;
        if (wsToken && wsToken.startsWith("Bearer ")) wsToken = wsToken.split(" ")[1];
        
        const auth = await authenticateToken(wsToken);
        ws.data = ws.data || {};
        ws.data.userId = auth.user.id;

        if (message.action === "getMatch") {
          ws.send(JSON.stringify({ action: "match", data: await getMatchState(message.matchId, auth.user.id) }));
          return;
        }
        if (message.action === "submitMove") {
          const result = await submitMove(message.matchId, auth.user.id, message.payload);
          ws.send(JSON.stringify({ action: "moveResult", data: result }));
          broadcastMatchState(message.matchId, result, true);
          return;
        }
        if (message.action === "exchangeCard") {
          const result = await exchangeCard(message.matchId, auth.user.id, message.payload);
          ws.send(JSON.stringify({ action: "exchangeResult", data: result }));
          broadcastMatchState(message.matchId, result, true);
          return;
        }
        if (message.action === "requestRematch") {
          const result = await requestMatchRematch(message.matchId, auth.user.id, message.payload);
          broadcastMatchState(message.matchId, result);
          return;
        }
        ws.send(JSON.stringify({ error: "Unsupported action." }));
      } catch (error) {
        ws.send(JSON.stringify({ error: error.message || "WebSocket Error" }));
      }
    }
  })
  .group("/auth", authGroup => authGroup
    .post("/register", async ({ body, set }) => {
      set.status = 201;
      return sendOk(await registerUser(body));
    })
    .post("/login", async ({ body }) => {
      return sendOk(await loginUser(body));
    })
  )
  .group("/auth", authGroup => authGroup
    .derive(async ({ bearer }) => {
      const auth = await authenticateToken(bearer);
      return { auth, token: bearer };
    })
    .post("/logout", async ({ token }) => {
      await logoutToken(token);
      return sendOk(null);
    })
    .get("/me", ({ auth }) => sendOk(auth))
    .put("/me", async ({ auth, body }) => sendOk(await updateUserCredentials(auth.user.id, body)))
    .post("/promote", async ({ auth, body }) => {
      if (!body.username) throw new AuthError(400, "Missing username.");
      await promoteUser(auth.user.id, body.username);
      return sendOk({ promoted: body.username });
    })
  )
  .get("/leaderboard", async () => sendOk(await getLeaderboard()))
  .group("", protectedApp => protectedApp
    .derive(async ({ bearer }) => {
      const auth = await authenticateToken(bearer);
      return { auth, token: bearer };
    })
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
      const matches = await listMatches(auth.user.id);
      const games = matches.filter(m => m.mode === "human-vs-bot");
      const rooms = matches.filter(m => m.mode === "human-vs-human");
      return sendOk({ info, games, rooms });
    })
    .group("/matches", app => app
      .get("/", async ({ auth }) => sendOk(await listMatches(auth.user.id)))
      .post("/", async ({ auth, body, set }) => {
        set.status = 201;
        return sendOk(await createMatch(auth.user.id, body));
      })
      .post("/join", async ({ auth, body }) => {
        if (body.matchId) return sendOk(await joinPublicMatch(body.matchId, auth.user.id, auth.user.username));
        return sendOk(await joinMatchByCode(body.inviteCode, auth.user.id, auth.user.username));
      })
      .get("/:matchId", async ({ auth, params: { matchId } }) => sendOk(await getMatchState(matchId, auth.user.id)))
      .post("/:matchId/refresh-code", async ({ auth, params: { matchId } }) => {
        const result = await refreshMatchInviteCode(matchId, auth.user.id);
        broadcastMatchState(matchId, result);
        return sendOk(result);
      })
      .post("/:matchId/start", async ({ auth, params: { matchId }, body }) => {
        const result = await setMatchReady(matchId, auth.user.id, body);
        broadcastMatchState(matchId, result);
        return sendOk(result);
      })
      .put("/:matchId/name", async ({ auth, params: { matchId }, body }) => sendOk(await renameMatch(matchId, auth.user.id, body)))
      .delete("/:matchId", async ({ auth, params: { matchId } }) => sendOk(await deleteMatchData(matchId, auth.user.id)))
      .post("/:matchId/leave", async ({ auth, params: { matchId } }) => sendOk(await leaveMatch(matchId, auth.user.id)))
      .get("/:matchId/export", async ({ auth, params: { matchId }, set }) => {
        const match = await exportMatch(matchId, auth.user.id);
        set.headers["Content-Type"] = "application/json; charset=utf-8";
        set.headers["Content-Disposition"] = `attachment; filename="match-${matchId}.json"`;
        return match;
      })
    )
  );

export const adminApp = new Elysia()
  .use(cors())
  .use(bearer())
  .onRequest(({ request }) => {
    logger.info(`[ADMIN] ${request.method} ${new URL(request.url).pathname}`);
  })
  .onError(({ code, error, set, request }) => {
    if (code === 'NOT_FOUND') {
      const url = new URL(request.url);
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        set.status = 200;
        set.headers["Content-Type"] = "text/html; charset=utf-8";
        return Bun.file(adminHtmlPath);
      }
    }
    return errorHandler({ code, error, set });
  })
  .get("/", ({ set }) => {
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return Bun.file(adminHtmlPath);
  })
  .get("/index.html", ({ set }) => {
    set.headers["Content-Type"] = "text/html; charset=utf-8";
    return Bun.file(adminHtmlPath);
  })
  .get("/app.js", ({ set }) => {
    set.headers["Content-Type"] = "application/javascript; charset=utf-8";
    return Bun.file(adminJsPath);
  })
  .get("/styles.css", ({ set }) => {
    set.headers["Content-Type"] = "text/css; charset=utf-8";
    return Bun.file(adminCssPath);
  })
  .group("/api", app => app
    .group("/auth", app => app
      .post("/login", async ({ body }) => sendOk(await loginAdminUser(body)))
    )
    .group("/auth", app => app
      .derive(async ({ bearer }) => {
        const auth = await authenticateToken(bearer);
        requireMinRole(auth.user, 1);
        return { auth, token: bearer };
      })
      .post("/logout", async ({ token }) => {
        await logoutToken(token);
        return sendOk(null);
      })
      .get("/me", ({ auth }) => sendOk(auth))
    )
    .group("", protectedAdminApi => protectedAdminApi
      .derive(async ({ bearer }) => {
        const auth = await authenticateToken(bearer);
        requireMinRole(auth.user, 1);
        return { auth, token: bearer };
      })
      .get("/overview", () => sendOk(getAdminOverview(startedAt)))
      .get("/logs", ({ query }) => sendOk(getAdminLogs(query)))
      .get("/config", () => sendOk(getAdminConfig()))
      .put("/config", ({ auth, body }) => {
        requireMinRole(auth.user, 0);
        return sendOk(saveAdminConfig(body));
      })
      .group("/backup", app => app
        .get("/config", ({ auth, set }) => {
          requireMinRole(auth.user, 0);
          set.headers["Content-Type"] = "application/json; charset=utf-8";
          set.headers["Content-Disposition"] = `attachment; filename="krps-config-backup.json"`;
          return getAdminBackupConfig();
        })
        .post("/config", async ({ auth, body }) => {
          requireMinRole(auth.user, 0);
          return sendOk(saveAdminConfig(body));
        })
        .get("/users", ({ auth, set }) => {
          requireMinRole(auth.user, 0);
          set.headers["Content-Type"] = "application/json; charset=utf-8";
          set.headers["Content-Disposition"] = `attachment; filename="krps-users-backup.json"`;
          const { listUsers } = require("./db.js");
          return listUsers();
        })
        .post("/users", async ({ auth, body }) => {
          requireMinRole(auth.user, 0);
          if (!Array.isArray(body)) throw new AuthError(400, "Expected an array of users.");
          const { upsertUser } = require("./db.js");
          let count = 0;
          for (const user of body) {
            if (!user.id || !user.username || !user.passwordHash) continue;
            upsertUser({
              id: user.id,
              username: user.username,
              passwordHash: user.passwordHash,
              role: user.role ?? 2,
              createdAt: user.createdAt ?? new Date().toISOString()
            });
            count++;
          }
          return sendOk({ imported: count });
        })
      )
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
      .group("/backup", app => app
        .get("/config", async ({ auth }) => {
          requireMinRole(auth.user, 0);
          return sendOk(getAdminBackupConfig());
        })
        .post("/config", async ({ auth, body }) => {
          requireMinRole(auth.user, 0);
          return sendOk(saveAdminConfig(body));
        })
        .get("/users", async ({ auth }) => {
          requireMinRole(auth.user, 0);
          const users = db.query("SELECT * FROM users").all();
          return sendOk(users);
        })
        .post("/users", async ({ auth, body }) => {
          requireMinRole(auth.user, 0);
          let count = 0;
          if (Array.isArray(body)) {
            for (const u of body) {
              if (u.id && u.username && u.password_hash) {
                upsertUser({
                  id: u.id,
                  username: u.username,
                  passwordHash: u.password_hash,
                  role: u.role ?? 2,
                  createdAt: u.created_at || new Date().toISOString()
                });
                count++;
              }
            }
          }
          return sendOk({ imported: count });
        })
      )
    )
  );
