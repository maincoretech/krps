import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
const storePath = path.join(dataDir, "store.json");

const defaultStore = () => ({
  users: [],
  sessions: [],
  games: [],
});

function ensureStoreFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(defaultStore(), null, 2), "utf8");
  }
}

function parseStore(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      games: Array.isArray(parsed.games) ? parsed.games : [],
    };
  } catch {
    return defaultStore();
  }
}

export function readStore() {
  ensureStoreFile();
  return parseStore(fs.readFileSync(storePath, "utf8"));
}

export function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

export function updateStore(mutator) {
  const store = readStore();
  const result = mutator(store);
  writeStore(store);
  return result;
}

export function getStorePath() {
  ensureStoreFile();
  return storePath;
}
