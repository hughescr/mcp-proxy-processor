/**
 * Configuration type definitions for MCP Proxy Processor
 */

import { z } from 'zod';

/**
 * Backend MCP server configuration (compatible with Claude Desktop's mcp.json format)
 * Supports multiple transport types: stdio, streamable-http, and sse (legacy)
 */

// STDIO transport configuration (default/legacy format)
export const StdioServerConfigSchema = z.object({
    command: z.string(),
    args:    z.array(z.string()).optional(),
    env:     z.record(z.string(), z.string()).optional(),
    cwd:     z.string().optional(),
});

// Streamable HTTP transport configuration
export const StreamableHttpServerConfigSchema = z.object({
    type:    z.literal('streamable-http'),
    url:     z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
});

// SSE (Server-Sent Events) transport configuration - legacy, deprecated
export const SseServerConfigSchema = z.object({
    type:    z.literal('sse'),
    url:     z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
});

// Union of all transport types
export const BackendServerConfigSchema = z.discriminatedUnion('type', [
    StreamableHttpServerConfigSchema,
    SseServerConfigSchema,
]).or(StdioServerConfigSchema); // stdio is default if no type field

export const BackendServersConfigSchema = z.object({
    mcpServers: z.record(z.string(), BackendServerConfigSchema),
});

export type StdioServerConfig = z.infer<typeof StdioServerConfigSchema>;
export type StreamableHttpServerConfig = z.infer<typeof StreamableHttpServerConfigSchema>;
export type SseServerConfig = z.infer<typeof SseServerConfigSchema>;
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
 * Resource override configuration
 */
export const ResourceOverrideSchema = z.object({
    /** Original resource URI from backend server */
    originalUri: z.string(),
    /** Backend server name this resource comes from */
    serverName:  z.string(),
    /** Optional: Override the resource name */
    name:        z.string().optional(),
    /** Optional: Override the resource description */
    description: z.string().optional(),
    /** Optional: Override the MIME type */
    mimeType:    z.string().optional(),
});

export type ResourceOverride = z.infer<typeof ResourceOverrideSchema>;

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
    /** Resources to expose in this group */
    resources:   z.array(ResourceOverrideSchema).optional().default([]),
});

export const GroupsConfigSchema = z.object({
    groups: z.record(z.string(), GroupConfigSchema),
});

export type GroupConfig = z.infer<typeof GroupConfigSchema>;
export type GroupsConfig = z.infer<typeof GroupsConfigSchema>;
