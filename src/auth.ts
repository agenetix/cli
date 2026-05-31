import { clearConfig, loadConfig, saveConfig, setSecret } from "./config.js";
import { DEFAULT_API_URL } from "./constants.js";
import { McpstackClient } from "./client.js";
import { tryOpenBrowser } from "./open-browser.js";
import { printInfo, printSuccess, printWarning } from "./output.js";
import { z } from "zod";
import type {
  CliConfigResponse,
  DeviceAuthorizationResponse,
  GlobalOptions,
  TokenResponse,
} from "./types.js";

const cliConfigSchema = z.object({
  apiUrl: z.string().url(),
  authIssuer: z.string().url(),
  clientId: z.string().min(1),
  deviceAuthorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  resource: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  supportedAuthModes: z.array(z.string()).default([]),
});

const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});

export async function login(options: GlobalOptions): Promise<void> {
  const client = await McpstackClient.create(options);
  const config = cliConfigSchema.parse(
    await client.request<CliConfigResponse>("/api/v1/cli/config", { noAuth: true }),
  );
  const scope = config.scopes.join(" ");

  const device = await startDeviceAuthorization(config, scope);
  const verificationUrl = device.verification_uri_complete ?? device.verification_uri;
  const noBrowser = options.noBrowser || (options as GlobalOptions & { browser?: boolean }).browser === false;
  const openedBrowser = !noBrowser && await tryOpenBrowser(verificationUrl);

  if (openedBrowser) {
    printInfo("Opened your browser to sign in. Complete approval there, then return here.");
  } else {
    printInfo("Open this URL to sign in:");
    console.log(verificationUrl);
  }

  console.log("");
  console.log(`Device code: ${device.user_code}`);

  const token = await pollDeviceToken(config, device, scope);
  const expiresAt = new Date(Date.now() + (token.expires_in ?? 600) * 1000).toISOString();

  await saveConfig({
    apiUrl: config.apiUrl,
    auth: {
      type: "oauth",
      clientId: config.clientId,
      tokenEndpoint: config.tokenEndpoint,
      scope,
      resource: config.resource,
      expiresAt,
    },
  });
  await setSecret("accessToken", token.access_token);
  if (token.refresh_token) {
    await setSecret("refreshToken", token.refresh_token);
  }

  const authedClient = await McpstackClient.create(options);
  const organization = await authedClient.syncDefaultOrganization();
  printSuccess(`Signed in. Organization: ${organization.name ?? organization.id}.`);
}

export async function logout(_options: GlobalOptions): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    printWarning("No active login found.");
    return;
  }

  await clearConfig();
  printSuccess("Signed out.");
}

export async function status(options: GlobalOptions): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    printWarning("No active login. Run `mcpstack auth login` or `mcpstack auth service-account login`.");
    return;
  }

  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Auth: ${config.auth?.type ?? "(none)"}`);

  try {
    const client = await McpstackClient.create(options);
    const organization = await client.syncDefaultOrganization();
    console.log(`Organization: ${organization.name ?? organization.id}`);
  } catch (error) {
    const cached = config.orgId
      ? (config.orgName ? `${config.orgName} (${config.orgId})` : config.orgId)
      : "(unavailable)";
    console.log(`Organization: ${cached}`);
    if (error instanceof Error && config.orgId) {
      printWarning(`Could not refresh organization: ${error.message}`);
    } else if (error instanceof Error) {
      printWarning(error.message);
    }
  }

  if (config.auth?.type === "oauth") {
    console.log(`Expires: ${config.auth.expiresAt ?? "(unknown)"}`);
  }
}

export async function serviceAccountLogin(options: GlobalOptions & { key?: string }): Promise<void> {
  const apiKey = options.key ?? process.env.MCPSTACK_API_KEY;
  if (!apiKey) {
    throw new Error("Provide --key <api-key> or set MCPSTACK_API_KEY.");
  }

  const apiUrl = options.apiUrl ?? process.env.MCPSTACK_API_URL ?? DEFAULT_API_URL;
  const clientId = apiKey.slice(0, apiKey.lastIndexOf("_"));

  await saveConfig({
    apiUrl,
    auth: {
      type: "api_key",
      clientId: clientId || undefined,
    },
  });
  await setSecret("apiKey", apiKey);

  const client = await McpstackClient.create(options);
  const organization = await client.syncDefaultOrganization();
  printSuccess(`Stored service-account login. Organization: ${organization.name ?? organization.id}.`);
}

export async function serviceAccountLogout(options: GlobalOptions): Promise<void> {
  await logout(options);
}

export async function whoami(options: GlobalOptions): Promise<unknown> {
  const client = await McpstackClient.create(options);
  return client.request("/api/v1/cli/whoami");
}

async function startDeviceAuthorization(
  config: CliConfigResponse,
  scope: string,
): Promise<DeviceAuthorizationResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope,
    resource: config.resource,
  });

  const response = await fetch(config.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      response.status === 404
        ? "The server does not expose device authorization yet. Update the MCP Stack API, then retry."
        : `Device authorization failed: ${text || response.statusText}`,
    );
  }

  return deviceAuthorizationSchema.parse(await response.json()) as DeviceAuthorizationResponse;
}

async function pollDeviceToken(
  config: CliConfigResponse,
  device: DeviceAuthorizationResponse,
  scope: string,
): Promise<TokenResponse> {
  const startedAt = Date.now();
  let intervalMs = Math.max(device.interval ?? 5, 1) * 1000;

  while (Date.now() - startedAt < device.expires_in * 1000) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: config.clientId,
      scope,
      resource: config.resource,
    });

    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) {
      return tokenResponseSchema.parse(payload) as TokenResponse;
    }

    const error = String(payload.error ?? "");
    if (error === "authorization_pending") {
      continue;
    }

    if (error === "slow_down") {
      intervalMs += 5_000;
      continue;
    }

    if (error === "access_denied") {
      throw new Error("Device login was denied.");
    }

    if (error === "expired_token") {
      throw new Error("Device login expired. Run `mcpstack auth login` again.");
    }

    throw new Error(`Device token polling failed: ${payload.error_description ?? error ?? response.statusText}`);
  }

  throw new Error("Device login expired. Run `mcpstack auth login` again.");
}
