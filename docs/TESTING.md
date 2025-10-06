# Testing Guide for MCP Proxy Processor

This guide covers manual and automated testing procedures for the MCP Proxy Processor, with a focus on testing resource and prompt fallback functionality.

## Overview

The MCP Proxy Processor supports three main MCP capabilities:
- **Tools**: Executable functions/commands
- **Resources**: Static or dynamic content (files, data, etc.)
- **Prompts**: Templated prompts for AI interactions

This testing guide focuses on validating the fallback system for resources and prompts across multiple backend servers.

## Test Configuration Files

Test configurations are located in `tests/fixtures/`:

### Backend Servers (`backend-servers-test.json`)

Defines test backend MCP servers:

- **time**: Simple time server (tools only)
- **calculator**: Math operations server (tools only)
- **everything**: Comprehensive test server with tools, resources, and prompts
- **filesystem**: File operations server with resource support

**Note:** These test configurations use the same format as production configs but include additional servers specifically for testing resource and prompt functionality.

### Using Test Configurations

Since the proxy looks for configs in `config/` by default, you have several options:

1. **Copy test configs to config directory:**
   ```bash
   cp tests/fixtures/backend-servers-test.json config/backend-servers.json
   cp tests/fixtures/groups-test.json config/groups.json
   ```

2. **Use symlinks (recommended for development):**
   ```bash
   ln -sf ../tests/fixtures/backend-servers-test.json config/backend-servers.json
   ln -sf ../tests/fixtures/groups-test.json config/groups.json
   ```

3. **Programmatic testing:** See the integration tests for examples of loading configs programmatically

### Test Groups (`groups-test.json`)

Defines test groups for different scenarios:

#### Tool Testing Groups
- `minimal`: Single tool from one server
- `basic`: Multiple tools from different servers
- `with_overrides`: Tool name and description overrides
- `duplicate_tools`: Same tool exposed under different names
- `schema_override`: Tool with input schema override

#### Resource Testing Groups
- `resource_test`: Resources from multiple backends (everything + filesystem)
- `resource_priority_test`: Demonstrates resource priority ordering with overlapping URIs

#### Prompt Testing Groups
- `prompt_test`: Prompts from the everything server

#### Combined Testing Groups
- `mixed_capabilities`: Tools, resources, and prompts together

## Manual Testing Procedures

### Prerequisites

1. **Set up test configurations:**
   ```bash
   # Use symlinks (recommended for development)
   ln -sf ../tests/fixtures/backend-servers-test.json config/backend-servers.json
   ln -sf ../tests/fixtures/groups-test.json config/groups.json
   ```

2. **Ensure all backend servers are properly installed:**
   ```bash
   # Test that servers can be invoked
   npx -y @modelcontextprotocol/server-everything --version
   npx -y @modelcontextprotocol/server-filesystem --version
   ```

3. **Create test data:**
   ```bash
   echo "Test resource content from filesystem server" > /tmp/test.txt
   ```

### Testing Resources

#### Basic Resource Test

1. **Start the proxy with resource_test group:**
   ```bash
   bun run dev serve resource_test
   ```

2. **Expected behavior:**
   - Proxy should connect to both `everything` and `filesystem` servers
   - Resources from both servers should be available
   - Check logs (stderr) for resource discovery messages

3. **Testing resource listing:**
   - Use an MCP client (like Claude Desktop or MCP Inspector)
   - List available resources
   - Verify resources from both backends appear

4. **Testing resource reading:**
   - Read `test://static/resource` (from everything server)
   - Read `file:///tmp/test.txt` (from filesystem server)
   - Verify correct content is returned

#### Resource Priority/Fallback Test

1. **Start the proxy with resource_priority_test group:**
   ```bash
   bun run dev serve resource_priority_test
   ```

2. **Test priority ordering:**
   - Resources are listed in group configuration order (top to bottom)
   - First matching resource URI wins
   - If a backend server fails, next server in list is tried

3. **Simulate backend failure:**
   - Start proxy normally
   - Kill the `everything` server process
   - Attempt to read resources
   - Verify fallback to `filesystem` server works

### Testing Prompts

#### Basic Prompt Test

1. **Start the proxy with prompt_test group:**
   ```bash
   bun run dev serve prompt_test
   ```

2. **Expected behavior:**
   - Proxy connects to `everything` server
   - Prompts from everything server are available

3. **Testing prompt listing:**
   - Use an MCP client to list available prompts
   - Verify `simple_prompt` appears

4. **Testing prompt execution:**
   - Get the `simple_prompt` with arguments
   - Verify correct prompt template is returned

### Testing Mixed Capabilities

1. **Start the proxy with mixed_capabilities group:**
   ```bash
   bun run dev serve mixed_capabilities
   ```

2. **Verify all capabilities:**
   - Tools from both `time` and `everything` servers
   - Resources from `everything` server
   - Prompts from `everything` server
   - All work independently and correctly

## Using MCP Inspector for Testing

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a visual testing tool for MCP servers.

### Setup

```bash
# Install MCP Inspector
npx @modelcontextprotocol/inspector
```

### Testing with Inspector

