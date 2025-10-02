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

### Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- Node.js 24.x or later

### Install from Source

```bash
# Clone the repository
git clone https://github.com/hughescr/mcp-proxy-processor.git
cd mcp-proxy-processor

# Install dependencies
bun install

# Build the project
bun run build

# Make the CLI available globally (optional)
bun link
```

After linking, you can use `mcp-proxy` command from anywhere. Otherwise, use `bun run dev` for development.

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

#### Option A: Using the Admin Interface (Recommended)

Launch the interactive admin interface to discover and configure tools:

```bash
bun run dev admin
# or if installed globally:
mcp-proxy admin
```

The admin interface lets you:
1. **Discover Tools**: Connect to backend servers and see all available tools
2. **Create Groups**: Create new groups for different purposes
3. **Add Tools**: Add tools to groups by selecting from available backend tools
4. **Override Definitions**: Improve tool names and descriptions
5. **Save**: Write configuration to `config/groups.json`

**Admin Interface Workflow:**
- Use arrow keys to navigate menus
- Press Enter to select options
- Type to enter text in prompts
- Press Ctrl+C to exit at any time

#### Option B: Manual Configuration

Copy and edit the example:

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
          "originalName": "get_current_time"
        },
        {
          "serverName": "calculator",
          "originalName": "calculate"
        },
        {
          "serverName": "calculator",
          "originalName": "solve",
          "description": "Solve algebraic equations for a variable. Provide the equation as a string with one variable (e.g., '2*x + 5 = 13' or 'y^2 - 4 = 0'). This override fixes the confusing original description."
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
      "args": ["serve", "standard_tools"]
    },
    "financial_tools": {
      "command": "mcp-proxy",
      "args": ["serve", "financial_tools"]
    }
  }
}
```

**Note:** The legacy `--serve` format is still supported for backward compatibility, but the new `serve` command format is recommended.

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
- `argumentMapping` (optional): Transform arguments before sending to backend

## Argument Mapping

Argument mapping allows you to transform tool call arguments from the AI agent format to the backend server format. This is useful for:

- Adding default values for optional parameters
- Injecting authentication credentials or API keys
- Renaming parameters between client and backend
- Restructuring complex argument schemas

### Template Mappings

Template mappings provide declarative parameter transformations for common use cases. They're easier to configure and validate than JSONata expressions.

#### Passthrough

Pass a parameter through unchanged:

```json
{
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "query": { "type": "passthrough", "source": "query" }
    }
  }
}
```

#### Constant

Always use a fixed value (useful for API keys, modes, etc.):

```json
{
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "apiKey": { "type": "constant", "value": "secret-key-123" },
      "mode": { "type": "constant", "value": "production" }
    }
  }
}
```

#### Default

Use client value if provided, otherwise use a default:

```json
{
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "timezone": {
        "type": "default",
        "source": "timezone",
        "default": "America/Los_Angeles"
      }
    }
  }
}
```

This is perfect for making required backend parameters optional for the AI agent.

#### Rename

Rename a parameter from client to backend:

```json
{
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "search_query": { "type": "rename", "source": "query" }
    }
  }
}
```

### JSONata Expressions

For complex transformations, use [JSONata](https://jsonata.org/) expressions:

```json
{
  "argumentMapping": {
    "type": "jsonata",
    "expression": "{ \"search\": { \"q\": query, \"limit\": limit ? limit : 10 }, \"tz\": timezone ? timezone : \"UTC\" }"
  }
}
```

JSONata provides conditional logic, object restructuring, string manipulation, array operations, and more.

### Complete Example

Here's a complete tool override with argument mapping:

```json
{
  "tools": [
    {
      "serverName": "time",
      "originalName": "get_current_time",
      "name": "get_time",
      "description": "Get current time in a timezone",
      "inputSchema": {
        "properties": {
          "timezone": {
            "type": "string",
            "description": "IANA timezone (optional, defaults to America/Los_Angeles)"
          }
        }
      },
      "argumentMapping": {
        "type": "template",
        "mappings": {
          "timezone": {
            "type": "default",
            "source": "timezone",
            "default": "America/Los_Angeles"
          }
        }
      }
    }
  ]
}
```

**How it works:**
1. The `inputSchema` makes `timezone` optional for the AI agent
2. The `argumentMapping` adds `America/Los_Angeles` as default if not provided
3. The backend always receives a timezone parameter

For detailed documentation and more examples, see [docs/argument-mapping.md](./docs/argument-mapping.md).

## Usage

### CLI Commands

The CLI uses Commander.js with automatic help generation. Run `mcp-proxy --help` to see all available commands.

#### Serve a Group

Start the MCP proxy server for a specific group:

```bash
mcp-proxy serve standard_tools
# or legacy format:
mcp-proxy --serve standard_tools
```

This starts an MCP server (stdio transport) exposing only the tools defined in the "standard_tools" group.

#### Admin Interface

Launch the interactive admin interface:

```bash
mcp-proxy admin
# or legacy format:
mcp-proxy --admin
```

Use this to:
- View available backend tools
- Create and edit groups
- Add/remove tools from groups
- Override tool definitions
- Save configurations

#### List Groups

List all configured groups:

```bash
mcp-proxy list-groups
```

Shows all groups with their descriptions and tool/resource counts.

#### Describe Group

Show detailed information about a specific group:

```bash
mcp-proxy describe-group standard_tools
```

Displays all tools and resources in the group, including overrides.

#### List Backend Servers

List all configured backend servers:

```bash
mcp-proxy list-backends
```

Shows all backend servers with their commands and configuration.

#### Validate Configuration

Validate configuration files without starting servers:

```bash
mcp-proxy validate
```

Checks that both `backend-servers.json` and `groups.json` are valid.

## Real-World Usage Examples

### Example 1: Financial Analysis Toolkit

Create a focused group for financial analysis that includes Excel, calculator, web search, and browser tools:

**Backend servers needed:**
```json
{
  "mcpServers": {
    "calculator": {
      "command": "uvx",
      "args": ["--from", "calculator-mcp-server", "--", "calculator-mcp-server", "--stdio"]
    },
    "excel": {
      "command": "bunx",
      "args": ["--bun", "@negokaz/excel-mcp-server@latest"],
      "env": {
        "EXCEL_MCP_PAGING_CELLS_LIMIT": "4000"
      }
    },
    "search": {
      "command": "bunx",
      "args": ["--bun", "mcp-omnisearch@latest"],
      "env": {
        "BRAVE_API_KEY": "your-api-key-here"
      }
    },
    "browser": {
      "command": "bunx",
      "args": ["--bun", "@playwright/mcp@latest"]
    }
  }
}
```

**Group configuration:**
```json
{
  "groups": {
    "financial_tools": {
      "name": "financial_tools",
      "description": "Tools for financial analysis including Excel, calculator, web search, and browser automation",
      "tools": [
        {
          "serverName": "calculator",
          "originalName": "calculate"
        },
        {
          "serverName": "calculator",
          "originalName": "statistics"
        },
        {
          "serverName": "excel",
          "originalName": "read_workbook"
        },
        {
          "serverName": "excel",
          "originalName": "write_workbook"
        },
        {
          "serverName": "search",
          "originalName": "brave_web_search",
          "description": "Search the web for financial information, SEC filings, market data, and company information. Returns titles, URLs, and snippets."
        },
        {
          "serverName": "browser",
          "originalName": "browser_navigate"
        },
        {
          "serverName": "browser",
          "originalName": "browser_snapshot"
        }
      ],
      "resources": []
    }
  }
}
```

**Usage in Claude Desktop:**
```json
{
  "mcpServers": {
    "financial_tools": {
      "command": "mcp-proxy",
      "args": ["serve", "financial_tools"]
    }
  }
}
```

Now when Claude analyzes financial data, it only sees 7 focused tools instead of 30+ tools from all four backend servers.

### Example 2: Research Assistant

Create a research-focused group with web search and browser automation:

```json
{
  "groups": {
    "research_tools": {
      "name": "research_tools",
      "description": "Tools for web research, AI-powered search, and browser automation",
      "tools": [
        {
          "serverName": "search",
          "originalName": "brave_web_search"
        },
        {
          "serverName": "search",
          "originalName": "perplexity_search",
          "description": "AI-powered search with reasoning. Use this for complex research questions that require synthesis across multiple sources."
        },
        {
          "serverName": "browser",
          "originalName": "browser_navigate"
        },
        {
          "serverName": "browser",
          "originalName": "browser_snapshot"
        },
        {
          "serverName": "browser",
          "originalName": "browser_click"
        },
        {
          "serverName": "time",
          "originalName": "get_current_time",
          "description": "Get the current time in any timezone. Useful for timestamping research findings."
        }
      ],
      "resources": []
    }
  }
}
```

### Example 3: Fixing Confusing Tool Descriptions

Some backend servers have unclear tool descriptions. Override them to help your AI agent:

**Original tool (confusing):**
```json
{
  "name": "solve",
  "description": "Solves equations"
}
```

**Overridden tool (clear):**
```json
{
  "serverName": "calculator",
  "originalName": "solve",
  "description": "Solve algebraic equations for a variable. Provide the equation as a string with one variable (e.g., '2*x + 5 = 13' or 'y^2 - 4 = 0'). Returns the solution(s) for the variable."
}
```

### Example 4: Multiple Groups for Different Tasks

Configure multiple groups in Claude Desktop for different workflows:

```json
{
  "mcpServers": {
    "quick_tools": {
      "command": "mcp-proxy",
      "args": ["serve", "standard_tools"]
    },
    "financial_analysis": {
      "command": "mcp-proxy",
      "args": ["serve", "financial_tools"]
    },
    "research": {
      "command": "mcp-proxy",
      "args": ["serve", "research_tools"]
    },
    "coding": {
      "command": "mcp-proxy",
      "args": ["serve", "coding_tools"]
    }
  }
}
```

Claude Desktop will show all four groups. You can enable/disable groups based on your current task, keeping context windows clean.

### Example 5: Testing a Group Before Adding to Claude

Test your group configuration before adding it to Claude Desktop:

```bash
# Validate configuration files
mcp-proxy validate

