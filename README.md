# MCP Stack CLI

`mcpstack` is the command-line interface for MCP Stack organizations, MCP servers, gateways, agents, members, invitations, and service-account API keys.

## Install

```bash
npm i -g @mcpstack/cli
```

Existing `@emcy/cli` installs remain supported as a compatibility package, but new projects should install `@mcpstack/cli`.

For local development:

```bash
npm install
npm run build
node dist/index.js --help
```

## Preview Package

Pull requests publish preview packages to npm with a stable dist-tag, for example `@mcpstack/cli@pr-12`. The workflow comments with the exact package ref.

To test a CLI change inside a MCP Stack SaaS PR preview, add the ref to `infra/preview-packages.json` in that PR:

```json
{
  "@mcpstack/cli": "@mcpstack/cli@pr-12"
}
```

The MCP Stack preview deploy installs that package before image builds, runs a CLI smoke check, and includes the resolved npm package link in the MCP Stack PR preview comment.

## Human Login

Human operators use OAuth device authorization. The API must expose `/api/v1/cli/config` and the `device_authorization_endpoint`.

By default the CLI targets production (`https://api.mcpstack.com`) and opens your browser for device login. Use `--no-browser` to print the URL only.

```bash
mcpstack auth login
mcpstack auth status
mcpstack auth whoami
mcpstack servers list
```

The CLI uses your **primary organization automatically** (the first organization returned by the API), matching the SaaS dashboard. You do not need to select an organization manually.

Local AppHost:

```bash
mcpstack auth login --api-url http://localhost:5150
```

## Service-Account Login

Automation and CI should use an MCP Stack service-account API key. You can either store one active service-account login locally or pass the key through environment variables.

```bash
mcpstack auth service-account login \
  --api-url https://api.mcpstack.com \
  --key mcpstack_sk_...

mcpstack servers list
```

Equivalent environment-only usage:

```bash
MCPSTACK_API_URL=https://api.mcpstack.com \
MCPSTACK_API_KEY=mcpstack_sk_... \
mcpstack servers list
```

Use `--org <organization-id>` only when you need to override the default organization for a single command.

## Common Workflows

```bash
mcpstack members invite teammate@example.com --role developer
mcpstack members invitations list

mcpstack api-keys create --name deploy-bot --role developer
mcpstack api-keys list

mcpstack servers create --openapi-file ./openapi.yaml
mcpstack servers get <server-id>
mcpstack servers update <server-id> --name "Production API"
mcpstack servers update <server-id> --openapi-file ./openapi.yaml
mcpstack logs stream <server-id>
mcpstack operations list <server-id> --json
mcpstack servers checks <server-id>
mcpstack smoke tools-list <server-id>
mcpstack servers delete <server-id> --yes

mcpstack servers custom-domain validate <server-id> --hostname mcp.example.com --json
mcpstack servers custom-domain get <server-id> --json

mcpstack agents list
mcpstack agents budget defaults <agent-id> --monthly-usd 10000 --default-user-usd 5 --json
mcpstack agents budget set <agent-id> --user customer_abc --monthly-usd 5 --json
mcpstack agents budget get <agent-id> --user customer_abc --json
mcpstack agents budget delete <agent-id> --user customer_abc --yes
mcpstack agents chat <agent-id> --message "Summarize production health"
```

Creating or updating a hosted server starts the managed edge publish automatically. The CLI intentionally does not expose separate deploy, undeploy, region mutation, reconcile, or rollback commands to customers; those are internal platform operations.

When creating or updating from `--openapi-file`, the CLI reads the local JSON/YAML file, sends the spec contents to MCP Stack, and records the source as an upload. The file does not need to be publicly reachable. Use `servers update --openapi-file` whenever the local spec changes.

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
