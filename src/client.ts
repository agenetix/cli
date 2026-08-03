import { fetch } from "undici";
import { DEFAULT_API_URL } from "./constants.js";
import { getSecret, loadConfig, saveConfig, setSecret } from "./config.js";
import { pickDefaultOrganization, type OrganizationSummary } from "./organization.js";
import type { ConfigFile, GlobalOptions, RequestOptions, TokenResponse } from "./types.js";

export class McpstackHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export class McpstackClient {
  readonly apiUrl: string;
  readonly config?: ConfigFile;

  private constructor(
    private readonly options: GlobalOptions,
    apiUrl: string,
    config?: ConfigFile,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.config = config;
  }

  static async create(options: GlobalOptions): Promise<McpstackClient> {
    const config = await loadConfig();
    const apiUrl = options.apiUrl
      ?? process.env.MCPSTACK_API_URL
      ?? config?.apiUrl
      ?? DEFAULT_API_URL;
    return new McpstackClient(options, apiUrl, config);
  }

  async request<T = unknown>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, requestOptions.query);
    const headers: Record<string, string> = {
      Accept: requestOptions.expectText ? "text/plain" : "application/json",
      ...requestOptions.headers,
    };

    let body: string | URLSearchParams | Uint8Array | Buffer | undefined;
    if (requestOptions.rawBody) {
      body = requestOptions.rawBody;
    } else if (requestOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(requestOptions.body);
    }

    if (!requestOptions.noAuth) {
      const authHeader = await this.resolveAuthHeader();
      if (authHeader) {
        headers.Authorization = authHeader;
      }
    }

    if (this.options.debugHttp) {
      console.error(`${requestOptions.method ?? "GET"} ${url}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: requestOptions.method ?? "GET",
        headers,
        body,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reach MCP Stack API at ${this.apiUrl} (${detail}). `
        + "Check the URL, network, and VPN, or pass --api-url / set MCPSTACK_API_URL.",
      );
    }

    const responseBody = requestOptions.expectText
      ? await response.text()
      : await readJsonOrText(response);

    if (!response.ok) {
      throw new McpstackHttpError(
        formatHttpError(response.status, responseBody),
        response.status,
        responseBody,
      );
    }

    return responseBody as T;
  }

  async stream(path: string, onChunk: (text: string) => void, requestOptions: RequestOptions = {}): Promise<void> {
    const url = this.buildUrl(path, requestOptions.query);
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...requestOptions.headers,
    };

    if (!requestOptions.noAuth) {
      const authHeader = await this.resolveAuthHeader();
      if (authHeader) {
        headers.Authorization = authHeader;
      }
    }

    const response = await fetch(url, { method: requestOptions.method ?? "GET", headers });
    if (!response.ok) {
      throw new McpstackHttpError(
        formatHttpError(response.status, await readJsonOrText(response)),
        response.status,
        undefined,
      );
    }

    if (!response.body) {
      return;
    }

    for await (const chunk of response.body) {
      onChunk(Buffer.from(chunk).toString("utf8"));
    }
  }

  async getDefaultOrganization(): Promise<OrganizationSummary> {
    const orgs = await this.request<unknown[]>("/api/v1/organizations");
    const organization = pickDefaultOrganization(orgs);
    if (!organization) {
      throw new Error("No organizations found for the current account.");
    }

    return organization;
  }

  async syncDefaultOrganization(): Promise<OrganizationSummary> {
    const organization = await this.getDefaultOrganization();
    await this.cacheOrganization(organization);
    return organization;
  }

  async resolveOrgId(explicitOrg?: string): Promise<string> {
    const override = explicitOrg
      ?? this.options.org
      ?? process.env.MCPSTACK_ORG_ID;
    if (override) {
      return override;
    }

    const organization = await this.syncDefaultOrganization();
    return organization.id;
  }

  private async cacheOrganization(organization: OrganizationSummary): Promise<void> {
    if (this.config?.orgId === organization.id && this.config.orgName === organization.name) {
      return;
    }

    if (!this.config) {
      await saveConfig({
        apiUrl: this.apiUrl,
        orgId: organization.id,
        orgName: organization.name,
      });
      return;
    }

    await saveConfig({
      ...this.config,
      orgId: organization.id,
      orgName: organization.name,
    });
  }

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.apiUrl}${normalizedPath}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async resolveAuthHeader(): Promise<string | undefined> {
    const accessToken = process.env.MCPSTACK_ACCESS_TOKEN;
    if (accessToken) {
      return `Bearer ${accessToken}`;
    }

    const apiKey = process.env.MCPSTACK_API_KEY;
    if (apiKey) {
      return `Bearer ${apiKey}`;
    }

    if (!this.config?.auth) {
      return undefined;
    }

    if (this.config.auth.type === "api_key") {
      const storedApiKey = await getSecret("apiKey");
      return storedApiKey ? `Bearer ${storedApiKey}` : undefined;
    }

    const refreshed = await this.refreshAccessTokenIfNeeded();
    const token = refreshed ?? await getSecret("accessToken");
    return token ? `Bearer ${token}` : undefined;
  }

  private async refreshAccessTokenIfNeeded(): Promise<string | undefined> {
    if (!this.config?.auth || this.config.auth.type !== "oauth") {
      return undefined;
    }

    const expiresAt = this.config.auth.expiresAt ? Date.parse(this.config.auth.expiresAt) : 0;
    if (expiresAt > Date.now() + 60_000) {
      return undefined;
    }

    const refreshToken = await getSecret("refreshToken");
    if (!refreshToken) {
      return undefined;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.auth.clientId,
    });

    const response = await fetch(this.config.auth.tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      return undefined;
    }

    const token = await response.json() as TokenResponse;
    await setSecret("accessToken", token.access_token);
    if (token.refresh_token) {
      await setSecret("refreshToken", token.refresh_token);
    }

    const expiresAtIso = new Date(Date.now() + (token.expires_in ?? 600) * 1000).toISOString();
    await saveConfig({
      ...this.config,
      auth: {
        ...this.config.auth,
        expiresAt: expiresAtIso,
      },
    });

    return token.access_token;
  }
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatHttpError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.error_description ?? record.error ?? record.message;
    if (message) {
      return `HTTP ${status}: ${String(message)}`;
    }
  }

  return typeof body === "string" && body
    ? `HTTP ${status}: ${body}`
    : `HTTP ${status}`;
}
