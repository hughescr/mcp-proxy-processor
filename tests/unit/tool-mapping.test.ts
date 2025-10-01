/**
 * Unit tests for tool and resource resolution/mapping
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, validGroupConfig, mockBackendTools, mockBackendResources, groupWithDuplicateTools, groupWithMissingBackendTool } from '../fixtures/mock-configs.js';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types';

describe('Tool Mapping', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(validGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('getRequiredServers()', () => {
        it('should return correct list of required servers for a group', () => {
            const servers = groupManager.getRequiredServers('test-group');
            expect(servers).toContain('test-server-1');
            expect(servers).toContain('test-server-2');
            expect(servers).toHaveLength(2);
        });

        it('should return unique server names only', async () => {
            const duplicateServersGroup = {
                groups: {
                    'duplicate-servers': {
                        name:  'duplicate-servers',
                        tools: [
                            {
                                originalName: 'tool1',
                                serverName:   'server-a',
                            },
                            {
                                originalName: 'tool2',
                                serverName:   'server-a',
                            },
                            {
                                originalName: 'tool3',
                                serverName:   'server-b',
                            },
                        ],
                        resources: [
                            {
                                originalUri: 'resource1',
                                serverName:  'server-a',
                            },
                            {
                                originalUri: 'resource2',
                                serverName:  'server-b',
                            },
                        ],
                    },
                },
            };

            const dupPath = await createTempConfigFile(duplicateServersGroup);
            const dupManager = new GroupManager(dupPath);
            await dupManager.load();

            const servers = dupManager.getRequiredServers('duplicate-servers');
            expect(servers).toEqual(['server-a', 'server-b']);
            expect(servers).toHaveLength(2);
        });

        it('should return empty array for non-existent group', () => {
            const servers = groupManager.getRequiredServers('non-existent-group');
            expect(servers).toEqual([]);
        });

        it('should handle group with only tools', async () => {
            const toolsOnlyGroup = {
                groups: {
                    'tools-only': {
                        name:  'tools-only',
                        tools: [
                            {
                                originalName: 'tool1',
                                serverName:   'server1',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const toolsPath = await createTempConfigFile(toolsOnlyGroup);
            const toolsManager = new GroupManager(toolsPath);
            await toolsManager.load();

            const servers = toolsManager.getRequiredServers('tools-only');
            expect(servers).toEqual(['server1']);
        });

        it('should handle group with only resources', async () => {
            const resourcesOnlyGroup = {
                groups: {
                    'resources-only': {
                        name:      'resources-only',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'resource1',
                                serverName:  'server1',
                            },
                        ],
                    },
                },
            };

            const resourcesPath = await createTempConfigFile(resourcesOnlyGroup);
            const resourcesManager = new GroupManager(resourcesPath);
            await resourcesManager.load();

            const servers = resourcesManager.getRequiredServers('resources-only');
            expect(servers).toEqual(['server1']);
        });

        it('should handle empty group', () => {
            const servers = groupManager.getRequiredServers('minimal-group');
            expect(servers).toEqual([]);
        });
    });

    describe('getToolsForGroup()', () => {
        it('should map tools correctly to a group', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);

            expect(tools).toHaveLength(2);
            expect(tools.map(t => t.name)).toContain('renamed_tool');
            expect(tools.map(t => t.name)).toContain('another_tool');
        });

        it('should return empty array for non-existent group', () => {
            const tools = groupManager.getToolsForGroup('non-existent-group', mockBackendTools);
            expect(tools).toEqual([]);
        });

        it('should handle missing backend server gracefully', () => {
            const incompleteBackendTools = new Map([
                // Missing 'test-server-2'
                ['test-server-1', mockBackendTools.get('test-server-1')!],
            ]);

            const tools = groupManager.getToolsForGroup('test-group', incompleteBackendTools);

            // Should only get tools from available server
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('renamed_tool');
        });

        it('should handle missing backend tool gracefully', async () => {
            const missingToolPath = await createTempConfigFile({
                groups: { 'missing-backend-group': groupWithMissingBackendTool },
            });
            const missingManager = new GroupManager(missingToolPath);
            await missingManager.load();

            const tools = missingManager.getToolsForGroup('missing-backend-group', mockBackendTools);

            // Tool doesn't exist in backend, should be skipped
            expect(tools).toEqual([]);
        });

        it('should handle duplicate tool names in group', async () => {
            const dupPath = await createTempConfigFile({
                groups: { 'duplicate-tools-group': groupWithDuplicateTools },
            });
            const dupManager = new GroupManager(dupPath);
            await dupManager.load();

            const tools = dupManager.getToolsForGroup('duplicate-tools-group', mockBackendTools);

            // Both tools should be included with different names
            expect(tools).toHaveLength(2);
            expect(tools.map(t => t.name)).toContain('renamed_tool_1');
            expect(tools.map(t => t.name)).toContain('renamed_tool_2');
        });

        it('should preserve tool order from configuration', () => {
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);

            // First tool in config should be first in result
            expect(tools[0].name).toBe('renamed_tool');
            expect(tools[1].name).toBe('another_tool');
        });

        it('should handle empty backend tools map', () => {
            const emptyBackendTools = new Map<string, Tool[]>();
            const tools = groupManager.getToolsForGroup('test-group', emptyBackendTools);

            expect(tools).toEqual([]);
        });

        it('should handle backend server with empty tools array', () => {
            const emptyServerTools = new Map([
                ['test-server-1', []],
                ['test-server-2', []],
            ]);

            const tools = groupManager.getToolsForGroup('test-group', emptyServerTools);

            expect(tools).toEqual([]);
        });
    });

    describe('getResourcesForGroup()', () => {
        it('should map resources correctly to a group', () => {
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);

            expect(resources).toHaveLength(1);
            expect(resources[0].name).toBe('Custom Resource Name');
            expect(resources[0].uri).toBe('test://resource1');
        });

        it('should return empty array for non-existent group', () => {
            const resources = groupManager.getResourcesForGroup('non-existent-group', mockBackendResources);
            expect(resources).toEqual([]);
        });

        it('should handle missing backend server gracefully', async () => {
            const resourceGroup = {
                groups: {
                    'resource-group': {
                        name:      'resource-group',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'test://resource1',
                                serverName:  'test-server-1',
                            },
                            {
                                originalUri: 'test://resource3',
                                serverName:  'test-server-2',
                            },
                        ],
                    },
                },
            };

            const resPath = await createTempConfigFile(resourceGroup);
            const resManager = new GroupManager(resPath);
            await resManager.load();

            const incompleteBackendResources = new Map([
                // Missing 'test-server-2'
                ['test-server-1', mockBackendResources.get('test-server-1')!],
            ]);

            const resources = resManager.getResourcesForGroup('resource-group', incompleteBackendResources);

            // Should only get resources from available server
            expect(resources).toHaveLength(1);
            expect(resources[0].uri).toBe('test://resource1');
        });

        it('should handle missing backend resource gracefully', async () => {
            const missingResourceGroup = {
                groups: {
                    'missing-resource': {
                        name:      'missing-resource',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'test://non-existent',
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

            // Resource doesn't exist in backend, should be skipped
            expect(resources).toEqual([]);
        });

        it('should handle duplicate resource URIs in group', async () => {
            const dupResourceGroup = {
                groups: {
                    'dup-resources': {
                        name:      'dup-resources',
                        tools:     [],
                        resources: [
                            {
                                originalUri: 'test://resource1',
                                serverName:  'test-server-1',
                                name:        'First Reference',
                            },
                            {
                                originalUri: 'test://resource1',
                                serverName:  'test-server-1',
                                name:        'Second Reference',
                            },
                        ],
                    },
                },
            };

            const dupPath = await createTempConfigFile(dupResourceGroup);
            const dupManager = new GroupManager(dupPath);
            await dupManager.load();

            const resources = dupManager.getResourcesForGroup('dup-resources', mockBackendResources);

            // Both references should be included with different names
            expect(resources).toHaveLength(2);
            expect(resources[0].name).toBe('First Reference');
            expect(resources[1].name).toBe('Second Reference');
            expect(resources[0].uri).toBe('test://resource1');
            expect(resources[1].uri).toBe('test://resource1');
        });

        it('should preserve resource order from configuration', () => {
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);

            expect(resources[0].uri).toBe('test://resource1');
        });

        it('should handle empty backend resources map', () => {
            const emptyBackendResources = new Map<string, Resource[]>();
            const resources = groupManager.getResourcesForGroup('test-group', emptyBackendResources);

            expect(resources).toEqual([]);
        });

        it('should handle group with no resources defined', () => {
            const resources = groupManager.getResourcesForGroup('minimal-group', mockBackendResources);

            expect(resources).toEqual([]);
        });
    });

    describe('getAllGroupNames()', () => {
        it('should return all group names', () => {
            const names = groupManager.getAllGroupNames();

            expect(names).toContain('test-group');
            expect(names).toContain('minimal-group');
            expect(names).toHaveLength(2);
        });

        it('should return empty array when no groups exist', async () => {
            const emptyPath = await createTempConfigFile({ groups: {} });
            const emptyManager = new GroupManager(emptyPath);
            await emptyManager.load();

            const names = emptyManager.getAllGroupNames();

            expect(names).toEqual([]);
        });
    });

    describe('getGroup()', () => {
        it('should return group configuration by name', () => {
            const group = groupManager.getGroup('test-group');

            expect(group).toBeDefined();
            expect(group?.name).toBe('test-group');
            expect(group?.description).toBe('Test group for unit tests');
            expect(group?.tools).toHaveLength(2);
        });

        it('should return undefined for non-existent group', () => {
            const group = groupManager.getGroup('non-existent');

            expect(group).toBeUndefined();
        });

        it('should return correct group for minimal configuration', () => {
            const group = groupManager.getGroup('minimal-group');

            expect(group).toBeDefined();
            expect(group?.name).toBe('minimal-group');
            expect(group?.description).toBeUndefined();
            expect(group?.tools).toEqual([]);
            expect(group?.resources).toEqual([]);
        });
    });
});
