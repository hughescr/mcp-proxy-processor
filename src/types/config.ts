/**
 * Configuration type definitions for MCP Proxy Processor
 */

import { z } from 'zod';

/**
 * Backend MCP server configuration (compatible with Claude Desktop's mcp.json format)
 * Currently only supports stdio transport.
 *
 * Future transports (not yet implemented):
 * - streamable-http: HTTP-based transport
 * - sse: Server-Sent Events transport (deprecated)
 */

// STDIO transport configuration (only supported transport)
export const StdioServerConfigSchema = z.object({
    command: z.string().min(1, 'Command cannot be empty'),
    args:    z.array(z.string()).optional(),
    env:     z.record(z.string(), z.string()).optional(),
    cwd:     z.string().optional(),
});

// Backend server config validates stdio and rejects unsupported transport types
export const BackendServerConfigSchema = StdioServerConfigSchema
    .passthrough() // Allow extra fields for validation
    .superRefine((config, ctx) => {
        if('type' in config) {
            const typeValue = (config as Record<string, unknown>).type;
            ctx.addIssue({
                code:    z.ZodIssueCode.custom,
                message: `Only stdio transport is currently supported. The "type" field should not be present. Future transports (streamable-http, sse) are not yet implemented. Received type: "${String(typeValue)}"`,
            });
        }
    })
    .transform((config) => {
        // Strip any extra fields and return only stdio config fields
        const result: StdioServerConfig = { command: config.command };
        if(config.args !== undefined) {
            result.args = config.args;
        }
        if(config.env !== undefined) {
            result.env = config.env;
        }
        if(config.cwd !== undefined) {
            result.cwd = config.cwd;
        }
        return result;
    });

export const BackendServersConfigSchema = z.object({
    mcpServers: z.record(z.string(), BackendServerConfigSchema),
});

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type BackendServerConfig = z.infer<typeof BackendServerConfigSchema>;
export type BackendServersConfig = z.infer<typeof BackendServersConfigSchema>;

/**
 * Parameter mapping types for argument transformation
 */

/** Pass parameter through unchanged from client to backend */
export const PassthroughMappingSchema = z.object({
    type:        z.literal('passthrough'),
    source:      z.string(), // Parameter name from client
    name:        z.string().optional(), // Override parameter name shown to agent
    description: z.string().optional(), // Override parameter description shown to agent
});

/** Always use a constant value, regardless of client input */
export const ConstantMappingSchema = z.object({
    type:  z.literal('constant'),
    value: z.unknown(), // Fixed value to use
});

/** Use client value if provided, otherwise use default */
/** Use client value if provided, otherwise use default */
export const DefaultMappingSchema = z.object({
    type:        z.literal('default'),
    source:      z.string(), // Parameter name from client
    'default':   z.unknown(), // Default value if not provided
    name:        z.string().optional(), // Override parameter name shown to agent
    description: z.string().optional(), // Override parameter description shown to agent
});

/** Rename parameter from client to backend */
export const RenameMappingSchema = z.object({
    type:        z.literal('rename'),
    source:      z.string(), // Parameter name from client
    name:        z.string().optional(), // Override parameter name shown to agent
    description: z.string().optional(), // Override parameter description shown to agent
});

/** Omit parameter from agent schema (not sent to backend) */
export const OmitMappingSchema = z.object({
    type: z.literal('omit'),
});

export const ParameterMappingSchema = z.discriminatedUnion('type', [
    PassthroughMappingSchema,
    ConstantMappingSchema,
    DefaultMappingSchema,
    RenameMappingSchema,
    OmitMappingSchema,
]);

export type PassthroughMapping = z.infer<typeof PassthroughMappingSchema>;
export type ConstantMapping = z.infer<typeof ConstantMappingSchema>;
export type DefaultMapping = z.infer<typeof DefaultMappingSchema>;
export type RenameMapping = z.infer<typeof RenameMappingSchema>;
export type OmitMapping = z.infer<typeof OmitMappingSchema>;
export type ParameterMapping = z.infer<typeof ParameterMappingSchema>;

