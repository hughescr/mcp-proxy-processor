# Test Helpers

Comprehensive, reusable test infrastructure for MCP Proxy Processor testing.

## Quick Start

```typescript
import {
  // Mock infrastructure
  createMockProcess,
  LoopbackTransport,

  // Test data builders
  builders,

  // Async utilities
  waitFor,
  waitForEvent,
  delay,

  // File system helpers
  createTempDir,
  createTempFile,
  cleanup,
  fileExists,
} from '../helpers/index.js';
```

## Helper Modules

### 1. Mocks (`mocks.ts`)

Mock implementations for subprocess operations and MCP protocol testing.

#### MockProcess

Creates a mock subprocess for testing ServerManager and process lifecycle.

```typescript
const mockProc = createMockProcess({
  exitCode: 0,              // Exit code when process terminates
  exitAfter: 100,           // Milliseconds before exit (optional)
  stderrOutput: ['log'],    // Lines to emit on stderr
  stdoutOutput: ['data'],   // Lines to emit on stdout
  pid: 12345,               // Process ID (default: random)
  emitSpawn: true,          // Whether to emit 'spawn' event
  spawnDelay: 0,            // Delay before spawn event
  autoEmitOutput: true,     // Auto-emit output lines
});

// Use like a real ChildProcess
mockProc.on('exit', (code) => console.log(`Exited: ${code}`));
mockProc.kill('SIGTERM');
```

**Key Features:**
- Emits `spawn` and `exit` events
- Provides stdout/stderr/stdin streams
- Supports `.kill()` method
- Configurable timing and output

#### LoopbackTransport

In-memory transport for testing MCP servers without real stdio.

```typescript
const transport = new LoopbackTransport();
await transport.connect(mcpServer);

// Send JSON-RPC message
transport.inject(JSON.stringify({
  jsonrpc: '2.0',
  method: 'initialize',
  id: 1,
  params: { protocolVersion: '2024-11-05' }
}));

// Read response
const response = await transport.nextFrame();
console.log(response);

// Cleanup
await transport.close();
```

**Key Features:**
- Bidirectional communication without stdio
- Message queue for async testing
- Timeout support for `nextFrame()`
- Frame capture for assertions

### 2. Builders (`builders.ts`)

Fluent builders for creating test data fixtures.

#### Backend Configuration

```typescript
import { backendConfig, stdioServer } from '../helpers/index.js';

// Minimal backend config
const config = backendConfig.minimal();

// With single server
const config = backendConfig.withServer('my-server', {
  command: 'bun',
  args: ['server.js'],
  env: { API_KEY: 'test' }
});

// With multiple servers
const config = backendConfig.withServers({
  'server-1': { command: 'node', args: ['s1.js'] },
  'server-2': { command: 'bun', args: ['s2.js'] }
});
```

#### Groups

```typescript
import { group, groupsConfig } from '../helpers/index.js';

// Minimal group
const grp = group.minimal('my-group');

// With tools
const grp = group.withTools(5, 'backend-server');

// With resources
const grp = group.withResources(3, 'backend-server');

// Custom group
const grp = group.custom({
  name: 'custom',
  description: 'Custom group',
  tools: [/* ... */],
});

// Full groups config
const config = groupsConfig.withGroups({
  'group-1': { tools: [/* ... */] },
  'group-2': { resources: [/* ... */] },
});
```

#### Tools & Resources

```typescript
import { tool, resource, prompt } from '../helpers/index.js';

// Tool with rename
const t = tool.renamed('original_name', 'new_name', 'server');

// Tool with schema override
const t = tool.withSchema('tool_name', {
  type: 'object',
  properties: { arg: { type: 'string' } }
});

// Tool with template mapping
const t = tool.withTemplateMapping('tool_name', {
  newArg: '{{oldArg}}'
});

// Resource reference
const r = resource.minimal('test://resource', 'server');

// Prompt reference
const p = prompt.minimal('my_prompt', 'server');
```

#### MCP Types

```typescript
import { mcpTool, mcpResource, mcpPrompt } from '../helpers/index.js';

// MCP Tool definition
const tool = mcpTool.withParams('search', {
  query: { type: 'string' },
  limit: { type: 'number' }
});

// MCP Resource
const resource = mcpResource.withMimeType(
  'test://doc',
  'application/json'
);

// MCP Prompt
const prompt = mcpPrompt.withArguments('template', [
  { name: 'topic', required: true }
]);
```

### 3. Async Utilities (`async-utils.ts`)

Utilities for handling asynchronous operations in tests.

#### Wait for Condition

```typescript
import { waitFor } from '../helpers/index.js';

// Wait for condition to become true
await waitFor(
  () => server.isReady(),
  { timeout: 5000, interval: 100 }
);
```

#### Wait for Event

```typescript
import { waitForEvent } from '../helpers/index.js';

// Wait for single event
const data = await waitForEvent(emitter, 'ready', 5000);

// Wait for multiple events in sequence
const events = await waitForEvents(
  emitter,
  ['connecting', 'connected', 'ready'],
  10000
);
```

#### Timeout & Delay

```typescript
import { timeout, delay, withTimeout } from '../helpers/index.js';

// Create timeout promise
await Promise.race([
  slowOperation(),
  timeout(1000, 'Operation too slow')
]);

// Simple delay
await delay(500);

// Wrap operation with timeout
const result = await withTimeout(
  () => fetchData(),
  3000,
  'Fetch timeout'
);
```

#### Retry Logic

```typescript
import { retry } from '../helpers/index.js';

const result = await retry(
  () => unstableOperation(),
  {
    maxAttempts: 3,
    delay: 1000,
    onError: (err, attempt) => {
      console.log(`Attempt ${attempt} failed: ${err}`);
    }
  }
);
```

