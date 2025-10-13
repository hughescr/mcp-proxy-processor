# Development Guide

## Overview

MCP Proxy Processor is built with Bun and TypeScript. This guide covers setting up a development environment, running tests, building for distribution, and contributing to the project.

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- Node.js 24.x or later (for runtime compatibility testing)
- Git with git-flow (optional but recommended)

## Setup from Source

### 1. Clone Repository

```bash
git clone https://github.com/hughescr/mcp-proxy-processor.git
cd mcp-proxy-processor
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Build

```bash
bun run build
```

This creates `dist/cli.js` - a standalone Node.js-compatible executable.

### 4. Link Globally (Optional)

```bash
bun link
```

Now the `mcp-proxy` command is available globally for development.

## Development Workflow

### Running in Dev Mode

```bash
# Serve a group
bun run dev serve standard_tools

# Launch admin interface
bun run dev admin

# List all groups
bun run dev list-groups

# Describe a specific group
bun run dev describe-group standard_tools

# List backend servers
bun run dev list-backends

# Validate configuration files
bun run dev validate
```

### Code Quality

```bash
# Lint and auto-fix
bun run lint

# Type check
tsc

# Run tests
bun test

# Full validation (lint + typecheck + test)
bun run full-test
```

## Testing

### Overview

The MCP Proxy Processor test suite covers three main MCP capabilities:
- **Tools**: Executable functions/commands
- **Resources**: Static or dynamic content (files, data, etc.)
- **Prompts**: Templated prompts for AI interactions

### Test Structure

Tests are organized in the `tests/` directory:

```
tests/
├── fixtures/           # Test configurations
│   ├── backend-servers-test.json
│   └── groups-test.json
├── unit/              # Unit tests
│   ├── argument-transformer.test.ts
│   └── ...
└── integration/       # Integration tests
    ├── argument-mapping.test.ts
    └── ...
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/unit/argument-transformer.test.ts

# Run tests matching a pattern
bun test --grep resource
bun test --grep prompt
```

### Test Configurations

Test configurations are in `tests/fixtures/`:

#### Backend Servers (`backend-servers-test.json`)

Defines test backend MCP servers:
- **time**: Simple time server (tools only)
- **calculator**: Math operations server (tools only)
- **everything**: Comprehensive test server with tools, resources, and prompts
- **filesystem**: File operations server with resource support

#### Test Groups (`groups-test.json`)

Defines test groups for different scenarios:

**Tool Testing Groups:**
- `minimal`: Single tool from one server
- `basic`: Multiple tools from different servers
- `with_overrides`: Tool name and description overrides
- `duplicate_tools`: Same tool exposed under different names
- `schema_override`: Tool with input schema override

**Resource Testing Groups:**
- `resource_test`: Resources from multiple backends
- `resource_priority_test`: Resource priority ordering with overlapping URIs

**Prompt Testing Groups:**
- `prompt_test`: Prompts from the everything server

**Combined Testing Groups:**
- `mixed_capabilities`: Tools, resources, and prompts together

### Using Test Configurations

To test with the test fixtures:

```bash
# Option 1: Copy test configs to config directory
cp tests/fixtures/backend-servers-test.json config/backend-servers.json
cp tests/fixtures/groups-test.json config/groups.json

# Option 2: Use symlinks (recommended for development)
ln -sf ../tests/fixtures/backend-servers-test.json config/backend-servers.json
ln -sf ../tests/fixtures/groups-test.json config/groups.json
```

### Manual Testing Procedures

#### Testing Resources

1. **Start the proxy with resource_test group:**
   ```bash
   bun run dev serve resource_test
   ```

2. **Expected behavior:**
   - Proxy connects to both `everything` and `filesystem` servers
   - Resources from both servers are available
   - Check logs (stderr) for resource discovery messages

3. **Testing resource listing:**
   - Use an MCP client (like Claude Desktop or MCP Inspector)
   - List available resources
   - Verify resources from both backends appear

4. **Testing resource reading:**
   - Read `test://static/resource` (from everything server)
   - Read `file:///tmp/test.txt` (from filesystem server)
   - Verify correct content is returned

