import { describe, expect, it } from "vitest";
import { runGatewayDoctor } from "./gateway-doctor.js";

type RouteMap = Record<string, { status: number; body?: unknown; headers?: Record<string, string> }>;

const publicId = "gw_test";
const apiBaseUrl = "https://pr-12-api.preview.mcpstack.com";
const gatewayBase = `${apiBaseUrl}/api/v1/gateway/${publicId}`;
const mcpUrl = `${gatewayBase}/mcp`;
const protectedResourceMetadataUrl = `${gatewayBase}/.well-known/oauth-protected-resource`;
const authorizationServerMetadataUrl = `${gatewayBase}/.well-known/oauth-authorization-server`;

function baseRoutes(toolCount = 2): RouteMap {
  return {
    [`GET ${protectedResourceMetadataUrl}`]: {
      status: 200,
      body: {
        resource: mcpUrl,
        authorization_servers: [gatewayBase],
        scopes_supported: ["todos.read"],
      },
    },
    [`GET ${authorizationServerMetadataUrl}`]: {
      status: 200,
      body: {
        issuer: gatewayBase,
        authorization_endpoint: `${gatewayBase}/authorize`,
        token_endpoint: `${gatewayBase}/token`,
        registration_endpoint: `${gatewayBase}/register`,
        code_challenge_methods_supported: ["S256"],
      },
    },
    [`POST ${mcpUrl} noauth`]: {
      status: 401,
      body: { error: "invalid_request" },
      headers: {
        "www-authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl}"`,
      },
    },
    [`POST ${mcpUrl} auth`]: {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: "mcpstack-doctor-tools-list",
        result: {
          tools: Array.from({ length: toolCount }, (_, index) => ({
            name: `tool_${index}`,
            description: `Tool ${index}`,
            inputSchema: { type: "object", properties: {} },
          })),
        },
      },
    },
  };
}

function fakeFetch(routes: RouteMap) {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    const authSuffix = method === "POST" ? (init?.headers?.Authorization ? " auth" : " noauth") : "";
    const key = `${method} ${url}${authSuffix}`;
    const route = routes[key];
    if (!route) {
      return createResponse(404, { error: "not_found", key });
    }

    return createResponse(route.status, route.body, route.headers);
  };
}

function createResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

describe("gateway public doctor", () => {
  it("passes ChatGPT metadata and authenticated tool-list checks", async () => {
    const result = await runGatewayDoctor(
      { apiBaseUrl, publicId, client: "chatgpt-web", bearer: "token" },
      fakeFetch(baseRoutes())
    );

    expect(result.ok).toBe(true);
    expect(result.mcpUrl).toBe(mcpUrl);
    expect(result.toolCount).toBe(2);
    expect(result.checks.map((check) => check.id)).toContain("www_authenticate");
  });

  it("fails when protected resource metadata resource does not match the MCP URL", async () => {
    const routes = baseRoutes();
    routes[`GET ${protectedResourceMetadataUrl}`] = {
      status: 200,
      body: {
        resource: "https://wrong.example.com/mcp",
        authorization_servers: [gatewayBase],
      },
    };

    const result = await runGatewayDoctor(
      { apiBaseUrl, publicId, client: "chatgpt-web" },
      fakeFetch(routes)
    );

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "resource")?.status).toBe("fail");
  });

  it("fails when a Gateway 401 challenge lacks resource metadata", async () => {
    const routes = baseRoutes();
    routes[`POST ${mcpUrl} noauth`] = {
      status: 401,
      body: { error: "invalid_request" },
      headers: { "www-authenticate": "Bearer" },
    };

    const result = await runGatewayDoctor(
      { apiBaseUrl, publicId, client: "chatgpt-web" },
      fakeFetch(routes)
    );

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === "www_authenticate")?.status).toBe("fail");
  });

  it("fails Claude web readiness when authenticated tools exceed 20", async () => {
    const result = await runGatewayDoctor(
      { apiBaseUrl, publicId, client: "claude-web", bearer: "token" },
      fakeFetch(baseRoutes(21))
    );

    expect(result.ok).toBe(false);
    expect(result.toolCount).toBe(21);
    expect(result.checks.find((check) => check.id === "claude_tool_count")?.status).toBe("fail");
  });
});