#### Polling

```typescript
import { poll } from '../helpers/index.js';

const value = await poll(
  () => getStatus(),
  { timeout: 5000, interval: 500 }
);
```

#### Deferred Promise

```typescript
import { createDeferred } from '../helpers/index.js';

const deferred = createDeferred<string>();

// Resolve from elsewhere
setTimeout(() => deferred.resolve('done'), 100);

// Wait for resolution
const result = await deferred.promise;
```

#### Event Collection

```typescript
import { collectEvents } from '../helpers/index.js';

const events = await collectEvents(
  emitter,
  'data',
  async () => {
    await processData();
  }
);

console.log('Collected events:', events);
```

#### Promise Utilities

```typescript
import { flushPromises, sequence } from '../helpers/index.js';

// Flush microtask queue
server.start();
await flushPromises();

// Run operations sequentially
const results = await sequence([
  () => operation1(),
  () => operation2(),
  () => operation3(),
]);
```

### 4. File System Helpers (`fs-utils.ts`)

Utilities for creating and managing temporary files and directories.

#### Temporary Directories

```typescript
import { createTempDir, cleanup } from '../helpers/index.js';

describe('My Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('my-test');
  });

  afterEach(async () => {
    await cleanup(); // Removes ALL registered temp dirs
  });

  it('works with temp dir', async () => {
    // testDir is a unique temp directory
    const filePath = join(testDir, 'test.json');
    await writeFile(filePath, '{}');
  });
});
```

#### Temporary Files

```typescript
import { createTempFile } from '../helpers/index.js';

// With string content
const file1 = await createTempFile('Hello, world!', {
  filename: 'test.txt'
});

// With JSON content (auto-stringified)
const file2 = await createTempFile(
  { groups: { test: { name: 'test', tools: [] } } },
  { filename: 'groups.json' }
);

// In specific directory
const file3 = await createTempFile('data', {
  filename: 'data.txt',
  directory: '/path/to/dir'
});
```

#### File Utilities

```typescript
import { fileExists } from '../helpers/index.js';

const exists = await fileExists('/path/to/file');
if (exists) {
  // File exists and is accessible
}
```

#### Manual Registration

```typescript
import { registerForCleanup } from '../helpers/index.js';

// Register manually created path for cleanup
const customDir = '/tmp/my-custom-dir';
await mkdir(customDir);
registerForCleanup(customDir);

// Will be cleaned up by cleanup()
```

## Complete Example

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  createMockProcess,
  LoopbackTransport,
  builders,
  waitFor,
  createTempDir,
  createTempFile,
  cleanup,
} from '../helpers/index.js';

describe('Integration Test', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('integration');
  });

  afterEach(async () => {
    await cleanup();
  });

  it('integrates multiple helpers', async () => {
    // Create test config file
    const config = builders.backendConfig.withServer('test', {
      command: 'node',
      args: ['server.js']
    });
    const configFile = await createTempFile(config, {
      filename: 'backend-servers.json',
      directory: tempDir
    });

    // Create mock process
    const mockProc = createMockProcess({
      stderrOutput: ['Server started'],
      exitAfter: 1000
    });

    // Wait for spawn
    await waitFor(() => mockProc.pid !== undefined, {
      timeout: 500
    });

    expect(mockProc.pid).toBeGreaterThan(0);
  });

  it('tests MCP protocol', async () => {
    // Create MCP server (your implementation)
    const server = createMCPServer();

    // Use loopback transport
    const transport = new LoopbackTransport();
    await transport.connect(server);

    // Send initialize
    transport.inject(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: { protocolVersion: '2024-11-05' }
    }));

    // Wait for response
    const response = await transport.nextFrame(1000);
    expect(response).toBeDefined();

    await transport.close();
  });
});
```

## Best Practices

### 1. Always Clean Up

```typescript
afterEach(async () => {
  await cleanup(); // Essential for temp files/dirs
});
```

### 2. Use Builders for Complex Data

```typescript
// BAD: Manual construction
const config = {
  name: 'test',
  description: '',
  tools: [],
  resources: [],
  prompts: []
};

// GOOD: Use builder
const config = group.minimal('test');
```

### 3. Prefer Async Utilities

```typescript
// BAD: Manual timeout handling
const timeoutId = setTimeout(() => {
  throw new Error('Timeout');
}, 5000);

// GOOD: Use utility
await withTimeout(() => operation(), 5000);
```

### 4. Mock Appropriately

```typescript
// For process testing
const mockProc = createMockProcess({ /* ... */ });

// For MCP protocol testing
const transport = new LoopbackTransport();
```

## Helper Statistics

- **Total lines:** ~1,363 lines of test infrastructure
- **Files:** 5 helper modules + index
- **Currently used by:** 6 test files
- **Potential usage:** All integration and unit tests

## Adding New Helpers

When adding new helpers:

1. Choose the appropriate module (or create new one)
2. Add comprehensive JSDoc comments
3. Include usage examples in docstring
4. Export from `index.ts`
5. Add entry to this README
6. Consider adding simple tests in `tests/helpers/` (optional)

## Migration from Inline Helpers

If you have inline test helpers that could be reused:

1. Check if a similar helper exists here
2. If yes, import and use it
3. If no, consider extracting to appropriate helper module
4. Update tests to use centralized helper
5. Remove inline duplicate

## Future Enhancements

Potential additions to the helper library:

- Database mocking utilities
- HTTP request/response mocking
- Stream testing utilities
- Performance measurement helpers
- Snapshot testing utilities
