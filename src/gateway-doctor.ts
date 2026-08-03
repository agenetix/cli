import { fetch as undiciFetch } from "undici";

export type GatewayDoctorClient = "chatgpt-web" | "claude-web";
export type GatewayDoctorStatus = "pass" | "warn" | "fail" | "skip";

export interface GatewayDoctorCheck {
  id: string;
  check: string;
  status: GatewayDoctorStatus;
  detail: string;
}

export interface GatewayDoctorResult {
  ok: boolean;
  client: GatewayDoctorClient;
  mcpUrl: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl?: string;
  toolCount?: number;
  checks: GatewayDoctorCheck[];
}

export interface GatewayDoctorOptions {
  apiBaseUrl?: string;
  publicId?: string;
  url?: string;
  client: GatewayDoctorClient;
  bearer?: string;
}

interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchResponseLike>;

interface HttpResult {
  url: string;
  status: number;
  ok: boolean;
  headers: FetchResponseLike["headers"];
  body: unknown;
  text: string;
}

const CLAUDE_WEB_TOOL_LIMIT = 20;

export const gatewayDoctorColumns = [
  { header: "Status", value: (item: GatewayDoctorCheck) => item.status.toUpperCase() },
  { header: "Check", value: (item: GatewayDoctorCheck) => item.check },
  { header: "Detail", value: (item: GatewayDoctorCheck) => item.detail },
];

export async function runGatewayDoctor(
  options: GatewayDoctorOptions,
  fetchImpl: FetchLike = undiciFetch as unknown as FetchLike,
): Promise<GatewayDoctorResult> {
  const target = resolveDoctorTarget(options);
  const checks: GatewayDoctorCheck[] = [];
  const add = (id: string, check: string, status: GatewayDoctorStatus, detail: string) => {
    checks.push({ id, check, status, detail });
  };

  validatePublicHttps(target.mcpUrl, options.client, add);

  const protectedResource = await getJson(fetchImpl, target.protectedResourceMetadataUrl);
  if (!protectedResource.ok || !isObject(protectedResource.body)) {
    add("protected_resource_metadata", "Protected resource metadata", "fail", `Expected JSON 200 from ${target.protectedResourceMetadataUrl}; got HTTP ${protectedResource.status}.`);
    return buildResult(options, target, checks);
  }
  add("protected_resource_metadata", "Protected resource metadata", "pass", `Loaded ${target.protectedResourceMetadataUrl}.`);

  const resource = getString(protectedResource.body, "resource");
  if (!resource) {
    add("resource", "Resource identifier", "fail", "Protected resource metadata is missing resource.");
  } else if (resource !== target.mcpUrl) {
    add("resource", "Resource identifier", "fail", `Metadata resource ${resource} does not match MCP URL ${target.mcpUrl}.`);
  } else {
    add("resource", "Resource identifier", "pass", "Resource exactly matches MCP URL.");
  }

  const authServer = getFirstString(protectedResource.body, "authorization_servers");
  if (!authServer) {
    add("authorization_server", "Authorization server", "fail", "Protected resource metadata is missing authorization_servers[0].");
    return buildResult(options, target, checks);
  }
  add("authorization_server", "Authorization server", "pass", authServer);

  const authorizationServerMetadataUrl = `${trimTrailingSlash(authServer)}/.well-known/oauth-authorization-server`;
  target.authorizationServerMetadataUrl = authorizationServerMetadataUrl;
  const authorizationServer = await getJson(fetchImpl, authorizationServerMetadataUrl);
  if (!authorizationServer.ok || !isObject(authorizationServer.body)) {
    add("authorization_server_metadata", "Authorization server metadata", "fail", `Expected JSON 200 from ${authorizationServerMetadataUrl}; got HTTP ${authorizationServer.status}.`);
  } else {
    add("authorization_server_metadata", "Authorization server metadata", "pass", `Loaded ${authorizationServerMetadataUrl}.`);
    validateAuthorizationServerMetadata(authorizationServer.body, authServer, add);
  }

  const unauthenticatedMcp = await postToolsList(fetchImpl, target.mcpUrl);
  let unauthenticatedToolsBody: unknown | undefined;
  if (unauthenticatedMcp.status === 401) {
    validateAuthenticateChallenge(
      unauthenticatedMcp.headers.get("www-authenticate"),
      target.protectedResourceMetadataUrl,
      add,
    );
  } else if (unauthenticatedMcp.ok) {
    add("mcp_unauthenticated", "Unauthenticated MCP", "warn", "MCP tools/list succeeded without bearer auth; verify this is intentional for the target server.");
    unauthenticatedToolsBody = unauthenticatedMcp.body;
  } else {
    add("mcp_unauthenticated", "Unauthenticated MCP", "fail", `Expected 401 challenge or authless tools/list; got HTTP ${unauthenticatedMcp.status}.`);
  }

  if (options.bearer) {
    const authenticatedMcp = await postToolsList(fetchImpl, target.mcpUrl, options.bearer);
    if (!authenticatedMcp.ok) {
      add("mcp_authenticated_tools", "Authenticated tools/list", "fail", `Expected authenticated tools/list to succeed; got HTTP ${authenticatedMcp.status}.`);
    } else {
      add("mcp_authenticated_tools", "Authenticated tools/list", "pass", "tools/list succeeded with bearer token.");
      validateToolList(authenticatedMcp.body, options.client, add);
    }
  } else if (unauthenticatedToolsBody !== undefined) {
    validateToolList(unauthenticatedToolsBody, options.client, add);
  } else {
    add("mcp_authenticated_tools", "Authenticated tools/list", "skip", "Pass --bearer to validate authenticated tool listing and Claude web tool count.");
  }

  return buildResult(options, target, checks);
}

