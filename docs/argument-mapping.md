# Argument Mapping

Argument mapping allows you to transform tool call arguments from the client (agent) format to the backend server format. This is powerful for optimizing context window usage and improving agent experience.

## Why Use Argument Mapping?

**Problem:** Backend MCP servers often expose tools with suboptimal parameter schemas:
- Required parameters that should have sensible defaults (reducing flexibility)
- API keys and credentials visible to agents (wasting context tokens)
- Poor parameter names that confuse agents
- Too many optional parameters that bloat context (most never used)

**Solution:** Argument mapping lets you transform the parameter schema to:
- **Hide unnecessary parameters** from the agent's view (saves context tokens)
- **Add default values** so agents can omit common parameters
- **Inject credentials** invisibly (agents never see them)
- **Rename parameters** to be clearer and more intuitive
- **Restructure complex schemas** to match agent expectations

## Configuration

Argument mappings are defined in the `argumentMapping` field of a tool override in `config/groups.json`.

## Mapping Types

### Template Mappings

Template mappings provide declarative parameter transformations. They're easier to configure and validate than JSONata expressions.

#### Passthrough

Pass a parameter through unchanged from client to backend.

**Use case:** The backend parameter is perfect as-is.

```json
{
  "type": "template",
  "mappings": {
    "query": { "type": "passthrough", "source": "query" }
  }
}
```

**With parameter overrides** (change how the parameter appears to the agent):

```json
{
  "type": "template",
  "mappings": {
    "query": {
      "type": "passthrough",
      "source": "query",
      "name": "search_query",
      "description": "Your search query (clearer than the backend's description)"
    }
  }
}
```

This passes the value unchanged but shows a better name/description to the agent.

#### Constant

Always use a fixed value, regardless of client input. The parameter is **completely hidden** from the agent.

**Use case:** Inject API keys, credentials, or fixed configuration values that agents should never see.

**Problem → Solution:**
- **Problem:** Backend requires `api_key` parameter, exposing it to agent (wastes context tokens)
- **Solution:** Use constant mapping to inject it invisibly

```json
{
  "type": "template",
  "mappings": {
    "apiKey": { "type": "constant", "value": "secret-key-123" },
    "mode": { "type": "constant", "value": "production" },
    "provider": { "type": "constant", "value": "brave" }
  }
}
```

The agent never sees these parameters in the tool schema, saving context tokens. The backend always receives the constant values.

#### Default

Use client value if provided, otherwise use a default value.

**Use case:** Make required backend parameters optional for agents by providing sensible defaults.

**Problem → Solution:**
- **Problem:** Backend requires `timezone` parameter, forcing agents to always specify it
- **Solution:** Use default mapping to make it optional, defaulting to sensible value

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

**With parameter overrides** to clarify the default in the description:

```json
{
  "type": "template",
  "mappings": {
    "timezone": {
      "type": "default",
      "source": "timezone",
      "default": "America/Los_Angeles",
      "description": "IANA timezone (optional, defaults to America/Los_Angeles)"
    }
  }
}
```

**Important:** You must also update `inputSchema` to make the parameter optional (remove it from `required` array). The default mapping ensures the backend always receives a value even when the agent omits it.

#### Rename

Rename a parameter from client to backend. Agent uses a different parameter name than the backend expects.

**Use case:** Backend has poor/confusing parameter names. Show clear names to agent.

**Problem → Solution:**
- **Problem:** Backend uses cryptic `loc` parameter name
- **Solution:** Agent sees clear `location` parameter, proxy renames to `loc` for backend

```json
{
  "type": "template",
  "mappings": {
    "loc": { "type": "rename", "source": "location" }
  }
}
```

Backend parameter `loc` ← Agent parameter `location`

**With parameter overrides** for better agent-facing description:

```json
{
  "type": "template",
  "mappings": {
    "loc": {
      "type": "rename",
      "source": "location",
      "name": "location",
      "description": "City name or ZIP code (not the cryptic backend description)"
    }
  }
}
```

#### Omit

Completely remove a parameter from the agent-visible schema. The parameter never reaches the backend.

**Use case:** Backend has rarely-used optional parameters that bloat context without adding value.

**Problem → Solution:**
- **Problem:** Backend weather tool has 12 optional parameters (`dewpoint`, `barometric_pressure`, `uv_index`, etc.) but agents only need basic weather
- **Solution:** Omit the 9 rarely-used parameters, reducing context bloat by ~200 tokens

```json
{
  "type": "template",
  "mappings": {
    "location": { "type": "passthrough", "source": "location" },
    "units": { "type": "default", "source": "units", "default": "fahrenheit" },
    "dewpoint": { "type": "omit" },
    "barometric_pressure": { "type": "omit" },
    "uv_index": { "type": "omit" },
    "visibility": { "type": "omit" },
    "wind_gust": { "type": "omit" }
  }
}
```

Agents see only `location` and `units`. The backend never receives the omitted parameters. Each omitted parameter saves 15-30 context tokens (parameter name + type + description + constraints).

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

## Context Window Optimization Strategy

To maximize context savings:

1. **Start with omit**: Identify rarely-used optional parameters and omit them completely
2. **Add constants**: Hide all credentials, API keys, and fixed configuration
3. **Apply defaults**: Make required parameters optional when sensible defaults exist
4. **Clean up names**: Use rename with description overrides for confusing parameters
5. **Measure impact**: Each hidden/omitted parameter saves 15-30 tokens

**Example savings calculation:**
- Backend tool with 15 parameters, 200-word description
- Agent only needs 3 parameters, 20-word description
- Savings: ~12 parameters × 25 tokens + 180 words × 1.3 tokens = ~534 tokens per tool
- Across 10 tools: ~5,340 tokens saved in context window

## Best Practices

1. **Use template mappings** for simple transformations (90% of cases)
2. **Use JSONata** only for complex transformations requiring logic
3. **Keep transformations simple** - complex logic is hard to debug
4. **Optimize for context window** - fewer parameters = better agent performance
5. **Document your mappings** - add comments explaining the "why" behind each transformation
6. **Test your mappings** - use the admin interface to preview transformations
7. **Update inputSchema** - when using defaults/omit, modify the agent-facing schema to match

## Future Enhancements

Planned features:
- TypeScript plugin system for custom transformations
- Validation that mappings produce valid backend schemas
- Transformation testing/preview in admin UI
