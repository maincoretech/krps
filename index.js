#!/usr/bin/env bun
import { runCli } from "./src/cli.js";
import { getRuntimeConfig } from "./src/system.js";
import { initializeSysAdmin } from "./src/auth.js";
import logger from "./src/logger.js";
import { app, adminApp } from "./src/app.js";

async function boot() {
  const config = getRuntimeConfig();
  await initializeSysAdmin();

  try {
    app.listen({ port: config.serverPort, hostname: config.hostname }, () => logger.info(`API/WS at ${config.serverPort}`));
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      logger.error(`API/WS Server failed to start: Port ${config.serverPort} is already in use.`);
      logger.error(`Tip: A background service (like systemd) might already be running the server.`);
    } else {
      logger.error(`API/WS Server error: ${err.message || err}`);
    }
    process.exit(1);
  }
  
  try {
    adminApp.listen({ port: config.adminPort, hostname: config.hostname }, () => logger.info(`Admin at ${config.adminPort}`));
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      logger.error(`Admin Server failed to start: Port ${config.adminPort} is already in use.`);
      logger.error(`Tip: A background service (like systemd) might already be running the server.`);
    } else {
      logger.error(`Admin Server error: ${err.message || err}`);
    }
    process.exit(1);
  }
}

async function main() {
  const cliResult = await runCli();
  if (!cliResult.shouldStartServer) {
    process.exit(cliResult.exitCode ?? 0);
  }
  await boot();
}

main().catch((error) => {
  logger.error(`Failed to start server: ${error.message || error}`);
  process.exit(1);
});
