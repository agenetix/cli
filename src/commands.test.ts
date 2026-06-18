import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { inferOpenApiServerName, registerCommands, slugifyServerName } from "./commands.js";

function commandNames(command: Command): string[] {
  return command.commands.map((child) => child.name());
}

describe("mcpstack command surface", () => {
  it("registers the primary command groups", () => {
    const program = new Command();
    registerCommands(program);

    const names = commandNames(program);
    expect(names).toEqual(expect.arrayContaining([
      "auth",
      "org",
      "members",
      "api-keys",
      "apps",
      "models",
      "servers",
      "tools",
      "logs",
      "smoke",
      "operations",
      "gateways",
      "gateway-public",
      "agents",
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "deploy",
      "undeploy",
      "deployments",
      "deployment-config",
      "runtime",
      "routing",
      "host",
      "doctor",
    ]));
    expect(names).not.toContain("profiles");
  });

  it("keeps destructive commands behind confirmation flags", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    const deleteCommand = servers?.commands.find((command) => command.name() === "delete");
    const customDomain = servers?.commands.find((command) => command.name() === "custom-domain");
    const customDomainDelete = customDomain?.commands.find((command) => command.name() === "delete");

    expect(deleteCommand?.options.some((option) => option.long === "--yes")).toBe(true);
    expect(customDomainDelete?.options.some((option) => option.long === "--yes")).toBe(true);
  });

  it("registers hosted server custom domain commands", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    const customDomain = servers?.commands.find((command) => command.name() === "custom-domain");
    const validateCommand = customDomain?.commands.find((command) => command.name() === "validate");

    expect(customDomain).toBeDefined();
    expect(commandNames(customDomain!)).toEqual([
      "get",
      "validate",
      "confirm-ownership",
      "finalize",
      "delete",
    ]);
    expect(validateCommand?.options.some((option) => option.long === "--hostname")).toBe(true);
    expect(validateCommand?.options.some((option) => option.long === "--host")).toBe(true);
    for (const commandName of ["get", "validate", "confirm-ownership", "finalize", "delete"]) {
      const command = customDomain?.commands.find((candidate) => candidate.name() === commandName);
      expect(command?.options.some((option) => option.long === "--environment")).toBe(true);
    }
  });

  it("allows smoke checks to target a hosted environment", () => {
    const program = new Command();
    registerCommands(program);

    const smoke = program.commands.find((command) => command.name() === "smoke");
    const toolsList = smoke?.commands.find((command) => command.name() === "tools-list");
    const call = smoke?.commands.find((command) => command.name() === "call");

    expect(toolsList?.options.some((option) => option.long === "--environment")).toBe(true);
    expect(call?.options.some((option) => option.long === "--environment")).toBe(true);
  });

  it("keeps the advertised OpenAPI file create path available", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    const createCommand = servers?.commands.find((command) => command.name() === "create");
    const nameOption = createCommand?.options.find((option) => option.long === "--name");
    const openApiFileOption = createCommand?.options.find((option) => option.long === "--openapi-file");
    const runtimeTypeOption = createCommand?.options.find((option) => option.long === "--runtime-type");

    expect(openApiFileOption).toBeDefined();
    expect(runtimeTypeOption).toBeDefined();
    expect(nameOption?.mandatory).toBe(false);
  });

  it("exposes basic MCP server lifecycle commands", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    expect(commandNames(servers!)).toEqual(expect.arrayContaining([
      "create",
      "get",
      "update",
      "delete",
      "logs",
    ]));

    const updateCommand = servers?.commands.find((command) => command.name() === "update");
    expect(updateCommand?.options.some((option) => option.long === "--openapi-file")).toBe(true);
    expect(updateCommand?.options.some((option) => option.long === "--openapi-url")).toBe(true);
  });

  it("exposes Agenetix app declaration commands", () => {
    const program = new Command();
    registerCommands(program);

    const apps = program.commands.find((command) => command.name() === "apps");
    expect(commandNames(apps!)).toEqual(expect.arrayContaining([
      "list",
      "get",
      "create",
      "update",
      "workloads",
      "environments",
      "database",
      "files",
      "deployments",
      "deployment",
      "deploy",
      "logs",
    ]));

    const create = apps?.commands.find((command) => command.name() === "create");
    expect(create?.options.some((option) => option.long === "--workload-kind")).toBe(true);
    expect(create?.options.some((option) => option.long === "--database")).toBe(true);
    expect(create?.options.some((option) => option.long === "--file-store")).toBe(true);

    const workloads = apps?.commands.find((command) => command.name() === "workloads");
    expect(commandNames(workloads!)).toEqual(["add"]);
    const workloadAdd = workloads?.commands.find((command) => command.name() === "add");
    expect(workloadAdd?.options.some((option) => option.long === "--kind")).toBe(true);

    const deployments = apps?.commands.find((command) => command.name() === "deployments");
    expect(deployments?.description()).toBe("List app deployments");

    const deploy = apps?.commands.find((command) => command.name() === "deploy");
    expect(deploy?.options.some((option) => option.long === "--workload")).toBe(true);
    expect(deploy?.options.some((option) => option.long === "--repo")).toBe(true);
    expect(deploy?.options.some((option) => option.long === "--environment")).toBe(true);

    const logs = apps?.commands.find((command) => command.name() === "logs");
    expect(logs?.options.some((option) => option.long === "--tail")).toBe(true);
  });

  it("exposes Agenetix platform model commands", () => {
    const program = new Command();
    registerCommands(program);

    const models = program.commands.find((command) => command.name() === "models");
    expect(models?.description()).toBe("List Agenetix platform models");
    expect(commandNames(models!)).toEqual(["list"]);
  });

  it("does not expose legacy OpenAPI subcommands", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    expect(servers?.commands.some((command) => command.name() === "openapi")).toBe(false);
  });

  it("keeps server config inspection read-only in the CLI", () => {
    const program = new Command();
    registerCommands(program);

    const servers = program.commands.find((command) => command.name() === "servers");
    const authConfig = servers?.commands.find((command) => command.name() === "auth-config");
    const endpoints = servers?.commands.find((command) => command.name() === "endpoints");

    expect(commandNames(authConfig!)).toEqual(["get"]);
    expect(commandNames(endpoints!)).toEqual(["get"]);
  });

  it("exposes hosted server operations and custom-domain commands", () => {
    const program = new Command();
    registerCommands(program);

    const operations = program.commands.find((command) => command.name() === "operations");
    expect(commandNames(operations!)).toEqual(expect.arrayContaining(["list", "get"]));

    const servers = program.commands.find((command) => command.name() === "servers");
    const customDomain = servers?.commands.find((command) => command.name() === "custom-domain");
    expect(commandNames(customDomain!)).toEqual(expect.arrayContaining([
      "validate",
      "confirm-ownership",
      "finalize",
      "get",
      "delete",
    ]));
  });

  it("lets smoke tests target an environment", () => {
    const program = new Command();
    registerCommands(program);

    const smoke = program.commands.find((command) => command.name() === "smoke");
    const toolsList = smoke?.commands.find((command) => command.name() === "tools-list");
    const call = smoke?.commands.find((command) => command.name() === "call");

    expect(toolsList?.options.some((option) => option.long === "--environment")).toBe(true);
    expect(call?.options.some((option) => option.long === "--environment")).toBe(true);
  });

  it("exposes embedded user budget commands", () => {
    const program = new Command();
    registerCommands(program);

    const agents = program.commands.find((command) => command.name() === "agents");
    const budget = agents?.commands.find((command) => command.name() === "budget");
    const defaults = budget?.commands.find((command) => command.name() === "defaults");
    const set = budget?.commands.find((command) => command.name() === "set");
    const get = budget?.commands.find((command) => command.name() === "get");
    const deleteCommand = budget?.commands.find((command) => command.name() === "delete");

    expect(budget?.description()).toBe("Manage embedded user budgets");
    expect(commandNames(budget!)).toEqual(expect.arrayContaining([
      "defaults",
      "set",
      "get",
      "delete",
    ]));
    expect(defaults?.description()).toBe("Set the agent pool and default user budget policy");
    expect(defaults?.options.some((option) => option.long === "--monthly-usd")).toBe(true);
    expect(defaults?.options.some((option) => option.long === "--default-user-usd")).toBe(true);
    expect(defaults?.options.some((option) => option.long === "--anonymous-usd")).toBe(true);
    expect(set?.description()).toBe("Set one external user's monthly budget");
    expect(set?.options.some((option) => option.long === "--user")).toBe(true);
    expect(set?.options.some((option) => option.long === "--monthly-usd")).toBe(true);
    expect(get?.description()).toBe("Show one external user's assigned and effective budget");
    expect(get?.options.some((option) => option.long === "--user")).toBe(true);
    expect(deleteCommand?.description()).toBe("Remove a user's explicit budget so the agent default applies");
    expect(deleteCommand?.options.some((option) => option.long === "--user")).toBe(true);
    expect(deleteCommand?.options.some((option) => option.long === "--yes")).toBe(true);
  });

  it("derives server identity from an OpenAPI file", () => {
    const spec = `
openapi: 3.0.3
info:
  title: Private Billing API
  version: 2026.05.29
paths: {}
`;

    expect(inferOpenApiServerName(spec, "./openapi.yaml")).toBe("Private Billing API");
    expect(inferOpenApiServerName("not: an openapi document", "./private-orders-api.yaml")).toBe("Private Orders API");
    expect(slugifyServerName("Private Billing API")).toBe("private-billing-api");
  });

  it("registers Gateway public doctor client readiness command", () => {
    const program = new Command();
    registerCommands(program);

    const gatewayPublic = program.commands.find((command) => command.name() === "gateway-public");
    const doctor = gatewayPublic?.commands.find((command) => command.name() === "doctor");

    expect(doctor).toBeDefined();
    expect(doctor?.options.some((option) => option.long === "--client")).toBe(true);
    expect(doctor?.options.some((option) => option.long === "--url")).toBe(true);
    expect(doctor?.options.some((option) => option.long === "--bearer")).toBe(true);
    expect(doctor?.options.some((option) => option.long === "--json")).toBe(true);
    expect(doctor?.options.some((option) => option.long === "--output")).toBe(true);
  });
});
