# MCP Proxy Processor

An MCP (Model Context Protocol) proxy server that allows selective re-exposure of tools and resources from backend MCP servers through configurable "groups". Keep your AI agents focused by exposing only the tools they need.

## Why Use MCP Proxy Processor?

Modern MCP servers can expose dozens of tools, cluttering your AI agent's context window. MCP Proxy Processor lets you:

- **Curate tool sets**: Create named groups containing only the tools you need
- **Override descriptions**: Improve poorly-written tool descriptions to reduce agent confusion
- **Organize by purpose**: Different tool sets for different tasks (coding, financial analysis, etc.)
- **Keep context clean**: Agents only see relevant tools, improving focus and reducing token usage

## Example Use Case

You have two backend MCP servers:

- **time server**: `current_time` (get time in any timezone), `convert_timezone`
- **calculator server**: `calculate`, `solve_equation`, `differentiate`, `integrate`, `mean`, `variance`, `standard_deviation`, `median`, `mode`

You want to expose only `current_time`, `calculate`, and `solve_equation` to your agent, AND the `solve_equation` description is confusing. With MCP Proxy Processor:

1. Define a "standard_tools" group containing these three tools
2. Override the `solve_equation` description with a clearer version
3. Configure your agent to use the "standard_tools" MCP server
4. Agent sees exactly 3 clean, well-described tools

You can create multiple groups for different purposes:
- **standard_tools**: Time and basic math for general use
- **financial_tools**: Statistics, calculator, and web search for financial analysis
- **coding_tools**: File operations, documentation search, and linting

## Installation

```bash
# Clone the repository
git clone https://github.com/hughescr/mcp-proxy-processor.git
cd mcp-proxy-processor

# Install dependencies
bun install

# Build the project
bun run build
```

## Quick Start

### 1. Configure Backend Servers

Copy the example configuration and edit it:

```bash
cp config/backend-servers.example.json config/backend-servers.json
```

Edit `config/backend-servers.json` to define your backend MCP servers (uses Claude Desktop's `mcp.json` format):

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-time"]
    },
    "calculator": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-calculator"]
    }
  }
}
```

### 2. Configure Groups

Use the admin interface to create groups:

```bash
bun run dev --admin
```

Or copy and edit the example:

```bash
cp config/groups.example.json config/groups.json
```

Edit `config/groups.json` to define your tool groups:

```json
{
  "groups": {
    "standard_tools": {
      "name": "standard_tools",
      "description": "Basic tools for everyday use",
      "tools": [
        {
          "serverName": "time",
          "originalName": "current_time"
        },
        {
          "serverName": "calculator",
          "originalName": "calculate"
        },
        {
          "serverName": "calculator",
          "originalName": "solve_equation",
          "description": "Solve algebraic equations. Provide the equation as a string (e.g., '2x + 5 = 13') and this tool will solve for the variable."
        }
      ],
      "resources": []
    }
  }
}
```

### 3. Configure Claude Desktop

Add the proxy to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "standard_tools": {
      "command": "mcp-proxy",
      "args": ["--serve", "standard_tools"]
    },
    "financial_tools": {
      "command": "mcp-proxy",
      "args": ["--serve", "financial_tools"]
    }
  }
}
```

### 4. Test It

Restart Claude Desktop. Your agent now has access to the curated tool sets!

## Configuration Reference

### Backend Servers

The `config/backend-servers.json` file uses the same format as Claude Desktop's `mcp.json`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "command-to-run",
      "args": ["arg1", "arg2"],
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### Groups

The `config/groups.json` file defines tool groups:

```json
{
  "groups": {
    "group-name": {
      "name": "group-name",
      "description": "Optional group description",
      "tools": [
        {
          "serverName": "backend-server-name",
          "originalName": "original_tool_name",
          "name": "optional-override-name",
          "description": "Optional override description",
          "inputSchema": {}
        }
      ],
      "resources": [
        {
          "serverName": "backend-server-name",
          "originalUri": "resource://uri",
          "name": "optional-override-name",
          "description": "Optional override description"
        }
      ]
    }
  }
}
```

**Tool Override Fields:**
- `serverName` (required): Backend server providing the tool
- `originalName` (required): Tool name from backend server
- `name` (optional): Override the tool name
- `description` (optional): Override the tool description
- `inputSchema` (optional): Override the input schema

## Usage

### Serve a Group

Start the MCP proxy server for a specific group:

```bash
mcp-proxy --serve standard_tools
```

This starts an MCP server (stdio transport) exposing only the tools defined in the "standard_tools" group.

### Admin Interface

Launch the interactive admin interface:

```bash
mcp-proxy --admin
```

Use this to:
- View available backend tools
- Create and edit groups
- Add/remove tools from groups
- Override tool definitions
- Save configurations

## Architecture

```
┌─────────────────┐
│   AI Agent      │
│ (Claude, etc.)  │
└────────┬────────┘
         │ stdio
         ▼
┌─────────────────────────┐
│  Frontend MCP Server    │
│  (Group: standard_tools)│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Middleware Layer       │
│  (Group mapping &       │
│   tool overrides)       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Backend MCP Clients    │
│  (time, calculator)     │
└─────────────────────────┘
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev --serve standard_tools
bun run dev --admin

# Run tests
bun test

# Lint
bun run lint

# Type check
tsc

# Full validation
bun run full-test
```

## Roadmap

- [x] Basic proxy functionality
- [x] Group configuration
- [x] Tool overrides
- [x] Admin CLI interface
- [ ] Pre/post-processing hooks (jq-style)
- [ ] TypeScript plugin system
- [ ] SSE transport support
- [ ] Web-based admin UI
- [ ] Group inheritance

## License

Apache-2.0

## Author

Craig R. Hughes <craig.git@rungie.com>