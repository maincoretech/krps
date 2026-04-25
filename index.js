#!/usr/bin/env bun
import "dotenv/config";
import http from "http";
import { runCli } from "./src/cli.js";
import { getRuntimeConfig } from "./src/system.js";
import { initializeSysAdmin } from "./src/auth.js";
import logger from "./src/logger.js";
import { app, adminApp, setupWebSocket } from "./src/app.js";

const server = http.createServer(app);
setupWebSocket(server);

async function boot() {
  const config = getRuntimeConfig();
  await initializeSysAdmin();
  server.listen(config.serverPort, config.hostname, () => logger.info(`API/WS at ${config.serverPort}`));
  adminApp.listen(config.adminPort, config.hostname, () => logger.info(`Admin at ${config.adminPort}`));
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
