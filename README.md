# Agenetix CLI

`agenetix` is the command-line interface for Agenetix organizations, MCP servers, gateways, agents, members, invitations, and service-account API keys.

## Install

```bash
npm i -g @agenetix/cli
```

Install with `npm install -g @agenetix/cli`.

For local development:

```bash
npm install
npm run build
node dist/index.js --help
```

## Publishing

`publish-npm.yml` is the only npm publish entry point. Merging to `main` does not publish `latest`.

- **Pull request against `main`** — publishes a preview dist-tag, for example `@agenetix/cli@pr-12`. The workflow comments with the exact package ref.
- **`v*` tag** (for example `v2.0.3`) — publishes `latest`. Bump `package.json` first; npm will not overwrite an already-published version.

To test a CLI change inside a platform PR preview, add the ref to `infra/preview-packages.json` in that PR:

```json
{
  "@agenetix/cli": "@agenetix/cli@pr-12"
}
```

The platform preview deploy installs that package before image builds, runs a CLI smoke check, and includes the resolved npm package link in the platform PR preview comment.

## Human Login

Human operators use OAuth device authorization. The API must expose `/api/v1/cli/config` and the `device_authorization_endpoint`.

By default the CLI targets production (`https://api.mcpstack.com`) and opens your browser for device login. Use `--no-browser` to print the URL only.

```bash
agenetix auth login
agenetix auth status
agenetix auth whoami
agenetix servers list
```

The CLI uses your **primary organization automatically** (the first organization returned by the API), matching the SaaS dashboard. You do not need to select an organization manually.

Local AppHost:

```bash
agenetix auth login --api-url http://localhost:5150
```

## Service-Account Login

Automation and CI should use an MCP Stack service-account API key. You can either store one active service-account login locally or pass the key through environment variables.

```bash
agenetix auth service-account login \
  --api-url https://api.mcpstack.com \
  --key mcpstack_sk_...

agenetix servers list
```

Equivalent environment-only usage:

```bash
MCPSTACK_API_URL=https://api.mcpstack.com \
MCPSTACK_API_KEY=mcpstack_sk_... \
agenetix servers list
```

Use `--org <organization-id>` only when you need to override the default organization for a single command.

## Common Workflows

```bash
agenetix members invite teammate@example.com --role developer
agenetix members invitations list

agenetix api-keys create --name deploy-bot --role developer
agenetix api-keys list

agenetix servers create --openapi-file ./openapi.yaml
agenetix servers get <server-id>
agenetix servers update <server-id> --name "Production API"
agenetix servers update <server-id> --openapi-file ./openapi.yaml
agenetix logs stream <server-id>
agenetix operations list <server-id> --json
agenetix servers checks <server-id>
agenetix smoke tools-list <server-id>
agenetix servers delete <server-id> --yes

agenetix servers custom-domain validate <server-id> --hostname mcp.example.com --json
agenetix servers custom-domain get <server-id> --json

agenetix agents list
agenetix agents budget defaults <agent-id> --monthly-usd 10000 --default-user-usd 5 --json
agenetix agents budget set <agent-id> --user customer_abc --monthly-usd 5 --json
agenetix agents budget get <agent-id> --user customer_abc --json
agenetix agents budget delete <agent-id> --user customer_abc --yes
agenetix agents chat <agent-id> --message "Summarize production health"
```

Creating or updating a hosted server starts the managed edge publish automatically. The CLI intentionally does not expose separate deploy, undeploy, region mutation, reconcile, or rollback commands to customers; those are internal platform operations.

When creating or updating from `--openapi-file`, the CLI reads the local JSON/YAML file, sends the spec contents to MCP Stack, and records the source as an upload. The file does not need to be publicly reachable. Use `servers update --openapi-file` whenever the local spec changes.

## Hosted Custom Domains

Hosted servers can expose one customer-owned subdomain such as `mcp.example.com`. MCP Stack keeps the canonical platform MCP URL as a fallback and only prefers the custom URL after DNS, Azure Front Door managed TLS, and routing are active.

```bash
agenetix servers custom-domain validate <server-id> --hostname mcp.example.com --json
agenetix servers custom-domain confirm-ownership <server-id> --json
agenetix servers custom-domain get <server-id> --json
agenetix servers custom-domain finalize <server-id> --json
agenetix smoke tools-list <server-id>
```

The `validate` response returns the ownership TXT record to create at your DNS provider. After it resolves, run `confirm-ownership`; MCP Stack then prepares the routing CNAME and Azure validation TXT records. Add those records, then run `finalize` to activate routing and managed TLS. `delete --yes` removes the custom domain from the server.

## Configuration

Global flags:

```text
--api-url, --org (advanced override), --json, --output table|json|yaml,
--yes, --wait, --timeout, --verbose, --debug-http
```

Environment overrides:

```text
MCPSTACK_API_URL
MCPSTACK_ORG_ID
MCPSTACK_ACCESS_TOKEN
MCPSTACK_API_KEY
MCPSTACK_DISABLE_KEYCHAIN
MCPSTACK_OUTPUT
NO_COLOR
```

The active login and selected organization are stored at `~/.config/mcpstack/config.json`. Secrets use the OS keychain when `keytar` is available, with a `0600` local fallback. Set `MCPSTACK_DISABLE_KEYCHAIN=1` for CI or isolated E2E runs that should not touch the desktop keychain.
