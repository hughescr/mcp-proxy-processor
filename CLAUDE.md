# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Proxy Processor is a proxy server for the Model Context Protocol (MCP) that allows selective re-exposure of tools and resources from backend MCP servers through configurable "groups". This enables fine-grained control over which tools AI agents can access while keeping their context windows clean.

## Architecture

The project follows a three-tier architecture:

### 1. Backend Layer (`src/backend/`)
- Manages connections to backend MCP servers
- Launches servers as stdio subprocesses based on `config/backend-servers.json`
- Maintains MCP client connections to backend servers
- Proxies tool/resource requests to appropriate backend servers
- Backend configuration format matches Claude Desktop's `mcp.json` format

### 2. Middleware Layer (`src/middleware/`)
- Loads and manages group configurations from `config/groups.json`
- Maps backend tools/resources to named groups
- Applies overrides to tool/resource definitions (name, description, schema)
- Determines which backend servers are needed for a given group
- Validates group configurations against Zod schemas

### 3. Frontend Layer (`src/frontend/`)
- Exposes an MCP server using stdio transport
- Serves tools/resources for a specific group (specified via CLI argument)
- Routes incoming tool calls to appropriate backend servers
- Returns responses to the MCP client (e.g., Claude Desktop)

### Additional Components

- **CLI (`src/cli.ts`)**: Entry point with two modes:
  - `--serve <groupname>`: Start MCP server for a group
  - `--admin`: Launch interactive admin UI

- **Admin Interface (`src/admin/`)**: Interactive CLI for:
  - Discovering available backend tools/resources
  - Creating/editing groups
  - Adding/removing tools from groups
  - Overriding tool definitions
  - Saving configurations

- **Types (`src/types/`)**: Shared TypeScript types and Zod schemas for configuration validation

## Configuration Files

### Backend Servers (`config/backend-servers.json`)

Defines backend MCP servers to connect to. Format matches Claude Desktop's `mcp.json`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "env": {
        "API_KEY": "value"
      }
    }
  }
}
```

### Groups (`config/groups.json`)

Defines groups of tools/resources with optional overrides:

```json
{
  "groups": {
    "group-name": {
      "name": "group-name",
      "description": "Group description",
      "tools": [
        {
          "serverName": "backend-server",
          "originalName": "tool_name",
          "name": "optional-new-name",
          "description": "Optional override description",
          "inputSchema": {}
        }
      ],
      "resources": []
    }
  }
}
```

## Development Commands

### Setup
```bash
bun install
```

### Development
```bash
# Run MCP server for a group (stdio mode)
bun run dev --serve standard_tools

# Run admin interface
bun run dev --admin

# Build for distribution
bun run build
```

### Testing and Quality
```bash
# Run tests
bun test

# Lint and fix
bun run lint

# Full validation (lint + typecheck + test)
bun run full-test

# Check for package updates
bun run package-check
```

## MCP Protocol Details

### Transport
- All communication uses **stdio transport** (standard input/output)
- Messages use JSON-RPC 2.0 format, UTF-8 encoded
- Messages are newline-delimited
- Logging should go to stderr to avoid corrupting the protocol stream

### Message Flow
1. Client (Claude Desktop) launches `mcp-proxy --serve <group>` as subprocess
2. Client and proxy exchange initialization messages
3. Client requests tool/resource lists
4. Client invokes tools; proxy routes to backend servers
5. Backend servers execute and return results
6. Proxy returns results to client

### Key Protocol Operations
- `initialize`: Handshake and capability negotiation
- `tools/list`: Get available tools for the group
- `tools/call`: Execute a tool
- `resources/list`: Get available resources
- `resources/read`: Read a resource

## Development Workflow

1. **Backend servers**: Ensure backend servers are properly configured in `config/backend-servers.json`
2. **Groups**: Define groups using admin interface or by editing `config/groups.json`
3. **Testing**: Test groups by running `mcp-proxy --serve <groupname>` and connecting via Claude Desktop
4. **Iteration**: Refine tool overrides based on agent behavior

## Code Style and Conventions

- Use Bun runtime for all operations (`bun` not `npm`/`npx`)
- TypeScript strict mode enabled
- ESLint with hughescr configuration
- Prefer functional patterns with lodash
- Use Zod for runtime validation of configurations
- Log to stderr using `console.error()` in MCP servers (never stdout)
- Use absolute imports for cross-module dependencies

## Future Enhancements (Not Yet Implemented)

- Pre/post-processing of tool calls (e.g., jq-style transformations)
- TypeScript plugins for custom tool argument/response munging
- SSE transport support for remote connections
- Web-based admin UI
- Group inheritance/composition