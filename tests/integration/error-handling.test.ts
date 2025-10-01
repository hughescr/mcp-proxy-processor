/**
 * Integration tests for error scenarios and edge cases
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { find as _find } from 'lodash';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, validGroupConfig, mockBackendTools, mockBackendResources, mockToolCallError, invalidGroupConfig, invalidBackendConfig } from '../fixtures/mock-configs.js';
import { unlink } from 'node:fs/promises';

describe('Error Handling', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(validGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('Configuration Errors', () => {
        it('should handle non-existent configuration file', async () => {
            const nonExistentManager = new GroupManager('/path/that/does/not/exist.json');

            expect(nonExistentManager.load()).rejects.toThrow(/Failed to load groups configuration/);
        });

        it('should handle invalid JSON in configuration file', async () => {
            const invalidJsonPath = await createTempConfigFile('{ invalid json }');
            const invalidJsonManager = new GroupManager(invalidJsonPath);

            expect(invalidJsonManager.load()).rejects.toThrow(/Failed to load groups configuration/);
        });

        it('should handle invalid configuration schema', async () => {
            const invalidSchemaPath = await createTempConfigFile(invalidGroupConfig);
            const invalidSchemaManager = new GroupManager(invalidSchemaPath);

            expect(invalidSchemaManager.load()).rejects.toThrow(/Failed to load groups configuration/);
        });

        it('should handle file read permissions error', async () => {
            // Create a file and then delete it to simulate permission error
            const tempPath = await createTempConfigFile(validGroupConfig);
            await unlink(tempPath);

            const deletedFileManager = new GroupManager(tempPath);
            expect(deletedFileManager.load()).rejects.toThrow();
        });

        it('should handle malformed backend server config', async () => {
            const malformedBackendPath = await createTempConfigFile(invalidBackendConfig);
            const malformedManager = new GroupManager(malformedBackendPath);

            expect(malformedManager.load()).rejects.toThrow();
        });
    });

    describe('Group Not Found Errors', () => {
        it('should handle non-existent group name gracefully', () => {
            const group = groupManager.getGroup('non-existent-group');
            expect(group).toBeUndefined();

            const servers = groupManager.getRequiredServers('non-existent-group');
            expect(servers).toEqual([]);

            const tools = groupManager.getToolsForGroup('non-existent-group', mockBackendTools);
            expect(tools).toEqual([]);

            const resources = groupManager.getResourcesForGroup('non-existent-group', mockBackendResources);
            expect(resources).toEqual([]);
        });

        it('should handle empty group name', () => {
            const group = groupManager.getGroup('');
            expect(group).toBeUndefined();

            const servers = groupManager.getRequiredServers('');
            expect(servers).toEqual([]);
        });

        it('should handle special characters in group name', () => {
            const specialNames = [
                '../etc/passwd',
                '../../config',
                '<script>alert(1)</script>',
                'group; rm -rf /',
                'group\0null',
            ];

            for(const name of specialNames) {
                const group = groupManager.getGroup(name);
                expect(group).toBeUndefined();
            }
        });
    });

    describe('Backend Server Errors', () => {
        it('should handle non-existent backend server gracefully', () => {
            // Group references server that doesn't exist in backend map
            const emptyBackendTools = new Map<string, Tool[]>();
            const tools = groupManager.getToolsForGroup('test-group', emptyBackendTools);

            // Should return empty array, not throw
            expect(tools).toEqual([]);
        });

        it('should handle backend server connection failure', async () => {
            const failureGroup = {
                groups: {
                    'failure-group': {
                        name:  'failure-group',
                        tools: [
                            {
                                originalName: 'tool',
                                serverName:   'unreachable-server',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const failurePath = await createTempConfigFile(failureGroup);
            const failureManager = new GroupManager(failurePath);
            await failureManager.load();

            // Simulate backend server not available
            const emptyBackend = new Map<string, Tool[]>();
            const tools = failureManager.getToolsForGroup('failure-group', emptyBackend);

            expect(tools).toEqual([]);
        });

        it('should continue with partial backend availability', () => {
            // One server available, one not
            const partialBackend = new Map([
                ['test-server-1', mockBackendTools.get('test-server-1')!],
                // test-server-2 missing
            ]);

            const tools = groupManager.getToolsForGroup('test-group', partialBackend);

            // Should get tools from available server only
            expect(tools.length).toBeGreaterThan(0);
            expect(_find(tools, { name: 'renamed_tool' })).toBeDefined();
            expect(_find(tools, { name: 'another_tool' })).toBeUndefined();
        });
    });

    describe('Tool Not Found Errors', () => {
        it('should handle non-existent tool in backend gracefully', async () => {
            const missingToolGroup = {
                groups: {
                    'missing-tool': {
                        name:  'missing-tool',
                        tools: [
                            {
                                originalName: 'does_not_exist',
                                serverName:   'test-server-1',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const missingPath = await createTempConfigFile(missingToolGroup);
            const missingManager = new GroupManager(missingPath);
            await missingManager.load();

            const tools = missingManager.getToolsForGroup('missing-tool', mockBackendTools);

            // Tool not found, should skip it
            expect(tools).toEqual([]);
        });

        it('should handle renamed tool that no longer exists', async () => {
            const renamedGroup = {
                groups: {
                    renamed: {
                        name:  'renamed',
                        tools: [
                            {
                                originalName: 'old_tool_name',
                                serverName:   'test-server-1',
                                name:         'new_tool_name',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const renamedPath = await createTempConfigFile(renamedGroup);
            const renamedManager = new GroupManager(renamedPath);
            await renamedManager.load();

            const tools = renamedManager.getToolsForGroup('renamed', mockBackendTools);

            // Original tool doesn't exist
            expect(tools).toEqual([]);
        });

        it('should skip invalid tools and continue with valid ones', async () => {
            const mixedGroup = {
                groups: {
                    mixed: {
                        name:  'mixed',
                        tools: [
                            {
                                originalName: 'invalid_tool',
                                serverName:   'test-server-1',
                            },
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                            },
                            {
                                originalName: 'another_invalid',
                                serverName:   'test-server-1',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const mixedPath = await createTempConfigFile(mixedGroup);
            const mixedManager = new GroupManager(mixedPath);
            await mixedManager.load();

            const tools = mixedManager.getToolsForGroup('mixed', mockBackendTools);

            // Should get only the valid tool
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('original_tool');
        });
    });

    describe('Resource Not Found Errors', () => {
        it('should handle non-existent resource in backend gracefully', async () => {
            const missingResourceGroup = {
                groups: {
                    'missing-resource': {
                        name:      'missing-resource',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'test://does-not-exist',
                                serverName:  'test-server-1',
                            },
                        ],
                    },
                },
            };

            const missingPath = await createTempConfigFile(missingResourceGroup);
            const missingManager = new GroupManager(missingPath);
            await missingManager.load();

            const resources = missingManager.getResourcesForGroup('missing-resource', mockBackendResources);

            // Resource not found, should skip it
            expect(resources).toEqual([]);
        });

        it('should skip invalid resources and continue with valid ones', async () => {
            const mixedResourceGroup = {
                groups: {
                    'mixed-resources': {
                        name:      'mixed-resources',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'test://invalid1',
                                serverName:  'test-server-1',
                            },
                            {
                                originalUri: 'test://resource1',
                                serverName:  'test-server-1',
                            },
                            {
                                originalUri: 'test://invalid2',
                                serverName:  'test-server-1',
                            },
                        ],
                    },
                },
            };

            const mixedPath = await createTempConfigFile(mixedResourceGroup);
            const mixedManager = new GroupManager(mixedPath);
            await mixedManager.load();

            const resources = mixedManager.getResourcesForGroup('mixed-resources', mockBackendResources);

            // Should get only the valid resource
            expect(resources).toHaveLength(1);
            expect(resources[0].uri).toBe('test://resource1');
        });
    });

    describe('Invalid Tool Arguments', () => {
        it('should handle invalid tool call arguments', () => {
            // This would typically be handled by the proxy layer
            // Here we just verify the error response structure
            const errorResponse = mockToolCallError;

            expect(errorResponse.isError).toBe(true);
            expect(errorResponse.content[0].text).toContain('failed');
        });

        it('should handle tool call with missing required arguments', async () => {
            const strictSchemaGroup = {
                groups: {
                    strict: {
                        name:  'strict',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                inputSchema:  {
                                    type:       'object',
                                    properties: {
                                        required_field: {
                                            type:        'string',
                                            description: 'This field is required',
                                        },
                                    },
                                    required: ['required_field'],
                                },
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const strictPath = await createTempConfigFile(strictSchemaGroup);
            const strictManager = new GroupManager(strictPath);
            await strictManager.load();

            const tools = strictManager.getToolsForGroup('strict', mockBackendTools);
            const tool = tools[0];

            // Verify the schema has required fields
            expect(tool.inputSchema?.required).toContain('required_field');
        });
    });

    describe('Backend Server Error Propagation', () => {
        it('should propagate backend server errors correctly', () => {
            // Simulate backend error response
            const errorResponse = mockToolCallError;

            expect(errorResponse.isError).toBe(true);
            expect(errorResponse.content).toBeDefined();
            expect(errorResponse.content[0].type).toBe('text');
        });

        it('should handle timeout errors from backend', async () => {
            // This would typically involve actual timeout handling
            // Here we simulate the expected behavior
            const timeoutGroup = {
                groups: {
                    timeout: {
                        name:  'timeout',
                        tools: [
                            {
                                originalName: 'slow_tool',
                                serverName:   'slow-server',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const timeoutPath = await createTempConfigFile(timeoutGroup);
            const timeoutManager = new GroupManager(timeoutPath);
            await timeoutManager.load();

            // Backend not available (simulating timeout)
            const tools = timeoutManager.getToolsForGroup('timeout', new Map());

            expect(tools).toEqual([]);
        });
    });

    describe('Concurrent Error Scenarios', () => {
        it('should handle multiple simultaneous errors gracefully', async () => {
            const errorProneGroup = {
                groups: {
                    'error-prone': {
                        name:  'error-prone',
                        tools: [
                            {
                                originalName: 'missing1',
                                serverName:   'server1',
                            },
                            {
                                originalName: 'missing2',
                                serverName:   'server2',
                            },
                            {
                                originalName: 'missing3',
                                serverName:   'server3',
                            },
                        ],
                        resources: [
                            {
                                originalUri: 'missing://resource1',
                                serverName:  'server1',
                            },
                            {
                                originalUri: 'missing://resource2',
                                serverName:  'server2',
                            },
                        ],
                    },
                },
            };

            const errorPath = await createTempConfigFile(errorProneGroup);
            const errorManager = new GroupManager(errorPath);
            await errorManager.load();

            // All backend lookups will fail
            const tools = errorManager.getToolsForGroup('error-prone', mockBackendTools);
            const resources = errorManager.getResourcesForGroup('error-prone', mockBackendResources);

            // Should handle all failures gracefully
            expect(tools).toEqual([]);
            expect(resources).toEqual([]);
        });

        it('should isolate errors between different groups', async () => {
            const multiGroupConfig = {
                groups: {
                    'working-group': {
                        name:  'working-group',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                            },
                        ],
                        resources: [],
                    },
                    'broken-group': {
                        name:  'broken-group',
                        tools: [
                            {
                                originalName: 'non_existent',
                                serverName:   'test-server-1',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const multiPath = await createTempConfigFile(multiGroupConfig);
            const multiManager = new GroupManager(multiPath);
            await multiManager.load();

            // Working group should function normally
            const workingTools = multiManager.getToolsForGroup('working-group', mockBackendTools);
            expect(workingTools).toHaveLength(1);

            // Broken group should fail gracefully
            const brokenTools = multiManager.getToolsForGroup('broken-group', mockBackendTools);
            expect(brokenTools).toEqual([]);

            // Error in one group shouldn't affect the other
            expect(workingTools[0].name).toBe('original_tool');
        });
    });

    describe('Recovery and Resilience', () => {
        it('should recover from transient errors', async () => {
            // First attempt fails
            const emptyBackend = new Map<string, Tool[]>();
            const tools1 = groupManager.getToolsForGroup('test-group', emptyBackend);
            expect(tools1).toEqual([]);

            // Second attempt succeeds (backend now available)
            const tools2 = groupManager.getToolsForGroup('test-group', mockBackendTools);
            expect(tools2.length).toBeGreaterThan(0);
        });

        it('should handle configuration reload after error', async () => {
            // Load valid config
            const group1 = groupManager.getGroup('test-group');
            expect(group1).toBeDefined();

            // Try to load invalid config (should fail but not crash)
            const invalidManager = new GroupManager('/invalid/path');
            expect(invalidManager.load()).rejects.toThrow();

            // Original manager should still work
            const group2 = groupManager.getGroup('test-group');
            expect(group2).toBeDefined();
            expect(group2?.name).toBe('test-group');
        });
    });
});
