import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { updateStore } from "./store.js";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 72);

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash).split(":");
  if (!salt || !expected) {
    return false;
  }

  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actual, expectedBuffer);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function validateCredentials(payload) {
  const username = String(payload?.username ?? "").trim();
  const password = String(payload?.password ?? "");

  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(
      400,
      "Username must be 3-32 chars and use letters, numbers, _ or -."
    );
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(400, "Password must be at least 8 characters.");
  }

  return { username, password };
}

function pruneExpiredSessions(store) {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => session.expiresAt > now);
}

export function registerUser(payload) {
  const { username, password } = validateCredentials(payload);

  return updateStore((store) => {
    pruneExpiredSessions(store);

    const exists = store.users.some(
      (user) => user.username.toLowerCase() === username.toLowerCase()
    );
    if (exists) {
      throw new AuthError(409, "Username already exists.");
    }

    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      createdAt: now,
    };

    store.users.push(user);
    return {
      user: sanitizeUser(user),
    };
  });
}

export function loginUser(payload) {
  const { username, password } = validateCredentials(payload);

  return updateStore((store) => {
    pruneExpiredSessions(store);

    const user = store.users.find(
      (entry) => entry.username.toLowerCase() === username.toLowerCase()
    );

    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AuthError(401, "Invalid username or password.");
    }

    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const session = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: now + TOKEN_TTL_HOURS * 60 * 60 * 1000,
    };

    store.sessions.push(session);

    return {
      token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: sanitizeUser(user),
    };
  });
}

export function authenticateToken(token) {
  if (!token) {
    throw new AuthError(401, "Missing bearer token.");
  }

  const tokenHash = hashToken(token);

  return updateStore((store) => {
    pruneExpiredSessions(store);

    const session = store.sessions.find((entry) => entry.tokenHash === tokenHash);
    if (!session) {
      throw new AuthError(401, "Invalid or expired token.");
    }

    const user = store.users.find((entry) => entry.id === session.userId);
    if (!user) {
      throw new AuthError(401, "User for token no longer exists.");
    }

    return {
      session: {
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
      user: sanitizeUser(user),
    };
  });
}

export function logoutToken(token) {
  if (!token) {
    throw new AuthError(401, "Missing bearer token.");
  }

  const tokenHash = hashToken(token);

  return updateStore((store) => {
    const before = store.sessions.length;
    store.sessions = store.sessions.filter((entry) => entry.tokenHash !== tokenHash);

    if (before === store.sessions.length) {
      throw new AuthError(401, "Invalid or expired token.");
    }

    return true;
  });
}
