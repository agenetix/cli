import { McpstackClient, McpstackHttpError } from "./client.js";
import { tryOpenBrowser } from "./open-browser.js";
import { printData, printInfo, printSuccess, type TableColumn } from "./output.js";
import type { GlobalOptions, OutputFormat } from "./types.js";

type BillingOptions = GlobalOptions & {
  amount?: string;
  calls?: string;
  category?: string;
  cursor?: string;
  nonInteractive?: boolean;
  pageSize?: string;
  plan?: string;
  product?: BillingCheckoutProduct;
  session?: string;
  noBrowser?: boolean;
};

type BillingCheckoutProduct = "hosting" | "ai-credits" | "tool-call-credits";

type CheckoutSession = {
  provider: string;
  sessionId: string;
  url: string;
  expiresAt?: string | null;
  [key: string]: unknown;
};

type CheckoutStatus = {
  product: BillingCheckoutProduct;
  sessionId: string;
  status: string;
  completed: boolean;
  ledgerEntryId?: string | null;
  planKey?: string | null;
};

const planColumns: TableColumn<any>[] = [
  { header: "Plan", value: (item) => item.planName },
  { header: "Key", value: (item) => item.planKey },
  { header: "Monthly", value: (item) => formatCents(item.monthlyPlatformFeeCents) },
  { header: "Servers", value: (item) => item.hostedServersUnlimited ? "Unlimited" : item.hostedServersLimit },
  { header: "Tool calls", value: (item) => item.includedToolCalls },
];

const aiCreditLedgerColumns: TableColumn<any>[] = [
  { header: "ID", value: (item) => item.id },
  { header: "Amount", value: (item) => `$${Number(item.amountUsd ?? 0).toFixed(2)}` },
  { header: "Balance", value: (item) => item.balanceAfterUsd == null ? "" : `$${Number(item.balanceAfterUsd).toFixed(2)}` },
  { header: "Kind", value: (item) => item.entryKind },
  { header: "Created", value: (item) => item.createdOn },
];

const toolCallCreditLedgerColumns: TableColumn<any>[] = [
  { header: "ID", value: (item) => item.id },
  { header: "Calls", value: (item) => item.amountCalls },
  { header: "Balance", value: (item) => item.balanceAfterCalls },
  { header: "Kind", value: (item) => item.entryKind },
  { header: "Created", value: (item) => item.createdOn },
];

export async function printBillingStatus(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const [hosting, aiCredits] = await Promise.all([
    client.request(`/api/v1/organizations/${orgId}/mcp-hosting/usage`),
    client.request(`/api/v1/organizations/${orgId}/ai-credits/summary`),
  ]);

  printData({ organizationId: orgId, hosting, aiCredits }, options);
}

export async function listBillingPlans(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  printData(
    await client.request(`/api/v1/organizations/${orgId}/mcp-hosting/billing/plans`),
    options,
    planColumns,
  );
}

export async function createHostingCheckout(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  if (!options.plan) {
    throw new Error("Provide --plan <plan-key>.");
  }

  const session = await client.request<CheckoutSession>(
    `/api/v1/organizations/${orgId}/mcp-hosting/billing/checkout-session`,
    {
      method: "POST",
      body: { planKey: options.plan },
    },
  );

  await printCheckoutSession(client, options, orgId, "hosting", session);
}

export async function createAiCreditCheckout(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const amountUsd = parsePositiveNumber(options.amount, "--amount");
  const session = await client.request<CheckoutSession>(
    `/api/v1/organizations/${orgId}/ai-credits/checkout-session`,
    {
      method: "POST",
      body: { amountUsd },
    },
  );

  await printCheckoutSession(client, options, orgId, "ai-credits", session);
}

export async function createToolCallCreditCheckout(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const calls = parsePositiveInteger(options.calls, "--calls");
  const session = await client.request<CheckoutSession>(
    `/api/v1/organizations/${orgId}/mcp-hosting/tool-call-credits/checkout-session`,
    {
      method: "POST",
      body: { calls },
    },
  );

  await printCheckoutSession(client, options, orgId, "tool-call-credits", session);
}

export async function listAiCreditLedger(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const page = await client.request<any>(`/api/v1/organizations/${orgId}/ai-credits/ledger`, {
    query: {
      category: options.category ?? "purchases",
      cursor: options.cursor,
      pageSize: parseOptionalPositiveInteger(options.pageSize, "--page-size"),
    },
  });
  printData(page.data ?? page, options, aiCreditLedgerColumns);
}

export async function listToolCallCreditLedger(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const page = await client.request<any>(`/api/v1/organizations/${orgId}/mcp-hosting/tool-call-credits/ledger`, {
    query: {
      category: options.category ?? "purchases",
      cursor: options.cursor,
      pageSize: parseOptionalPositiveInteger(options.pageSize, "--page-size"),
    },
  });
  printData(page.data ?? page, options, toolCallCreditLedgerColumns);
}

export async function getAiCreditSettings(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  const summary = await client.request<any>(`/api/v1/organizations/${orgId}/ai-credits/summary`);
  printData({
    organizationId: orgId,
    autoRechargeSupported: false,
    topUpOptionsUsd: summary.topUpOptionsUsd ?? [],
    note: "Saved payment and off-session auto top-up settings are not available in this API version.",
  }, options);
}

export async function setAiCreditSettings(): Promise<void> {
  throw new Error("AI credit auto top-up settings are not available in this API version.");
}

export async function syncBillingSession(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
  sessionId: string,
): Promise<void> {
  const product = normalizeProduct(options.product ?? "hosting");
  await syncCheckoutSession(client, orgId, product, sessionId);
  printSuccess(`Synced ${product} checkout session ${sessionId}.`);
}

