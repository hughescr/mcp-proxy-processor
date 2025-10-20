/**
 * Test data builders for creating valid and invalid configurations
 * Provides fluent builder API for constructing test fixtures
 */

import _ from 'lodash';
import type {
    BackendServersConfig,
    GroupsConfig,
    GroupConfig,
    StdioServerConfig,
    ToolOverride,
    ResourceRef,
    PromptRef,
    TemplateMapping
} from '../../src/types/config.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';

/**
 * Builder for creating backend server configurations
 */
export const backendConfig = {
    /**
     * Create a minimal valid backend servers config
     */
    minimal(): BackendServersConfig {
        return {
            mcpServers: {},
        };
    },

    /**
     * Create a backend config with a single server
     */
    withServer(name: string, config?: Partial<StdioServerConfig>): BackendServersConfig {
        return {
            mcpServers: {
                [name]: {
                    command: config?.command ?? 'node',
                    args:    config?.args ?? ['server.js'],
                    env:     config?.env ?? {},
                    ..._.omit(config, ['command', 'args', 'env']),
                },
            },
        };
    },

    /**
     * Create a backend config with multiple servers
     */
    withServers(servers: Record<string, Partial<StdioServerConfig>>): BackendServersConfig {
        return {
            mcpServers: _.mapValues(servers, config => ({
                command: config.command ?? 'node',
                args:    config.args ?? ['server.js'],
                env:     config.env ?? {},
                ..._.omit(config, ['command', 'args', 'env']),
            })),
        };
    },

    /**
     * Create an invalid backend config (missing required fields)
     */
    invalid(): Record<string, unknown> {
        return {
            mcpServers: {
                'invalid-server': {
                    // Missing required 'command' field
                    args: ['test'],
                },
            },
        };
    },
};

/**
 * Builder for creating stdio server configurations
 */
export const stdioServer = {
    /**
     * Create a minimal valid stdio server config
     */
    minimal(command = 'node'): StdioServerConfig {
        return { command };
    },

    /**
     * Create a stdio server with args
     */
    withArgs(command: string, args: string[]): StdioServerConfig {
        return { command, args };
    },

    /**
     * Create a stdio server with environment variables
     */
    withEnv(command: string, env: Record<string, string>): StdioServerConfig {
        return { command, env };
    },

    /**
     * Create a full stdio server config with all options
     */
    full(config: StdioServerConfig): StdioServerConfig {
        return { ...config };
    },
};

/**
 * Builder for creating group configurations
 */
export const group = {
    /**
     * Create a minimal valid group config
     */
    minimal(name = 'test-group'): GroupConfig {
        return {
            name,
            description: '',
            tools:       [],
            resources:   [],
            prompts:     [],
        };
    },

    /**
     * Create a group with a specific number of tools
     */
    withTools(count: number, serverName = 'test-server'): GroupConfig {
        const tools: ToolOverride[] = _.times(count, i => ({
            originalName: `tool_${i}`,
            serverName,
            name:         `renamed_tool_${i}`,
        }));

        return {
            name:        'test-group',
            description: `Group with ${count} tools`,
            tools,
            resources:   [],
            prompts:     [],
        };
    },

    /**
     * Create a group with a specific number of resources
     */
    withResources(count: number, serverName = 'test-server'): GroupConfig {
        const resources: ResourceRef[] = _.times(count, i => ({
            serverName,
            uri: `test://resource${i}`,
        }));

        return {
            name:        'test-group',
            description: `Group with ${count} resources`,
            tools:       [],
            resources,
            prompts:     [],
        };
    },

    /**
     * Create a group with a specific number of prompts
     */
    withPrompts(count: number, serverName = 'test-server'): GroupConfig {
        const prompts: PromptRef[] = _.times(count, i => ({
            serverName,
            name: `prompt_${i}`,
        }));

        return {
            name:        'test-group',
            description: `Group with ${count} prompts`,
            tools:       [],
            resources:   [],
            prompts,
        };
    },

    /**
     * Create an invalid group config (missing required fields)
     */
    invalid(): Record<string, unknown> {
        return {
            // Missing required 'name' field
            tools: [],
        };
    },

    /**
     * Create a group with custom properties
     */
    custom(overrides: Partial<GroupConfig>): GroupConfig {
        return {
            name:        'test-group',
            description: '',
            tools:       [],
            resources:   [],
            prompts:     [],
            ...overrides,
        };
    },
};

/**
 * Builder for creating groups configurations (collection of groups)
 */
export const groupsConfig = {
    /**
     * Create an empty groups config
     */
    empty(): GroupsConfig {
        return { groups: {} };
    },

    /**
     * Create a groups config with a single group
     */
    withGroup(name: string, groupCfg?: Partial<GroupConfig>): GroupsConfig {
        return {
            groups: {
                [name]: {
                    name,
                    description: '',
                    tools:       [],
                    resources:   [],
                    prompts:     [],
                    ...groupCfg,
                },
            },
        };
    },

    /**
     * Create a groups config with multiple groups
     */
    withGroups(groups: Record<string, Partial<GroupConfig>>): GroupsConfig {
        return {
            groups: _.mapValues(groups, (groupCfg, name) => ({
                name,
                description: '',
                tools:       [],
                resources:   [],
                prompts:     [],
                ...groupCfg,
            })),
        };
    },

    /**
     * Create an invalid groups config
     */
    invalid(): Record<string, unknown> {
        return {
            groups: {
                'invalid-group': {
                    // Missing required 'name' field
                    tools: [],
                },
            },
        };
    },
};