#### Testing Prompts

1. **Start the proxy with prompt_test group:**
   ```bash
   bun run dev serve prompt_test
   ```

2. **Testing prompt listing:**
   - Use an MCP client to list available prompts
   - Verify `simple_prompt` appears

3. **Testing prompt execution:**
   - Get the `simple_prompt` with arguments
   - Verify correct prompt template is returned

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a visual testing tool for MCP servers.

```bash
# Install and run MCP Inspector
npx @modelcontextprotocol/inspector mcp-proxy serve standard_tools
```

This opens a web interface where you can:
- See all available tools, resources, and prompts
- Call tools with a form-based interface
- Read resources
- View request/response history
- Debug protocol issues

### Automated Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test tests/unit/argument-transformer.test.ts
bun test tests/integration/argument-mapping.test.ts

# Run with coverage (if configured)
bun test --coverage
```

### Common Testing Issues

#### Backend Server Won't Start

**Solutions:**
1. Verify server is installed:
   ```bash
   npx -y @modelcontextprotocol/server-everything --help
   ```
2. Check server command and args in config
3. Test server standalone

#### Resources Not Appearing

**Solutions:**
1. Check group configuration has correct `resources` array
2. Verify backend server actually provides resources
3. Check stderr logs for resource discovery messages
4. Verify URI format matches backend server's resources

#### Prompts Not Appearing

**Solutions:**
1. Check group configuration has `prompts` array
2. Verify backend server supports prompts capability
3. Check stderr logs for prompt discovery messages
4. Verify prompt names match backend server's prompts

## Architecture

### Three-Tier Architecture

The project follows a three-tier architecture:

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

### 1. Backend Layer (`src/backend/`)

- Manages connections to backend MCP servers
- Launches servers as stdio subprocesses based on `config/backend-servers.json`
- Maintains MCP client connections to backend servers
- Proxies tool/resource/prompt requests to appropriate backend servers
- Backend configuration format matches Claude Desktop's `mcp.json` format

### 2. Middleware Layer (`src/middleware/`)

- Loads and manages group configurations from `config/groups.json`
- Maps backend tools/resources/prompts to named groups
- Applies overrides to tool/resource/prompt definitions (name, description, schema)
- Transforms arguments with argument mapping feature
- Determines which backend servers are needed for a given group
- Validates group configurations against Zod schemas

### 3. Frontend Layer (`src/frontend/`)

- Exposes an MCP server using stdio transport
- Serves tools/resources/prompts for a specific group (specified via CLI argument)
- Routes incoming tool calls to appropriate backend servers
- Returns responses to the MCP client (e.g., Claude Desktop)

### Additional Components

#### CLI (`src/cli.ts`)

Entry point with multiple commands:
- `serve <groupname>`: Start MCP server for a group
- `admin`: Launch interactive admin UI
- `list-groups`: List all configured groups
- `describe-group <name>`: Show group details
- `list-backends`: List backend servers
- `validate`: Validate configuration files

#### Admin Interface (`src/admin/`)

Interactive TUI (Terminal User Interface) built with Ink (React for terminals) for:
- Discovering available backend tools/resources/prompts
- Creating/editing groups
- Adding/removing tools from groups
- Overriding tool definitions
- Configuring argument mappings
- Saving configurations

#### Types (`src/types/`)

Shared TypeScript types and Zod schemas for configuration validation.

### MCP Protocol Details

#### Transport

- All communication uses **stdio transport** (standard input/output)
- Messages use JSON-RPC 2.0 format, UTF-8 encoded
- Messages are newline-delimited
- Logging should go to stderr to avoid corrupting the protocol stream

#### Message Flow

1. Client (Claude Desktop) launches `mcp-proxy serve <group>` as subprocess
2. Client and proxy exchange initialization messages
3. Client requests tool/resource/prompt lists
4. Client invokes tools; proxy routes to backend servers
5. Backend servers execute and return results
6. Proxy returns results to client

#### Key Protocol Operations

- `initialize`: Handshake and capability negotiation
- `tools/list`: Get available tools for the group
- `tools/call`: Execute a tool
- `resources/list`: Get available resources
- `resources/read`: Read a resource
- `prompts/list`: Get available prompts
- `prompts/get`: Get a prompt template

## Building for Distribution

### Build Process

The build uses Bun's bundler to create a standalone Node.js-compatible executable:

```bash
bun run build
```

This process:
1. Bundles `src/cli.ts` with all dependencies
2. Targets Node.js runtime (not Bun-specific)
3. Adds shebang `#!/usr/bin/env node`
4. Makes output executable
5. Outputs to `dist/cli.js`