function resolveDoctorTarget(options: GatewayDoctorOptions): {
  mcpUrl: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl?: string;
} {
  if (options.url) {
    const mcpUrl = normalizeMcpUrl(options.url);
    const url = new URL(mcpUrl);
    return {
      mcpUrl,
      protectedResourceMetadataUrl: `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`,
    };
  }

  if (!options.publicId) {
    throw new Error("Provide either <publicId> or --url for gateway-public doctor.");
  }

  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl || "https://mcpstack.com");
  const base = `${apiBaseUrl}/api/v1/gateway/${encodeURIComponent(options.publicId)}`;
  return {
    mcpUrl: `${base}/mcp`,
    protectedResourceMetadataUrl: `${base}/.well-known/oauth-protected-resource`,
  };
}

function normalizeMcpUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  return url.pathname.endsWith("/mcp")
    ? url.toString()
    : new URL(`${trimTrailingSlash(url.toString())}/mcp`).toString();
}

function validatePublicHttps(
  mcpUrl: string,
  client: GatewayDoctorClient,
  add: (id: string, check: string, status: GatewayDoctorStatus, detail: string) => void,
): void {
  const url = new URL(mcpUrl);
  if (url.protocol === "https:") {
    add("public_https", "Public HTTPS URL", "pass", mcpUrl);
    return;
  }

  if (isLocalhost(url.hostname)) {
    add("public_https", "Public HTTPS URL", "warn", `${client} requires public HTTPS; localhost is only acceptable for local debugging.`);
    return;
  }

  add("public_https", "Public HTTPS URL", "fail", `${client} requires public HTTPS; got ${mcpUrl}.`);
}

function validateAuthorizationServerMetadata(
  metadata: Record<string, unknown>,
  expectedIssuer: string,
  add: (id: string, check: string, status: GatewayDoctorStatus, detail: string) => void,
): void {
  const issuer = getString(metadata, "issuer");
  if (issuer === expectedIssuer) {
    add("issuer", "Issuer", "pass", "Issuer matches protected resource authorization server.");
  } else {
    add("issuer", "Issuer", "fail", `Expected issuer ${expectedIssuer}; got ${issuer || "missing"}.`);
  }

  addRequiredUrl(metadata, "authorization_endpoint", "Authorization endpoint", add);
  addRequiredUrl(metadata, "token_endpoint", "Token endpoint", add);
  addRequiredUrl(metadata, "registration_endpoint", "Dynamic client registration", add);

  const pkceMethods = getStringArray(metadata, "code_challenge_methods_supported");
  if (pkceMethods.includes("S256")) {
    add("pkce_s256", "PKCE S256", "pass", "Authorization server advertises S256.");
  } else {
    add("pkce_s256", "PKCE S256", "fail", "Authorization server does not advertise S256.");
  }
}

