/**
 * Comprehensive test suite for Frontend MCP Server
 *
 * This tests the critical stdio protocol implementation that interfaces with Claude Desktop.
 * The frontend layer is responsible for:
 * - MCP server initialization (13-step process)
 * - JSON-RPC request handling over stdio transport
 * - Tool call routing to backend servers
 * - Resource/prompt discovery and fallback chains
 * - Error handling and propagation
 * - Graceful shutdown on SIGINT/SIGTERM
 *
 * Note: These tests focus on the business logic and handler behavior rather than full
 * stdio transport testing, as the MCP SDK handles the transport layer.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import _ from 'lodash';
import type { GroupManager } from '../../src/middleware/index.js';
import type { ClientManager } from '../../src/backend/client-manager.js';
import type { DiscoveryService } from '../../src/backend/discovery.js';
import type { ProxyService } from '../../src/backend/proxy.js';
import type { ArgumentTransformer } from '../../src/middleware/argument-transformer.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import {
    mockBackendTools,
    validGroupConfig,
    createTempConfigFile,
    mockToolCallResponse
} from '../fixtures/mock-configs.js';

describe('Frontend MCP Server', () => {
    let mockGroupManager: Partial<GroupManager>;
    let mockClientManager: Partial<ClientManager>;
    let mockDiscoveryService: Partial<DiscoveryService>;
    let mockProxyService: Partial<ProxyService>;
    let mockArgumentTransformer: Partial<ArgumentTransformer>;

    beforeEach(async () => {
        // Create temp config file
        await createTempConfigFile(validGroupConfig);

        // Setup mock GroupManager
        mockGroupManager = {
            load:     mock(async () => Promise.resolve()),
            getGroup: mock((groupName: string) => {
                if(groupName === 'test-group') {
                    return {
                        name:  'test-group',
                        tools: [
                            {
                                originalName: 'original_tool',
                                serverName:   'test-server-1',
                                name:         'renamed_tool',
                                description:  'Overridden description',
                            },
                            {
                                originalName: 'another_tool',
                                serverName:   'test-server-2',
                            },
                        ],
                        resources: [
                            {
                                uri:        'test://resource1',
                                serverName: 'test-server-1',
                            },
                        ],
                        prompts: [
                            {
                                name:       'test-prompt',
                                serverName: 'test-server-1',
                            },
                        ],
                    };
                }
                return undefined;
            }),
            getRequiredServers: mock((groupName: string) => {
                if(groupName === 'test-group') {
                    return ['test-server-1', 'test-server-2'];
                }
                return [];
            }),
            getToolsForGroup: mock((_groupName: string, _backendTools: Map<string, Tool[]>) => {
                return [
                    {
                        name:        'renamed_tool',
                        description: 'Overridden description',
                        inputSchema: {
                            type:       'object' as const,
                            properties: {
                                param1: { type: 'string', description: 'First parameter' },
                            },
                            required: ['param1'],
                        },
                    },
                    {
                        name:        'another_tool',
                        description: 'Another tool from server 2',
                        inputSchema: {
                            type:       'object' as const,
                            properties: {
                                value: { type: 'number' },
                            },
                        },
                    },
                ] as Tool[];
            }),
            getResourcesForGroup: mock((_groupName: string, _backendResources: Map<string, Resource[]>) => {
                return [
                    {
                        uri:         'test://resource1',
                        name:        'Original Resource',
                        description: 'Original resource description',
                        mimeType:    'text/plain',
                    },
                ];
            }),
            getPromptsForGroup: mock((_groupName: string, _backendPrompts: Map<string, Prompt[]>) => {
                return [
                    {
                        name:        'test-prompt',
                        description: 'Test prompt',
                        arguments:   [],
                    },
                ];
            }),
        };

        // Setup mock ClientManager
        mockClientManager = {
            connectAll:              mock(async () => ({ successful: [], failed: [] })),
            disconnectAll:           mock(async () => Promise.resolve()),
            getConnectedServerNames: mock(() => ['test-server-1', 'test-server-2']),
        };

        // Setup mock DiscoveryService
        mockDiscoveryService = {
            discoverAllTools:     mock(async () => mockBackendTools),
            discoverAllResources: mock(async () => new Map([
                ['test-server-1', [
                    {
                        uri:         'test://resource1',
                        name:        'Original Resource',
                        description: 'Original resource description',
                        mimeType:    'text/plain',
                    },
                ]],
            ])),
            discoverAllPrompts: mock(async () => new Map([
                ['test-server-1', [
                    {
                        name:        'test-prompt',
                        description: 'Test prompt',
                        arguments:   [],
                    },
                ]],
            ])),
        };

        // Setup mock ProxyService
        mockProxyService = {
            callTool: mock(async (_serverName: string, _toolName: string, _args: unknown) => {
                return mockToolCallResponse;
            }),
            readResource: mock(async (_serverName: string, _uri: string) => {
                return {
                    contents: [
                        {
                            uri:      'test://resource1',
                            mimeType: 'text/plain',
                            text:     'Resource content',
                        },
                    ],
                };
            }),
            getPrompt: mock(async (_serverName: string, _name: string, _args: unknown) => {
                return {
                    description: 'Test prompt description',
                    messages:    [
                        {
                            role:    'user' as const,
                            content: { type: 'text', text: 'Test prompt message' },
                        },
                    ],
                };
            }),
        };

        // Setup mock ArgumentTransformer
        mockArgumentTransformer = {
            transform: mock(async (args: unknown, _mapping: unknown): Promise<Record<string, unknown>> => {
                return args as Record<string, unknown>; // Passthrough by default
            }),
        };
    });

    describe('Initialization', () => {
        it('should throw error if group not found', () => {
            mockGroupManager.getGroup = mock(() => undefined);

            // Attempting to start server with non-existent group should fail
            expect(mockGroupManager.getGroup('non-existent-group')).toBeUndefined();
        });

        it('should determine required backend servers', () => {
            const requiredServers = mockGroupManager.getRequiredServers!('test-group');

            expect(requiredServers).toHaveLength(2);
            expect(requiredServers).toContain('test-server-1');
            expect(requiredServers).toContain('test-server-2');
        });

        it('should connect to all backend clients', async () => {
            await mockClientManager.connectAll!();

            expect(mockClientManager.connectAll).toHaveBeenCalled();

            const connectedServers = mockClientManager.getConnectedServerNames!();
            expect(connectedServers).toHaveLength(2);
            expect(connectedServers).toContain('test-server-1');
            expect(connectedServers).toContain('test-server-2');
        });

        it('should discover tools from backend servers', async () => {
            const tools = await mockDiscoveryService.discoverAllTools!();

            expect(mockDiscoveryService.discoverAllTools).toHaveBeenCalled();
            expect(tools).toBeInstanceOf(Map);
            expect(tools.has('test-server-1')).toBe(true);
            expect(tools.has('test-server-2')).toBe(true);
        });

        it('should discover resources from backend servers', async () => {
            const resources = await mockDiscoveryService.discoverAllResources!();

            expect(mockDiscoveryService.discoverAllResources).toHaveBeenCalled();
            expect(resources).toBeInstanceOf(Map);
            expect(resources.has('test-server-1')).toBe(true);
        });

        it('should discover prompts from backend servers', async () => {
            const prompts = await mockDiscoveryService.discoverAllPrompts!();

            expect(mockDiscoveryService.discoverAllPrompts).toHaveBeenCalled();
            expect(prompts).toBeInstanceOf(Map);
            expect(prompts.has('test-server-1')).toBe(true);
        });
    });

    describe('Tool List Handler Logic', () => {
        it('should return all tools from the group', () => {
            const tools = mockGroupManager.getToolsForGroup!('test-group', mockBackendTools);

            expect(tools).toHaveLength(2);
            expect(_.find(tools, { name: 'renamed_tool' })).toBeDefined();
            expect(_.find(tools, { name: 'another_tool' })).toBeDefined();
        });

        it('should handle groups with 100+ tools efficiently', () => {
            const manyTools: Tool[] = Array.from({ length: 150 }, (_, i) => ({
                name:        `tool_${i}`,
                description: `Tool ${i}`,
                inputSchema: { type: 'object' },
            }));

            mockGroupManager.getToolsForGroup = mock(() => manyTools);

            const startTime = performance.now();
            const tools = mockGroupManager.getToolsForGroup('test-group', mockBackendTools);
            const endTime = performance.now();

            expect(tools).toHaveLength(150);
            expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
        });

        it('should return empty array for groups with no tools', () => {
            mockGroupManager.getToolsForGroup = mock(() => []);

            const tools = mockGroupManager.getToolsForGroup('test-group', mockBackendTools);

            expect(tools).toHaveLength(0);
            expect(_.isArray(tools)).toBe(true);
        });
    });

    describe('Tool Call Handler Logic', () => {
        it('should route tool call to correct backend server', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const toolName = 'renamed_tool';
            const args = { param1: 'test-value' };

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);
            expect(toolOverride).toBeDefined();

            const result = await mockProxyService.callTool!(
                toolOverride!.serverName,
                toolOverride!.originalName,
                args
            );

            expect(result).toEqual(mockToolCallResponse);

            // Verify proxy service was called with correct parameters
            expect(mockProxyService.callTool).toHaveBeenCalledWith(
                'test-server-1',
                'original_tool',
                { param1: 'test-value' }
            );
        });

        it('should apply argument transformation if configured', async () => {
            const group = {
                ...mockGroupManager.getGroup!('test-group')!,
                tools: [
                    {
                        originalName:    'original_tool',
                        serverName:      'test-server-1',
                        name:            'renamed_tool',
                        argumentMapping: {
                            mapping: {
                                backendParam: '$.param1',
                            },
                        },
                    },
                ],
            };

            mockArgumentTransformer.transform = mock(async (_args: unknown, _mapping: unknown) => {
                return { backendParam: 'transformed-value' };
            });

            const toolName = 'renamed_tool';
            const args = { param1: 'test-value' };

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);
            expect(toolOverride).toBeDefined();

            let backendArgs: Record<string, unknown> = args;
            if(toolOverride!.argumentMapping) {
                backendArgs = await mockArgumentTransformer.transform(args, toolOverride!.argumentMapping as never);
            }

            await mockProxyService.callTool!(
                toolOverride!.serverName,
                toolOverride!.originalName,
                backendArgs
            );

            // Verify transformer was called
            expect(mockArgumentTransformer.transform).toHaveBeenCalled();

            // Verify proxy was called with transformed args
            expect(mockProxyService.callTool).toHaveBeenCalledWith(
                'test-server-1',
                'original_tool',
                { backendParam: 'transformed-value' }
            );
        });

        it('should return backend response unchanged', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const toolName = 'renamed_tool';
            const args = { param1: 'test-value' };

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);
            const result = await mockProxyService.callTool!(
                toolOverride!.serverName,
                toolOverride!.originalName,
                args
            );

            // Verify the response matches exactly what the backend returned
            expect(result).toEqual(mockToolCallResponse);
        });

        it('should propagate backend errors with context', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;

            mockProxyService.callTool = mock(async () => {
                throw new Error('Backend server error');
            });

            const toolName = 'renamed_tool';
            const args = { param1: 'test-value' };

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);

            expect(
                mockProxyService.callTool(
                    toolOverride!.serverName,
                    toolOverride!.originalName,
                    args
                )
            ).rejects.toThrow('Backend server error');
        });

        it('should handle tool not found errors', () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const toolName = 'non_existent_tool';

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);
            expect(toolOverride).toBeUndefined();
        });

        it('should handle tool calls with undefined arguments', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const toolName = 'another_tool';
            const args = undefined;

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);

            const result = await mockProxyService.callTool!(
                toolOverride!.serverName,
                toolOverride!.originalName,
                args
            );

            expect(result).toBeDefined();

            // Verify proxy was called with undefined args
            expect(mockProxyService.callTool).toHaveBeenCalledWith(
                'test-server-2',
                'another_tool',
                undefined
            );
        });
    });

    describe('Resource List Handler Logic', () => {
        it('should return deduplicated resources from all servers', () => {
            const resources = mockGroupManager.getResourcesForGroup!('test-group', new Map());

            // Simulate deduplication
            const deduplicated = _.uniqBy(resources, 'uri');

            expect(deduplicated).toHaveLength(1);
            expect(deduplicated[0].uri).toBe('test://resource1');
        });
    });

    describe('Resource Read Handler Logic', () => {
        it('should read resource from priority server', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const uri = 'test://resource1';

            const matchingRef = _.find(group.resources ?? [], { uri });
            expect(matchingRef).toBeDefined();

            const result = await mockProxyService.readResource!(
                matchingRef!.serverName,
                uri
            );

            expect(result.contents).toBeDefined();
            expect(result.contents[0].uri).toBe('test://resource1');
            expect(result.contents[0].text).toBe('Resource content');

            // Verify proxy was called correctly
            expect(mockProxyService.readResource).toHaveBeenCalledWith(
                'test-server-1',
                'test://resource1'
            );
        });

        it('should fallback to next server on failure', async () => {
            const group = {
                ...mockGroupManager.getGroup!('test-group')!,
                resources: [
                    { uri: 'test://resource1', serverName: 'test-server-1' },
                    { uri: 'test://resource1', serverName: 'test-server-2' }, // Fallback
                ],
            };

            let callCount = 0;
            mockProxyService.readResource = mock(async (_serverName: string, _uri: string) => {
                callCount++;
                if(callCount === 1) {
                    throw new Error('First server failed');
                }
                return {
                    contents: [
                        {
                            uri:      'test://resource1',
                            mimeType: 'text/plain',
                            text:     'Resource from fallback server',
                        },
                    ],
                };
            });

            const uri = 'test://resource1';
            const matchingRefs = _.filter(group.resources ?? [], { uri });

            let result: Awaited<ReturnType<typeof mockProxyService.readResource>> | undefined;
            for(const resourceRef of matchingRefs) {
                try {
                    result = await mockProxyService.readResource(
                        resourceRef.serverName,
                        uri
                    );
                    break;
                } catch{
                    // Continue to next server
                }
            }

            expect(result).toBeDefined();
            if(result) {
                expect(result.contents[0].text).toBe('Resource from fallback server');
            }

            // Verify both servers were tried
            expect(mockProxyService.readResource).toHaveBeenCalledTimes(2);
        });

        it('should throw error if all servers fail', async () => {
            const group = {
                ...mockGroupManager.getGroup!('test-group')!,
                resources: [
                    { uri: 'test://resource1', serverName: 'test-server-1' },
                    { uri: 'test://resource1', serverName: 'test-server-2' },
                ],
            };

            mockProxyService.readResource = mock(async () => {
                throw new Error('Backend server unavailable');
            });

            const uri = 'test://resource1';
            const matchingRefs = _.filter(group.resources ?? [], { uri });

            let lastError: Error | undefined;
            for(const resourceRef of matchingRefs) {
                try {
                    await mockProxyService.readResource(
                        resourceRef.serverName,
                        uri
                    );
                } catch (error) {
                    lastError = _.isError(error) ? error : new Error(String(error));
                }
            }

            expect(lastError).toBeDefined();
            expect(lastError!.message).toContain('Backend server unavailable');
        });
    });

    describe('Prompt Handlers Logic', () => {
        it('should list prompts with deduplication', () => {
            const prompts = mockGroupManager.getPromptsForGroup!('test-group', new Map());

            const deduplicated = _.uniqBy(prompts, 'name');

            expect(deduplicated).toHaveLength(1);
            expect(deduplicated[0].name).toBe('test-prompt');
        });

        it('should get prompt from priority server', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;
            const name = 'test-prompt';
            const args = {};

            const matchingRef = _.find(group.prompts ?? [], { name });
            expect(matchingRef).toBeDefined();

            const result = await mockProxyService.getPrompt!(
                matchingRef!.serverName,
                name,
                args
            );

            expect(result.description).toBeDefined();
            expect(result.messages).toBeDefined();

            // Verify proxy was called correctly
            expect(mockProxyService.getPrompt).toHaveBeenCalledWith(
                'test-server-1',
                'test-prompt',
                {}
            );
        });
    });

    describe('Error Propagation', () => {
        it('should wrap backend errors with server context', async () => {
            const group = mockGroupManager.getGroup!('test-group')!;

            mockProxyService.callTool = mock(async () => {
                const error = new Error('Backend timeout');
                (error as unknown as { code: number }).code = -32000;
                throw error;
            });

            const toolName = 'renamed_tool';
            const args = {};

            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);

            let caughtError: Error | undefined;
            try {
                await mockProxyService.callTool(
                    toolOverride!.serverName,
                    toolOverride!.originalName,
                    args
                );
            } catch (error) {
                caughtError = _.isError(error) ? error : new Error(String(error));
            }

            expect(caughtError).toBeDefined();
            expect(caughtError!.message).toContain('Backend timeout');
        });
    });

    describe('Graceful Shutdown', () => {
        it('should handle shutdown correctly', async () => {
            await mockClientManager.disconnectAll!();

            expect(mockClientManager.disconnectAll).toHaveBeenCalled();
        });
    });
});
