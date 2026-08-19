import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_URL } from "./constants.js";

const legacyConfig = {
  apiUrl: "https://api.mcpstack.com",
  orgId: "org_wAZAg6DNAD58",
  orgName: "User One's Organization",
  auth: {
    type: "oauth",
    clientId: "mcpstack-cli",
    tokenEndpoint: "https://api.mcpstack.com/sqlos/auth/token",
    scope: "openid profile email offline_access",
    resource: "https://api.mcpstack.com",
    expiresAt: "2026-06-02T02:14:37.949Z",
  },
};

async function loadConfigModule(home: string) {
  process.env.HOME = home;
  vi.resetModules();
  return import("./config.js");
}

describe("loadConfig legacy migration", () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), "agenetix-cli-config-"));
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    vi.resetModules();
  });

  async function writeConfig(value: unknown): Promise<string> {
    const dir = join(home, ".config", "mcpstack");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify(value, null, 2));
    return path;
  }

  it("repoints legacy mcpstack.com config at the current API and drops the dead login", async () => {
    const path = await writeConfig(legacyConfig);
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    expect(config).toEqual({
      apiUrl: DEFAULT_API_URL,
      orgId: "org_wAZAg6DNAD58",
      orgName: "User One's Organization",
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("auth login"));

    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.apiUrl).toBe(DEFAULT_API_URL);
    expect(persisted.auth).toBeUndefined();

    // Second load: already migrated, no further warning.
    errorSpy.mockClear();
    const again = await loadConfig();
    expect(again?.apiUrl).toBe(DEFAULT_API_URL);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("migrates subdomains of mcpstack.com", async () => {
    await writeConfig({ ...legacyConfig, apiUrl: "https://staging.api.mcpstack.com" });
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    expect(config?.apiUrl).toBe(DEFAULT_API_URL);
    errorSpy.mockRestore();
  });

  it("leaves non-legacy config untouched", async () => {
    const current = { apiUrl: "https://api.agenetix.com", orgId: "org_x" };
    const path = await writeConfig(current);
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    expect(config?.apiUrl).toBe("https://api.agenetix.com");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(current);
    errorSpy.mockRestore();
  });

  it("does not treat lookalike hosts as legacy", async () => {
    await writeConfig({ apiUrl: "https://notmcpstack.com" });
    const { loadConfig } = await loadConfigModule(home);

    const config = await loadConfig();

    expect(config?.apiUrl).toBe("https://notmcpstack.com");
  });
});
