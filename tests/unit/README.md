# Unit Tests

Unit tests for individual components of the MCP Proxy Processor.

## Organization

Unit tests are organized to mirror the source code structure:

```
tests/unit/
├── backend/
│   ├── server-manager.test.ts
│   ├── client-manager.test.ts
│   ├── proxy.test.ts
│   └── discovery.test.ts
├── frontend/
│   └── index.test.ts
├── middleware/
│   └── index.test.ts
├── types/
│   └── config.test.ts
└── utils/
    └── index.test.ts
```

## Writing Unit Tests

Unit tests should:

1. **Test in isolation**: Mock all external dependencies
2. **Test single responsibility**: Each test should verify one behavior
3. **Be fast**: Unit tests should execute in milliseconds
4. **Be deterministic**: Same input always produces same output

## Example Unit Test

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { createMockGroupConfig } from '../../utils/test-helpers.js';

describe('ComponentName', () => {
    let mockConfig;

    beforeEach(() => {
        mockConfig = createMockGroupConfig();
    });

    describe('methodName()', () => {
        it('should handle valid input', () => {
            // Arrange
            const input = 'test-value';

            // Act
            const result = methodName(input);

            // Assert
            expect(result).toBeDefined();
            expect(result).toBe('expected-value');
        });

        it('should throw error for invalid input', () => {
            expect(() => methodName(null)).toThrow();
        });
    });
});
```

## Testing Guidelines

### Configuration Testing

Use fixture loaders:

```typescript
import { loadGroupsFixture } from '../../utils/test-helpers.js';

const config = await loadGroupsFixture();
```

### Schema Validation

Test Zod schemas:

```typescript
import { GroupConfigSchema } from '../../../src/types/config.js';

expect(() => GroupConfigSchema.parse(invalidData)).toThrow();
expect(() => GroupConfigSchema.parse(validData)).not.toThrow();
```

### Error Handling

Always test error cases:

```typescript
it('should handle missing configuration', () => {
    expect(() => loadConfig(undefined)).toThrow('Configuration required');
});
```

## What NOT to Unit Test

- External API calls (use integration tests)
- Database operations (use integration tests)
- File I/O (use integration tests or mock fs)
- Complex integration between components (use integration tests)

## Running Unit Tests Only

```bash
# Run all unit tests
bun test tests/unit/

# Run specific unit test file
bun test tests/unit/backend/proxy.test.ts

# Watch mode for TDD
bun test --watch tests/unit/
```
