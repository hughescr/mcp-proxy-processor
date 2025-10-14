# Project Configuration Example

This document describes the **actual MCP configuration** used for developing mcp-proxy-processor itself. It demonstrates real-world usage patterns and showcases the key features that make mcp-proxy-processor valuable for managing complex MCP toolchains.

## Overview

The project uses mcp-proxy-processor to "dogfood" its own functionality, consolidating **7 backend MCP servers** with 50+ tools into **3 focused groups** with 19 carefully selected tools. This configuration improves Claude Code's effectiveness by reducing context window bloat and providing clear, well-organized tool sets.

**Configuration files:**
- `config/project-backend-servers.json` - Backend server definitions
- `config/project-groups.json` - Group configurations with tool mappings
- `.mcp.json` - Claude Code integration (uses the groups, not raw backends)

**Architecture:**
```
Backend Servers (7)          Groups (3)              Claude Code
┌──────────────────┐        ┌──────────────┐       ┌────────────┐
│ search           │───┐    │              │       │            │
│ documentation    │───┼───▶│  DevTools    │──────▶│  19 total  │
│ calculator       │   │    │              │       │   tools    │
│ tmux             │───┤    ├──────────────┤       │            │
│ serena           │   │    │              │       │  vs 50+    │
│ package-registry │   └───▶│    Tmux      │──────▶│   from     │
│ ts-language-srv  │        │              │       │  backends  │
└──────────────────┘        ├──────────────┤       │            │
                            │              │       │            │
                            │   Search     │──────▶│            │
                            │              │       │            │
                            └──────────────┘       └────────────┘
```

## Backend Servers

The configuration uses 7 specialized MCP servers, each providing different capabilities:

### 1. **search** (mcp-omnisearch)
Unified search interface supporting multiple providers (Brave, Perplexity).

### 2. **documentation** (@upstash/context7-mcp)
Library and framework documentation lookup using Context7.

### 3. **calculator** (calculator-mcp-server)
Mathematical calculations and equation solving (not heavily used in this project).

### 4. **tmux** (@hughescr/tmux-mcp-server)
Process control and TUI interaction for managing development watchers.

### 5. **serena** (serena LSP)
Language Server Protocol integration providing symbol navigation and code editing based on AST understanding.

### 6. **package-registry** (package-registry-mcp)
NPM package search and metadata lookup.

### 7. **Typescript Language Server** (@mizchi/lsmcp)
TypeScript-specific diagnostics using the official TypeScript Language Server.

## Group Configurations

### DevTools Group

**Purpose:** Code navigation, library documentation, and package management.

**Tools (13):**
- `get-library-docs`, `resolve-library-id` (documentation)
- `get-npm-package-details`, `list-npm-package-versions`, `search-npm-packages` (package-registry)
- `find_referencing_symbols`, `find_symbol`, `get_symbols_overview` (serena)
- `insert_after_symbol`, `insert_before_symbol`, `replace_symbol_body` (serena)
- `typescript_diagnostics` (Typescript Language Server)

**Key features demonstrated:**

#### 1. Argument Mapping with Parameter Injection
The `typescript_diagnostics` tool uses template mapping to inject the `root` parameter as a constant:

```json
{
  "originalName": "lsp_get_diagnostics",
  "serverName": "Typescript Language Server",
  "name": "typescript_diagnostics",
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "root": {
        "type": "constant",
        "value": "."
      },
      "forceRefresh": {
        "type": "passthrough",
        "source": "forceRefresh"
      },
      "timeout": {
        "type": "omit"
      },
      "relativePath": {
        "type": "passthrough",
        "source": "relativePath",
        "description": "File path to check for diagnostics (relative to project root)"
      }
    }
  }
}
```

**Benefits:**
- The agent never sees the `root` parameter (saves ~20 tokens)
- The `timeout` parameter is completely hidden (saves ~25 tokens)
- The tool name is clearer and more specific to TypeScript
- Total savings: ~45 tokens per tool definition, ~450 tokens across 10 typical uses

#### 2. Symbol-based Code Editing
The serena LSP tools provide AST-aware code editing that's more reliable than text-based editing:

- **`get_symbols_overview`**: Get high-level file structure before diving into details
- **`find_symbol`**: Find symbols by name pattern with LSP kind filtering
- **`insert_after_symbol`**: Insert code after a symbol definition
- **`replace_symbol_body`**: Replace a symbol's body safely

