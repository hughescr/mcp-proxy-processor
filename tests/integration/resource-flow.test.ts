/**
 * Integration tests for resource reading and proxying
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { find as _find, map as _map } from 'lodash';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, validGroupConfig, mockBackendTools, mockBackendResources, mockResourceReadResponse } from '../fixtures/mock-configs.js';
import type { Resource } from '@modelcontextprotocol/sdk/types';

describe('Resource Flow Integration', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(validGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('Backend Resource Discovery', () => {
        it('should discover resources from backend servers', () => {
            const requiredServers = groupManager.getRequiredServers('test-group');
            expect(requiredServers).toContain('test-server-1');

            // Simulate backend resource discovery
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);

            expect(resources).toHaveLength(1);
            expect(resources[0].name).toBe('Original Resource'); // ResourceRef doesn't override - uses backend as-is
            expect(resources[0].uri).toBe('test://resource1');
        });

        it('should handle resources from multiple backend servers', async () => {
            const multiServerResourceGroup = {
                groups: {
                    'multi-resource': {
                        name:      'multi-resource',
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

            const multiPath = await createTempConfigFile(multiServerResourceGroup);
            const multiManager = new GroupManager(multiPath);
            await multiManager.load();

            const resources = multiManager.getResourcesForGroup('multi-resource', mockBackendResources);

            expect(resources).toHaveLength(2);
            expect(resources[0].name).toBe('Original Resource'); // No overrides with ResourceRef
            expect(resources[1].name).toBe('Server 2 Resource');
        });

        it('should handle partial backend server availability for resources', () => {
            const partialBackendResources = new Map([
                ['test-server-1', mockBackendResources.get('test-server-1')!],
                // test-server-2 is missing
            ]);

            const resources = groupManager.getResourcesForGroup('test-group', partialBackendResources);

            // Should only get resources from available server
            expect(resources).toHaveLength(1);
            expect(resources[0].uri).toBe('test://resource1');
        });
    });

    describe('Resource Read Proxying', () => {
        it('should use resources as-is from backend', () => {
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);
            const resource = resources[0];

            // ResourceRef doesn't override - uses backend as-is
            expect(resource.name).toBe('Original Resource');
            expect(resource.uri).toBe('test://resource1');

            // The resource info is directly from config
            const groupConfig = groupManager.getGroup('test-group');
            const resourceRef = groupConfig?.resources?.[0];

            expect(resourceRef?.uri).toBe('test://resource1');
            expect(resourceRef?.serverName).toBe('test-server-1');
        });

        it('should map resource reads to correct backend server', async () => {
            const multiServerGroup = {
                groups: {
                    'multi-server': {
                        name:      'multi-server',
                        tools:     [],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'server-a',
                            },
                            {
                                uri:        'test://resource2',
                                serverName: 'server-b',
                            },
                            {
                                uri:        'test://resource3',
                                serverName: 'server-a',
                            },
                        ],
                    },
                },
            };

            const multiPath = await createTempConfigFile(multiServerGroup);
            const multiManager = new GroupManager(multiPath);
            await multiManager.load();

            const group = multiManager.getGroup('multi-server');

            // Each resource should map to its backend server
            expect(group?.resources?.[0].serverName).toBe('server-a');
            expect(group?.resources?.[1].serverName).toBe('server-b');
            expect(group?.resources?.[2].serverName).toBe('server-a');

            // Verify server deduplication
            const servers = multiManager.getRequiredServers('multi-server');
            expect(servers).toEqual(['server-a', 'server-b']);
        });

        it('should use backend resource without overrides', async () => {
            const simpleGroup = {
                groups: {
                    simple: {
                        name:      'simple',
                        tools:     [],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                        ],
                    },
                },
            };

            const simplePath = await createTempConfigFile(simpleGroup);
            const simpleManager = new GroupManager(simplePath);
            await simpleManager.load();

            const resources = simpleManager.getResourcesForGroup('simple', mockBackendResources);
            const resource = resources[0];

            // Verify resource is used as-is from backend (no overrides)
            const backendResource = _find(mockBackendResources.get('test-server-1'), { uri: 'test://resource1' });
            expect(backendResource).toBeDefined();

            expect(resource.name).toBe(backendResource!.name);

            expect(resource.description).toBe(backendResource!.description);

            expect(resource.mimeType).toBe(backendResource!.mimeType);
            expect(resource.uri).toBe('test://resource1');
        });
    });

    describe('End-to-End Resource Flow Simulation', () => {
        it('should complete full proxy flow for a resource read', async () => {
            // 1. Load configuration
            const group = groupManager.getGroup('test-group');
            expect(group).toBeDefined();

            // 2. Get required backend servers
            const servers = groupManager.getRequiredServers('test-group');
            expect(servers).toContain('test-server-1');

            // 3. Discover backend resources (simulated)
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);
            expect(resources).toHaveLength(1);

            // 4. Find resource mapping for a read
            const resourceUri = 'test://resource1';
            const resource = _find(resources, { uri: resourceUri });
            expect(resource).toBeDefined();
            expect(resource?.name).toBe('Original Resource'); // ResourceRef uses backend as-is

            // 5. Get resource info for backend read
            const resourceRef = _find(group?.resources, { uri: resourceUri });
            expect(resourceRef?.uri).toBe('test://resource1');
            expect(resourceRef?.serverName).toBe('test-server-1');

            // 6. Simulate backend read and response
            const response = mockResourceReadResponse;
            expect(response.contents).toHaveLength(1);
            expect(response.contents[0].uri).toBe('test://resource1');
            expect(response.contents[0].text).toBe('Resource content');
        });

        it('should handle multiple concurrent resource reads', async () => {
            const concurrentGroup = {
                groups: {
                    concurrent: {
                        name:      'concurrent',
                        tools:     [],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                            {
                                uri:        'test://resource2',
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

            const concurrentPath = await createTempConfigFile(concurrentGroup);
            const concurrentManager = new GroupManager(concurrentPath);
            await concurrentManager.load();

            const resources = concurrentManager.getResourcesForGroup('concurrent', mockBackendResources);

            // Simulate concurrent reads
            expect(resources).toHaveLength(3);
            expect(resources[0].name).toBe('Original Resource');
            expect(resources[1].name).toBe('Unused Resource');
            expect(resources[2].name).toBe('Server 2 Resource');

            const group = concurrentManager.getGroup('concurrent');
            const mappings = _map(group?.resources, r => ({
                uri:    r.uri,
                server: r.serverName,
            }));

            expect(mappings).toEqual([
                { uri: 'test://resource1', server: 'test-server-1' },
                { uri: 'test://resource2', server: 'test-server-1' },
                { uri: 'test://resource3', server: 'test-server-2' },
            ]);
        });

        it('should maintain resource isolation between groups', async () => {
            // Create another group with same backend resource
            const anotherGroup = {
                groups: {
                    'another-group': {
                        name:      'another-group',
                        tools:     [],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                        ],
                    },
                },
            };

            const anotherPath = await createTempConfigFile(anotherGroup);
            const anotherManager = new GroupManager(anotherPath);
            await anotherManager.load();

            // Get resources for both groups
            const resources1 = groupManager.getResourcesForGroup('test-group', mockBackendResources);
            const resources2 = anotherManager.getResourcesForGroup('another-group', mockBackendResources);

            // Same backend resource - ResourceRef doesn't override
            expect(resources1[0].name).toBe('Original Resource');
            expect(resources2[0].name).toBe('Original Resource'); // Same since no overrides
            expect(resources1[0].uri).toBe(resources2[0].uri); // Same URI

            // Both map to same backend resource
            const group1 = groupManager.getGroup('test-group');
            const group2 = anotherManager.getGroup('another-group');

            expect(group1?.resources?.[0].uri).toBe(group2?.resources?.[0].uri);
            expect(group1?.resources?.[0].serverName).toBe(group2?.resources?.[0].serverName);
        });
    });

    describe('Mixed Tools and Resources', () => {
        it('should handle groups with both tools and resources', () => {
            const servers = groupManager.getRequiredServers('test-group');

            // Should include servers for both tools and resources
            expect(servers).toContain('test-server-1');
            expect(servers).toContain('test-server-2');

            const tools = groupManager.getToolsForGroup('test-group', mockBackendTools);
            const resources = groupManager.getResourcesForGroup('test-group', mockBackendResources);

            expect(tools).toHaveLength(2);
            expect(resources).toHaveLength(1);
        });

        it('should handle empty resources array gracefully', async () => {
            const noResourcesGroup = {
                groups: {
                    'no-resources': {
                        name:  'no-resources',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                            },
                        ],
                        resources: [],
                    },
                },
            };

            const noResPath = await createTempConfigFile(noResourcesGroup);
            const noResManager = new GroupManager(noResPath);
            await noResManager.load();

            const resources = noResManager.getResourcesForGroup('no-resources', mockBackendResources);
            expect(resources).toEqual([]);

            const servers = noResManager.getRequiredServers('no-resources');
            expect(servers).toEqual(['test-server-1']); // Only from tools
        });

        it('should handle undefined resources array gracefully', async () => {
            const undefinedResourcesGroup = {
                groups: {
                    'undefined-resources': {
                        name:  'undefined-resources',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                            },
                        ],
                        // resources field omitted
                    },
                },
            };

            const undefinedPath = await createTempConfigFile(undefinedResourcesGroup);
            const undefinedManager = new GroupManager(undefinedPath);
            await undefinedManager.load();

            const resources = undefinedManager.getResourcesForGroup('undefined-resources', mockBackendResources);
            expect(resources).toEqual([]);

            const group = undefinedManager.getGroup('undefined-resources');
            expect(group?.resources).toEqual([]); // Should default to empty array
        });
    });

    describe('Performance Considerations', () => {
        it('should handle large number of resources efficiently', async () => {
            const manyResourcesGroup = {
                groups: {
                    'many-resources': {
                        name:      'many-resources',
                        tools:     [],
                        resources: Array.from({ length: 100 }, (_, i) => ({
                            uri:        `test://resource${i}`,
                            serverName: `server_${i % 10}`, // Distribute across 10 servers
                        })),
                    },
                },
            };

            const largePath = await createTempConfigFile(manyResourcesGroup);
            const largeManager = new GroupManager(largePath);
            await largeManager.load();

            // Create corresponding backend resources
            const largeBackendResources = new Map<string, Resource[]>();
            for(let s = 0; s < 10; s++) {
                const serverResources: Resource[] = [];
                for(let r = s; r < 100; r += 10) {
                    serverResources.push({
                        uri:         `test://resource${r}`,
                        name:        `Backend Resource ${r}`,
                        description: `Backend description ${r}`,
                        mimeType:    'text/plain',
                    });
                }
                largeBackendResources.set(`server_${s}`, serverResources);
            }

            const startTime = performance.now();
            const resources = largeManager.getResourcesForGroup('many-resources', largeBackendResources);
            const endTime = performance.now();

            expect(resources).toHaveLength(100);
            expect(endTime - startTime).toBeLessThan(100); // Should be fast (< 100ms)
        });
    });
});
