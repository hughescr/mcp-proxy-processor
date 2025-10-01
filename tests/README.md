# Test Infrastructure

This directory contains the complete test infrastructure for the MCP Proxy Processor project.

## Directory Structure

```
tests/
├── fixtures/           # Test data and configuration files
│   ├── backend-servers-test.json    # Minimal backend server configs
│   ├── groups-test.json             # Valid group configurations
│   ├── groups-invalid.json          # Invalid configs for error testing
│   └── README.md                    # Fixture documentation
├── utils/              # Test utilities and helpers
│   ├── test-helpers.ts              # Configuration loaders, assertions
│   ├── mock-mcp.ts                  # Mock MCP client/server implementations
│   └── index.ts                     # Utility exports
├── unit/               # Unit tests for individual components
├── integration/        # Integration tests with real backend servers
└── infrastructure.test.ts           # Infrastructure smoke tests
```

## Running Tests

```bash
# Run all tests
bun test

# Run with watch mode (for development)
bun test --watch

# Run specific test file
bun test tests/infrastructure.test.ts

# Run tests with coverage
bun test --coverage

# Run full test suite (lint + typecheck + test)
bun run full-test
```

## Test Utilities

### Configuration Loaders

Load test fixtures easily:

```typescript
import {
    loadBackendServersFixture,
    loadGroupsFixture,
    getTestGroup,
    getTestBackendServer
} from './utils/test-helpers.js';

// Load entire configuration files
const servers = await loadBackendServersFixture();
const groups = await loadGroupsFixture();

// Load specific items
const timeServer = await getTestBackendServer('time');
const minimalGroup = await getTestGroup('minimal');

// Load custom fixtures
const invalid = await loadGroupsFixture('groups-invalid.json');
```

### Mock Factories

Create test data programmatically:

```typescript
import {
    createMockBackendServerConfig,
    createMockGroupConfig,
    createMockBackendServersConfig,
    createMockGroupsConfig
} from './utils/test-helpers.js';

// Create individual mocks with overrides
const server = createMockBackendServerConfig({
    command: '/usr/bin/python',
    args: ['server.py']
});

const group = createMockGroupConfig({
    name: 'test-group',
    tools: [/* ... */]
});

// Create full configurations
const serversConfig = createMockBackendServersConfig({
    'custom-server': server
});

const groupsConfig = createMockGroupsConfig({
    'custom-group': group
});
```

### Mock MCP Clients

Create mock MCP clients for testing without real backend servers:

```typescript
import {
    createMockClient,
    createMockTool,
    createMockResource,
    createMockToolCollection
} from './utils/mock-mcp.js';

// Create a mock client
const client = createMockClient('test-server', [
    createMockTool({ name: 'my_tool' })
]);

await client.connect();
const { tools } = await client.listTools();

// Register tool handlers
client.registerToolHandler('my_tool', (args) => {
    return { result: 'success' };
});

const result = await client.callTool('my_tool', { arg: 'value' });
```

### Assertion Helpers

Custom assertions for cleaner tests:

```typescript
import {
    assertDefined,
    assertContains,
    assertHasProperty
} from './utils/test-helpers.js';

// Assert value is not null/undefined (with type narrowing)
assertDefined(maybeValue); // TypeScript now knows it's defined

// Assert array contains item
assertContains([1, 2, 3], 2);

// Assert object has property (with type narrowing)
assertHasProperty(obj, 'key'); // TypeScript now knows obj.key exists
```

### Async Test Utilities

Helpers for asynchronous testing:

```typescript
import { waitFor, timeout } from './utils/test-helpers.js';

// Wait for condition with timeout
await waitFor(() => condition === true, 5000);

// Race against timeout
await Promise.race([
    someAsyncOperation(),
    timeout(1000) // Fails if operation takes > 1 second
]);
```

### Console Mocking

Prevent test output pollution:

```typescript
import { mockConsole } from './utils/test-helpers.js';

const mock = mockConsole();

// Code that logs to console...
someFunction();

// Restore original console
mock.restore();
```