These tools enable Claude Code to make precise edits without worrying about whitespace, indentation, or accidentally breaking nearby code.

### Tmux Group

**Purpose:** Process control for development watchers and TUI interaction.

**Tools (6):**
- `get_output`, `list_windows`, `run_command`, `scrollback_size`, `send_input`, `send_keys`

**Resources (2):**
- `tmux://common-patterns` - Usage patterns and examples
- `tmux://keys-reference` - Key binding reference

**Key features demonstrated:**

#### 1. Tool Renaming for Clarity
```json
{
  "originalName": "list_workspaces",
  "serverName": "tmux",
  "name": "list_windows"
}
```

The backend server uses "workspaces" terminology, but for this project's context "windows" is clearer and more accurate. This rename prevents confusion without changing backend behavior.

#### 2. Description Override
```json
{
  "originalName": "get_output",
  "serverName": "tmux",
  "description": "Capture tmux window output. Use either lines mode OR search mode, not both."
}
```

The original description was verbose and unclear about the mutually exclusive modes. The override provides concise, actionable guidance.

#### 3. Argument Mapping with Passthrough
```json
{
  "originalName": "get_output",
  "serverName": "tmux",
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "window_name": {
        "type": "passthrough",
        "source": "window_name",
        "description": "tmux window to capture"
      },
      "lines": {
        "type": "passthrough",
        "source": "lines"
      },
      "search": {
        "type": "passthrough",
        "source": "search"
      }
    }
  }
}
```

While this appears to just pass through all parameters, it establishes explicit control over the interface. In the future, parameters can be added, renamed, or removed without breaking the agent interface.

**Workflow integration:**

The tmux tools enable Claude Code to:
1. Start `tsc --watch` in a persistent tmux window
2. Make file edits using symbol-based tools
3. Check the watcher output for errors
4. Iterate until clean

This is documented in `CLAUDE.md` as the recommended TypeScript development workflow.

### Search Group

**Purpose:** Internet search for documentation, best practices, and current information.

**Tools (2):**
- `ai_search`, `web_search`

**Resources (2):**
- `omnisearch://providers/status` - Provider availability
- `omnisearch://search/{provider}/info` - Provider info

**Key features demonstrated:**

#### 1. Parameter Injection with Constants
The backend `mcp-omnisearch` server uses a single tool with a `provider` parameter. The groups split this into two distinct tools:

**AI Search (Perplexity):**
```json
{
  "originalName": "ai_search",
  "serverName": "search",
  "description": "AI-powered search with reasoning by Perplexity.",
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "provider": {
        "type": "constant",
        "value": "perplexity"
      }
    }
  }
}
```

**Web Search (Brave):**
```json
{
  "originalName": "web_search",
  "serverName": "search",
  "description": "Search the web using the Brave search engine.",
  "argumentMapping": {
    "type": "template",
    "mappings": {
      "provider": {
        "type": "constant",
        "value": "brave"
      },
      "include_domains": {
        "type": "omit"
      },
      "limit": {
        "type": "passthrough",
        "source": "limit"
      }
    }
  }
}
```

**Benefits:**
- Agent sees two purpose-specific tools instead of one generic tool with a provider parameter
- The `provider` parameter is completely hidden (saves ~30 tokens per tool)
- Tool names and descriptions clearly communicate the search engine used
- The `include_domains` parameter is hidden from `web_search` (saves ~25 tokens)
- Total savings: ~55 tokens per tool, ~110 tokens for both search tools

#### 2. Parameter Omission
The `include_domains` parameter is rarely useful and adds complexity. By omitting it from the web_search tool, the agent's context is cleaner and the tool is easier to use.

## Quantified Benefits

### Context Window Savings

**Raw backend exposure:** 50+ tools with verbose descriptions
- Average tool definition: ~200 tokens
- Total context usage: ~10,000 tokens
- Parameters include rarely-used options, API keys visible

**Proxied groups:** 19 focused tools with concise descriptions
- Average tool definition: ~120 tokens (40% reduction through description overrides)
- Total context usage: ~2,280 tokens
- Hidden parameters save additional tokens
- **Net savings: ~7,720 tokens (77% reduction)**