The bundled file is a single standalone JavaScript file that runs on any Node.js 24+ runtime.

### Package Structure

From `package.json`:

```json
{
  "name": "@hughescr/mcp-proxy-processor",
  "bin": {
    "mcp-proxy": "./dist/cli.js"
  },
  "files": [
    "dist/cli.js",
    "docs/ARGUMENT_MAPS.md",
    "docs/RESOURCES_AND_PROMPTS.md",
    "README.md",
    "TROUBLESHOOTING.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=24.x"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### Publishing to npm

The project uses git-flow with automated release management via the `postversion` script. Here's the complete workflow:

```bash
# 1. Start on develop branch
git checkout develop

# 2. Pull all changes and prune deleted remote branches
git pull --all -p

# 3. Ensure clean state
# - No merge conflicts
# - All changes committed
# - Working directory clean
git status  # Should show "nothing to commit, working tree clean"

# 4. Bump version (WITHOUT creating git tag - handled by postversion script)
npm version --no-git-tag-version patch  # or minor, major

# The postversion script now automatically:
# - Commits package.json with version bump
# - Runs: git flow release start $VERSION
# - Runs: git flow release finish -m $VERSION $VERSION
#   - Merges to main
#   - Tags the release
#   - Merges back to develop
# - Checks out develop

# 5. Push everything to remote (assuming 'github' is your remote name)
git push github main develop --follow-tags