export async function waitForBillingSessionCommand(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
): Promise<void> {
  if (!options.session) {
    throw new Error("Provide --session <checkout-session-id>.");
  }

  const status = await waitForBillingSession(
    client,
    options,
    orgId,
    options.session,
    normalizeOptionalProduct(options.product),
  );
  printData(status, options.nonInteractive ? forceJsonOptions(options) : options);
}

async function printCheckoutSession(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
  product: BillingCheckoutProduct,
  session: CheckoutSession,
): Promise<void> {
  const output = {
    ...session,
    product,
    organizationId: orgId,
  };

  if (options.nonInteractive) {
    printData(output, forceJsonOptions(options));
    return;
  }

  const opened = !options.noBrowser && await tryOpenBrowser(session.url);
  if (opened) {
    printInfo("Opened Stripe Checkout. Complete payment in the browser, then return here.");
  } else {
    printInfo("Open this Stripe Checkout URL:");
    console.log(session.url);
  }
  console.log(`Session: ${session.sessionId}`);
  console.log(`Organization: ${orgId}`);

  if (options.wait) {
    const status = await waitForBillingSession(client, options, orgId, session.sessionId, product);
    printData(status, options);
  }
}

async function waitForBillingSession(
  client: McpstackClient,
  options: BillingOptions,
  orgId: string,
  sessionId: string,
  product?: BillingCheckoutProduct,
): Promise<CheckoutStatus> {
  const timeoutSeconds = parseTimeoutSeconds(options.timeout);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatuses: CheckoutStatus[] = [];

  while (Date.now() <= deadline) {
    if (product) {
      await trySyncCheckoutSession(client, orgId, product, sessionId);
    }

    lastStatuses = await getCheckoutStatuses(client, orgId, sessionId, product);
    const completed = lastStatuses.find((status) => status.completed);
    if (completed) {
      return completed;
    }

    await delay(2_000);
  }

  const last = lastStatuses
    .map((status) => `${status.product}:${status.status}`)
    .join(", ") || "no status";
  throw new Error(`Timed out waiting for checkout session ${sessionId}. Last status: ${last}.`);
}

async function getCheckoutStatuses(
  client: McpstackClient,
  orgId: string,
  sessionId: string,
  product?: BillingCheckoutProduct,
): Promise<CheckoutStatus[]> {
  const products: BillingCheckoutProduct[] = product
    ? [product]
    : ["hosting", "ai-credits", "tool-call-credits"];

  const statuses: CheckoutStatus[] = [];
  for (const currentProduct of products) {
    try {
      statuses.push(await client.request<CheckoutStatus>(
        getStatusPath(orgId, currentProduct, sessionId),
      ));
    } catch (error) {
      if (!(error instanceof McpstackHttpError) || error.status !== 404) {
        throw error;
      }
    }
  }

  return statuses;
}

async function trySyncCheckoutSession(
  client: McpstackClient,
  orgId: string,
  product: BillingCheckoutProduct,
  sessionId: string,
): Promise<void> {
  try {
    await syncCheckoutSession(client, orgId, product, sessionId);
  } catch (error) {
    if (!(error instanceof McpstackHttpError) || error.status < 500) {
      throw error;
    }
  }
}

async function syncCheckoutSession(
  client: McpstackClient,
  orgId: string,
  product: BillingCheckoutProduct,
  sessionId: string,
): Promise<void> {
  await client.request(getSyncPath(orgId, product, sessionId), { method: "POST" });
}

function getStatusPath(orgId: string, product: BillingCheckoutProduct, sessionId: string): string {
  const encoded = encodeURIComponent(sessionId);
  switch (product) {
    case "hosting":
      return `/api/v1/organizations/${orgId}/mcp-hosting/billing/checkout-session/${encoded}/status`;
    case "ai-credits":
      return `/api/v1/organizations/${orgId}/ai-credits/checkout-session/${encoded}/status`;
    case "tool-call-credits":
      return `/api/v1/organizations/${orgId}/mcp-hosting/tool-call-credits/checkout-session/${encoded}/status`;
  }
}

function getSyncPath(orgId: string, product: BillingCheckoutProduct, sessionId: string): string {
  const encoded = encodeURIComponent(sessionId);
  switch (product) {
    case "hosting":
      return `/api/v1/organizations/${orgId}/mcp-hosting/billing/checkout-session/${encoded}/sync`;
    case "ai-credits":
      return `/api/v1/organizations/${orgId}/ai-credits/checkout-session/${encoded}/sync`;
    case "tool-call-credits":
      return `/api/v1/organizations/${orgId}/mcp-hosting/tool-call-credits/checkout-session/${encoded}/sync`;
  }
}

function forceJsonOptions(options: BillingOptions): GlobalOptions {
  return {
    ...options,
    json: true,
    output: "json" as OutputFormat,
  };
}

function parsePositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Provide ${flag} as a positive number.`);
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Provide ${flag} as a positive integer.`);
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parsePositiveInteger(value, flag);
}

function parseTimeoutSeconds(value: string | undefined): number {
  if (value === undefined) {
    return 300;
  }

  return parsePositiveInteger(value, "--timeout");
}

function normalizeOptionalProduct(value: string | undefined): BillingCheckoutProduct | undefined {
  return value === undefined ? undefined : normalizeProduct(value);
}

function normalizeProduct(value: string): BillingCheckoutProduct {
  if (value === "hosting" || value === "ai-credits" || value === "tool-call-credits") {
    return value;
  }

  throw new Error("--product must be one of: hosting, ai-credits, tool-call-credits.");
}

function formatCents(value: unknown): string {
  const cents = Number(value ?? 0);
  return cents === 0 ? "$0.00" : `$${(cents / 100).toFixed(2)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
