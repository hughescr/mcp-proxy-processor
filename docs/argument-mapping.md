# Argument Mapping

Argument mapping allows you to transform tool call arguments from the client (agent) format to the backend server format. This is useful for:

- Adding default values for optional parameters
- Injecting authentication credentials
- Renaming parameters
- Restructuring complex argument schemas

## Configuration

Argument mappings are defined in the `argumentMapping` field of a tool override in `config/groups.json`.

## Mapping Types

### Template Mappings

Template mappings provide declarative parameter transformations. They're easier to configure and validate than JSONata expressions.

#### Passthrough

Pass a parameter through unchanged:

```json
{
  "type": "template",
  "mappings": {
    "query": { "type": "passthrough", "source": "query" }
  }
}
```

#### Constant

Always use a fixed value (useful for API keys, modes, etc.):

```json
{
  "type": "template",
  "mappings": {
    "apiKey": { "type": "constant", "value": "secret-key-123" },
    "mode": { "type": "constant", "value": "production" }
  }
}
```

#### Default

Use client value if provided, otherwise use a default:

```json
{
  "type": "template",
  "mappings": {
    "timezone": {
      "type": "default",
      "source": "timezone",
      "default": "America/Los_Angeles"
    }
  }
}
```

This solves the timezone example from the requirements: if the client doesn't provide a timezone, we default to `America/Los_Angeles`.

#### Rename

Rename a parameter from client to backend:

```json
{
  "type": "template",
  "mappings": {
    "search_query": { "type": "rename", "source": "query" }
  }
}
```

### JSONata Expressions

For complex transformations, use JSONata expressions:

```json
{
  "type": "jsonata",
  "expression": "{ \"search\": { \"q\": query, \"limit\": limit ? limit : 10 }, \"tz\": timezone ? timezone : \"UTC\" }"
}
```

JSONata provides:
- Conditional logic (`? :`)
- Object restructuring
- String manipulation
- Array operations
- And more

## Complete Example

Here's a complete tool override with argument mapping:

```json
{
  "tools": [
    {
      "serverName": "time",
      "originalName": "get_current_time",
      "name": "get_time",
      "description": "Get current time in a timezone",
      "inputSchema": {
        "properties": {
          "timezone": {
            "type": "string",
            "description": "IANA timezone (optional, defaults to America/Los_Angeles)"
          }
        }
      },
      "argumentMapping": {
        "type": "template",
        "mappings": {
          "timezone": {
            "type": "default",
            "source": "timezone",
            "default": "America/Los_Angeles"
          }
        }
      }
    }
  ]
}
```

In this example:
1. The **group's input schema** makes `timezone` optional
2. The **argument mapping** adds `America/Los_Angeles` as default if not provided
3. The **backend** always receives a timezone parameter

## Workflow

1. **Client calls tool** with arguments (e.g., `{}` - no timezone)
2. **Proxy applies mapping** to transform arguments (e.g., `{ "timezone": "America/Los_Angeles" }`)
3. **Backend receives** transformed arguments

## Common Use Cases

### Adding Authentication

```json
{
  "type": "template",
  "mappings": {
    "query": { "type": "passthrough", "source": "query" },
    "apiKey": { "type": "constant", "value": "backend-api-key" }
  }
}
```

### Parameter Defaults

```json
{
  "type": "template",
  "mappings": {
    "limit": { "type": "default", "source": "limit", "default": 10 },
    "offset": { "type": "default", "source": "offset", "default": 0 }
  }
}
```

### Complex Restructuring

```json
{
  "type": "jsonata",
  "expression": "{
    \"params\": {
      \"search\": query,
      \"pagination\": { \"limit\": limit ? limit : 10, \"offset\": offset ? offset : 0 }
    }
  }"
}
```

## Best Practices

1. **Use template mappings** for simple transformations (90% of cases)
2. **Use JSONata** only for complex transformations requiring logic
3. **Keep transformations simple** - complex logic is hard to debug
4. **Document your mappings** - add comments in your config explaining why
5. **Test your mappings** - use the admin interface to preview transformations

## Future Enhancements

Planned features:
- TypeScript plugin system for custom transformations
- Validation that mappings produce valid backend schemas
- Transformation testing/preview in admin UI
