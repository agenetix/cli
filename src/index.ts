#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { registerCommands } from "./commands.js";
import { McpstackHttpError } from "./client.js";
import { printError } from "./output.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("mcpstack")
  .description("Manage MCP Stack organizations, MCP servers, gateways, agents, and service accounts.")
  .version(version)
  .option("--api-url <url>", "MCP Stack API URL")
  .option("--org <organizationId>", "Override organization id (advanced; default matches the SaaS dashboard)")
  .option("--json", "Print JSON output")
  .option("--output <format>", "Output format: table, json, yaml")
  .option("--yes", "Skip confirmation prompts")
  .option("--wait", "Wait for long-running operations where supported")
  .option("--timeout <seconds>", "Timeout for wait/watch commands")
  .option("--verbose", "Verbose output")
  .option("--debug-http", "Print HTTP requests");

registerCommands(program);

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "commander.helpDisplayed" || code === "commander.version") {
      process.exit(0);
    }
  }

  if (error instanceof McpstackHttpError) {
    printError(error.message);
    if (program.opts().debugHttp && error.body !== undefined) {
      console.error(JSON.stringify(error.body, null, 2));
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    printError(error.message);
    process.exit(1);
  }

  printError(String(error));
  process.exit(1);
}