function validateAuthenticateChallenge(
  challenge: string | null,
  expectedMetadataUrl: string,
  add: (id: string, check: string, status: GatewayDoctorStatus, detail: string) => void,
): void {
  if (!challenge) {
    add("www_authenticate", "401 WWW-Authenticate", "fail", "401 response is missing WWW-Authenticate.");
    return;
  }

  if (!/^Bearer\b/i.test(challenge)) {
    add("www_authenticate", "401 WWW-Authenticate", "fail", `Expected Bearer challenge; got ${challenge}.`);
    return;
  }

  const metadataUrl = extractChallengeParameter(challenge, "resource_metadata");
  if (!metadataUrl) {
    add("www_authenticate", "401 WWW-Authenticate", "fail", `Bearer challenge is missing resource_metadata: ${challenge}.`);
    return;
  }

  if (metadataUrl !== expectedMetadataUrl) {
    add("www_authenticate", "401 WWW-Authenticate", "fail", `resource_metadata ${metadataUrl} does not match ${expectedMetadataUrl}.`);
    return;
  }

  add("www_authenticate", "401 WWW-Authenticate", "pass", "Bearer challenge points to protected resource metadata.");
}

function validateToolList(
  body: unknown,
  client: GatewayDoctorClient,
  add: (id: string, check: string, status: GatewayDoctorStatus, detail: string) => void,
): void {
  const tools = extractTools(body);
  if (!tools) {
    add("tool_list_shape", "Tool list shape", "fail", "tools/list response did not include result.tools[].");
    return;
  }

  add("tool_list_shape", "Tool list shape", "pass", `${tools.length} tools returned.`);
  if (client === "claude-web" && tools.length > CLAUDE_WEB_TOOL_LIMIT) {
    add("claude_tool_count", "Claude web tool count", "fail", `Claude web limit is ${CLAUDE_WEB_TOOL_LIMIT}; server returned ${tools.length}.`);
  } else if (client === "claude-web") {
    add("claude_tool_count", "Claude web tool count", "pass", `${tools.length}/${CLAUDE_WEB_TOOL_LIMIT} tools.`);
  }
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<HttpResult> {
  return readHttpResult(url, await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } }));
}

async function postToolsList(fetchImpl: FetchLike, url: string, bearer?: string): Promise<HttpResult> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-11-25",
    "Mcp-Method": "tools/list",
  };
  if (bearer) {
    headers.Authorization = bearer.startsWith("Bearer ") ? bearer : `Bearer ${bearer}`;
  }

  return readHttpResult(url, await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "mcpstack-doctor-tools-list", method: "tools/list", params: {} }),
  }));
}

async function readHttpResult(url: string, response: FetchResponseLike): Promise<HttpResult> {
  const text = await response.text();
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    body: parseMaybeJson(text),
  };
}

function buildResult(
  options: GatewayDoctorOptions,
  target: { mcpUrl: string; protectedResourceMetadataUrl: string; authorizationServerMetadataUrl?: string },
  checks: GatewayDoctorCheck[],
): GatewayDoctorResult {
  const failed = checks.some((check) => check.status === "fail");
  const toolCount = checks.find((check) => check.id === "tool_list_shape")?.detail.match(/^(\d+) tools/)?.[1];
  return {
    ok: !failed,
    client: options.client,
    mcpUrl: target.mcpUrl,
    protectedResourceMetadataUrl: target.protectedResourceMetadataUrl,
    authorizationServerMetadataUrl: target.authorizationServerMetadataUrl,
    toolCount: toolCount ? Number(toolCount) : undefined,
    checks,
  };
}

function addRequiredUrl(
  metadata: Record<string, unknown>,
  key: string,
  label: string,
  add: (id: string, check: string, status: GatewayDoctorStatus, detail: string) => void,
): void {
  const value = getString(metadata, key);
  if (!value) {
    add(key, label, "fail", `${key} is missing.`);
    return;
  }

  try {
    new URL(value);
    add(key, label, "pass", value);
  } catch {
    add(key, label, "fail", `${key} is not a valid URL: ${value}.`);
  }
}

function extractChallengeParameter(challenge: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = new RegExp(`${escapedKey}="([^"]+)"`, "i").exec(challenge);
  if (quoted) {
    return quoted[1];
  }

  return new RegExp(`${escapedKey}=([^,\\s]+)`, "i").exec(challenge)?.[1];
}

function extractTools(body: unknown): unknown[] | undefined {
  if (!isObject(body) || !isObject(body.result) || !Array.isArray(body.result.tools)) {
    return undefined;
  }

  return body.result.tools;
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function getFirstString(value: Record<string, unknown>, key: string): string | undefined {
  const array = value[key];
  return Array.isArray(array) && typeof array[0] === "string" ? array[0] : undefined;
}

function getStringArray(value: Record<string, unknown>, key: string): string[] {
  const array = value[key];
  return Array.isArray(array) ? array.filter((item): item is string => typeof item === "string") : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
