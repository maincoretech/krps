import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import {
  countUsersByRole,
  deleteSessionsByUserId,
  deleteExpiredSessions,
  deleteSessionsByTokenHash,
  findSessionByTokenHash,
  findFirstUserByRole,
  findUserById,
  findUserByUsername,
  findUserByUsernameExcludingId,
  insertSession,
  insertUser,
  listUsers,
  deleteUser,
  updateUser,
} from "./db.js";
import { getRuntimeConfig } from "./system.js";
import logger from "./logger.js";

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function hashPassword(password) {
  return Bun.password.hashSync(password, { algorithm: "bcrypt" });
}

function verifyPassword(password, storedHash) {
  const hashString = String(storedHash);
  if (hashString.includes(":")) {
    const [salt, expected] = hashString.split(":");
    if (!salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    if (actual.length !== expectedBuffer.length) return false;
    return timingSafeEqual(actual, expectedBuffer);
  }
  return Bun.password.verifySync(password, hashString);
}

function hashToken(token) {
  return new Bun.SHA256().update(token).digest("hex");
}

export function sanitizeUser(user) {
  return { id: user.id, username: user.username, role: user.role ?? 2, createdAt: user.createdAt };
}

export function validateCredentials(payload) {
  const username = String(payload?.username ?? "").trim();
  const password = String(payload?.password ?? "");
  if (!USERNAME_PATTERN.test(username)) throw new AuthError(400, "Username must be 3-32 chars and use letters, numbers, _ or -.");
  if (password.length < PASSWORD_MIN_LENGTH) throw new AuthError(400, "Password must be at least 8 characters.");
  return { username, password };
}

function validateOptionalPassword(password) {
  if (password == null || password === "") {
    return null;
  }
  const nextPassword = String(password);
  if (nextPassword.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(400, "Password must be at least 8 characters.");
  }
  return nextPassword;
}

async function pruneExpiredSessions() {
  const now = Date.now();
  deleteExpiredSessions(now);
}

function createSessionRecord(userId) {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const ttlHours = Number(getRuntimeConfig().authTokenTtlHours ?? 72);
  const session = {
    type: "session",
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + ttlHours * 60 * 60 * 1000,
  };
  insertSession(session);
  return { token, session };
}

export async function verifyUserCredentials(payload) {
  const { username, password } = validateCredentials(payload);
  await pruneExpiredSessions();
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AuthError(401, "Invalid username or password.");
  }
  return user;
}

export function requireMinRole(user, maxRole) {
  if (!user || Number(user.role ?? 99) > maxRole) {
    throw new AuthError(403, "Forbidden.");
  }
}

export async function initializeSysAdmin() {
  const adminCount = countUsersByRole(0);
  if (adminCount === 0) {
    const tempPassword = randomBytes(8).toString("hex");
    const user = {
      id: randomUUID(),
      username: "admin",
      passwordHash: hashPassword(tempPassword),
      role: 0,
      createdAt: new Date().toISOString()
    };
    insertUser(user);
    console.log("\n===========================================================");
    console.log("=== SYSTEM NO ADMIN DETECTED. AUTO-CREATED LEVEL 0 USER ===");
    console.log(`=== Username: admin`);
    console.log(`=== Password: ${tempPassword}`);
    console.log("=== Please change your password immediately after login!");
    console.log("===========================================================\n");
  }
}

export async function verifyTurnstile(token) {
  if (!token) return false;
  const secret = getRuntimeConfig().turnstileSecretKey || "1x0000000000000000000000000000000AA";
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error("Turnstile verification error:", error);
    return false;
  }
}

