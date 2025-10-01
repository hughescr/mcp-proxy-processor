# Troubleshooting Guide

This guide covers common issues, debugging techniques, and frequently asked questions for MCP Proxy Processor.

## Table of Contents

- [Common Issues](#common-issues)
  - [Backend Server Won't Start](#backend-server-wont-start)
  - [Tool Not Found Errors](#tool-not-found-errors)
  - [Group Configuration Errors](#group-configuration-errors)
  - [stdio Transport Issues](#stdio-transport-issues)
  - [Claude Desktop Integration Problems](#claude-desktop-integration-problems)
- [Debugging Tips](#debugging-tips)
  - [Checking Logs](#checking-logs)
  - [Verifying Backend Connections](#verifying-backend-connections)
  - [Testing Groups Manually](#testing-groups-manually)
  - [Inspecting MCP Messages](#inspecting-mcp-messages)
- [FAQ](#faq)
- [Known Limitations](#known-limitations)

## Common Issues

### Backend Server Won't Start

**Symptom:** Error message like "Failed to start backend server" or "Backend server 'calculator' crashed"

**Common Causes:**

1. **Missing Dependencies**
   ```bash
   # For Python-based servers (uvx)
   # Install uv if not already installed
   curl -LsSf https://astral.sh/uv/install.sh | sh

   # For Node-based servers (npx/bunx)
   # Ensure Node.js and/or Bun are installed
   bun --version
   node --version
   ```

2. **Wrong Command Path**

   Check if the command in `backend-servers.json` is correct:
   ```json
   {
     "mcpServers": {
       "time": {
         "command": "uvx",  // ← Check this exists in PATH
         "args": ["mcp-server-time@latest"]
       }
     }
   }
   ```

   Verify the command:
   ```bash
   which uvx
   which bunx
   which npx
   ```

   Use absolute paths if needed:
   ```json
   {
     "command": "/opt/homebrew/bin/uvx"
   }
   ```

3. **Missing API Keys**

   Some servers require environment variables:
   ```json
   {
     "mcpServers": {
       "search": {
         "command": "bunx",
         "args": ["--bun", "mcp-omnisearch@latest"],
         "env": {
           "BRAVE_API_KEY": "your-key-here",  // ← Required!
           "PERPLEXITY_API_KEY": "your-key-here"
         }
       }
     }
   }
   ```

4. **Server Package Not Found**

   The package might not exist or have a different name:
   ```bash
   # Test installing the package directly
   uvx mcp-server-time@latest --help
   bunx --bun @playwright/mcp@latest --help
   ```

**Solution Steps:**

1. Test the command manually:
   ```bash
   # Try running the exact command from backend-servers.json
   uvx mcp-server-time@latest
   ```

2. Check stderr output:
   ```bash
   # Run with verbose logging
   MCP_PROXY_LOG_LEVEL=debug mcp-proxy --serve standard_tools
   ```

3. Verify the package exists and is up-to-date:
   ```bash
   # For Python packages
   uvx --from mcp-server-time mcp-server-time --help

   # For Node packages
   bunx --bun @playwright/mcp@latest --help
   ```

### Tool Not Found Errors

**Symptom:** "Tool 'calculate' not found in backend server 'calculator'"

**Common Causes:**

1. **Wrong Tool Name**

   Tool names must match exactly what the backend server exposes.

   **How to find the correct tool name:**
   ```bash
   # Use the admin interface
   mcp-proxy --admin
   # Navigate to "Discover Backend Tools" to see all available tools
   ```

   Or manually test the backend:
   ```bash
   # Start the backend server
   uvx calculator-mcp-server --stdio

   # In another terminal, send a tools/list request
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | uvx calculator-mcp-server --stdio
   ```

2. **Server Name Mismatch**

   The `serverName` in `groups.json` must match the key in `backend-servers.json`:

   **backend-servers.json:**
   ```json
   {
     "mcpServers": {
       "calculator": {  // ← This is the server name
         "command": "uvx",
         "args": ["calculator-mcp-server"]
       }
     }
   }
   ```

   **groups.json:**
   ```json
   {
     "tools": [
       {
         "serverName": "calculator",  // ← Must match exactly
         "originalName": "calculate"
       }
     ]
   }
   ```

3. **Backend Server Not Started**

   The middleware only starts backend servers that are needed by the group. If you reference a tool from a server that isn't in your group, it won't be available.

**Solution:**

1. Use the admin interface to discover available tools
2. Copy tool names exactly (case-sensitive)
3. Verify server names match between config files
4. Test the backend server independently

### Group Configuration Errors

**Symptom:** "Invalid group configuration" or validation errors when starting the proxy

**Common Causes:**

1. **Invalid JSON Syntax**
   ```bash
   # Validate JSON syntax
   cat config/groups.json | jq
   ```

   Common JSON errors:
   - Missing commas between objects
   - Trailing commas (not allowed in JSON)
   - Unquoted keys or values
   - Unescaped quotes in strings

2. **Missing Required Fields**

   Every tool entry requires `serverName` and `originalName`:
   ```json
   {
     "tools": [
       {
         "serverName": "calculator",  // Required
         "originalName": "calculate"  // Required
       }
     ]
   }
   ```

3. **Schema Validation Errors**

   The configuration is validated against Zod schemas. Check the error message for which field is invalid.

   Example error:
   ```
   Error: Invalid group configuration for 'standard_tools':
   - tools[0].serverName: Required
   ```

**Solution:**

1. Validate JSON syntax with `jq`:
   ```bash
   jq . config/groups.json
   ```

2. Use the admin interface to generate valid configurations

3. Check against the schema in `src/types/config.ts`

4. Start with a minimal configuration and add tools incrementally

### stdio Transport Issues

**Symptom:** Communication errors, hanging connections, or "Protocol error" messages

**Common Causes:**

1. **Logging to stdout**

   MCP servers use stdio for protocol messages. Anything written to stdout will corrupt the message stream.

   **Wrong:**
   ```typescript
   console.log('Starting server...'); // ❌ Breaks protocol
   ```

   **Correct:**
   ```typescript
   console.error('Starting server...'); // ✅ Logs to stderr
   ```

2. **Buffering Issues**

   Stdio messages must be newline-delimited. Partial messages will cause protocol errors.

3. **Binary Data Corruption**

   Ensure all messages are UTF-8 encoded text, not binary data.

4. **Zombie Processes**

   If a backend server crashes, it might leave zombie processes that hold stdio connections.

   ```bash
   # Check for zombie processes
   ps aux | grep mcp

   # Kill stuck processes
   pkill -f "mcp-proxy"
   pkill -f "mcp-server-time"
   ```

**Solution:**

1. Never write to stdout in MCP servers - use stderr for all logging

2. Flush output after each message (usually automatic)

3. Check that backend servers are using stdio transport correctly

4. Restart Claude Desktop to clear stuck connections

### Claude Desktop Integration Problems

**Symptom:** MCP Proxy doesn't appear in Claude Desktop, or tools aren't available

**Common Causes:**

1. **Wrong Config File Location**

   Claude Desktop config location varies by OS:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. **Invalid JSON in Claude Config**
   ```bash
   # Validate Claude Desktop config
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq
   ```

3. **Wrong Command Path**

   If you didn't install globally with `bun link`, use the full path:
   ```json
   {
     "mcpServers": {
       "standard_tools": {
         "command": "/path/to/mcp-proxy-processor/dist/cli.js",
         "args": ["--serve", "standard_tools"]
       }
     }
   }
   ```

   Or use the development command:
   ```json
   {
     "command": "bun",
     "args": ["run", "/path/to/mcp-proxy-processor/src/cli.ts", "--serve", "standard_tools"]
   }
   ```

4. **Group Doesn't Exist**

   The group name in `--serve` must match a group in `config/groups.json`:
   ```json
   {
     "args": ["--serve", "standard_tools"]  // ← Must exist in groups.json
   }
   ```

5. **Permission Issues**

   The executable might not have execute permissions:
   ```bash
   chmod +x dist/cli.js
   ```

**Solution:**

1. Verify config file location and syntax
2. Test the command manually first:
   ```bash
   mcp-proxy --serve standard_tools
   # Should start without errors and wait for input
   ```
3. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`
   - Look for errors related to MCP servers

4. Restart Claude Desktop after configuration changes

5. Use absolute paths if relative paths don't work

## Debugging Tips

### Checking Logs

**Enable Debug Logging:**

```bash
# Set log level to debug
export MCP_PROXY_LOG_LEVEL=debug
mcp-proxy --serve standard_tools

# Or inline
MCP_PROXY_LOG_LEVEL=debug mcp-proxy --serve standard_tools
```

**What to Look For:**

- Backend server startup messages
- Tool discovery results
- Group loading confirmation
- Request/response messages
- Error stack traces

**Claude Desktop Logs:**

```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp*.log

# Linux
tail -f ~/.config/Claude/logs/mcp*.log
```

### Verifying Backend Connections

**Test Backend Server Independently:**

```bash
# Start the backend server directly
uvx mcp-server-time@latest --local-timezone=America/Los_Angeles

# In another terminal, send a request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  uvx mcp-server-time@latest --local-timezone=America/Los_Angeles
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_current_time",
        "description": "Get the current time in a specific timezone",
        "inputSchema": { ... }
      }
    ]
  }
}
```

**Using the Admin Interface:**

```bash
mcp-proxy --admin
# Select "Discover Backend Tools"
# This will show all tools from all configured backends
```

### Testing Groups Manually

**Test a Group Without Claude:**

```bash
# Start the proxy
mcp-proxy --serve standard_tools

# In another terminal, test tools/list
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  mcp-proxy --serve standard_tools | jq

# Test a specific tool call
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"calculate","arguments":{"expression":"2+2"}}}' | \
  mcp-proxy --serve standard_tools | jq
```

**Use MCP Inspector:**

The official MCP Inspector provides a GUI for testing:

```bash
npx @modelcontextprotocol/inspector mcp-proxy --serve standard_tools
```

This opens a web interface where you can:
- See all available tools
- Call tools with a form-based interface
- View request/response history
- Debug protocol issues

### Inspecting MCP Messages

**Capture All Messages:**

```bash
# Use tee to capture both input and output
mcp-proxy --serve standard_tools 2>&1 | tee mcp-debug.log
```

**Log to File:**

```bash
# Redirect stderr to a file
mcp-proxy --serve standard_tools 2>debug.log
```

**Pretty-Print JSON Messages:**

```bash
# Pipe through jq for readable output
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  mcp-proxy --serve standard_tools | jq -C
```

## FAQ

### Q: Can I use the same backend server in multiple groups?

**A:** Yes! You can reference the same backend server in multiple groups with different tool selections.

Example:
```json
{
  "groups": {
    "basic_math": {
      "tools": [
        {"serverName": "calculator", "originalName": "calculate"}
      ]
    },
    "advanced_math": {
      "tools": [
        {"serverName": "calculator", "originalName": "calculate"},
        {"serverName": "calculator", "originalName": "solve"},
        {"serverName": "calculator", "originalName": "differentiate"}
      ]
    }
  }
}
```

### Q: What happens if a backend server crashes?

**A:** The proxy will attempt to reconnect automatically. If the backend server is unrecoverable, tool calls to that server will fail with an error. Other tools from different backend servers will continue to work.

### Q: Can I override tool input schemas?

**A:** Yes! You can provide a custom `inputSchema` in the tool override:

```json
{
  "serverName": "calculator",
  "originalName": "calculate",
  "inputSchema": {
    "type": "object",
    "properties": {
      "expression": {
        "type": "string",
        "description": "Mathematical expression to evaluate"
      }
    },
    "required": ["expression"]
  }
}
```

This is useful for fixing incorrect schemas or simplifying complex ones.

### Q: How do I add resource overrides?

**A:** Resources work the same as tools:

```json
{
  "resources": [
    {
      "serverName": "filesystem",
      "originalUri": "file:///workspace",
      "name": "workspace",
      "description": "Access to workspace files",
      "mimeType": "application/json"
    }
  ]
}
```

### Q: Can I rename tools?

**A:** Yes! Use the `name` field to override the tool name:

```json
{
  "serverName": "calculator",
  "originalName": "calculate",
  "name": "math_eval"  // ← New name
}
```

Claude will see the tool as `math_eval` instead of `calculate`.

### Q: Do I need to restart Claude Desktop after changing configurations?

**A:** Yes, Claude Desktop loads MCP servers on startup. You need to restart Claude Desktop for configuration changes to take effect.

### Q: Can I use environment variables in configurations?

**A:** Not directly in JSON files, but you can use environment variables in the backend server `env` section:

```json
{
  "mcpServers": {
    "search": {
      "command": "bunx",
      "args": ["--bun", "mcp-omnisearch@latest"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"  // ❌ Won't work
      }
    }
  }
}
```

Instead, set the environment variable when running the proxy:
```bash
export BRAVE_API_KEY="your-key"
```

Or use Claude Desktop's environment:
```json
{
  "mcpServers": {
    "search": {
      "command": "bash",
      "args": ["-c", "BRAVE_API_KEY=$BRAVE_API_KEY bunx --bun mcp-omnisearch@latest"]
    }
  }
}
```

### Q: How do I contribute a fix or enhancement?

**A:** Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

See the README for development setup instructions.

### Q: Is there a web-based admin interface?

**A:** Not yet, but it's on the roadmap! For now, use the terminal-based admin interface (`mcp-proxy --admin`).

### Q: Can I use the proxy with other MCP clients besides Claude Desktop?

**A:** Yes! Any MCP client that supports stdio transport can use the proxy. Test with the MCP Inspector or build your own client.

## Known Limitations

### Current Version Limitations

1. **stdio Transport Only**
   - Currently only supports stdio transport
   - SSE (Server-Sent Events) transport planned for future release
   - This means remote connections aren't supported yet

2. **No Pre/Post-Processing**
   - Tool call transformations not yet implemented
   - Can't filter or modify tool arguments/responses
   - Planned for future release

3. **No Group Inheritance**
   - Can't compose groups from other groups
   - Must duplicate tool definitions across groups
   - Planned for future release

4. **No Tool Call Caching**
   - Every tool call goes to the backend server
   - No memoization or caching layer
   - May add in future for idempotent operations

5. **Limited Resource Support**
   - Resource overrides work but aren't as well-tested as tool overrides
   - Resource templates and dynamic resources not yet supported

6. **No Rate Limiting**
   - Can't limit requests to backend servers
   - Backend server crashes can cascade
   - Planned for future release

### Design Limitations

1. **Backend Server Must Support stdio**
   - All backend servers must use stdio transport
   - Can't proxy to HTTP/SSE MCP servers (yet)

2. **Configuration Reload Requires Restart**
   - Configuration changes require proxy restart
   - Hot reload not implemented

3. **No Multi-User Support**
   - Designed for single-user/single-agent scenarios
   - Not suitable for multi-tenant deployments

### Performance Considerations

1. **Startup Time**
   - Backend servers start on proxy startup
   - More backend servers = longer startup time
   - Lazy loading planned for future release

2. **Memory Usage**
   - Each backend server runs as a separate process
   - Can be memory-intensive with many backends

3. **Protocol Overhead**
   - Every tool call goes through two protocol layers (frontend → middleware → backend)
   - Adds some latency compared to direct backend connections

### Workarounds

- **For remote backends:** Run the proxy on the same machine as the backend servers
- **For slow startups:** Start the proxy once and keep it running
- **For memory concerns:** Use multiple groups with different backend subsets instead of one large group
- **For rate limiting:** Implement at the backend server level

## Getting Help

If you encounter an issue not covered here:

1. **Check Existing Issues:** https://github.com/hughescr/mcp-proxy-processor/issues
2. **Open a New Issue:** Provide:
   - Error messages (full stack trace)
   - Configuration files (redact sensitive data)
   - Steps to reproduce
   - Environment details (OS, Node/Bun version)
3. **Discussions:** For questions and general help

## Additional Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Servers List](https://github.com/modelcontextprotocol/servers)
- [Claude Desktop Documentation](https://docs.anthropic.com/)
- [Project README](./README.md)