## Test Fixtures

### Backend Servers (backend-servers-test.json)

Minimal configuration with reliable, fast servers:
- **time**: No external dependencies, deterministic
- **calculator**: Basic math operations, no API keys needed

### Groups (groups-test.json)

Comprehensive scenarios:
- **minimal**: Single tool (simplest case)
- **basic**: Multiple tools from different servers (typical case)
- **with_overrides**: Name and description overrides
- **duplicate_tools**: Same tool with different names
- **schema_override**: Custom input schema

### Invalid Groups (groups-invalid.json)

Error handling scenarios:
- **missing_server**: Non-existent backend server reference
- **empty_tools**: Group with no tools

See `fixtures/README.md` for detailed fixture documentation.

## Writing Tests

### Unit Tests

Place unit tests in `tests/unit/` organized by source file structure:

```typescript
// tests/unit/middleware/index.test.ts
import { describe, it, expect } from 'bun:test';
import { loadGroupsFixture } from '../../utils/test-helpers.js';

describe('Middleware', () => {
    it('should load group configuration', async () => {
        const config = await loadGroupsFixture();
        expect(config.groups).toBeDefined();
    });
});
```

### Integration Tests

Place integration tests in `tests/integration/`:

```typescript
// tests/integration/proxy.test.ts
import { describe, it, expect } from 'bun:test';
import { createMockClient } from '../../utils/mock-mcp.js';

describe('Backend Proxy Integration', () => {
    it('should connect to backend server and list tools', async () => {
        // Integration test with real or mock backend
    });
});
```

## Best Practices

### Test Organization

1. **One test file per source file**: `src/backend/proxy.ts` → `tests/unit/backend/proxy.test.ts`
2. **Group related tests**: Use `describe()` blocks to organize tests
3. **Clear test names**: Use descriptive `it()` messages that explain what is tested
4. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification

### Test Data

1. **Use fixtures**: Prefer loading from `tests/fixtures/` over inline data
2. **Use factories**: Use mock factories for programmatic test data
3. **Keep tests independent**: Don't share mutable state between tests
4. **Clean up**: Reset state after tests if needed

### Async Testing

1. **Always await**: Don't forget to await async operations
2. **Use timeouts**: Set reasonable timeouts for async operations
3. **Test both success and failure**: Test error cases, not just happy paths

### Mocking

1. **Mock external dependencies**: Don't rely on external services in unit tests
2. **Use mock clients**: Use `MockMCPClient` instead of real MCP connections
3. **Verify mock calls**: Check that mocks were called as expected

### Coverage

1. **Aim for high coverage**: Target >80% code coverage
2. **Test edge cases**: Include boundary conditions, errors, empty inputs
3. **Test error paths**: Verify error handling works correctly

## Troubleshooting

### Tests not found

Ensure test files end with `.test.ts` and are in the `tests/` directory.

### Import errors

- Use `.js` extension in imports (TypeScript convention)
- Check that `tsconfig.json` includes `tests/` directory
- Verify relative import paths are correct

### Async test timeouts

Increase timeout for slow operations:

```typescript
import { test } from 'bun:test';

test('slow operation', async () => {
    // Test code
}, { timeout: 10000 }); // 10 second timeout
```

### Fixture loading errors

- Verify fixture files exist in `tests/fixtures/`
- Check JSON syntax is valid
- Ensure fixtures match Zod schema definitions

## Future Enhancements

Planned improvements to test infrastructure:

- [ ] Test coverage reporting
- [ ] Integration test fixtures with real backend servers
- [ ] Performance benchmarking utilities
- [ ] Snapshot testing for tool schemas
- [ ] Docker-based test environment
- [ ] CI/CD integration examples

## Contributing

When adding tests:

1. Follow the existing directory structure
2. Use the provided test utilities
3. Add new fixtures to `tests/fixtures/` as needed
4. Document complex test scenarios
5. Run `bun run full-test` before committing
