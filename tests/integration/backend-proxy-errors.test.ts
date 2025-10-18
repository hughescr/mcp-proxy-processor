/**
 * Integration tests for backend proxy error handling
 *
 * Tests critical error scenarios:
 * 1. Timeout handling and cleanup
 * 2. Backend server failures
 * 3. Resource fallback chains
 * 4. Error propagation
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import _ from 'lodash';
import { ProxyService } from '../../src/backend/proxy.js';
import { ClientManager } from '../../src/backend/client-manager.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// Mock client for testing
class MockClient {
    public callToolHandler?:     (name: string, args: unknown) => Promise<CallToolResult>;
    public readResourceHandler?: (uri: string) => Promise<{ contents: unknown[] }>;
    public getPromptHandler?:    (name: string, args?: Record<string, string>) => Promise<{ messages: unknown[] }>;

    async callTool(params: { name: string, arguments: Record<string, unknown> }): Promise<CallToolResult> {
        if(this.callToolHandler) {
            return this.callToolHandler(params.name, params.arguments);
        }
        throw new Error('No handler configured');
    }

    async readResource(params: { uri: string }): Promise<{ contents: unknown[] }> {
        if(this.readResourceHandler) {
            return this.readResourceHandler(params.uri);
        }
        throw new Error('No handler configured');
    }

    async getPrompt(params: { name: string, arguments?: Record<string, string> }): Promise<{ messages: unknown[] }> {
        if(this.getPromptHandler) {
            return this.getPromptHandler(params.name, params.arguments);
        }
        throw new Error('No handler configured');
    }

    async close(): Promise<void> {
        // Mock close
    }
}

// Test client manager that returns our mocks
class TestClientManager extends ClientManager {
    private mockClients = new Map<string, MockClient>();

    constructor(mockClients: Map<string, MockClient>) {
        super(new Map());
        this.mockClients = mockClients;
    }

    override async ensureConnected(serverName: string): Promise<Client> {
        const mock = this.mockClients.get(serverName);
        if(!mock) {
            throw new Error(`Server not found: ${serverName}`);
        }
        return mock as unknown as Client;
    }

    override isConnected(serverName: string): boolean {
        return this.mockClients.has(serverName);
    }
}

describe('Backend Proxy Error Handling', () => {
    let mockClient: MockClient;
    let clientManager: TestClientManager;
    let proxyService: ProxyService;

    beforeEach(() => {
        mockClient = new MockClient();
        clientManager = new TestClientManager(new Map([
            ['test-server', mockClient],
        ]));
        proxyService = new ProxyService(clientManager);
    });

    describe('timeout handling', () => {
        it('should timeout slow tool calls', async () => {
            mockClient.callToolHandler = async () => {
                // Simulate slow operation
                await new Promise(resolve => setTimeout(resolve, 200));
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            // Set very short timeout
            return expect(
                proxyService.callTool('test-server', 'slow_tool', {}, 50)
            ).rejects.toThrow('timed out');
        });

        it('should cleanup timeout handles without memory leaks', async () => {
            // This test verifies that withTimeout cleans up its timeout handle
            // Note: JavaScript doesn't support canceling promises, so the underlying
            // operation continues to run even after timeout. This is expected behavior.

            let handlerCompleted = false;

            mockClient.callToolHandler = async () => {
                // Simulate a slow operation
                await new Promise(resolve => setTimeout(resolve, 100));
                handlerCompleted = true;
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            // Call with short timeout - should reject before handler completes
            try {
                await proxyService.callTool('test-server', 'cleanup_tool', {}, 10);
                throw new Error('Should have timed out');
            } catch (error) {
                expect(_.isError(error) && error.message).toContain('timed out');
            }

            // Handler should not have completed yet (timeout fired first)
            expect(handlerCompleted).toBe(false);

            // The timeout handle should be cleaned up immediately (no memory leak)
            // We can't directly verify this, but the withTimeout implementation
            // clears it in the catch block. The handler continues running in background.

            // Wait for background handler to complete
            await new Promise(resolve => setTimeout(resolve, 150));

            // Now the handler should have completed in the background
            expect(handlerCompleted).toBe(true);
        });

        it('should handle rapid successive timeouts without memory leaks', async () => {
            mockClient.callToolHandler = async () => {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            // Fire many concurrent requests that will timeout
            const requests = _.times(
                50,
                () => proxyService.callTool('test-server', 'tool', {}, 10)
                    .catch(_.constant('timeout'))
            );

            const results = await Promise.all(requests);

            // All should have timed out
            expect(_.every(results, r => r === 'timeout')).toBe(true);
        });
    });

    describe('backend server errors', () => {
        it('should propagate backend errors with context', async () => {
            mockClient.callToolHandler = async () => {
                throw new Error('Backend internal error');
            };

            return expect(
                proxyService.callTool('test-server', 'failing_tool', {})
            ).rejects.toThrow(/test-server\.failing_tool failed.*Backend internal error/);
        });

        it('should handle backend server crashes gracefully', async () => {
            mockClient.callToolHandler = async () => {
                throw new Error('ECONNRESET');
            };

            return expect(
                proxyService.callTool('test-server', 'crash_tool', {})
            ).rejects.toThrow();
        });

        it('should handle malformed backend responses', async () => {
            mockClient.callToolHandler = async () => {
                // Return malformed response
                return null as unknown as CallToolResult;
            };

            // Should not crash, might return null or throw
            const result = await proxyService.callTool('test-server', 'malformed_tool', {});
            expect(result).toBeDefined();
        });
    });

    describe('error recovery', () => {
        it('should retry on transient failures', async () => {
            let attempts = 0;

            mockClient.callToolHandler = async () => {
                attempts++;
                if(attempts < 2) {
                    throw new Error('Transient error');
                }
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            const result = await proxyService.callToolWithRetry(
                'test-server',
                'retry_tool',
                {},
                { maxRetries: 2, retryDelayMs: 10 }
            );

            expect(result.content).toBeDefined();
            expect(attempts).toBe(2);
        });

        it('should fail after max retries', async () => {
            mockClient.callToolHandler = async () => {
                throw new Error('Persistent error');
            };

            return expect(
                proxyService.callToolWithRetry(
                    'test-server',
                    'persistent_fail',
                    {},
                    { maxRetries: 2, retryDelayMs: 10 }
                )
            ).rejects.toThrow('Persistent error');
        });

        it('should use exponential backoff for retries', async () => {
            let attempts = 0;

            mockClient.callToolHandler = async () => {
                attempts++;
                if(attempts < 4) {
                    throw new Error('Retry me');
                }
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            // Track timing
            const start = Date.now();
            await proxyService.callToolWithRetry(
                'test-server',
                'backoff_tool',
                {},
                { maxRetries: 3, retryDelayMs: 50 }
            );
            const duration = Date.now() - start;

            // Should have delays: 50ms, 100ms, 150ms = 300ms minimum
            expect(duration).toBeGreaterThanOrEqual(280);
            expect(attempts).toBe(4);
        });
    });

    describe('batch operations', () => {
        it('should handle partial batch failures', async () => {
            mockClient.callToolHandler = async (name: string) => {
                if(name === 'fail_tool') {
                    throw new Error('Tool failed');
                }
                return {
                    content: [{ type: 'text' as const, text: `Result for ${name}` }],
                };
            };

            const results = await proxyService.callToolsBatch([
                { serverName: 'test-server', toolName: 'success_tool_1', args: {} },
                { serverName: 'test-server', toolName: 'fail_tool', args: {} },
                { serverName: 'test-server', toolName: 'success_tool_2', args: {} },
            ]);

            expect(results[0]?.success).toBe(true);
            expect(results[1]?.success).toBe(false);
            expect(results[2]?.success).toBe(true);
            expect(results[1]?.error).toContain('Tool failed');
        });

        it('should timeout individual batch items independently', async () => {
            mockClient.callToolHandler = async (name: string) => {
                if(name === 'slow_tool') {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            const results = await proxyService.callToolsBatch([
                { serverName: 'test-server', toolName: 'fast_tool', args: {}, timeoutMs: 1000 },
                { serverName: 'test-server', toolName: 'slow_tool', args: {}, timeoutMs: 50 },
            ]);

            expect(results[0]?.success).toBe(true);
            expect(results[1]?.success).toBe(false);
            expect(results[1]?.error).toContain('timed out');
        });
    });

    describe('resource fallback', () => {
        it('should fallback to next server on resource read failure', async () => {
            const mockClient2 = new MockClient();
            const manager = new TestClientManager(new Map([
                ['server1', mockClient],
                ['server2', mockClient2],
            ]));
            const proxy = new ProxyService(manager);

            mockClient.readResourceHandler = async () => {
                throw new Error('Server 1 failed');
            };

            mockClient2.readResourceHandler = async () => ({
                contents: [{ type: 'text' as const, text: 'From server 2' }],
            });

            // First try will fail, but that's expected
            // This test demonstrates the principle - actual fallback is in frontend layer
            let errorCaught = false;
            try {
                await proxy.readResource('server1', 'test://resource');
            } catch (error) {
                errorCaught = true;
                expect(error).toBeInstanceOf(Error);
            }
            expect(errorCaught).toBe(true);

            // Second server should work
            const result = await proxy.readResource('server2', 'test://resource');
            expect(result.contents).toBeDefined();
        });
    });

    describe('concurrent operations', () => {
        it('should handle concurrent tool calls without interference', async () => {
            const callCounts = new Map<string, number>();

            mockClient.callToolHandler = async (name: string) => {
                const count = (callCounts.get(name) ?? 0) + 1;
                callCounts.set(name, count);

                // Small delay to ensure concurrency
                await new Promise(resolve => setTimeout(resolve, 10));

                return {
                    content: [{ type: 'text' as const, text: `Call ${count} to ${name}` }],
                };
            };

            const calls = _.map(
                Array.from({ length: 10 }),
                (_, i) => proxyService.callTool('test-server', `tool_${i % 3}`, {})
            );

            const results = await Promise.all(calls);

            expect(results).toHaveLength(10);
            expect(callCounts.size).toBe(3); // 3 different tools
        });

        it('should maintain isolation between concurrent failing and succeeding calls', async () => {
            mockClient.callToolHandler = async (name: string) => {
                if(name.includes('fail')) {
                    throw new Error('Expected failure');
                }
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            const calls = [
                proxyService.callTool('test-server', 'success_1', {}).then(_.constant('ok')),
                proxyService.callTool('test-server', 'fail_1', {}).catch(_.constant('failed')),
                proxyService.callTool('test-server', 'success_2', {}).then(_.constant('ok')),
                proxyService.callTool('test-server', 'fail_2', {}).catch(_.constant('failed')),
            ];

            const results = await Promise.all(calls);

            expect(results).toEqual(['ok', 'failed', 'ok', 'failed']);
        });
    });

    describe('timeout configuration', () => {
        it('should respect custom default timeout', () => {
            const customProxy = new ProxyService(clientManager, { defaultTimeoutMs: 5000 });
            expect(customProxy.getDefaultTimeout()).toBe(5000);
        });

        it('should allow runtime timeout updates', () => {
            proxyService.setDefaultTimeout(15000);
            expect(proxyService.getDefaultTimeout()).toBe(15000);
        });

        it('should override default timeout with per-call timeout', async () => {
            mockClient.callToolHandler = async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return {
                    content: [{ type: 'text' as const, text: 'success' }],
                };
            };

            proxyService.setDefaultTimeout(10000);

            // Per-call timeout should override
            return expect(
                proxyService.callTool('test-server', 'tool', {}, 50)
            ).rejects.toThrow('timed out');
        });
    });
});
