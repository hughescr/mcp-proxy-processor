/**
 * Unit tests for GroupManager override application logic
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { find as _find } from 'lodash';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, validGroupConfig, mockBackendTools, mockBackendResources, groupWithSchemaOverride } from '../fixtures/mock-configs.js';

describe('Override Application', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(validGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('Tool Override Application', () => {
        it('should apply name override to tool', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const renamedTool = _find(tools, { name: 'renamed_tool' });

            expect(renamedTool).toBeDefined();
            expect(renamedTool?.name).toBe('renamed_tool'); // Override applied
            expect(renamedTool?.description).toBe('Overridden description'); // Override applied
        });

        it('should retain original values when no override specified', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const anotherTool = _find(tools, { name: 'another_tool' });

            expect(anotherTool).toBeDefined();
            expect(anotherTool?.name).toBe('another_tool'); // No override, original retained
            expect(anotherTool?.description).toBe('Another tool from server 2'); // Original retained
        });

        it('should apply description override while keeping original name', async () => {
            const customGroup = {
                groups: {
                    'desc-override': {
                        name:  'desc-override',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                description:  'Only description changed',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            // Create a new group manager with custom config
            const customPath = await createTempConfigFile(customGroup);
            const customManager = new GroupManager(customPath);
            await customManager.load();

            const tools = customManager.getToolsForGroup('desc-override', mockBackendTools);
            const tool = tools[0];

            expect(tool.name).toBe('original_tool'); // Name unchanged
            expect(tool.description).toBe('Only description changed'); // Description overridden
        });

        it('should apply schema override completely', async () => {
            // Create a group manager with schema override config
            const schemaConfigPath = await createTempConfigFile({
                groups: { 'schema-override-group': groupWithSchemaOverride },
            });
            const schemaManager = new GroupManager(schemaConfigPath);
            await schemaManager.load();

            const tools = schemaManager.getToolsForGroup('schema-override-group', mockBackendTools);
            const tool = tools[0];

            expect(tool.name).toBe('tool_with_override');
            expect(tool.description).toBe('Tool with complete override');
            expect(tool.inputSchema).toEqual({
                type:       'object',
                properties: {
                    newParam: {
                        type:        'string',
                        description: 'New parameter',
                    },
                },
                required: ['newParam'],
            });
        });

        it('should handle partial schema override', async () => {
            const partialSchemaGroup = {
                groups: {
                    'partial-schema': {
                        name:  'partial-schema',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                inputSchema:  {
                                    type:       'object',
                                    properties: {
                                        newParam: { type: 'boolean' },
                                    },
                                    // No required array
                                },
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const partialPath = await createTempConfigFile(partialSchemaGroup);
            const partialManager = new GroupManager(partialPath);
            await partialManager.load();

            const tools = partialManager.getToolsForGroup('partial-schema', mockBackendTools);
            const tool = tools[0];

            expect(tool.inputSchema).toEqual({
                type:       'object',
                properties: {
                    newParam: { type: 'boolean' },
                },
                // No required array since it wasn't in the override
            });
        });

        it('should preserve original input schema when no override provided', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const anotherTool = _find(tools, { name: 'another_tool' });

            expect(anotherTool?.inputSchema).toEqual({
                type:       'object',
                properties: {
                    value: {
                        type: 'number',
                    },
                },
            });
        });

        it('should handle required array in schema override', async () => {
            const requiredSchemaGroup = {
                groups: {
                    'required-schema': {
                        name:  'required-schema',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                inputSchema:  {
                                    type:       'object',
                                    properties: {
                                        field1: { type: 'string' },
                                        field2: { type: 'number' },
                                    },
                                    required: ['field1', 'field2'],
                                },
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const requiredPath = await createTempConfigFile(requiredSchemaGroup);
            const requiredManager = new GroupManager(requiredPath);
            await requiredManager.load();

            const tools = requiredManager.getToolsForGroup('required-schema', mockBackendTools);
            const tool = tools[0];

            expect(tool.inputSchema).toEqual({
                type:       'object',
                properties: {
                    field1: { type: 'string' },
                    field2: { type: 'number' },
                },
                required: ['field1', 'field2'],
            });
        });
    });

    describe('Mixed Overrides', () => {
        it('should handle group with both tool and resource overrides', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);

            expect(tools).toHaveLength(2);
            expect(resources).toHaveLength(1);

            // Check tool overrides applied
            expect(tools[0].name).toBe('renamed_tool');
            expect(tools[1].name).toBe('another_tool');

            // Check resource overrides applied
            expect(resources[0].name).toBe('Original Resource');
        });

        it('should handle empty overrides gracefully', async () => {
            const emptyOverridesGroup = {
                groups: {
                    'empty-overrides': {
                        name:  'empty-overrides',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                // No overrides at all
                            },
                        ],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                                // No overrides at all
                            },
                        ],
                    },
                },
            };

            const emptyPath = await createTempConfigFile(emptyOverridesGroup);
            const emptyManager = new GroupManager(emptyPath);
            await emptyManager.load();

            const tools = emptyManager.getToolsForGroup('empty-overrides', mockBackendTools);
            const resources = emptyManager.getResourcesForGroup('empty-overrides', mockBackendResources);

            // Should use all original values
            expect(tools[0].name).toBe('original_tool');
            expect(tools[0].description).toBe('Original tool description');

            expect(resources[0].name).toBe('Original Resource');
            expect(resources[0].description).toBe('Original resource description');
        });
    });
});
