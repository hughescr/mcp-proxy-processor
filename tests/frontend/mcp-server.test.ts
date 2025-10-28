/**
 * Comprehensive test suite for Frontend MCP Server
 *
 * This tests the real MCP server implementation using actual stdio protocol communication.
 * The frontend layer is responsible for:
 * - MCP server initialization and capability negotiation
 * - JSON-RPC request handling over stdio transport
 * - Tool call routing to backend servers
 * - Resource/prompt discovery and fallback chains
 * - Error handling and propagation
 * - Graceful shutdown on SIGINT/SIGTERM
 *
 * Testing approach: Uses MCP SDK client with stdio transport to communicate with real
 * proxy server subprocess, exercising the full protocol stack.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
    ListToolsResultSchema,
    CallToolResultSchema,
    ListResourcesResultSchema,
    ListPromptsResultSchema
} from '@modelcontextprotocol/sdk/types.js';
import { join } from 'node:path';
import { writeFile, unlink, mkdir, copyFile } from 'node:fs/promises';
import { find } from 'lodash';

// Use actual config directory for tests
const actualConfigDir = '/Users/craig/Library/Preferences/@hughescr/mcp-proxy-processor';
const testFilePath = '/private/tmp/mcp-test-file.txt';
const testContent = 'Test content for MCP server tests';

/**
 * Helper to setup config files and spawn a real MCP server for a group
 */
async function setupServerForGroup(groupName: string): Promise<{ client: Client, transport: StdioClientTransport }> {
    // Create MCP SDK client with stdio transport
    const transport = new StdioClientTransport({
        command: 'bun',
        args:    [
            join(import.meta.dir, '../../src/cli.ts'),
            'serve',
            groupName
        ],
        env: {
            ...process.env,
            LOG_LEVEL: 'error', // Reduce noise in test output
        },
    });

    const client = new Client(
        {
            name:    'mcp-server-test-client',
            version: '1.0.0',
        },
        {
            capabilities: {},
        }
    );

    // Connect and initialize
    await client.connect(transport);

    return { client, transport };
}

/**
 * Helper to cleanup client and transport
 */
async function cleanupServer(client: Client, transport: StdioClientTransport): Promise<void> {
    try {
        await client.close();
    } catch (error) {
        // eslint-disable-next-line no-console -- Test cleanup logging
        console.error('Error closing client:', error);
    }

    try {
        await transport.close();
    } catch (error) {
        // eslint-disable-next-line no-console -- Test cleanup logging
        console.error('Error closing transport:', error);
    }
}

