# MCP Proxy Processor

An MCP (Model Context Protocol) proxy server that allows selective re-exposure of tools, resources, and prompts from backend MCP servers through configurable "groups". Keep your AI agents focused by exposing only the tools they need, with smart resource management and prompt prioritization.

## Why Use MCP Proxy Processor?

Modern MCP servers often expose 20-50+ tools with verbose descriptions and numerous optional parameters, creating serious context window bloat that harms AI agent performance and increases costs.

### The Problem with Tool Overload

**Backend MCP servers often expose all their tools at once.** You might only need 5 specific tools from a server, but it exposes all 50. Every tool definition—including description and full parameter schema—gets loaded into the agent's context window. This wastes precious context tokens on irrelevant tools.

**In Claude Code, denying tool permissions doesn't solve the problem.** Even when you mark a tool as "deny", its complete definition—including description and full parameter schema—still gets loaded into the agent's context window on every conversation turn. This wastes precious context tokens on tools the agent can't even use.

**Tool authors frequently write overly verbose descriptions.** A simple "get current time" tool might have a 200-word description explaining timezones, edge cases, and implementation details. Multiply this by 50 tools and you've consumed thousands of tokens before the agent even reads your first message.

**Optional parameters bloat the context.** Many tools expose 10-15 parameters where only 2-3 are commonly used. Each parameter definition—with its type, description, constraints, and examples—consumes tokens. Most agents will never use `dewpoint_precision` or `barometric_pressure_unit`, but these parameters still occupy valuable context space.

**You can't easily fix this at the MCP client level.** You're connecting to the full backend server and receiving its entire tool catalog. You can't selectively expose tools, override verbose descriptions, or hide unnecessary parameters without a proxy layer.

### How MCP Proxy Processor Helps

MCP Proxy Processor **completely excludes** unwanted tools from your agent's context. The agent never sees them, never wastes tokens on them, and never gets confused by irrelevant options.

#### Tools
- **Curate tool sets**: Reduce 50 backend tools to 5 focused tools. Save thousands of context tokens per conversation.
- **Rewrite verbose descriptions**: Transform 200-word descriptions into clear, concise 20-word summaries.
- **Hide unnecessary parameters**: Remove rarely-used optional parameters from the agent-visible schema entirely. The agent sees only the 3 parameters that matter.
- **Inject hidden parameters**: Add API keys, default values, and configuration as constants—agents never see or waste tokens on them.

#### Resources
- **Selective resource exposure**: Choose which files, APIs, or data sources to expose from backend servers
- **URI template matching**: Use RFC 6570 templates to match multiple resource URIs with patterns
- **Priority-based fallback**: Configure multiple servers for the same resource with automatic failover
- **Conflict detection**: Identify overlapping resource patterns and resolve conflicts

#### Prompts
- **Prompt curation**: Select specific prompts from backend servers to expose to agents
- **Argument pass-through**: Preserve prompt arguments and requirements from backend definitions
- **Priority ordering**: Set fallback chains for prompts across multiple backend servers
- **Deduplication**: Automatically handle duplicate prompt names with smart priority resolution

#### Organization
- **Organize by purpose**: Create different groups for different tasks (coding, research, financial analysis), each optimized for its specific workflow.
- **Improve agent performance**: Cleaner, smaller tool sets help agents make better decisions faster with less confusion.

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

### Quick Install

**Run directly with npx (no installation needed):**

```bash
npx -y @hughescr/mcp-proxy-processor@latest --help
```

**Or install globally:**

```bash
npm install -g @hughescr/mcp-proxy-processor
mcp-proxy --help
```

**Note:** Built with Bun, runs on Node.js 24+ and any Node-compatible runtime (npm, yarn, bun, pnpm).

### Prerequisites

- Node.js 24.x or later
- Backend MCP servers you want to proxy (e.g., `@modelcontextprotocol/server-time`, `@modelcontextprotocol/server-calculator`)

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
npx @hughescr/mcp-proxy-processor@latest admin
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
      "resources": [],
      "prompts": []
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
      "command": "npx",
      "args": ["-y", "@hughescr/mcp-proxy-processor@latest", "serve", "standard_tools"]
    },
    "financial_tools": {
      "command": "npx",
      "args": ["-y", "@hughescr/mcp-proxy-processor@latest", "serve", "financial_tools"]
    }
  }
}
```

**If installed globally:**

```json
{
  "mcpServers": {
    "standard_tools": {
      "command": "mcp-proxy",
      "args": ["serve", "standard_tools"]
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
          "inputSchema": {},
          "argumentMapping": {}
        }
      ],
      "resources": [
        {
          "serverName": "backend-server-name",
          "uri": "resource://uri"
        }
      ],
      "prompts": [
        {
          "serverName": "backend-server-name",
          "name": "prompt-name"
        }
      ]
    }
  }
}
```

**Tool Fields:**
- `serverName` (required): Backend server providing the tool
- `originalName` (required): Tool name from backend server
- `name` (optional): Override the tool name
- `description` (optional): Override the tool description
- `inputSchema` (optional): Override the input schema
- `argumentMapping` (optional): Transform arguments before sending to backend

**Resource Fields:**
- `serverName` (required): Backend server providing the resource
- `uri` (required): Exact URI or RFC 6570 URI template (e.g., `file:///{path}`)

**Prompt Fields:**
- `serverName` (required): Backend server providing the prompt
- `name` (required): Prompt name from backend server

## Argument Mapping

Argument mapping allows you to transform tool call arguments from the AI agent format to the backend server format. This is useful for:

