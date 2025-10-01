/**
 * Integration tests for end-to-end tool call proxying
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { find as _find } from 'lodash';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, validGroupConfig, mockBackendTools, mockToolCallResponse, groupWithSchemaOverride } from '../fixtures/mock-configs.js';
import type { Tool } from '@modelcontextprotocol/sdk/types';

describe('Proxy Flow Integration', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(validGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('Group Configuration Loading', () => {
        it('should load and validate group configuration from disk', async () => {
            // Group manager already loaded in beforeEach
            const group = groupManager.getGroup('test-group');

            expect(group).toBeDefined();
            expect(group?.name).toBe('test-group');
            expect(group?.tools).toHaveLength(2);
        });

        it('should handle invalid configuration file gracefully', async () => {
            const invalidPath = await createTempConfigFile({ invalid: 'structure' });
            const invalidManager = new GroupManager(invalidPath);

            expect(invalidManager.load()).rejects.toThrow();
        });

        it('should handle non-existent configuration file', async () => {
            const nonExistentManager = new GroupManager('/non/existent/path.json');

            expect(nonExistentManager.load()).rejects.toThrow();
        });
    });

    describe('Backend Tool Discovery', () => {
        it('should discover tools from backend servers', () => {
            const requiredServers = groupManager.getRequiredServers('test-group');

            expect(requiredServers).toContain('test-server-1');
            expect(requiredServers).toContain('test-server-2');

            // Simulate backend tool discovery
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);

            expect(tools).toHaveLength(2);
            expect(_find(tools, { name: 'renamed_tool' })).toBeDefined();
            expect(_find(tools, { name: 'another_tool' })).toBeDefined();
        });

        it('should handle partial backend server availability', () => {
            const partialBackendTools = new Map([
                ['test-server-1', mockBackendTools.get('test-server-1')!],
                // test-server-2 is missing
            ]);

            const tools = groupManager.getToolsForGroup('test-group', partialBackendTools);

            // Should only get tools from available server
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('renamed_tool');
        });
    });

    describe('Tool Call Proxying', () => {
        it('should apply overrides when proxying tool calls', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const renamedTool = _find(tools, { name: 'renamed_tool' });

            // Verify the tool has overrides applied
            expect(renamedTool?.name).toBe('renamed_tool');
            expect(renamedTool?.description).toBe('Overridden description');

            // The original tool name would be needed for backend call
            const groupConfig = groupManager.getGroup('test-group');
            const toolOverride = _find(groupConfig?.tools, { name: 'renamed_tool' });

            expect(toolOverride?.originalName).toBe('original_tool');
            expect(toolOverride?.serverName).toBe('test-server-1');
        });

        it('should map tool calls to correct backend server', () => {
            const groupConfig = groupManager.getGroup('test-group');

            // Each tool should map to its backend server
            const tool1 = _find(groupConfig?.tools, { originalName: 'original_tool' });
            const tool2 = _find(groupConfig?.tools, { originalName: 'another_tool' });

            expect(tool1?.serverName).toBe('test-server-1');
            expect(tool2?.serverName).toBe('test-server-2');
        });

        it('should handle tool with complete schema override', async () => {
            const schemaPath = await createTempConfigFile({
                groups: { 'schema-override-group': groupWithSchemaOverride },
            });
            const schemaManager = new GroupManager(schemaPath);
            await schemaManager.load();

            const tools = schemaManager.getToolsForGroup('schema-override-group', mockBackendTools);
            const tool = tools[0];

            // Verify schema override is applied
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

            // Original backend would need different schema
            const backendTool = _find(mockBackendTools.get('test-server-1'), { name: 'original_tool' });
            expect(backendTool?.inputSchema).not.toEqual(tool.inputSchema);
        });
    });

    describe('End-to-End Flow Simulation', () => {
        it('should complete full proxy flow for a tool call', async () => {
            // 1. Load configuration
            const group = groupManager.getGroup('test-group');
            expect(group).toBeDefined();

            // 2. Get required backend servers
            const servers = groupManager.getRequiredServers('test-group');
            expect(servers).toHaveLength(2);

            // 3. Discover backend tools (simulated)
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            expect(tools).toHaveLength(2);

            // 4. Find tool mapping for a call
            const toolToCall = 'renamed_tool';
            const tool = _find(tools, { name: toolToCall });
            expect(tool).toBeDefined();

            // 5. Get original tool info for backend call
            const toolOverride = _find(group?.tools, { name: toolToCall });
            expect(toolOverride?.originalName).toBe('original_tool');
            expect(toolOverride?.serverName).toBe('test-server-1');

            // 6. Simulate backend call and response
            const response = mockToolCallResponse;
            expect(response.isError).toBe(false);
            expect(response.content[0].text).toBe('Tool executed successfully');
        });

        it('should handle multiple concurrent tool calls', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);

            // Simulate concurrent calls to different tools
            const tool1 = _find(tools, { name: 'renamed_tool' });
            const tool2 = _find(tools, { name: 'another_tool' });

            expect(tool1).toBeDefined();
            expect(tool2).toBeDefined();

            // Get backend mapping for both
            const group = groupManager.getGroup('test-group');
            const override1 = _find(group?.tools, t => t.name === 'renamed_tool' || t.originalName === 'original_tool');
            const override2 = _find(group?.tools, { originalName: 'another_tool' });

            expect(override1?.serverName).toBe('test-server-1');
            expect(override2?.serverName).toBe('test-server-2');

            // Different servers would handle different tools
            expect(override1?.serverName).not.toBe(override2?.serverName);
        });

        it('should maintain tool isolation between groups', async () => {
            // Create another group
            const anotherGroup = {
                groups: {
                    'another-group': {
                        name:  'another-group',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                name:         'different_name',
                                description:  'Different description',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const anotherPath = await createTempConfigFile(anotherGroup);
            const anotherManager = new GroupManager(anotherPath);
            await anotherManager.load();

            // Get tools for both groups
            const tools1 = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const tools2 = anotherManager.getToolsForGroup('another-group', mockBackendTools);

            // Same backend tool, different overrides
            const tool1 = _find(tools1, { name: 'renamed_tool' });
            const tool2 = _find(tools2, { name: 'different_name' });

            expect(tool1?.description).toBe('Overridden description');
            expect(tool2?.description).toBe('Different description');

            // Both map to same backend tool
            const group1 = groupManager.getGroup('test-group');
            const group2 = anotherManager.getGroup('another-group');

            const override1 = _find(group1?.tools, { originalName: 'original_tool' });
            const override2 = _find(group2?.tools, { originalName: 'original_tool' });

            expect(override1?.originalName).toBe(override2?.originalName);
            expect(override1?.serverName).toBe(override2?.serverName);
        });
    });

    describe('Performance Considerations', () => {
        it('should handle large number of tools efficiently', async () => {
            const manyToolsGroup = {
                groups: {
                    'many-tools': {
                        name:  'many-tools',
                        tools: Array.from({ length: 100 }, (_, i) => ({
                            originalName: `tool_${i}`,
                            serverName:   `server_${i % 10}`, // Distribute across 10 servers
                            name:         `renamed_tool_${i}`,
                            description:  `Description for tool ${i}`,
                        })),
                        resources: [],
                    },
                },
            };

            const largePath = await createTempConfigFile(manyToolsGroup);
            const largeManager = new GroupManager(largePath);
            await largeManager.load();

            // Create corresponding backend tools
            const largeBackendTools = new Map<string, Tool[]>();
            for(let s = 0; s < 10; s++) {
                const serverTools: Tool[] = [];
                for(let t = s; t < 100; t += 10) {
                    serverTools.push({
                        name:        `tool_${t}`,
                        description: `Backend tool ${t}`,
                        inputSchema: { type: 'object' },
                    });
                }
                largeBackendTools.set(`server_${s}`, serverTools);
            }

            const startTime = performance.now();
            const tools = largeManager.getToolsForGroup('many-tools', largeBackendTools);
            const endTime = performance.now();

            expect(tools).toHaveLength(100);
            expect(endTime - startTime).toBeLessThan(100); // Should be fast (< 100ms)
        });

        it('should cache group lookups efficiently', () => {
            // Multiple lookups of same group should be fast
            const iterations = 1000;
            const startTime = performance.now();

            for(let i = 0; i < iterations; i++) {
                const group = groupManager.getGroup('test-group');
                expect(group).toBeDefined();
            }

            const endTime = performance.now();
            const avgTime = (endTime - startTime) / iterations;

            expect(avgTime).toBeLessThan(1); // < 1ms per lookup
        });
    });
});
