# @emcy/cli

`@emcy/cli` is the legacy package name for the MCP Stack CLI. New installs should use `@mcpstack/cli`; this package is published for existing automation that still installs `@emcy/cli`.

```bash
npm i -g @emcy/cli
mcpstack agents budget --help
mcpstack agents budget defaults <agent-id> --monthly-usd 25 --default-user-usd 3 --anonymous-usd 1
mcpstack agents budget set <agent-id> --user customer_abc --monthly-usd 5
mcpstack agents budget get <agent-id> --user customer_abc
mcpstack agents budget delete <agent-id> --user customer_abc --yes
```
