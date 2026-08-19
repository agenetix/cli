import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

  let originalDisableKeychain: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalDisableKeychain = process.env.MCPSTACK_DISABLE_KEYCHAIN;
    process.env.MCPSTACK_DISABLE_KEYCHAIN = "1";
    home = await mkdtemp(join(tmpdir(), "agenetix-cli-config-"));
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalDisableKeychain === undefined) {
      delete process.env.MCPSTACK_DISABLE_KEYCHAIN;
    } else {
      process.env.MCPSTACK_DISABLE_KEYCHAIN = originalDisableKeychain;
    }
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

  it("clears stale OAuth secrets when dropping a legacy login", async () => {
    await writeConfig(legacyConfig);
    const secretsPath = join(home, ".config", "mcpstack", "secrets.json");
    await writeFile(
      secretsPath,
      JSON.stringify({ "current:accessToken": "stale-access", "current:refreshToken": "stale-refresh" }),
    );
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loadConfig();

    const secrets = JSON.parse(await readFile(secretsPath, "utf8"));
    expect(secrets["current:accessToken"]).toBeUndefined();
    expect(secrets["current:refreshToken"]).toBeUndefined();
    errorSpy.mockRestore();
  });

  it("preserves service-account auth and only repoints the API URL", async () => {
    const path = await writeConfig({
      apiUrl: "https://api.mcpstack.com",
      orgId: "org_x",
      auth: { type: "api_key" },
    });
    const secretsPath = join(home, ".config", "mcpstack", "secrets.json");
    await writeFile(secretsPath, JSON.stringify({ "current:apiKey": "mcpstack_sk_live" }));
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    expect(config).toEqual({
      apiUrl: DEFAULT_API_URL,
      orgId: "org_x",
      orgName: undefined,
      auth: { type: "api_key" },
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.not.stringContaining("auth login"));
    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.auth).toEqual({ type: "api_key" });
    const secrets = JSON.parse(await readFile(secretsPath, "utf8"));
    expect(secrets["current:apiKey"]).toBe("mcpstack_sk_live");
    errorSpy.mockRestore();
  });

  it("still migrates in memory when the config file is read-only", async () => {
    const path = await writeConfig(legacyConfig);
    await chmod(path, 0o444);
    const { loadConfig } = await loadConfigModule(home);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    expect(config?.apiUrl).toBe(DEFAULT_API_URL);
    expect(config?.auth).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Could not persist"));

    await chmod(path, 0o644);
    expect(JSON.parse(await readFile(path, "utf8")).apiUrl).toBe("https://api.mcpstack.com");
    errorSpy.mockRestore();
  });

  it("does not treat lookalike hosts as legacy", async () => {
    await writeConfig({ apiUrl: "https://notmcpstack.com" });
    const { loadConfig } = await loadConfigModule(home);

    const config = await loadConfig();

    expect(config?.apiUrl).toBe("https://notmcpstack.com");
  });
});