/** Template-based argument mapping */
export const TemplateMappingSchema = z.object({
    type:     z.literal('template'),
    mappings: z.record(z.string(), ParameterMappingSchema), // backend param -> mapping config
});

/** JSONata expression-based argument mapping */
export const JsonataMappingSchema = z.object({
    type:       z.literal('jsonata'),
    expression: z.string(), // JSONata expression that transforms args
});

export const ArgumentMappingSchema = z.discriminatedUnion('type', [
    TemplateMappingSchema,
    JsonataMappingSchema,
]);

export type TemplateMapping = z.infer<typeof TemplateMappingSchema>;
export type JsonataMapping = z.infer<typeof JsonataMappingSchema>;
export type ArgumentMapping = z.infer<typeof ArgumentMappingSchema>;

/**
 * Tool override configuration
 */
export const ToolOverrideSchema = z.object({
    /** Original tool name from backend server */
    originalName:    z.string(),
    /** Backend server name this tool comes from */
    serverName:      z.string(),
    /** Optional: Override the tool name exposed to clients */
    name:            z.string().optional(),
    /** Optional: Override the tool description */
    description:     z.string().optional(),
    /** Optional: Override the input schema */
    inputSchema:     z.record(z.string(), z.unknown()).optional(),
    /** Optional: Argument mapping configuration for transforming client args to backend args */
    argumentMapping: ArgumentMappingSchema.optional(),
});

export type ToolOverride = z.infer<typeof ToolOverrideSchema>;

/**
 * Resource reference for priority-based fallback system
 * Resources are included/excluded with no overrides
 * Priority is determined by array order (first = highest priority)
 */
export const ResourceRefSchema = z.object({
    /** Backend server name */
    serverName: z.string(),
    /** Resource URI (may be a template with {variables}) */
    uri:        z.string(),
});

export type ResourceRef = z.infer<typeof ResourceRefSchema>;

/**
 * Prompt reference for priority-based fallback system
 * Prompts are included/excluded with no overrides
 * Priority is determined by array order (first = highest priority)
 */
export const PromptRefSchema = z.object({
    /** Backend server name */
    serverName: z.string(),
    /** Prompt name */
    name:       z.string(),
});

export type PromptRef = z.infer<typeof PromptRefSchema>;

/**
 * Resource conflict detection result
 */
export type ResourceConflictType
    = | 'exact-duplicate'         // Same exact URI from different servers
      | 'template-covers-exact'   // Template matches an exact URI
      | 'exact-covered-by-template' // Inverse of above
      | 'template-overlap';       // Two templates match some of the same URIs

export interface ResourceConflict {
    /** Type of conflict */
    type:       ResourceConflictType
    /** The two conflicting resources */
    resources:  [ResourceRef, ResourceRef]
    /** Example URI that both would match */
    exampleUri: string
    /** Array indices showing priority order */
    priority:   [number, number]
}

/**
 * Prompt conflict detection result
 */
export interface PromptConflict {
    /** The two conflicting prompts */
    prompts:  [PromptRef, PromptRef]
    /** Array indices showing priority order */
    priority: [number, number]
}

/**
 * Group configuration
 */
export const GroupConfigSchema = z.object({
    /** Group name */
    name:        z.string(),
    /** Optional: Group description */
    description: z.string().optional(),
    /** Tools to expose in this group */
    tools:       z.array(ToolOverrideSchema),
    /** Resources to expose in this group (priority ordered) */
    resources:   z.array(ResourceRefSchema).optional().default([]),
    /** Prompts to expose in this group (priority ordered) */
    prompts:     z.array(PromptRefSchema).optional().default([]),
});

export const GroupsConfigSchema = z.object({
    groups: z.record(z.string(), GroupConfigSchema),
});

export type GroupConfig = z.infer<typeof GroupConfigSchema>;
export type GroupsConfig = z.infer<typeof GroupsConfigSchema>;