- Adding default values for optional parameters
- Injecting authentication credentials or API keys
- Renaming parameters between client and backend
- Restructuring complex argument schemas
- Hiding unnecessary parameters from the agent (saves context tokens)

### Quick Example: Adding Defaults

Make a required backend parameter optional for agents by providing a default:

```json
{
  "serverName": "time",
  "originalName": "get_current_time",
  "description": "Get current time (defaults to America/Los_Angeles)",
  "inputSchema": {
    "properties": {
      "timezone": {
        "type": "string",
        "description": "IANA timezone (optional)"
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
```

**How it works:**
1. The agent sees `timezone` as optional
2. If agent omits it, the mapping adds `"America/Los_Angeles"`
3. Backend always receives a timezone parameter

### Mapping Types

**Template Mappings** (declarative, recommended):
- **passthrough**: Pass parameter through unchanged
- **constant**: Always use a fixed value (hidden from agent)
- **default**: Use client value if provided, otherwise use default
- **omit**: Remove parameter from agent-visible schema
- **rename**: Show different parameter name to agent

**JSONata Expressions** (for complex transformations):
- Conditional logic based on parameter values
- Restructuring nested objects
- Array transformations
- String manipulation

### Context Window Optimization

Each hidden/omitted parameter saves 15-30 context tokens. For example:
- Backend tool with 15 parameters, 200-word description
- Agent only needs 3 parameters, 20-word description
- **Savings: ~534 tokens per tool**
- Across 10 tools: **~5,340 tokens saved**

For complete documentation, see **[Argument Mapping Guide](docs/ARGUMENT_MAPS.md)**.

## CLI Commands

### Serve a Group

Start the MCP proxy server for a specific group:

```bash
mcp-proxy serve standard_tools
```

This starts an MCP server (stdio transport) exposing only the tools defined in the "standard_tools" group.

### Admin Interface

Launch the interactive admin interface:

```bash
mcp-proxy admin
```

Use this to:
- View available backend tools
- Create and edit groups
- Add/remove tools from groups
- Override tool definitions
- Configure argument mappings
- Save configurations

### List Groups

List all configured groups:

```bash
mcp-proxy list-groups
```

### Describe Group

Show detailed information about a specific group:

```bash
mcp-proxy describe-group standard_tools
```

### List Backend Servers

List all configured backend servers:

```bash
mcp-proxy list-backends
```

### Validate Configuration

Validate configuration files without starting servers:

```bash
mcp-proxy validate
```

## Real-World Usage Examples

### Financial Analysis Toolkit

Create a focused group for financial analysis that includes Excel, calculator, web search, and browser tools:

```json
{
  "groups": {
    "financial_tools": {
      "name": "financial_tools",
      "description": "Tools for financial analysis",
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
          "serverName": "search",
          "originalName": "brave_web_search",
          "description": "Search for financial information, SEC filings, market data, and company information."
        },
        {
          "serverName": "browser",
          "originalName": "browser_navigate"
        },
        {
          "serverName": "browser",
          "originalName": "browser_snapshot"
        }
      ]
    }
  }
}
```

Now when Claude analyzes financial data, it only sees 6 focused tools instead of 30+ tools from all four backend servers.

### Research Assistant

Create a research-focused group with web search and browser automation:

```json
{
  "groups": {
    "research_tools": {
      "name": "research_tools",
      "description": "Tools for web research and browser automation",
      "tools": [
        {
          "serverName": "search",
          "originalName": "brave_web_search"
        },
        {
          "serverName": "search",
          "originalName": "perplexity_search",
          "description": "AI-powered search with reasoning. Use for complex research questions requiring synthesis."
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
          "serverName": "time",
          "originalName": "get_current_time",
          "description": "Get current time for timestamping research findings."
        }
      ]
    }
  }
}
```

### Multiple Groups for Different Tasks

Configure multiple groups in Claude Desktop for different workflows:

```json
{
  "mcpServers": {
    "quick_tools": {
      "command": "npx",
      "args": ["-y", "@hughescr/mcp-proxy-processor@latest", "serve", "standard_tools"]
    },
    "financial_analysis": {
      "command": "npx",
      "args": ["-y", "@hughescr/mcp-proxy-processor@latest", "serve", "financial_tools"]
    },
    "research": {
      "command": "npx",
      "args": ["-y", "@hughescr/mcp-proxy-processor@latest", "serve", "research_tools"]
    }
  }
}
```

Claude Desktop will show all groups. You can enable/disable groups based on your current task, keeping context windows clean.

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

## Documentation

- **[Argument Mapping Guide](docs/ARGUMENT_MAPS.md)** - Transform tool parameters and optimize context usage
- **[Resources & Prompts Guide](docs/RESOURCES_AND_PROMPTS.md)** - Configure resources and prompts with priority fallback
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues, debugging tips, and FAQ
- **[Development Guide](DEVELOPMENT.md)** - Build from source, run tests, contribute to the project

## Troubleshooting

For common issues, debugging tips, and frequently asked questions, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

Quick tips:
- **Backend server won't start:** Verify the command path and required dependencies
- **Tool not found errors:** Use `mcp-proxy admin` to discover correct tool names
- **Claude Desktop issues:** Check config file syntax and restart Claude Desktop
- **Protocol errors:** Ensure backend servers use stdio transport correctly

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch from `develop`
3. Make your changes with tests
4. Run `bun run full-test` to validate
5. Submit a pull request to `develop`

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for detailed setup instructions, testing procedures, and development guidelines.

## License

[Apache-2.0](./LICENSE)

## Author

Craig R. Hughes <craig.git@rungie.com>