/**
 * Builder for creating tool override configurations
 */
export const tool = {
    /**
     * Create a minimal tool override (passthrough with no changes)
     */
    minimal(originalName: string, serverName = 'test-server'): ToolOverride {
        return {
            originalName,
            serverName,
        };
    },

    /**
     * Create a tool with name override
     */
    renamed(originalName: string, newName: string, serverName = 'test-server'): ToolOverride {
        return {
            originalName,
            serverName,
            name: newName,
        };
    },

    /**
     * Create a tool with description override
     */
    withDescription(originalName: string, description: string, serverName = 'test-server'): ToolOverride {
        return {
            originalName,
            serverName,
            description,
        };
    },

    /**
     * Create a tool with schema override
     */
    withSchema(
        originalName: string,
        inputSchema: Record<string, unknown>,
        serverName = 'test-server'
    ): ToolOverride {
        return {
            originalName,
            serverName,
            inputSchema,
        };
    },

    /**
     * Create a tool with template argument mapping
     */
    withTemplateMapping(
        originalName: string,
        mappings: TemplateMapping['mappings'],
        serverName = 'test-server'
    ): ToolOverride {
        return {
            originalName,
            serverName,
            argumentMapping: {
                type: 'template',
                mappings,
            },
        };
    },

    /**
     * Create a tool with JSONata argument mapping
     */
    withJsonataMapping(
        originalName: string,
        expression: string,
        serverName = 'test-server'
    ): ToolOverride {
        return {
            originalName,
            serverName,
            argumentMapping: {
                type: 'jsonata',
                expression,
            },
        };
    },

    /**
     * Create a fully customized tool override
     */
    custom(overrides: ToolOverride): ToolOverride {
        return { ...overrides };
    },
};

/**
 * Builder for creating resource references
 */
export const resource = {
    /**
     * Create a minimal resource reference
     */
    minimal(uri: string, serverName = 'test-server'): ResourceRef {
        return { serverName, uri };
    },

    /**
     * Create a template resource reference
     */
    template(uriTemplate: string, serverName = 'test-server'): ResourceRef {
        return { serverName, uri: uriTemplate };
    },
};

/**
 * Builder for creating prompt references
 */
export const prompt = {
    /**
     * Create a minimal prompt reference
     */
    minimal(name: string, serverName = 'test-server'): PromptRef {
        return { serverName, name };
    },
};

/**
 * Builder for creating MCP tool definitions (from backend servers)
 */
export const mcpTool = {
    /**
     * Create a minimal MCP tool definition
     */
    minimal(name: string): Tool {
        return {
            name,
            description: `Tool ${name}`,
            inputSchema: {
                type:       'object',
                properties: {},
            },
        };
    },

    /**
     * Create an MCP tool with parameters
     */
    withParams(name: string, params: Record<string, unknown>): Tool {
        return {
            name,
            description: `Tool ${name}`,
            inputSchema: {
                type:       'object',
                properties: params,
                required:   _.keys(params),
            },
        };
    },

    /**
     * Create a fully customized MCP tool
     */
    custom(overrides: Partial<Tool>): Tool {
        return {
            name:        'custom_tool',
            description: 'Custom tool',
            inputSchema: {
                type:       'object',
                properties: {},
            },
            ...overrides,
        };
    },
};

/**
 * Builder for creating MCP resource definitions (from backend servers)
 */
export const mcpResource = {
    /**
     * Create a minimal MCP resource definition
     */
    minimal(uri: string): Resource {
        return {
            uri,
            name:     `Resource ${uri}`,
            mimeType: 'text/plain',
        };
    },

    /**
     * Create an MCP resource with specific mime type
     */
    withMimeType(uri: string, mimeType: string): Resource {
        return {
            uri,
            name: `Resource ${uri}`,
            mimeType,
        };
    },

    /**
     * Create a fully customized MCP resource
     */
    custom(overrides: Partial<Resource>): Resource {
        return {
            uri:      'test://resource',
            name:     'Test Resource',
            mimeType: 'text/plain',
            ...overrides,
        };
    },
};

/**
 * Builder for creating MCP prompt definitions (from backend servers)
 */
export const mcpPrompt = {
    /**
     * Create a minimal MCP prompt definition
     */
    minimal(name: string): Prompt {
        return {
            name,
            description: `Prompt ${name}`,
        };
    },

    /**
     * Create an MCP prompt with arguments
     */
    withArguments(name: string, args: Prompt['arguments']): Prompt {
        return {
            name,
            description: `Prompt ${name}`,
            arguments:   args,
        };
    },

    /**
     * Create a fully customized MCP prompt
     */
    custom(overrides: Partial<Prompt>): Prompt {
        return {
            name:        'custom_prompt',
            description: 'Custom prompt',
            ...overrides,
        };
    },
};

/**
 * Combined builders export for convenient access
 */
export const builders = {
    backendConfig,
    stdioServer,
    group,
    groupsConfig,
    tool,
    resource,
    prompt,
    mcpTool,
    mcpResource,
    mcpPrompt,
};
