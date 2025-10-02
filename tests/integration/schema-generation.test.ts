/**
 * Integration test for schema generation from parameter mappings
 */

import { describe, test, expect } from 'bun:test';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile } from '../fixtures/mock-configs.js';
import type { Tool } from '@modelcontextprotocol/sdk/types';

describe('Schema Generation Integration', () => {
    test('should generate client schema with constant parameter hidden', async () => {
        // Create a group configuration with a constant parameter mapping
        const groupConfig = {
            groups: {
                'test-group': {
                    name:  'test-group',
                    tools: [
                        {
                            originalName:    'search_tool',
                            serverName:      'test-server',
                            argumentMapping: {
                                type:     'template' as const,
                                mappings: {
                                    api_key: {
                                        type:  'constant' as const,
                                        value: 'secret123',
                                    },
                                    query: {
                                        type:   'passthrough' as const,
                                        source: 'query',
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        };

        const configPath = await createTempConfigFile(groupConfig);
        const groupManager = new GroupManager(configPath);
        await groupManager.load();

        // Mock backend tool with schema
        const backendTool: Tool = {
            name:        'search_tool',
            description: 'Search tool',
            inputSchema: {
                type:       'object',
                properties: {
                    api_key: { type: 'string', description: 'API key' },
                    query:   { type: 'string', description: 'Search query' },
                },
                required: ['api_key', 'query'],
            },
        };

        const backendTools = new Map([
            ['test-server', [backendTool]],
        ]);

        const tools = groupManager.getToolsForGroup('test-group', backendTools);

        expect(tools).toHaveLength(1);
        const tool = tools[0];

        // Verify that api_key is hidden from client schema
        expect(tool.inputSchema).toBeDefined();
        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;

        expect(properties).not.toHaveProperty('api_key');
        expect(properties).toHaveProperty('query');

        const required = schema.required as string[];
        expect(required).not.toContain('api_key');
        expect(required).toContain('query');
    });

    test('should make default parameters optional in client schema', async () => {
        const groupConfig = {
            groups: {
                'test-group': {
                    name:  'test-group',
                    tools: [
                        {
                            originalName:    'time_tool',
                            serverName:      'test-server',
                            argumentMapping: {
                                type:     'template' as const,
                                mappings: {
                                    timezone: {
                                        type:      'default' as const,
                                        source:    'timezone',
                                        'default': 'America/Los_Angeles',
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        };

        const configPath = await createTempConfigFile(groupConfig);
        const groupManager = new GroupManager(configPath);
        await groupManager.load();

        const backendTool: Tool = {
            name:        'time_tool',
            description: 'Get current time',
            inputSchema: {
                type:       'object',
                properties: {
                    timezone: { type: 'string', description: 'Timezone' },
                },
                required: ['timezone'],
            },
        };

        const backendTools = new Map([
            ['test-server', [backendTool]],
        ]);

        const tools = groupManager.getToolsForGroup('test-group', backendTools);

        expect(tools).toHaveLength(1);
        const tool = tools[0];

        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;
        const required = schema.required as string[];

        // timezone should be in properties but not required
        expect(properties).toHaveProperty('timezone');
        expect(required).not.toContain('timezone');
    });

    test('should apply parameter name and description overrides', async () => {
        const groupConfig = {
            groups: {
                'test-group': {
                    name:  'test-group',
                    tools: [
                        {
                            originalName:    'search_tool',
                            serverName:      'test-server',
                            argumentMapping: {
                                type:     'template' as const,
                                mappings: {
                                    backend_query: {
                                        type:        'passthrough' as const,
                                        source:      'q',
                                        name:        'q',
                                        description: 'Simple search query',
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        };

        const configPath = await createTempConfigFile(groupConfig);
        const groupManager = new GroupManager(configPath);
        await groupManager.load();

        const backendTool: Tool = {
            name:        'search_tool',
            description: 'Search tool',
            inputSchema: {
                type:       'object',
                properties: {
                    backend_query: { type: 'string', description: 'Complex backend query' },
                },
                required: ['backend_query'],
            },
        };

        const backendTools = new Map([
            ['test-server', [backendTool]],
        ]);

        const tools = groupManager.getToolsForGroup('test-group', backendTools);

        expect(tools).toHaveLength(1);
        const tool = tools[0];

        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;

        // Client should see parameter as 'q' with overridden description
        expect(properties).toHaveProperty('q');
        expect(properties).not.toHaveProperty('backend_query');

        const qParam = properties.q as Record<string, unknown>;
        expect(qParam.description).toBe('Simple search query');
    });

    test('should hide omit parameters from client schema', async () => {
        const groupConfig = {
            groups: {
                'test-group': {
                    name:  'test-group',
                    tools: [
                        {
                            originalName:    'debug_tool',
                            serverName:      'test-server',
                            argumentMapping: {
                                type:     'template' as const,
                                mappings: {
                                    debug: {
                                        type: 'omit' as const,
                                    },
                                    query: {
                                        type:   'passthrough' as const,
                                        source: 'query',
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        };

        const configPath = await createTempConfigFile(groupConfig);
        const groupManager = new GroupManager(configPath);
        await groupManager.load();

        const backendTool: Tool = {
            name:        'debug_tool',
            description: 'Debug tool',
            inputSchema: {
                type:       'object',
                properties: {
                    debug: { type: 'boolean', description: 'Enable debug mode' },
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
            },
        };

        const backendTools = new Map([
            ['test-server', [backendTool]],
        ]);

        const tools = groupManager.getToolsForGroup('test-group', backendTools);

        expect(tools).toHaveLength(1);
        const tool = tools[0];

        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;

        // debug should be hidden
        expect(properties).not.toHaveProperty('debug');
        expect(properties).toHaveProperty('query');
    });

    test('should use explicit inputSchema override when no argument mapping is present', async () => {
        const groupConfig = {
            groups: {
                'test-group': {
                    name:  'test-group',
                    tools: [
                        {
                            originalName: 'simple_tool',
                            serverName:   'test-server',
                            inputSchema:  {
                                properties: {
                                    custom_param: { type: 'string' },
                                },
                                required: ['custom_param'],
                            },
                        },
                    ],
                },
            },
        };

        const configPath = await createTempConfigFile(groupConfig);
        const groupManager = new GroupManager(configPath);
        await groupManager.load();

        const backendTool: Tool = {
            name:        'simple_tool',
            description: 'Simple tool',
            inputSchema: {
                type:       'object',
                properties: {
                    original_param: { type: 'string' },
                },
                required: ['original_param'],
            },
        };

        const backendTools = new Map([
            ['test-server', [backendTool]],
        ]);

        const tools = groupManager.getToolsForGroup('test-group', backendTools);

        expect(tools).toHaveLength(1);
        const tool = tools[0];

        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = schema.properties as Record<string, unknown>;

        // Should use the explicit override
        expect(properties).toHaveProperty('custom_param');
        expect(properties).not.toHaveProperty('original_param');
    });
});
