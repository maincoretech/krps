import {
  getSystemConfigValue,
  listSystemConfig,
  setSystemConfigValue,
  getStorePath as getConfigStorePath,
} from "./db.js";

const defaultConfig = {
  serverName: "478 card game backend",
  serverDescription: "Persistent card-game backend with user, game and room management.",
  hostname: "0.0.0.0",
  serverPort: 3000,
  adminPort: 47807,
  allowedOrigins: ["http://localhost:5173", "http://localhost:4173", "http://localhost:47808"],
  authTokenTtlHours: 72,
  serviceName: "478",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};

let cachedConfig = null;

function normalizeOriginList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  return [...new Set(items)];
}

function normalizePositiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return number;
}

function normalizeHostname(value) {
  const hostname = String(value ?? "").trim();
  return hostname || defaultConfig.hostname;
}

function normalizeName(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeConfig(input = {}) {
  const config = { ...defaultConfig, ...input };
  return {
    serverName: normalizeName(config.serverName, defaultConfig.serverName),
    serverDescription: String(config.serverDescription ?? "").trim(),
    hostname: normalizeHostname(config.hostname),
    serverPort: normalizePositiveInt(config.serverPort, defaultConfig.serverPort),
    adminPort: normalizePositiveInt(config.adminPort, defaultConfig.adminPort),
    allowedOrigins: normalizeOriginList(config.allowedOrigins ?? defaultConfig.allowedOrigins),
    authTokenTtlHours: normalizePositiveInt(
      config.authTokenTtlHours,
      defaultConfig.authTokenTtlHours
    ),
    serviceName: normalizeName(config.serviceName, defaultConfig.serviceName),
    turnstileSecretKey: String(config.turnstileSecretKey ?? defaultConfig.turnstileSecretKey).trim() || defaultConfig.turnstileSecretKey,
  };
}

function readRawConfigFromDb() {
  const rows = listSystemConfig();
  const rawConfig = {};
  for (const row of rows) {
    try {
      rawConfig[row.key] = JSON.parse(row.value);
    } catch {
      rawConfig[row.key] = row.value;
    }
  }
  return rawConfig;
}

function buildConfigFromSources() {
  const dbConfig = readRawConfigFromDb();
  return normalizeConfig({
    ...dbConfig,
    serverName: getSystemConfigValue("serverName")
      ? dbConfig.serverName
      : process.env.SERVER_NAME,
    serverDescription: getSystemConfigValue("serverDescription")
      ? dbConfig.serverDescription
      : process.env.SERVER_DESCRIPTION,
    hostname: getSystemConfigValue("hostname") ? dbConfig.hostname : process.env.SERVER_HOSTNAME,
    serverPort: getSystemConfigValue("serverPort") ? dbConfig.serverPort : process.env.SERVER_PORT,
    adminPort: getSystemConfigValue("adminPort") ? dbConfig.adminPort : process.env.ADMIN_PORT,
    allowedOrigins: getSystemConfigValue("allowedOrigins")
      ? dbConfig.allowedOrigins
      : process.env.ALLOWED_ORIGINS,
    authTokenTtlHours: getSystemConfigValue("authTokenTtlHours")
      ? dbConfig.authTokenTtlHours
      : process.env.AUTH_TOKEN_TTL_HOURS,
    serviceName: getSystemConfigValue("serviceName")
      ? dbConfig.serviceName
      : process.env.SERVICE_NAME,
    turnstileSecretKey: getSystemConfigValue("turnstileSecretKey")
      ? dbConfig.turnstileSecretKey
      : process.env.TURNSTILE_SECRET_KEY,
  });
}

export function loadConfig() {
  if (!cachedConfig) {
    cachedConfig = buildConfigFromSources();
  }
  return { ...cachedConfig, allowedOrigins: [...cachedConfig.allowedOrigins] };
}

export function getRuntimeConfig() {
  return loadConfig();
}

export function saveConfig(nextConfig) {
  cachedConfig = normalizeConfig(nextConfig);
  for (const [key, value] of Object.entries(cachedConfig)) {
    setSystemConfigValue(key, JSON.stringify(value));
  }
  return loadConfig();
}

export function updateConfig(partialConfig) {
  return saveConfig({ ...loadConfig(), ...partialConfig });
}

export function getConfigStorage() {
  return {
    type: "sqlite",
    table: "system_config",
    storePath: getConfigStorePath(),
    legacyPath: null,
  };
}

export function getDefaultConfig() {
  return {
    ...defaultConfig,
    allowedOrigins: [...defaultConfig.allowedOrigins],
  };
}


import {
  countGames,
  countRooms,
  countSessions,
  countUsers,
  countUsersByRole,
  getStorePath,
} from "./db.js";
import { getLogs } from "./logger.js";

function filterLogs(items, { search = "", level = "", limit = 200 } = {}) {
  const keyword = String(search ?? "").trim().toLowerCase();
  const normalizedLevel = String(level ?? "").trim().toLowerCase();
  const maxItems = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  const filtered = items.filter((item) => {
    if (normalizedLevel && String(item.level).toLowerCase() !== normalizedLevel) {
      return false;
    }
    if (keyword) {
      const haystack = `${item.date} ${item.level} ${item.message}`.toLowerCase();
      return haystack.includes(keyword);
    }
    return true;
  });
  return filtered.slice(-maxItems).reverse();
}

export function getAdminOverview(startedAt) {
  const config = getRuntimeConfig();
  return {
    service: {
      name: config.serverName,
      description: config.serverDescription,
      hostname: config.hostname,
      apiPort: config.serverPort,
      adminPort: config.adminPort,
      configStorage: getConfigStorage(),
      storePath: getStorePath(),
      startedAt,
      uptimeMs: Date.now() - startedAt,
    },
    counts: {
      users: countUsers(),
      superAdmins: countUsersByRole(0),
      admins: countUsersByRole(1),
      normalUsers: countUsersByRole(2),
      sessions: countSessions(),
      games: countGames(),
      rooms: countRooms(),
      appLogs: getLogs("app").length,
      matchLogs: getLogs("match").length,
    },
  };
}

export function getAdminLogs(query) {
  const scope = query?.scope === "match" ? "match" : "app";
  return {
    scope,
    items: filterLogs(getLogs(scope), query),
  };
}

export function getAdminConfig() {
  return {
    ...getRuntimeConfig(),
    configStorage: getConfigStorage(),
  };
}

export function saveAdminConfig(payload) {
  const previous = getRuntimeConfig();
  const next = updateConfig(payload);
  const requiresRestart =
    previous.serverPort !== next.serverPort ||
    previous.adminPort !== next.adminPort ||
    previous.hostname !== next.hostname;
  return {
    config: {
      ...next,
      configStorage: getConfigStorage(),
    },
    requiresRestart,
  };
}
