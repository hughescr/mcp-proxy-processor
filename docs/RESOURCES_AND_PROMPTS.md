# Resources and Prompts Guide

## Overview

MCP Proxy Processor supports exposing backend MCP server resources and prompts to clients with advanced features like priority-based fallback, URI template matching, and conflict detection.

## Resources

### What are Resources?

Resources in MCP represent data sources that can be read by AI agents. Examples include:
- Files on the filesystem (`file:///path/to/file`)
- Web APIs (`https://api.example.com/data`)
- Database records (`sqlite:///db/app.db`)
- Any URI-addressable data source

### Adding Resources to a Group

Resources are added to groups via the `resources` array in `config/groups.json`:

```json
{
  "groups": {
    "my-group": {
      "name": "my-group",
      "tools": [],
      "resources": [
        {
          "uri": "file:///data/config.json",
          "serverName": "fs-server"
        },
        {
          "uri": "https://api.example.com/users/{id}",
          "serverName": "api-server"
        }
      ]
    }
  }
}
```

### URI Templates

Resources support RFC 6570 URI templates for matching multiple URIs:

- `file:///{path}` - Matches any file path
- `https://api.example.com/users/{id}` - Matches user endpoints
- `https://api.{domain}/v1/{endpoint}` - Matches multiple domains

Template variables are extracted and passed to backend servers.

### Priority-Based Fallback

When multiple servers provide the same resource, they form a fallback chain:

```json
{
  "resources": [
    {
      "uri": "https://api.example.com/data",
      "serverName": "primary-server"
    },
    {
      "uri": "https://api.example.com/data",
      "serverName": "backup-server"
    }
  ]
}
```

If `primary-server` fails, the system automatically tries `backup-server`.

### Conflict Detection

The system detects and warns about resource conflicts:

1. **Exact Duplicates**: Same URI from different positions
2. **Template Overlap**: Templates that match the same URIs
3. **Template Covers Exact**: Template that matches an exact URI

Use the admin UI to visualize and resolve conflicts.

## Prompts

### What are Prompts?

Prompts are pre-defined conversation starters or templates that can be invoked by AI agents. They can include:
- Code review prompts
- Analysis templates
- Documentation generators
- Any reusable prompt pattern

### Adding Prompts to a Group

Prompts are added via the `prompts` array:

```json
{
  "groups": {
    "my-group": {
      "name": "my-group",
      "tools": [],
      "prompts": [
        {
          "name": "code-review",
          "serverName": "ai-assistant"
        },
        {
          "name": "generate-tests",
          "serverName": "test-generator"
        }
      ]
    }
  }
}
```

### Prompt Arguments

Prompts can accept arguments that are passed through from the client:

```typescript
// Backend prompt definition
{
  name: "code-review",
  description: "Review code for best practices",
  arguments: [
    {
      name: "language",
      description: "Programming language",
      required: true
    },
    {
      name: "style",
      description: "Review style guide",
      required: false
    }
  ]
}
```

### Priority and Deduplication

Like resources, prompts support priority-based fallback:

```json
{
  "prompts": [
    {
      "name": "summarize",
      "serverName": "advanced-ai"  // First priority
    },
    {
      "name": "summarize",
      "serverName": "basic-ai"     // Fallback
    }
  ]
}
```

The system automatically deduplicates prompts by name, keeping the highest priority version for the prompts/list response while maintaining the full fallback chain for execution.

## Admin UI Usage

### Resource Management

1. Navigate to Group Editor
2. Select "Manage Resources"
3. Use Resource Browser to:
   - Search available backend resources
   - Preview resource details
   - Add resources to group
4. Use Priority Screen to:
   - Reorder resources by priority
   - View conflict warnings
   - Remove unwanted resources

### Prompt Management

1. Navigate to Group Editor
2. Select "Manage Prompts"
3. Use Prompt Browser to:
   - Browse available prompts
   - View prompt arguments
   - Add prompts to group
4. Use Priority Screen to:
   - Set prompt priority order
   - Identify duplicate names
   - Manage fallback chains

## Best Practices

### Resource Configuration

1. **Use templates wisely**: Templates provide flexibility but can cause conflicts
2. **Order matters**: Place most specific resources first, templates last
3. **Test fallback**: Verify fallback servers actually provide the resource
4. **Monitor conflicts**: Regularly check for unintended overlaps

### Prompt Configuration

1. **Name consistently**: Use clear, descriptive prompt names
2. **Document arguments**: Ensure prompt arguments are well-documented
3. **Version appropriately**: Use different servers for different prompt versions
4. **Test thoroughly**: Verify prompts work with all configured servers

### Performance Tips

1. **Limit fallback chains**: 2-3 servers is usually sufficient
2. **Cache when possible**: Resources can be cached client-side
3. **Minimize conflicts**: Resolve conflicts to avoid ambiguity
4. **Use specific URIs**: Prefer exact URIs over templates when possible

## Troubleshooting

### Common Issues

**Resources not appearing:**
- Verify backend server is running and connected
- Check that resource URI matches exactly
- Ensure serverName is correct in configuration

**Template not matching:**
- Test template with URI matcher utility
- Check for typos in template syntax
- Verify variable names match expected format

**Prompts not working:**
- Confirm prompt name matches backend exactly
- Check argument requirements match
- Verify backend server provides the prompt

**Conflicts detected:**
- Review priority order in admin UI
- Consider using more specific URIs
- Remove redundant resource references

### Debug Commands

```bash
# List all resources for a group
bun run dev --admin
# Navigate to group -> Manage Resources

# Test resource matching
bun test tests/unit/uri-matcher.test.ts

# Check for conflicts
bun test tests/unit/conflict-detection.test.ts
```

## API Reference

### Resource Configuration

```typescript
interface ResourceRef {
  uri: string;        // Exact URI or URI template
  serverName: string; // Backend server providing resource
}
```

### Prompt Configuration

```typescript
interface PromptRef {
  name: string;       // Prompt name (must match backend)
  serverName: string; // Backend server providing prompt
}
```

### Conflict Types

```typescript
type ConflictType =
  | 'exact-duplicate'           // Same URI appears multiple times
  | 'template-covers-exact'     // Template matches an exact URI
  | 'exact-covered-by-template' // Exact URI matched by template
  | 'template-overlap';         // Templates match same URIs
```

## Examples

### Multi-Environment API Setup

```json
{
  "resources": [
    {
      "uri": "https://api.prod.example.com/{endpoint}",
      "serverName": "prod-api"
    },
    {
      "uri": "https://api.staging.example.com/{endpoint}",
      "serverName": "staging-api"
    },
    {
      "uri": "https://api.dev.example.com/{endpoint}",
      "serverName": "dev-api"
    }
  ]
}
```

### File System with Fallback

```json
{
  "resources": [
    {
      "uri": "file:///mnt/fast-ssd/{path}",
      "serverName": "ssd-fs"
    },
    {
      "uri": "file:///mnt/slow-hdd/{path}",
      "serverName": "hdd-fs"
    }
  ]
}
```

### Versioned Prompts

```json
{
  "prompts": [
    {
      "name": "analyze-code",
      "serverName": "ai-v3"
    },
    {
      "name": "analyze-code",
      "serverName": "ai-v2"
    },
    {
      "name": "analyze-code",
      "serverName": "ai-v1"
    }
  ]
}
```