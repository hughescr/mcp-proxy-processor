/**
 * Configuration type definitions for MCP Proxy Processor
 */

import { z } from 'zod';

/**
 * Backend MCP server configuration (compatible with Claude Desktop's mcp.json format)
 */
export const BackendServerConfigSchema = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
});

export const BackendServersConfigSchema = z.object({
    mcpServers: z.record(z.string(), BackendServerConfigSchema),
});

export type BackendServerConfig = z.infer<typeof BackendServerConfigSchema>;
export type BackendServersConfig = z.infer<typeof BackendServersConfigSchema>;

/**
 * Tool override configuration
 */
export const ToolOverrideSchema = z.object({
    /** Original tool name from backend server */
    originalName: z.string(),
    /** Backend server name this tool comes from */
    serverName: z.string(),
    /** Optional: Override the tool name exposed to clients */
    name: z.string().optional(),
    /** Optional: Override the tool description */
    description: z.string().optional(),
    /** Optional: Override the input schema */
    inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export type ToolOverride = z.infer<typeof ToolOverrideSchema>;

/**
 * Resource override configuration
 */
export const ResourceOverrideSchema = z.object({
    /** Original resource URI from backend server */
    originalUri: z.string(),
    /** Backend server name this resource comes from */
    serverName: z.string(),
    /** Optional: Override the resource name */
    name: z.string().optional(),
    /** Optional: Override the resource description */
    description: z.string().optional(),
    /** Optional: Override the MIME type */
    mimeType: z.string().optional(),
});

export type ResourceOverride = z.infer<typeof ResourceOverrideSchema>;

/**
 * Group configuration
 */
export const GroupConfigSchema = z.object({
    /** Group name */
    name: z.string(),
    /** Optional: Group description */
    description: z.string().optional(),
    /** Tools to expose in this group */
    tools: z.array(ToolOverrideSchema),
    /** Resources to expose in this group */
    resources: z.array(ResourceOverrideSchema).optional().default([]),
});

export const GroupsConfigSchema = z.object({
    groups: z.record(z.string(), GroupConfigSchema),
});

export type GroupConfig = z.infer<typeof GroupConfigSchema>;
export type GroupsConfig = z.infer<typeof GroupsConfigSchema>;
