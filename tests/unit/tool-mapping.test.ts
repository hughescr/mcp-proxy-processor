/**
 * Unit tests for tool and resource resolution/mapping
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { map as _map } from 'lodash';
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
                                uri:        'resource1',
                                serverName: 'server-a',
                            },
                            {
                                uri:        'resource2',
                                serverName: 'server-b',
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
                                uri:        'resource1',
                                serverName: 'server1',
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
            expect(_map(tools, 'name')).toContain('renamed_tool');
            expect(_map(tools, 'name')).toContain('another_tool');
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
            expect(_map(tools, 'name')).toContain('renamed_tool_1');
            expect(_map(tools, 'name')).toContain('renamed_tool_2');
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
            expect(resources[0].name).toBe('Original Resource');
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
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                            {
                                uri:        'test://resource3',
                                serverName: 'test-server-2',
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
                                uri:        'test://non-existent',
                                serverName: 'test-server-1',
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

        it('should deduplicate resources with same URI from same server', async () => {
            const dupResourceGroup = {
                groups: {
                    'dup-resources': {
                        name:      'dup-resources',
                        tools:     [],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                        ],
                    },
                },
            };

            const dupPath = await createTempConfigFile(dupResourceGroup);
            const dupManager = new GroupManager(dupPath);
            await dupManager.load();

            const resources = dupManager.getResourcesForGroup('dup-resources', mockBackendResources);

            // Should deduplicate to 1 resource (same URI)
            expect(resources).toHaveLength(1);
            // Name should come from backend, not config
            expect(resources[0].name).toBe('Original Resource');
            expect(resources[0].uri).toBe('test://resource1');
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

    describe('Edge Cases - Exact Matching', () => {
        it('should match tools by exact name only (no partial matches)', async () => {
            // Backend has "read_file" and "read_file_all" - config should only match exact name
            const backendWithSimilarTools = new Map<string, Tool[]>([
                [
                    'test-server',
                    [
                        {
                            name:        'read_file',
                            description: 'Read a single file',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'read_file_all',
                            description: 'Read all files',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'search',
                            description: 'Basic search',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'search_advanced',
                            description: 'Advanced search',
                            inputSchema: { type: 'object' },
                        },
                    ],
                ],
            ]);

            const exactMatchGroup = {
                groups: {
                    'exact-match-group': {
                        name:  'exact-match-group',
                        tools: [
                            {
                                originalName: 'read_file',
                                serverName:   'test-server',
                            },
                            {
                                originalName: 'search',
                                serverName:   'test-server',
                            },
                        ],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const exactPath = await createTempConfigFile(exactMatchGroup);
            const exactManager = new GroupManager(exactPath);
            await exactManager.load();

            const tools = exactManager.getToolsForGroup('exact-match-group', backendWithSimilarTools);

            // Should get exactly 2 tools with exact name matches
            expect(tools).toHaveLength(2);
            expect(_map(tools, 'name')).toEqual(['read_file', 'search']);
            expect(_map(tools, 'name')).not.toContain('read_file_all');
            expect(_map(tools, 'name')).not.toContain('search_advanced');
        });

        it('should NOT match partial tool names', async () => {
            // Config requests "file" but backend has "read_file" - should not match
            const backendTools = new Map<string, Tool[]>([
                [
                    'server',
                    [
                        {
                            name:        'read_file',
                            description: 'Read file tool',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'file_operations',
                            description: 'File ops',
                            inputSchema: { type: 'object' },
                        },
                    ],
                ],
            ]);

            const partialMatchGroup = {
                groups: {
                    'partial-group': {
                        name:  'partial-group',
                        tools: [
                            {
                                originalName: 'file',
                                serverName:   'server',
                            },
                        ],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const partialPath = await createTempConfigFile(partialMatchGroup);
            const partialManager = new GroupManager(partialPath);
            await partialManager.load();

            const tools = partialManager.getToolsForGroup('partial-group', backendTools);

            // Should get zero tools because "file" doesn't exactly match any backend tool
            expect(tools).toHaveLength(0);
        });
    });

    describe('Edge Cases - Case Sensitivity', () => {
        it('should treat tool names as case-sensitive', async () => {
            // Backend has tools with different casing
            const caseSensitiveBackend = new Map<string, Tool[]>([
                [
                    'server',
                    [
                        {
                            name:        'ReadFile',
                            description: 'Pascal case',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'readFile',
                            description: 'Camel case',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'read_file',
                            description: 'Snake case',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'READ_FILE',
                            description: 'Upper snake case',
                            inputSchema: { type: 'object' },
                        },
                    ],
                ],
            ]);

            const caseGroup = {
                groups: {
                    'case-sensitive-group': {
                        name:  'case-sensitive-group',
                        tools: [
                            {
                                originalName: 'read_file',
                                serverName:   'server',
                            },
                        ],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const casePath = await createTempConfigFile(caseGroup);
            const caseManager = new GroupManager(casePath);
            await caseManager.load();

            const tools = caseManager.getToolsForGroup('case-sensitive-group', caseSensitiveBackend);

            // Should get exactly 1 tool with exact case match
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('read_file');
            expect(tools[0].description).toBe('Snake case');
        });

        it('should match resource URIs with case sensitivity', async () => {
            const caseSensitiveResources = new Map<string, Resource[]>([
                [
                    'server',
                    [
                        {
                            uri:         'file://Path/To/File',
                            name:        'Mixed case path',
                            description: 'Mixed case',
                        },
                        {
                            uri:         'file://path/to/file',
                            name:        'Lower case path',
                            description: 'Lower case',
                        },
                        {
                            uri:         'file://PATH/TO/FILE',
                            name:        'Upper case path',
                            description: 'Upper case',
                        },
                    ],
                ],
            ]);

            const resourceCaseGroup = {
                groups: {
                    'resource-case-group': {
                        name:      'resource-case-group',
                        tools:     [],
                        resources: [
                            {
                                uri:        'file://path/to/file',
                                serverName: 'server',
                            },
                        ],
                        prompts: [],
                    },
                },
            };

            const resourcePath = await createTempConfigFile(resourceCaseGroup);
            const resourceManager = new GroupManager(resourcePath);
            await resourceManager.load();

            const resources = resourceManager.getResourcesForGroup('resource-case-group', caseSensitiveResources);

            // Should get exactly 1 resource with exact case match
            expect(resources).toHaveLength(1);
            expect(resources[0].uri).toBe('file://path/to/file');
            expect(resources[0].description).toBe('Lower case');
        });
    });

    describe('Edge Cases - Original Name Exclusion After Rename', () => {
        it('should exclude original tool name after rename', async () => {
            // Backend has "backend_tool"
            // Config renames it to "client_tool"
            // Only "client_tool" should be accessible, not "backend_tool"
            const renameBackend = new Map<string, Tool[]>([
                [
                    'server',
                    [
                        {
                            name:        'backend_tool',
                            description: 'Backend tool',
                            inputSchema: { type: 'object' },
                        },
                    ],
                ],
            ]);

            const renameGroup = {
                groups: {
                    'rename-group': {
                        name:  'rename-group',
                        tools: [
                            {
                                originalName: 'backend_tool',
                                serverName:   'server',
                                name:         'client_tool',
                            },
                        ],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const renamePath = await createTempConfigFile(renameGroup);
            const renameManager = new GroupManager(renamePath);
            await renameManager.load();

            const tools = renameManager.getToolsForGroup('rename-group', renameBackend);

            // Should get 1 tool with the NEW name
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('client_tool');
            expect(_map(tools, 'name')).not.toContain('backend_tool');
        });

        it('should allow multiple renames of same backend tool', () => {
            // This is already tested by the 'duplicate-tools-group' test
            // but let's verify the semantic: original name should not appear
            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);

            // Backend has "original_tool" renamed to "renamed_tool"
            // Backend name should not appear in result
            expect(_map(tools, 'name')).toContain('renamed_tool');
            expect(_map(tools, 'name')).not.toContain('original_tool');
        });
    });

    describe('Edge Cases - Special Characters', () => {
        it('should handle tools with dots, dashes, and underscores', async () => {
            const specialCharBackend = new Map<string, Tool[]>([
                [
                    'server',
                    [
                        {
                            name:        'tool.with.dots',
                            description: 'Dotted tool',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'tool-with-dashes',
                            description: 'Dashed tool',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'tool_with_underscores',
                            description: 'Underscored tool',
                            inputSchema: { type: 'object' },
                        },
                        {
                            name:        'tool.mixed-chars_here',
                            description: 'Mixed special chars',
                            inputSchema: { type: 'object' },
                        },
                    ],
                ],
            ]);

            const specialCharGroup = {
                groups: {
                    'special-char-group': {
                        name:  'special-char-group',
                        tools: [
                            {
                                originalName: 'tool.with.dots',
                                serverName:   'server',
                            },
                            {
                                originalName: 'tool-with-dashes',
                                serverName:   'server',
                            },
                            {
                                originalName: 'tool_with_underscores',
                                serverName:   'server',
                            },
                            {
                                originalName: 'tool.mixed-chars_here',
                                serverName:   'server',
                            },
                        ],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const specialPath = await createTempConfigFile(specialCharGroup);
            const specialManager = new GroupManager(specialPath);
            await specialManager.load();

            const tools = specialManager.getToolsForGroup('special-char-group', specialCharBackend);

            // Should get all 4 tools with exact name matches including special chars
            expect(tools).toHaveLength(4);
            expect(_map(tools, 'name')).toContain('tool.with.dots');
            expect(_map(tools, 'name')).toContain('tool-with-dashes');
            expect(_map(tools, 'name')).toContain('tool_with_underscores');
            expect(_map(tools, 'name')).toContain('tool.mixed-chars_here');
        });

        it('should handle resources with special characters in URIs', async () => {
            const specialUriResources = new Map<string, Resource[]>([
                [
                    'server',
                    [
                        {
                            uri:         'file:///path/with-dashes/file.txt',
                            name:        'Dashed path',
                            description: 'Resource with dashes',
                        },
                        {
                            uri:         'file:///path/with_underscores/file.txt',
                            name:        'Underscored path',
                            description: 'Resource with underscores',
                        },
                        {
                            uri:         'file:///path/with.dots/file.txt',
                            name:        'Dotted path',
                            description: 'Resource with dots',
                        },
                        {
                            uri:         'custom://resource?param=value&other=123',
                            name:        'Query params',
                            description: 'Resource with query params',
                        },
                    ],
                ],
            ]);

            const specialUriGroup = {
                groups: {
                    'special-uri-group': {
                        name:      'special-uri-group',
                        tools:     [],
                        resources: [
                            {
                                uri:        'file:///path/with-dashes/file.txt',
                                serverName: 'server',
                            },
                            {
                                uri:        'file:///path/with_underscores/file.txt',
                                serverName: 'server',
                            },
                            {
                                uri:        'custom://resource?param=value&other=123',
                                serverName: 'server',
                            },
                        ],
                        prompts: [],
                    },
                },
            };

            const uriPath = await createTempConfigFile(specialUriGroup);
            const uriManager = new GroupManager(uriPath);
            await uriManager.load();

            const resources = uriManager.getResourcesForGroup('special-uri-group', specialUriResources);

            // Should get all 3 resources with exact URI matches
            expect(resources).toHaveLength(3);
            expect(_map(resources, 'uri')).toContain('file:///path/with-dashes/file.txt');
            expect(_map(resources, 'uri')).toContain('file:///path/with_underscores/file.txt');
            expect(_map(resources, 'uri')).toContain('custom://resource?param=value&other=123');
        });
    });
});
