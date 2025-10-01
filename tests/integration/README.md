# Integration Tests

Integration tests for the MCP Proxy Processor that test components working together.

## Purpose

Integration tests verify:

1. **Backend Server Connections**: Real MCP server initialization and communication
2. **End-to-End Flows**: Complete request/response cycles through all layers
3. **Multi-Component Integration**: Backend, middleware, and frontend working together
4. **Error Propagation**: Errors handled correctly across component boundaries
5. **Real Protocol**: Actual MCP protocol message exchange

## Organization

```
tests/integration/
├── backend-proxy.test.ts      # Backend server connection and tool execution
├── frontend-server.test.ts    # Frontend MCP server with real groups
├── full-stack.test.ts         # Complete proxy flow end-to-end
└── error-handling.test.ts     # Error scenarios across components
```

## Writing Integration Tests

Integration tests should:

1. **Test realistic scenarios**: Use real configurations and data flows
2. **Test component boundaries**: Verify data transformation between layers
3. **Be slower**: Integration tests can take seconds (vs milliseconds for unit tests)
4. **Use real dependencies**: Connect to actual backend servers when possible
5. **Clean up resources**: Properly disconnect and cleanup after tests

## Example Integration Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { loadBackendServersFixture, loadGroupsFixture } from '../../utils/test-helpers.js';
import { BackendServerManager } from '../../../src/backend/server-manager.js';

describe('Backend Integration', () => {
    let manager: BackendServerManager;

    beforeAll(async () => {
        const config = await loadBackendServersFixture();
        manager = new BackendServerManager(config);
        await manager.startServer('time');
    });

    afterAll(async () => {
        await manager.stopAll();
    });

    it('should connect to backend server and list tools', async () => {
        const client = manager.getClient('time');
        expect(client).toBeDefined();

        const result = await client.listTools();
        expect(result.tools).toBeDefined();
        expect(result.tools.length).toBeGreaterThan(0);
    });
});
```

## Testing Patterns

### Setup and Teardown

Use Bun's lifecycle hooks:

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

beforeAll(async () => {
    // Setup that runs once before all tests
    await initializeServers();
});

afterAll(async () => {
    // Cleanup that runs once after all tests
    await shutdownServers();
});

beforeEach(() => {
    // Setup that runs before each test
});

afterEach(() => {
    // Cleanup that runs after each test
});
```

### Timeout Configuration

Integration tests may need longer timeouts:

```typescript
it('should complete long operation', async () => {
    // Test code
}, { timeout: 30000 }); // 30 second timeout
```

### Testing Real Backend Servers

When using real backend servers:

```typescript
import { loadBackendServersFixture } from '../../utils/test-helpers.js';

const config = await loadBackendServersFixture();
// Use time and calculator servers from fixtures
```

### Testing Error Scenarios

Test how errors propagate:

```typescript
it('should handle backend server failure gracefully', async () => {
    await manager.stopServer('time');

    await expect(
        proxy.callTool('get_current_time', {})
    ).rejects.toThrow('Server not available');
});
```

## What to Integration Test

- ✅ Backend server startup and connection
- ✅ Tool discovery and listing
- ✅ Tool execution through proxy
- ✅ Resource listing and reading
- ✅ Group configuration loading and application
- ✅ Tool override application
- ✅ Error handling across component boundaries
- ✅ Message routing between frontend and backend
- ✅ Cleanup and resource management

## What NOT to Integration Test

- ❌ Internal component logic (use unit tests)
- ❌ Schema validation (use unit tests)
- ❌ Pure functions (use unit tests)
- ❌ Mock interactions (use unit tests)

## Running Integration Tests

```bash
# Run all integration tests
bun test tests/integration/

# Run specific integration test
bun test tests/integration/backend-proxy.test.ts

# Run with verbose output
bun test --verbose tests/integration/

# Skip integration tests (if needed)
bun test tests/unit/
```

## Performance Considerations

Integration tests are slower:

- Backend server startup: 1-5 seconds
- Tool execution: 100-1000ms
- Full end-to-end flow: 2-10 seconds

Keep total test suite runtime reasonable:

- Reuse backend servers across tests (use `beforeAll`)
- Run tests in parallel where possible
- Use timeouts to catch hung tests
- Clean up resources properly

## Debugging Integration Tests

### Enable verbose logging

```typescript
import logger from '@hughescr/logger';

// In test setup
logger.level = 'debug';
```

### Check backend server output

Backend servers write to stderr - check their output for errors.

### Verify configurations

```typescript
// Print loaded configuration for debugging
const config = await loadBackendServersFixture();
console.error('Loaded config:', JSON.stringify(config, null, 2));
```

### Test isolation

Ensure tests don't interfere:

```typescript
afterEach(async () => {
    // Reset state between tests
    await manager.disconnectAll();
});
```

## CI/CD Considerations

When running in CI:

- Use longer timeouts (CI may be slower)
- Ensure backend server dependencies are installed
- Consider using Docker for consistent environment
- Cache dependencies to speed up test runs
- Run integration tests separately from unit tests

## Future Enhancements

- [ ] Docker containers for backend servers
- [ ] Test fixtures with more complex scenarios
- [ ] Performance benchmarking in integration tests
- [ ] Network failure simulation
- [ ] Parallel test execution optimization