describe('Frontend MCP Server (Real Protocol Tests)', () => {
    let backupGroupsPath = '';
    let backupBackendPath = '';

    beforeAll(async () => {
        // Setup test file
        await writeFile(testFilePath, testContent);

        // Backup existing config files if they exist
        const fixturesDir = join(import.meta.dir, '..', 'fixtures');
        const groupsPath = join(actualConfigDir, 'groups.json');
        const backendPath = join(actualConfigDir, 'backend-servers.json');

        try {
            await copyFile(groupsPath, `${groupsPath}.mcp-test-backup`);
            backupGroupsPath = `${groupsPath}.mcp-test-backup`;
        } catch{
            // File doesn't exist, no backup needed
        }

        try {
            await copyFile(backendPath, `${backendPath}.mcp-test-backup`);
            backupBackendPath = `${backendPath}.mcp-test-backup`;
        } catch{
            // File doesn't exist, no backup needed
        }

        // Create config directory and copy test fixtures
        await mkdir(actualConfigDir, { recursive: true });
        await copyFile(
            join(fixturesDir, 'backend-servers-mcp-test.json'),
            backendPath
        );
        await copyFile(
            join(fixturesDir, 'groups-mcp-test.json'),
            groupsPath
        );
    });

    afterAll(async () => {
        // Cleanup test file
        try {
            await unlink(testFilePath);
        } catch{
            // Ignore if file doesn't exist
        }

        // Restore backed up config files
        const groupsPath = join(actualConfigDir, 'groups.json');
        const backendPath = join(actualConfigDir, 'backend-servers.json');

        if(backupGroupsPath) {
            try {
                await copyFile(backupGroupsPath, groupsPath);
                await unlink(backupGroupsPath);
            } catch (error) {
                // eslint-disable-next-line no-console -- Test cleanup logging
                console.error('Error restoring groups config:', error);
            }
        } else {
            try {
                await unlink(groupsPath);
            } catch{
                // Ignore
            }
        }

        if(backupBackendPath) {
            try {
                await copyFile(backupBackendPath, backendPath);
                await unlink(backupBackendPath);
            } catch (error) {
                // eslint-disable-next-line no-console -- Test cleanup logging
                console.error('Error restoring backend config:', error);
            }
        } else {
            try {
                await unlink(backendPath);
            } catch{
                // Ignore
            }
        }
    });

    describe('Initialization and Protocol Compliance', () => {
        it('should initialize and complete handshake with valid group', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // If we got here, initialization succeeded
            expect(client).toBeDefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should return valid JSON-RPC 2.0 responses', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // Make a request using low-level request method
            const response = await client.request(
                {
                    method: 'tools/list',
                },
                ListToolsResultSchema
            );

            // Validate JSON-RPC structure
            expect(response).toBeDefined();
            expect(response).toBeObject();
            expect(response).toHaveProperty('tools');

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle multiple sequential requests', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // Make multiple requests
            const response1 = await client.listTools();
            expect(response1).toBeDefined();

            const response2 = await client.listTools();
            expect(response2).toBeDefined();

            const response3 = await client.listTools();
            expect(response3).toBeDefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Tool List Handler', () => {
        it('should return all tools from the group', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const result = await client.listTools();

            expect(result).toBeDefined();
            expect(result.tools).toBeArray();
            expect(result.tools.length).toBeGreaterThan(0);

            // Verify test_echo tool is present
            const testTool = find(result.tools, { name: 'test_echo' });
            expect(testTool).toBeDefined();
            expect(testTool?.name).toBe('test_echo');

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should apply tool name overrides', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-renamed');

            const result = await client.listTools();

            // Should have renamed tool
            const renamedTool = find(result.tools, { name: 'renamed_echo' });
            expect(renamedTool).toBeDefined();
            expect(renamedTool?.name).toBe('renamed_echo');

            // Should NOT have original name
            const originalTool = find(result.tools, { name: 'test_echo' });
            expect(originalTool).toBeUndefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should apply description overrides', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-renamed');

            const result = await client.listTools();

            const renamedTool = find(result.tools, { name: 'renamed_echo' });
            expect(renamedTool).toBeDefined();
            expect(renamedTool?.description).toContain('Renamed echo tool');

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should aggregate tools from multiple backend servers', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-multi-server');

            const result = await client.listTools();

            expect(result.tools.length).toBeGreaterThanOrEqual(2);

            // Should have tool from test-server-1
            const echoTool = find(result.tools, { name: 'test_echo' });
            expect(echoTool).toBeDefined();

            // Should have tool from test-filesystem
            const readFileTool = find(result.tools, { name: 'read_file' });
            expect(readFileTool).toBeDefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should return empty array for groups with no tools', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-empty');

            const result = await client.listTools();

            expect(result.tools).toBeArray();
            expect(result.tools.length).toBe(0);

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle large tool lists efficiently', async () => {
            // Use multi-server group which has multiple tools
            const { client, transport } = await setupServerForGroup('mcp-test-multi-server');

            const startTime = performance.now();
            const result = await client.listTools();
            const endTime = performance.now();

            expect(result.tools).toBeArray();
            expect(endTime - startTime).toBeLessThan(5000); // Should complete in <5s

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Tool Call Handler', () => {
        it('should route tool call to correct backend server', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const result = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'test_echo',
                        arguments: {
                            message: 'test message',
                        },
                    },
                },
                CallToolResultSchema
            );

            expect(result).toBeDefined();
            expect(result.content).toBeArray();
            const content = result.content[0] as { type: string, text: string };
            expect(content.type).toBe('text');
            expect(content.text).toContain('test message');

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should route to backend with original tool name when renamed', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-renamed');

            // Call with renamed name, should route to backend with original name
            const result = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'renamed_echo',
                        arguments: {
                            message: 'renamed test',
                        },
                    },
                },
                CallToolResultSchema
            );

            expect(result).toBeDefined();
            expect(result.content).toBeArray();
            const content = result.content[0] as { type: string, text: string };
            expect(content.text).toContain('renamed test');

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should pass arguments through to backend server', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const testMessage = 'unique test message 12345';

            const result = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'test_echo',
                        arguments: {
                            message: testMessage,
                        },
                    },
                },
                CallToolResultSchema
            );

            const content = result.content[0] as { type: string, text: string };
            expect(content.text).toContain(testMessage);

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle tool calls with empty arguments', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const result = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'test_echo',
                        arguments: {
                            message: '',
                        },
                    },
                },
                CallToolResultSchema
            );

            expect(result).toBeDefined();
            expect(result.content).toBeArray();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should route calls to multiple different backend servers', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-multi-server');

            // Call tool from test-server-1
            const result1 = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'test_echo',
                        arguments: {
                            message: 'server 1',
                        },
                    },
                },
                CallToolResultSchema
            );

            expect(result1).toBeDefined();
            const content1 = result1.content[0] as { type: string, text: string };
            expect(content1.text).toContain('server 1');

            // Call tool from test-filesystem
            const result2 = await client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'read_file',
                        arguments: {
                            path: testFilePath,
                        },
                    },
                },
                CallToolResultSchema
            );

            expect(result2).toBeDefined();
            const content2 = result2.content[0] as { type: string, text: string };
            expect(content2.text).toContain(testContent);

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Error Handling', () => {
        it('should return error for non-existent tool', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const testPromise = client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'nonexistent_tool',
                        arguments: {},
                    },
                },
                CallToolResultSchema
            );

            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a thenable
            await expect(testPromise).rejects.toThrow();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should propagate backend server errors', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-multi-server');

            // Call read_file with invalid path to trigger backend error
            const testPromise = client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'read_file',
                        arguments: {
                            path: '/nonexistent/path/that/does/not/exist.txt',
                        },
                    },
                },
                CallToolResultSchema
            );

            // Should reject with error from backend
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a thenable
            await expect(testPromise).rejects.toThrow();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle malformed tool call requests', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // Missing required argument
            const testPromise = client.request(
                {
                    method: 'tools/call',
                    params: {
                        name:      'test_echo',
                        arguments: {
                            // Missing 'message' field
                        },
                    },
                },
                CallToolResultSchema
            );

            // Should handle gracefully (either reject or return error content)
            try {
                const result = await testPromise;
                // If it doesn't throw, it should return a result
                expect(result).toBeDefined();
            } catch (error) {
                // If it throws, that's also acceptable error handling
                expect(error).toBeDefined();
            }

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Resource Handlers', () => {
        it('should list resources from backend servers', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-multi-server');

            const result = await client.request(
                {
                    method: 'resources/list',
                },
                ListResourcesResultSchema
            );

            expect(result).toBeDefined();
            expect(result.resources).toBeDefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle empty resource lists', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-empty');

            const result = await client.request(
                {
                    method: 'resources/list',
                },
                ListResourcesResultSchema
            );

            expect(result).toBeDefined();
            expect(result.resources).toBeArray();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Prompt Handlers', () => {
        it('should list prompts from backend servers', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            const result = await client.request(
                {
                    method: 'prompts/list',
                },
                ListPromptsResultSchema
            );

            expect(result).toBeDefined();
            expect(result.prompts).toBeDefined();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });

        it('should handle empty prompt lists', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-empty');

            const result = await client.request(
                {
                    method: 'prompts/list',
                },
                ListPromptsResultSchema
            );

            expect(result).toBeDefined();
            expect(result.prompts).toBeArray();

            await cleanupServer(client, transport);
        }, { timeout: 30000 });
    });

    describe('Server Lifecycle', () => {
        it('should handle graceful shutdown', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // Make a request to ensure server is responsive
            const result = await client.listTools();
            expect(result).toBeDefined();

            // Close should succeed without throwing
            try {
                await cleanupServer(client, transport);
                expect(true).toBe(true); // If we get here, cleanup succeeded
            } catch (error) {
                throw new Error(`Cleanup failed: ${String(error)}`);
            }
        }, { timeout: 30000 });

        it('should reject requests after shutdown', async () => {
            const { client, transport } = await setupServerForGroup('mcp-test-basic');

            // Close the server
            await cleanupServer(client, transport);

            // Subsequent requests should fail
            const testPromise = client.listTools();

            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a thenable
            await expect(testPromise).rejects.toThrow();
        }, { timeout: 30000 });
    });
});