export async function registerUser(payload) {
  const { username, password } = validateCredentials(payload);
  
  const isValidCaptcha = await verifyTurnstile(payload.turnstileToken);
  if (!isValidCaptcha) {
    throw new AuthError(400, "Turnstile verification failed. Please complete the captcha.");
  }

  await pruneExpiredSessions();
  const existing = findUserByUsername(username);
  if (existing) throw new AuthError(409, "Username already exists.");
  const user = {
    id: randomUUID(),
    username,
    role: 2,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  insertUser(user);
  return { user: sanitizeUser(user) };
}

export async function loginUser(payload) {
  const user = await verifyUserCredentials(payload);
  const { token, session } = createSessionRecord(user.id);
  return { token, expiresAt: new Date(session.expiresAt).toISOString(), user: sanitizeUser(user) };
}

export async function authenticateToken(token) {
  if (!token) throw new AuthError(401, "Missing bearer token.");
  await pruneExpiredSessions();
  const session = findSessionByTokenHash(hashToken(token));
  if (!session) throw new AuthError(401, "Invalid or expired token.");
  const user = findUserById(session.userId);
  if (!user) throw new AuthError(401, "User for token no longer exists.");
  return {
    session: { id: session.id, createdAt: session.createdAt, expiresAt: new Date(session.expiresAt).toISOString() },
    user: sanitizeUser(user)
  };
}

export async function logoutToken(token) {
  if (!token) throw new AuthError(401, "Missing bearer token.");
  const numRemoved = deleteSessionsByTokenHash(hashToken(token));
  if (numRemoved === 0) throw new AuthError(401, "Invalid or expired token.");
  return true;
}

export async function updateUserCredentials(userId, payload) {
  const user = findUserById(userId);
  if (!user) throw new AuthError(404, "User not found.");

  const nextUser = { ...user };
  if (payload.username) {
    if (!USERNAME_PATTERN.test(payload.username)) throw new AuthError(400, "Invalid username format.");
    const existing = findUserByUsernameExcludingId(payload.username, userId);
    if (existing) throw new AuthError(409, "Username already exists.");
    nextUser.username = payload.username;
  }
  const nextPassword = validateOptionalPassword(payload.password);
  if (nextPassword) {
    nextUser.passwordHash = hashPassword(nextPassword);
  }

  if (nextUser.username !== user.username || nextUser.passwordHash !== user.passwordHash) {
    updateUser(nextUser);
    return { user: sanitizeUser(nextUser) };
  }
  return { user: sanitizeUser(user) };
}

export async function promoteUser(promoterId, targetUsername) {
  const promoter = findUserById(promoterId);
  if (!promoter || promoter.role !== 0) throw new AuthError(403, "Forbidden: Only Level 0 users can promote.");

  const target = findUserByUsername(targetUsername);
  if (!target) throw new AuthError(404, "User not found.");
  if (target.role === 0) throw new AuthError(400, "Cannot promote a level 0 user.");

  updateUser({ ...target, role: 1 });
  return true;
}

export async function resetSuperAdminPassword() {
  const admin = findFirstUserByRole(0);
  if (!admin) {
    throw new AuthError(404, "No level 0 user found. Please start the server first to initialize.");
  }

  const tempPassword = randomBytes(8).toString("hex");
  updateUser({ ...admin, passwordHash: hashPassword(tempPassword) });
  deleteSessionsByUserId(admin.id);
  return { username: admin.username, password: tempPassword };
}

export async function loginAdminUser(payload) {
  const user = await verifyUserCredentials(payload);
  requireMinRole(user, 1);
  const { token, session } = createSessionRecord(user.id);
  return { token, expiresAt: new Date(session.expiresAt).toISOString(), user: sanitizeUser(user) };
}

export async function listManagedUsers() {
  return listUsers().map(sanitizeUser);
}

export async function createManagedUser(actorId, payload) {
  const actor = findUserById(actorId);
  requireMinRole(actor, 1);

  const { username, password } = validateCredentials(payload);
  const role = Number(payload?.role ?? 2);
  if (![1, 2].includes(role) || (role === 1 && actor.role !== 0)) {
    throw new AuthError(403, "Forbidden role assignment.");
  }

  if (findUserByUsername(username)) {
    throw new AuthError(409, "Username already exists.");
  }

  const user = {
    id: randomUUID(),
    username,
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  insertUser(user);
  return sanitizeUser(user);
}

export async function updateManagedUser(actorId, targetUserId, payload) {
  const actor = findUserById(actorId);
  requireMinRole(actor, 1);

  const target = findUserById(targetUserId);
  if (!target) {
    throw new AuthError(404, "User not found.");
  }

  if (target.role <= 1 && actor.role !== 0 && actor.id !== target.id) {
    throw new AuthError(403, "Admins can only manage normal users.");
  }

  const nextUser = { ...target };
  if (payload.username != null && String(payload.username).trim() !== "") {
    const username = String(payload.username).trim();
    if (!USERNAME_PATTERN.test(username)) {
      throw new AuthError(400, "Invalid username format.");
    }
    const existing = findUserByUsernameExcludingId(username, targetUserId);
    if (existing) {
      throw new AuthError(409, "Username already exists.");
    }
    nextUser.username = username;
  }

  if (payload.role != null) {
    const nextRole = Number(payload.role);
    if (![0, 1, 2].includes(nextRole)) {
      throw new AuthError(400, "Invalid role.");
    }
    if (nextRole === 0 && actor.role !== 0) {
      throw new AuthError(403, "Only level 0 users can assign level 0.");
    }
    if (target.role === 0 && actor.role !== 0) {
      throw new AuthError(403, "Only level 0 users can edit level 0 users.");
    }
    if (target.id === actor.id && nextRole !== target.role) {
      throw new AuthError(400, "Cannot change your own role.");
    }
    if (target.role === 0 && nextRole !== 0 && countUsersByRole(0) <= 1) {
      throw new AuthError(400, "Cannot demote the last level 0 user.");
    }
    nextUser.role = nextRole;
  }

  const nextPassword = validateOptionalPassword(payload.password);
  if (nextPassword) {
    nextUser.passwordHash = hashPassword(nextPassword);
    deleteSessionsByUserId(target.id);
  }

  updateUser(nextUser);
  return sanitizeUser(nextUser);
}

export async function resetManagedUserPassword(actorId, targetUserId) {
  const actor = findUserById(actorId);
  requireMinRole(actor, 1);

  const target = findUserById(targetUserId);
  if (!target) {
    throw new AuthError(404, "User not found.");
  }
  if (target.role <= 1 && actor.role !== 0 && actor.id !== target.id) {
    throw new AuthError(403, "Admins can only reset normal user passwords.");
  }

  const tempPassword = randomBytes(8).toString("hex");
  updateUser({ ...target, passwordHash: hashPassword(tempPassword) });
  deleteSessionsByUserId(target.id);
  return { user: sanitizeUser(target), password: tempPassword };
}

export async function deleteManagedUser(actorId, targetUserId) {
  const actor = findUserById(actorId);
  requireMinRole(actor, 1);

  const target = findUserById(targetUserId);
  if (!target) {
    throw new AuthError(404, "User not found.");
  }
  if (target.id === actor.id) {
    throw new AuthError(400, "Cannot delete your own account.");
  }
  if (target.role === 0) {
    throw new AuthError(400, "Cannot delete a level 0 user.");
  }
  if (target.role === 1 && actor.role !== 0) {
    throw new AuthError(403, "Only level 0 users can delete admins.");
  }

  deleteSessionsByUserId(target.id);
  deleteUser(target.id);
  return true;
}
