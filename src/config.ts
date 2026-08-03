import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConfigFile } from "./types.js";

const configPath = join(homedir(), ".config", "mcpstack", "config.json");
const fallbackSecretPath = join(homedir(), ".config", "mcpstack", "secrets.json");
const secretService = "mcpstack";
const secretAccountPrefix = "current";

type SecretMap = Record<string, string>;
type KeytarModule = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytarPromise: Promise<KeytarModule | null> | undefined;

export async function loadConfig(): Promise<ConfigFile | undefined> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ConfigFile>;
    if (!parsed.apiUrl) {
      return undefined;
    }

    return {
      apiUrl: parsed.apiUrl,
      orgId: parsed.orgId,
      orgName: parsed.orgName,
      auth: parsed.auth,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function saveConfig(config: ConfigFile): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function clearConfig(): Promise<void> {
  await deleteSecret("accessToken");
  await deleteSecret("refreshToken");
  await deleteSecret("apiKey");
  await rm(configPath, { force: true });
}

export async function setActiveOrganization(orgId: string): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No active login found. Run `mcpstack auth login` or `mcpstack auth service-account login` first.");
  }

  await saveConfig({ ...config, orgId });
}

export async function getSecret(key: string): Promise<string | undefined> {
  const account = getSecretAccount(key);
  const keytar = await loadKeytar();
  if (keytar) {
    const value = await keytar.getPassword(secretService, account);
    if (value) {
      return value;
    }
  }

  const secrets = await loadFallbackSecrets();
  return secrets[account];
}

export async function setSecret(key: string, value: string): Promise<void> {
  const account = getSecretAccount(key);
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(secretService, account, value);
    return;
  }

  const secrets = await loadFallbackSecrets();
  secrets[account] = value;
  await saveFallbackSecrets(secrets);
}

export async function deleteSecret(key: string): Promise<void> {
  const account = getSecretAccount(key);
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.deletePassword(secretService, account);
  }

  const secrets = await loadFallbackSecrets();
  delete secrets[account];
  await saveFallbackSecrets(secrets);
}

export async function removeAllLocalState(): Promise<void> {
  await rm(configPath, { force: true });
  await rm(fallbackSecretPath, { force: true });
}

export async function getConfigPath(): Promise<string> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  try {
    await stat(configPath);
  } catch {
    await writeFile(configPath, "{}\n", { mode: 0o600 });
  }
  return configPath;
}

function getSecretAccount(key: string): string {
  return `${secretAccountPrefix}:${key}`;
}

async function loadKeytar(): Promise<KeytarModule | null> {
  if (isKeychainDisabled()) {
    return null;
  }

  keytarPromise ??= import("keytar")
    .then((module) => module.default as KeytarModule)
    .catch(() => null);
  return keytarPromise;
}

function isKeychainDisabled(): boolean {
  const configured = process.env.MCPSTACK_DISABLE_KEYCHAIN?.trim().toLowerCase();
  return configured === "1" || configured === "true" || configured === "yes";
}

async function loadFallbackSecrets(): Promise<SecretMap> {
  try {
    const raw = await readFile(fallbackSecretPath, "utf8");
    return JSON.parse(raw) as SecretMap;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveFallbackSecrets(secrets: SecretMap): Promise<void> {
  await mkdir(dirname(fallbackSecretPath), { recursive: true, mode: 0o700 });
  await writeFile(fallbackSecretPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}
