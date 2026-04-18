const date = () => {
  return (
    "[" +
    new Intl.DateTimeFormat("zh", { dateStyle: "short" }).format() +
    "#" +
    new Intl.DateTimeFormat("zh", { timeStyle: "long" }).format() +
    "]"
  );
};

export const logStore = [];
export const matchStore = [];
const MAX_LOGS = 50000;

const addLog = (level, msg, color) => {
  const d = date();
  logStore.push({ date: d, level, message: msg });
  if (logStore.length > MAX_LOGS) logStore.shift();
  console.log(d + color + `[${level.toUpperCase()}]\x1b[0m ` + msg);
};

const logger = {
  info: (s) => addLog("info", s, "\x1b[32m"),
  warn: (s) => addLog("warn", s, "\x1b[33m"),
  error: (s) => addLog("error", s, "\x1b[31m"),
  match: (s) => {
    const d = date();
    matchStore.push({ date: d, level: "match", message: s });
    if (matchStore.length > MAX_LOGS) matchStore.shift();
    console.log(d + "\x1b[36m[MATCH]\x1b[0m " + s);
  }
};

export default logger;