# List all configured groups
mcp-proxy list-groups

# Show details about a specific group
mcp-proxy describe-group financial_tools

# Start the proxy server for your group
mcp-proxy serve financial_tools

# In another terminal, use the MCP Inspector
npx @modelcontextprotocol/inspector mcp-proxy serve financial_tools

# Or test with curl (requires jq for pretty-printing)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | mcp-proxy serve financial_tools | jq
```

This lets you verify that:
- The proxy starts without errors
- Backend servers connect successfully
- Tools are exposed correctly
- Overrides are applied properly

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

## Troubleshooting

For common issues, debugging tips, and frequently asked questions, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

Quick tips:
- **Backend server won't start:** Verify the command path and required dependencies
- **Tool not found errors:** Use `--admin` to discover correct tool names
- **Claude Desktop issues:** Check config file syntax and restart Claude Desktop
- **Protocol errors:** Ensure backend servers use stdio transport correctly

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev serve standard_tools
bun run dev admin
bun run dev list-groups
bun run dev describe-group standard_tools
bun run dev list-backends
bun run dev validate

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

### Completed ✓
- [x] Basic proxy functionality
- [x] Group configuration
- [x] Tool overrides (name, description, inputSchema)
- [x] Resource overrides (name, description, mimeType)
- [x] Argument mapping (template & JSONata transformations)
- [x] Admin UI for argument mapping configuration
- [x] Admin CLI interface (Ink-based TUI)
- [x] Backend server management
- [x] MCP client connections to backends
- [x] Tool/resource discovery from backends
- [x] Frontend MCP server with stdio transport
- [x] Request proxying to backend servers
- [x] Group-based tool filtering

### Future Enhancements
- [ ] Response transformation (JSONata-based post-processing)
- [ ] Custom JSONata functions via plugin system (using `registerFunction` API)
- [ ] SSE transport support for remote connections
- [ ] Web-based admin UI
- [ ] Group inheritance/composition
- [ ] Rate limiting per backend server
- [ ] Metrics and monitoring dashboard

## License

[Apache-2.0](./LICENSE)

## Author

Craig R. Hughes <craig.git@rungie.com>