1. **Start your proxy:**
   ```bash
   bun run dev serve resource_test
   ```

2. **Connect Inspector:**
   - Point inspector to your proxy's stdio interface
   - Or use the proxy as a subprocess

3. **Verify capabilities:**
   - Check Tools tab for available tools
   - Check Resources tab for available resources
   - Check Prompts tab for available prompts
   - Execute tools/read resources/get prompts

## Automated Testing

### Integration Tests

Run the full test suite:
```bash
bun test
```

### Specific Resource Tests

```bash
# Run only resource-related tests
bun test --grep resource

# Run only prompt-related tests
bun test --grep prompt
```

## Common Issues and Troubleshooting

### Backend Server Won't Start

**Symptoms:**
- Proxy fails with "Failed to connect to backend server"
- No output from backend server

**Solutions:**
1. Verify server is installed:
   ```bash
   npx -y @modelcontextprotocol/server-everything --help
   ```

2. Check server command and args in config
3. Test server standalone:
   ```bash
   npx -y @modelcontextprotocol/server-everything
   ```
   (Should output JSON-RPC messages)

### Resources Not Appearing

**Symptoms:**
- Resources/list returns empty array
- Expected resources missing

**Solutions:**
1. Check group configuration has correct `resources` array
2. Verify backend server actually provides resources:
   ```bash
   # Use MCP Inspector to connect directly to backend
   ```
3. Check stderr logs for resource discovery messages
4. Verify URI format matches backend server's resources

### Prompts Not Appearing

**Symptoms:**
- Prompts/list returns empty array
- Expected prompts missing

**Solutions:**
1. Check group configuration has `prompts` array
2. Verify backend server supports prompts capability
3. Check stderr logs for prompt discovery messages
4. Verify prompt names match backend server's prompts

### Resource Fallback Not Working

**Symptoms:**
- Reading resource fails instead of falling back to next server
- Wrong server handles resource request

**Solutions:**
1. Verify resources are listed in priority order in group config
2. Check URI patterns - they might not overlap as expected
3. Review resource routing logic in middleware
4. Check logs for which server handled the request

### Performance Issues

**Symptoms:**
- Slow response times
- Timeouts

**Solutions:**
1. Check if backend servers are responsive (test standalone)
2. Reduce number of resources in group
3. Use URI templates instead of listing all resources
4. Check for network latency if using remote servers

## Advanced Testing Scenarios

### Testing URI Templates

Some servers (like `everything`) support resource URI templates with parameters.

**Example:**
```json
{
  "resources": [
    {
      "serverName": "everything",
      "uriTemplate": "test://dynamic/{id}"
    }
  ]
}
```

**Testing:**
1. List resources - should show template
2. Read with specific URI: `test://dynamic/123`
3. Verify parameter is passed to backend

### Testing Resource Subscriptions

Some servers support resource subscriptions for change notifications.

**Testing:**
1. Subscribe to a resource URI
2. Modify the resource (if backend supports it)
3. Verify subscription notifications are received

### Stress Testing

Test with many resources:

1. Configure group with 100+ resources
2. Start proxy and measure startup time
3. List all resources and measure response time
4. Read resources sequentially and measure throughput

## Continuous Integration

For CI/CD pipelines:

```bash
# Set up test configs (if not already done)
ln -sf ../tests/fixtures/backend-servers-test.json config/backend-servers.json
ln -sf ../tests/fixtures/groups-test.json config/groups.json

# Run all tests
bun test

# Generate coverage report (if coverage tooling is set up)
bun test --coverage
```

## Test Data Setup

For filesystem resource testing:

```bash
# Create test file
echo "Test resource content" > /tmp/test.txt

# Create test directory structure
mkdir -p /tmp/mcp-test/resources
echo "Resource 1" > /tmp/mcp-test/resources/r1.txt
echo "Resource 2" > /tmp/mcp-test/resources/r2.txt
```

## Validating Configuration

Before testing, validate your configurations:

```bash
# Validate JSON syntax
bun run -e "require('./tests/fixtures/backend-servers-test.json')"
bun run -e "require('./tests/fixtures/groups-test.json')"

# Check schema validation (if validation script exists)
bun run validate-config
```

## Debugging Tips

1. **Enable verbose logging:**
   ```bash
   DEBUG=mcp:* bun run dev serve resource_test
   ```

2. **Monitor stderr:**
   All MCP logging goes to stderr (stdout is reserved for JSON-RPC)
   ```bash
   bun run dev serve resource_test 2>&1 | tee debug.log
   ```

3. **Test backend servers independently:**
   ```bash
   # Start a backend server standalone
   npx -y @modelcontextprotocol/server-everything
   ```
   Then manually send JSON-RPC messages

4. **Use MCP Inspector:**
   Visual tool shows all capabilities and allows interactive testing

## Next Steps

After validating basic functionality:

1. Test with real-world MCP servers (GitHub, Google Drive, etc.)
2. Test resource override functionality (name, description changes)
3. Test error handling and fallback mechanisms
4. Performance testing with large numbers of resources
5. Test resource template substitution
6. Test subscription support if applicable
