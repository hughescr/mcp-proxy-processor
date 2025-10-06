# Claude Code Assistant Guide

## Tooling Expectations

- **Tools before terminal:** prefer Claude's MCP tools (e.g., `Glob`, `Grep`, `Read`, `LS`) before falling back to shell commands.
- **Editing:** use `mcp__language-server__edit_file` for TypeScript and `MultiEdit` for other file types to benefit from live diagnostics.
- **Bun-first workflow:** invoke project scripts via `bun`/`bunx`; avoid `npm`/`npx`.
- **Watchers via MCP:** manage development watchers with the tmux MCP server (`mcp__tmux__list_workspaces`, `mcp__tmux__run_command`, `mcp__tmux__get_output`). Do not run `tsc`, `astro check`, or `bun test` directly.
- **Lint enforcement:** the Claude settings run ESLint automatically after each edit—review output and fix issues immediately.
- **CRITICAL: Zero tolerance for lint issues:** ALL ESLint output must be fixed, including warnings. "Style preferences" are NOT optional. The goal is always 0 errors, 0 warnings. Never dismiss warnings as "just style preferences."

## Admin UI Design System

The admin TUI follows a consistent design system with semantic styling.

### Semantic Bold Principle

**Bold (default color) is used EXCLUSIVELY for data values and primary content.**

This creates a visual language where bold always means "this is the data" - never for labels, headers, or decorative text.

### Typography & Color Hierarchy

1. **Screen Title (H1)**: `<Text bold color="cyan">` - Top-level screen headers
2. **Data Values**: `<Text bold>` - ALL editable data, primary content (the only use of default-color bold)
3. **Metadata/Context**: `<Text color="yellow">` - Server names, counts, types (non-editable contextual info)
4. **Labels**: `<Text>` - Field labels like "Name:", "Server:", etc.
5. **Selected Items**: `color="cyan"` - Applied automatically by SelectInput component
6. **Body/Instructions**: `<Text>` - User guidance, help text (never dimColor)
7. **Success Messages**: `<Text color="green">` - Confirmations, success states
8. **Error Messages**: `<Text color="red">` - Errors, warnings
9. **Decorative Only**: `<Text dimColor>` - Separator lines ONLY (never for actual text content)

### Examples

```tsx
// Screen header
<ScreenHeader title="Group Management" subtitle="Select a group to edit:" />

// Data display (bold = data, yellow = metadata, default = labels)
<Text>Group: <Text bold>my-group</Text></Text>
<Text>Server: <Text color="yellow">mcp-browser</Text></Text>
<Text>Tools: <Text color="yellow">(5)</Text></Text>

// Menu separator (only place for dimColor in text)
menuSeparator()  // or { label: repeat('─', 40), value: 'sep', disabled: true }

// Help text (default color, NOT dimColor)
<Text>Press Enter to save, Esc to cancel</Text>
```

### Spacing & Layout

- **Screen padding**: `padding={1}` standard
- **Section margins**: `marginBottom={1}` between major sections
- **Separator length**: 40 chars for menus via `menuSeparator()`

### Reusable Components

Located in `src/admin/components/ui/`:

- **ScreenHeader** - Standardized cyan bold headers with optional subtitle
- **ScreenFooter** - Help text/controls (not currently used but available)
- **LoadingScreen** - Consistent loading states
- **ErrorScreen** - Error display with troubleshooting tips
- **EmptyState** - "No items" messages
- **VirtualScrollList** - Virtual scrolling for long lists

### Virtual Scrolling

Apply to any list that could exceed terminal height:

```tsx
<VirtualScrollList
  items={menuItems}
  onSelect={handleSelect}
  fixedUIHeight={6}  // padding + header + margins
/>
```

The component automatically:
- Calculates viewport bounds
- Shows "N more above/below" indicators
- Handles keyboard navigation within viewport

## Sub-Agent Orchestration

- Treat Claude Code as a conductor. Delegate implementation work to the appropriate sub-agent (see `~/.claude/agents/*.md`).
- Handle only coordination, planning, and communication in the primary session; sub-agents perform analysis, coding, and execution.
- When delegating, remind sub-agents to follow the module guides and monitor tmux watchers.

## Watcher Windows

- Long-lived tmux windows: `sst-dev`, `tsc-watch`, `astro-watch`, `test-watch`. Do not close them once started.
- Check for existing windows before launching new watchers.
- Temporary windows you create must be cleaned up (Ctrl+C, exit shell).

## Common Pitfalls

- Forgetting to route work through sub-agents.
- Falling back to raw shell commands when an MCP tool exists.
- Ignoring ESLint diagnostics emitted by the post-edit hook.
- Running tests or checkers outside the watcher workflow.

# Engineering playbook

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

- **Admin Interface (`src/admin/`)**: Interactive TUI (Terminal User Interface) built with Ink (React for terminals) for:
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
- Admin TUI uses Ink components with React-based component architecture

### Ink/React Best Practices for Admin UI

**CRITICAL: Always use functional setState in `useInput` handlers**

When using Ink's `useInput` hook to handle keyboard navigation (arrow keys, etc.), you MUST use the functional form of `setState` to avoid race conditions with rapid input.

❌ **WRONG - Will fail with rapid keypresses:**
```typescript
useInput((input, key) => {
  if(key.downArrow) {
    setIndex(index + 1);  // Reads stale state!
  }
});
```

✅ **CORRECT - Works with rapid input:**
```typescript
useInput((input, key) => {
  if(key.downArrow) {
    setIndex(prevIndex => prevIndex + 1);  // Uses previous update's result
  }
});
```

**Why this matters:**
- The admin UI runs with Ink's `splitRapidInput: true` option enabled
- This splits rapid keypresses (e.g., from automation/testing) into separate events
- React state updates are asynchronous - multiple events in quick succession will all see the same stale state value
- Using functional `setState(prev => ...)` ensures each update builds on the previous one

**When to use functional setState:**
- ANY navigation logic in `useInput` handlers (arrow keys, page up/down, etc.)
- ANY state update that depends on the current value of that state
- Especially for: cursor position, selection index, scroll position, or any navigation state

**Examples in codebase:**
- `src/admin/components/SelectInput.tsx` - List navigation
- `src/admin/components/MultiLineTextEditor.tsx` - Cursor movement
- `src/admin/components/SchemaTransformationViewer.tsx` - Parameter navigation

## Future Enhancements (Not Yet Implemented)

- Pre/post-processing of tool calls (e.g., jq-style transformations)
- TypeScript plugins for custom tool argument/response munging
- SSE transport support for remote connections
- Web-based admin UI
- Group inheritance/composition