# 6. Publish to npm (prepublishOnly ensures build runs first)
bun publish
```

**Important Notes:**
- Always start from `develop` branch, not `main`
- Use `--no-git-tag-version` because the `postversion` script handles git operations
- The `postversion` script requires `git flow` to be initialized for the repository
- Replace `github` with your actual remote name (check with `git remote -v`)
- The `prepublishOnly` hook ensures `bun run build` executes before publishing

### Version Management

The project uses git-flow with automated version management:

```json
{
  "postversion": "git commit -m \"Bump package version to $npm_package_version\" package.json; git flow release start $npm_package_version; git flow release finish -m $npm_package_version $npm_package_version; git checkout develop; git merge main"
}
```

This automatically:
1. Commits the version bump to develop
2. Creates a git-flow release branch
3. Finishes the release (merges to main and creates tag)
4. Merges back to develop
5. Checks out develop

## Contributing

### Git Workflow

We use git-flow:
- `main` - stable releases only
- `develop` - active development (default branch)
- `feature/*` - new features (branch from develop)
- `hotfix/*` - urgent fixes (branch from main)

### Submitting Changes

1. Fork the repository
2. Create a feature branch from `develop`:
   ```bash
   git checkout develop
   git pull
   git checkout -b feature/my-feature
   ```
3. Make your changes with tests
4. Run full validation:
   ```bash
   bun run full-test
   ```
5. Commit with clear messages:
   ```bash
   git commit -m "Add feature: description"
   ```
6. Push to your fork:
   ```bash
   git push origin feature/my-feature
   ```
7. Submit a Pull Request to `develop` branch

### Code Style

- **Linting**: ESLint with `@hughescr/eslint-config-default`
- **TypeScript**: Strict mode enabled
- **Patterns**: Functional patterns with lodash preferred
- **Validation**: Zod for runtime configuration validation
- **Logging**: Use stderr for all logging (never stdout in MCP servers)
- **Imports**: Use absolute imports for cross-module dependencies

### Admin UI Guidelines

The admin TUI uses Ink (React for terminals) with specific design patterns:

#### Semantic Bold Principle

**Bold (default color) is used EXCLUSIVELY for data values and primary content.**

This creates a visual language where bold always means "this is the data" - never for labels, headers, or decorative text.

#### Typography & Color Hierarchy

1. **Screen Title (H1)**: `<Text bold color="cyan">` - Top-level screen headers
2. **Data Values**: `<Text bold>` - ALL editable data, primary content
3. **Metadata/Context**: `<Text color="yellow">` - Server names, counts, types
4. **Labels**: `<Text>` - Field labels like "Name:", "Server:"
5. **Selected Items**: `color="cyan"` - Applied automatically by SelectInput
6. **Body/Instructions**: `<Text>` - User guidance, help text
7. **Success Messages**: `<Text color="green">` - Confirmations
8. **Error Messages**: `<Text color="red">` - Errors, warnings
9. **Decorative Only**: `<Text dimColor>` - Separator lines ONLY

#### Critical: Functional setState in useInput

**ALWAYS use functional setState in `useInput` handlers:**

```typescript
// ❌ WRONG - Will fail with rapid keypresses
useInput((input, key) => {
  if(key.downArrow) {
    setIndex(index + 1);  // Reads stale state!
  }
});

// ✅ CORRECT - Works with rapid input
useInput((input, key) => {
  if(key.downArrow) {
    setIndex(prevIndex => prevIndex + 1);  // Uses previous update's result
  }
});
```

The admin UI runs with Ink's `splitRapidInput: true` option, which splits rapid keypresses into separate events. React state updates are asynchronous, so multiple events in quick succession will all see the same stale state value. Using functional `setState(prev => ...)` ensures each update builds on the previous one.

### Documentation

When adding features:
- Update README.md if it affects user-facing functionality
- Add examples to relevant docs/ files
- Include JSDoc comments in source code
- Update TROUBLESHOOTING.md if adding common issues
- Add integration tests demonstrating the feature

## Roadmap

### Completed ✓

- [x] Basic proxy functionality
- [x] Group configuration
- [x] Tool overrides (name, description, inputSchema)
- [x] Resource overrides (name, description, mimeType)
- [x] Prompt support with priority fallback
- [x] Argument mapping (template & JSONata transformations)
- [x] Admin UI for argument mapping configuration
- [x] Admin CLI interface (Ink-based TUI)
- [x] Backend server management
- [x] MCP client connections to backends
- [x] Tool/resource/prompt discovery from backends
- [x] Frontend MCP server with stdio transport
- [x] Request proxying to backend servers
- [x] Group-based tool/resource/prompt filtering

### Planned Future Enhancements

- [ ] Response transformation (JSONata-based post-processing)
- [ ] Custom JSONata functions via plugin system (using `registerFunction` API)
- [ ] SSE transport support for remote connections
- [ ] Web-based admin UI
- [ ] Group inheritance/composition
- [ ] Rate limiting per backend server
- [ ] Metrics and monitoring dashboard
- [ ] Tool call caching for idempotent operations
- [ ] Hot reload of configuration files
- [ ] Multi-user/multi-tenant support

## Additional Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Servers List](https://github.com/modelcontextprotocol/servers)
- [Claude Desktop Documentation](https://docs.anthropic.com/)
- [Bun Documentation](https://bun.sh/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [JSONata Documentation](https://jsonata.org/)

## Getting Help

If you encounter issues while developing:

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues
2. Search existing [GitHub Issues](https://github.com/hughescr/mcp-proxy-processor/issues)
3. Ask in [GitHub Discussions](https://github.com/hughescr/mcp-proxy-processor/discussions)
4. Open a new issue with:
   - Error messages and stack traces
   - Steps to reproduce
   - Environment details (OS, Node/Bun version)
   - Configuration files (redact sensitive data)