This leaves more context window available for:
- Code files
- Error messages
- User instructions
- Agent reasoning

### Developer Experience Improvements

1. **Clearer tool names**: `typescript_diagnostics` vs `lsp_get_diagnostics`
2. **Better descriptions**: Concise, actionable guidance vs verbose documentation
3. **Organized by purpose**: Three focused groups vs one large undifferentiated tool list
4. **Less cognitive load**: Agent sees only relevant tools for the task at hand

### Maintenance Benefits

1. **Centralized configuration**: Backend servers defined once, reused across groups
2. **Explicit interfaces**: Argument mappings document the contract between agent and backend
3. **Version isolation**: Backend server updates don't break agent interface
4. **Easy iteration**: Test new backend servers without changing Claude Code config

## Adapting This Pattern

### For Your Own Projects

1. **Identify your backend servers**
   - What MCP servers do you use?
   - What tools do they expose?
   - Which tools do you actually use?

2. **Group by purpose**
   - Coding tools (LSP, formatting, linting)
   - Research tools (search, documentation)
   - Automation tools (browser, file operations)
   - Domain-specific tools (finance, data analysis, etc.)

3. **Apply optimizations**
   - Override verbose descriptions with concise summaries
   - Hide rarely-used parameters with `omit`
   - Inject constants (API keys, defaults) with `constant`
   - Rename unclear tool names for clarity

4. **Test and iterate**
   - Use `mcp-proxy admin` to discover available tools
   - Start with a minimal group and expand as needed
   - Monitor agent behavior and adjust tool descriptions
   - Measure context window usage before/after

### Example: Create a "coding" Group

```json
{
  "groups": {
    "coding": {
      "name": "coding",
      "description": "Tools for software development",
      "tools": [
        {
          "originalName": "find_symbol",
          "serverName": "serena",
          "description": "Find code symbols by name pattern"
        },
        {
          "originalName": "typescript_diagnostics",
          "serverName": "typescript-lsp"
        },
        {
          "originalName": "format_code",
          "serverName": "prettier",
          "argumentMapping": {
            "type": "template",
            "mappings": {
              "parser": {
                "type": "constant",
                "value": "typescript"
              }
            }
          }
        }
      ]
    }
  }
}
```

Then in your Claude Code config (`.mcp.json`):

```json
{
  "mcpServers": {
    "coding": {
      "command": "bunx",
      "args": ["@hughescr/mcp-proxy-processor@latest", "serve", "coding"]
    }
  }
}
```

### Tips for Success

1. **Start small**: Begin with 3-5 essential tools, expand as needed
2. **Measure impact**: Count tokens before/after to quantify savings
3. **Document usage**: Add tool guidance to your project's CLAUDE.md or similar
4. **Version carefully**: Pin backend server versions until you're ready to update
5. **Use the admin UI**: Discover tools interactively rather than reading source code

## Integration with Claude Code

The project's `.claude/settings.json` configures permissions for the grouped tools:

```json
{
  "permissions": {
    "allow": [
      "Bash(bun test:*)",
      "WebSearch",
      "WebFetch",
      "mcp__DevTools",
      "mcp__Tmux",
      "mcp__Search"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|Update|mcp__DevTools__insert_after_symbol|mcp__DevTools__insert_before_symbol|mcp__DevTools__replace_symbol_body",
        "hooks": [
          {
            "type": "command",
            "command": "bun run lint:${file}"
          }
        ]
      }
    ]
  }
}
```

**Key aspects:**

1. **Group-level permissions**: Allow entire groups with `mcp__DevTools` syntax
2. **Tool-level hooks**: Run ESLint after symbol-based edits
3. **Simplified management**: Three group names vs 19 individual tool names

The `CLAUDE.md` file provides comprehensive documentation on using these tools effectively, including workflow recommendations and best practices.

## Conclusion

This configuration demonstrates how mcp-proxy-processor enables sophisticated MCP toolchain management:

- **Consolidation**: 7 backends → 3 groups → 19 tools
- **Optimization**: 77% reduction in context window usage
- **Organization**: Logical grouping by purpose
- **Clarity**: Renamed tools and improved descriptions
- **Maintainability**: Explicit argument mappings and centralized configuration

By "dogfooding" mcp-proxy-processor in its own development, the project validates its value proposition and provides a comprehensive real-world example for users.
