# Test Fixtures

This directory contains configuration files used for testing the MCP Proxy Processor.

## Files

### backend-servers-test.json
Minimal backend MCP server configuration for tests. Uses simple, reliable servers:
- **time**: MCP time server (no external dependencies)
- **calculator**: Calculator MCP server (basic math operations)

These servers are chosen for testing because:
- They have minimal external dependencies
- They provide predictable, deterministic responses
- They're lightweight and fast to initialize
- They cover both simple (time) and parameterized (calculator) tool patterns

### groups-test.json
Comprehensive group configurations covering various scenarios:

- **minimal**: Single tool from one server (simplest case)
- **basic**: Multiple tools from different servers (typical case)
- **with_overrides**: Tools with name and description overrides (customization testing)
- **duplicate_tools**: Same tool exposed under different names (aliasing testing)
- **schema_override**: Tool with input schema override (advanced customization)

### groups-invalid.json
Invalid group configurations for error handling tests:

- **missing_server**: References a backend server that doesn't exist
- **empty_tools**: Group with no tools defined

## Usage

Load fixtures in tests using the helper functions from `tests/utils/test-helpers.ts`:

```typescript
import { loadBackendServersFixture, loadGroupsFixture, getTestGroup } from '../utils/test-helpers.js';

// Load entire config files
const servers = await loadBackendServersFixture();
const groups = await loadGroupsFixture();

// Load specific groups
const minimalGroup = await getTestGroup('minimal');
const basicGroup = await getTestGroup('basic');

// Load invalid fixtures for error testing
const invalidGroups = await loadGroupsFixture('groups-invalid.json');
```

## Adding New Fixtures

When adding new test fixtures:

1. Keep them minimal but realistic
2. Document the purpose of each configuration
3. Follow the same naming conventions
4. Update this README with the new fixture details
5. Consider edge cases and error scenarios

## Fixture Maintenance

- Keep fixtures in sync with schema changes in `src/types/config.ts`
- Update fixtures when adding new test scenarios
- Remove obsolete fixtures that are no longer used
- Validate fixtures against Zod schemas in tests
