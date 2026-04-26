import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getConfigStorage, loadConfig, saveConfig } from "./system.js";
import { initializeSysAdmin, resetSuperAdminPassword } from "./auth.js";
import logger from "./logger.js";

function resolveCliArgv(argv) {
  if (Array.isArray(argv) && argv.length > 0) {
    return argv;
  }

  const rawArgv = process.argv.slice(1);
  const first = rawArgv[0];
  if (first) {
    if (first.includes("$bunfs")) {
      return rawArgv.slice(1);
    }
    if (fs.existsSync(first) && /\.(mjs|cjs|js|ts)$/i.test(first)) {
      return rawArgv.slice(1);
    }
  }
  return rawArgv;
}

function printHelp() {
  console.log(`478 backend commands:

  start      Start services (same as no argument)
  config     Interactive configuration wizard
  passwd     Reset the level 0 super admin password
  install    Install a systemd service unit on Linux
  remove     Remove the installed systemd service unit
  status     Print runtime and configuration status
  help       Show this help message
`);
}

function printStatus() {
  const config = loadConfig();
  const storage = getConfigStorage();
  console.log(JSON.stringify({
    configStorage: storage,
    serverPort: config.serverPort,
    adminPort: config.adminPort,
    hostname: config.hostname,
    allowedOrigins: config.allowedOrigins,
    serverName: config.serverName,
    serviceName: config.serviceName,
    platform: process.platform,
    executable: process.execPath,
    script: process.argv[1] ?? null,
    cwd: process.cwd(),
  }, null, 2));
}

function getStartCommand() {
  const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (scriptPath && !scriptPath.includes("$bunfs") && fs.existsSync(scriptPath) && scriptPath !== process.execPath) {
    return `"${process.execPath}" "${scriptPath}" start`;
  }
  return `"${process.execPath}" start`;
}

function requireSystemd() {
  if (process.platform !== "linux") {
    throw new Error("systemd install/remove is only supported on Linux.");
  }
  if (!fs.existsSync("/run/systemd/system")) {
    throw new Error("systemd does not appear to be available on this host.");
  }
}

function writeSystemdUnit(unitPath, config) {
  const content = `[Unit]
Description=${config.serverName}
After=network.target

[Service]
Type=simple
WorkingDirectory=${process.cwd()}
ExecStart=${getStartCommand()}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${config.serviceName}

[Install]
WantedBy=multi-user.target
`;
  Bun.write(unitPath, content);
}

function runSystemCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? 1}.`);
  }
}

async function runConfigWizard() {
  const current = loadConfig();
  const rl = createInterface({ input, output });

  async function ask(label, currentValue) {
    const answer = await rl.question(`${label} [${currentValue}]: `);
    return answer.trim() === "" ? String(currentValue) : answer.trim();
  }

  try {
    const nextConfig = {
      serverName: await ask("Server name", current.serverName),
      serverDescription: await ask("Server description", current.serverDescription),
      hostname: await ask("Listen hostname", current.hostname),
      serverPort: Number(await ask("API port", current.serverPort)),
      adminPort: Number(await ask("Admin port", current.adminPort)),
      authTokenTtlHours: Number(await ask("Auth token TTL hours", current.authTokenTtlHours)),
      allowedOrigins: (
        await ask("Allowed frontend origins (comma separated)", current.allowedOrigins.join(","))
      )
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      serviceName: await ask("Systemd service name", current.serviceName),
    };
    const saved = saveConfig(nextConfig);
    console.log(`Saved config to SQLite table ${getConfigStorage().table}`);
    console.log(JSON.stringify(saved, null, 2));
  } finally {
    rl.close();
  }
}

async function installSystemdService() {
  requireSystemd();
  const config = loadConfig();
  const serviceName = `${config.serviceName}.service`;
  const unitPath = path.join("/etc/systemd/system", serviceName);
  writeSystemdUnit(unitPath, config);
  runSystemCommand("systemctl", ["daemon-reload"]);
  runSystemCommand("systemctl", ["enable", serviceName]);
  console.log(`Installed ${serviceName} at ${unitPath}`);
}

async function removeSystemdService() {
  requireSystemd();
  const config = loadConfig();
  const serviceName = `${config.serviceName}.service`;
  const unitPath = path.join("/etc/systemd/system", serviceName);
  if (fs.existsSync(unitPath)) {
    runSystemCommand("systemctl", ["disable", "--now", serviceName]);
    fs.rmSync(unitPath, { force: true });
    runSystemCommand("systemctl", ["daemon-reload"]);
    console.log(`Removed ${serviceName}`);
    return;
  }
  console.log(`${serviceName} was not installed.`);
}

async function resetPasswordFromCli() {
  await initializeSysAdmin();
  const result = await resetSuperAdminPassword();
  logger.info("=== ADMIN PASSWORD RESET ===");
  logger.info(`Username: ${result.username}`);
  logger.info(`New Password: ${result.password}`);
  logger.info("============================");
}

export async function runCli(argv) {
  const resolvedArgv = resolveCliArgv(argv);
  const command = (resolvedArgv[0] ?? "start").toLowerCase();

  if (command === "start") {
    return { shouldStartServer: true };
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return { shouldStartServer: false };
  }
  if (command === "status") {
    printStatus();
    return { shouldStartServer: false };
  }
  if (command === "config") {
    await runConfigWizard();
    return { shouldStartServer: false };
  }
  if (command === "passwd") {
    await resetPasswordFromCli();
    return { shouldStartServer: false };
  }
  if (command === "install") {
    await installSystemdService();
    return { shouldStartServer: false };
  }
  if (command === "remove") {
    await removeSystemdService();
    return { shouldStartServer: false };
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return { shouldStartServer: false, exitCode: os.constants.errno.EINVAL || 1 };
}
