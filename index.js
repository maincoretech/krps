import cors from "cors";
import express from "express";
import "dotenv/config";
import {
  AuthError,
  authenticateToken,
  loginUser,
  logoutToken,
  registerUser,
} from "./modules/auth.js";
import {
  GameError,
  createGame,
  exchangeOnTie,
  exportAllGames,
  exportGame,
  getGameState,
  listGames,
  playRound,
} from "./modules/game.js";
import { getStorePath } from "./modules/store.js";
import logger from "./utils/logger.js";

const app = express();
const port = Number(process.env.SERVER_PORT ?? 3000);
const hostname = process.env.SERVER_HOSTNAME ?? "0.0.0.0";
const serverName = process.env.SERVER_NAME ?? "478 card game backend";

app.use(cors());
app.use(express.json());

function getBearerToken(req) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function requireAuth(req, res, next) {
  try {
    const auth = authenticateToken(getBearerToken(req));
    req.auth = auth;
    req.token = getBearerToken(req);
    next();
  } catch (error) {
    next(error);
  }
}

app.get("/", (req, res) => {
  res.status(200).json({
    status: true,
    message: "Server is up.",
    data: {
      server: {
        name: serverName,
        host: hostname,
        port,
        storage: getStorePath(),
      },
      endpoints: [
        "POST /auth/register",
        "POST /auth/login",
        "GET /auth/me",
        "POST /auth/logout",
        "GET /games",
        "POST /games",
        "GET /games/:gameId",
        "POST /games/:gameId/round",
        "POST /games/:gameId/exchange",
        "GET /games/:gameId/export",
        "GET /games-export",
      ],
    },
  });
});

app.get("/server/information", (req, res) => {
  res.status(200).json({
    status: true,
    message: "Server information.",
    data: {
      server: {
        name: serverName,
        host: hostname,
        port,
        storage: getStorePath(),
      },
      auth: {
        tokenType: "Bearer",
      },
    },
  });
});

app.post("/auth/register", (req, res) => {
  const result = registerUser(req.body);
  res.status(201).json({
    status: true,
    message: "User registered.",
    data: result,
  });
});

app.post("/auth/login", (req, res) => {
  const result = loginUser(req.body);
  res.status(200).json({
    status: true,
    message: "Login successful.",
    data: result,
  });
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.status(200).json({
    status: true,
    message: "Authenticated user.",
    data: req.auth,
  });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  logoutToken(req.token);
  res.status(200).json({
    status: true,
    message: "Logout successful.",
    data: {},
  });
});

app.get("/games", requireAuth, (req, res) => {
  res.status(200).json({
    status: true,
    message: "Games loaded.",
    data: listGames(req.auth.user.id),
  });
});

app.post("/games", requireAuth, (req, res) => {
  res.status(201).json({
    status: true,
    message: "Game created.",
    data: createGame(req.auth.user.id, req.body),
  });
});

app.get("/games/:gameId", requireAuth, (req, res) => {
  res.status(200).json({
    status: true,
    message: "Game loaded.",
    data: getGameState(req.params.gameId, req.auth.user.id),
  });
});

app.post("/games/:gameId/round", requireAuth, (req, res) => {
  res.status(200).json({
    status: true,
    message: "Round resolved.",
    data: playRound(req.params.gameId, req.auth.user.id, req.body),
  });
});

app.post("/games/:gameId/exchange", requireAuth, (req, res) => {
  res.status(200).json({
    status: true,
    message: "Tie exchange resolved.",
    data: exchangeOnTie(req.params.gameId, req.auth.user.id, req.body),
  });
});

app.get("/games/:gameId/export", requireAuth, (req, res) => {
  const game = exportGame(req.params.gameId, req.auth.user.id);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="game-${game.id}.json"`
  );
  res.status(200).json(game);
});

app.get("/games-export", requireAuth, (req, res) => {
  const games = exportAllGames(req.auth.user.id);
  const fileName = `games-${req.auth.user.username}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).json({
    exportedAt: new Date().toISOString(),
    user: req.auth.user,
    games,
  });
});

app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: "Route not found.",
    data: {},
  });
});

app.use((error, req, res, next) => {
  if (error instanceof AuthError || error instanceof GameError) {
    res.status(error.status).json({
      status: false,
      message: error.message,
      data: {},
    });
    return;
  }

  logger.error(error?.stack ?? error?.message ?? String(error));
  res.status(500).json({
    status: false,
    message: "Internal server error.",
    data: {},
  });
});

app.listen(port, hostname, () => {
  logger.info(`Server is running at http://${hostname}:${port}`);
});

export default app;
