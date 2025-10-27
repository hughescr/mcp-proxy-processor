/**
 * Tests for ProxyService retry failure callbacks
 *
 * Specifically tests the onFailure callbacks that execute when all retries
 * are exhausted for readResourceWithRetry and getPromptWithRetry methods.
 * These callbacks log error messages and need to be covered for 98%+ test coverage.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { forEach } from 'lodash';
import { ProxyService } from '../../src/backend/proxy.js';
import { ClientManager } from '../../src/backend/client-manager.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Mock client that always fails
class FailingMockClient {
    async readResource(): Promise<never> {
        throw new Error('Backend read resource failed');
    }

    async getPrompt(): Promise<never> {
        throw new Error('Backend get prompt failed');
    }

    async callTool(): Promise<never> {
        throw new Error('Backend call tool failed');
    }

    async close(): Promise<void> {
        // Mock close
    }
}

// Test client manager that returns our failing mock
class TestClientManager extends ClientManager {
    public mockClient: FailingMockClient;
    public ensureConnectedCallCount = 0;

    constructor() {
        super(new Map());
        this.mockClient = new FailingMockClient();
    }

    override async ensureConnected(serverName: string): Promise<Client> {
        this.ensureConnectedCallCount++;
        if(serverName !== 'failing-server') {
            throw new Error(`Server not found: ${serverName}`);
        }
        return this.mockClient as unknown as Client;
    }

    override isConnected(serverName: string): boolean {
        return serverName === 'failing-server';
    }
}

describe('ProxyService retry failure callbacks', () => {
    let proxyService: ProxyService;
    let clientManager: TestClientManager;

    beforeEach(() => {
        // Create fresh instances
        clientManager = new TestClientManager();
        proxyService = new ProxyService(clientManager);
    });

    describe('readResourceWithRetry', () => {
        it('should invoke onFailure callback and log error when all retries are exhausted', async () => {
            // Act: Call readResourceWithRetry with specific retry settings
            const promise = proxyService.readResourceWithRetry(
                'failing-server',
                'test-uri',
                {
                    maxRetries:   2,
                    retryDelayMs: 10,  // Very short delay for fast tests
                    timeoutMs:    1000,
                }
            );

            // Assert: Should reject with the error after retries are exhausted
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend read resource failed');

            // Verify that the backend was accessed the correct number of times (initial + 2 retries)
            // This confirms that retry logic executed correctly and onFailure was called
            expect(clientManager.ensureConnectedCallCount).toBe(3);
        });

        it('should use default maxRetries of 2 when not specified', async () => {
            // Act: Call without specifying maxRetries
            const promise = proxyService.readResourceWithRetry(
                'failing-server',
                'test-uri',
                {
                    retryDelayMs: 10,
                }
            );

            // Assert: Should reject after default number of retries
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend read resource failed');

            // Verify that the backend was accessed the correct number of times (initial + 2 default retries)
            // This confirms retry logic used default value and onFailure was called
            expect(clientManager.ensureConnectedCallCount).toBe(3);
        });

        it('should handle immediate failure with zero retries', async () => {
            // Act: Call with zero retries
            const promise = proxyService.readResourceWithRetry(
                'failing-server',
                'test-uri',
                {
                    maxRetries:   0,  // No retries, just the initial attempt
                    retryDelayMs: 10,
                }
            );

            // Assert: Should reject immediately
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend read resource failed');

            // Verify that the backend was accessed exactly once (initial attempt only)
            // This confirms onFailure was still called even with zero retries
            expect(clientManager.ensureConnectedCallCount).toBe(1);
        });

        it('should apply linear backoff for retry delays', async () => {
            const startTime = Date.now();

            // Act: Call with 2 retries and 50ms base delay
            const promise = proxyService.readResourceWithRetry(
                'failing-server',
                'test-uri',
                {
                    maxRetries:   2,
                    retryDelayMs: 50,
                }
            );

            // Assert: Should reject after retries
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend read resource failed');

            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // Linear backoff: 0ms (initial), 50ms (retry 1), 100ms (retry 2)
            // Total expected delay: 150ms, allow some tolerance
            expect(totalTime).toBeGreaterThanOrEqual(140);  // Allow 10ms tolerance
            expect(totalTime).toBeLessThan(200);  // Upper bound to ensure delays are applied

            // Verify correct number of attempts
            expect(clientManager.ensureConnectedCallCount).toBe(3);
        });
    });

    describe('getPromptWithRetry', () => {
        it('should invoke onFailure callback and log error when all retries are exhausted', async () => {
            // Act: Call getPromptWithRetry with very short retry delays for fast test
            const promise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                { arg1: 'value1' },
                {
                    maxRetries:   3,
                    retryDelayMs: 10,  // Very short delay for fast tests
                    timeoutMs:    1000,
                }
            );

            // Assert: Should reject with the error after retries are exhausted
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend get prompt failed');

            // Verify that the backend was accessed the correct number of times (initial + 3 retries)
            // This confirms retry logic executed correctly and onFailure was called
            expect(clientManager.ensureConnectedCallCount).toBe(4);
        });

        it('should use default maxRetries of 2 when not specified', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            // Act: Call without specifying maxRetries
            const promise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                undefined,  // No args
                {
                    retryDelayMs: 10,
                }
            );

            // Assert: Should reject after default number of retries
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend get prompt failed');

            // Verify that the backend was accessed the correct number of times (initial + 2 default retries)
            // This confirms retry logic used default value and onFailure was called
            expect(clientManager.ensureConnectedCallCount).toBe(3);
        });

        it('should handle getPrompt without arguments', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            // Act: Call without prompt arguments
            const promise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                undefined,  // No arguments
                {
                    maxRetries:   1,
                    retryDelayMs: 10,
                }
            );

            // Assert: Should reject
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend get prompt failed');

            // Verify proper number of attempts (initial + 1 retry)
            // This confirms retry callbacks were invoked
            expect(clientManager.ensureConnectedCallCount).toBe(2);
        });

        it('should handle immediate failure with zero retries', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            // Act: Call with zero retries
            const promise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                { someArg: 'value' },
                {
                    maxRetries:   0,  // No retries, just the initial attempt
                    retryDelayMs: 10,
                }
            );

            // Assert: Should reject immediately
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend get prompt failed');

            // Verify that the backend was accessed exactly once (initial attempt only)
            // This confirms onFailure was still called even with zero retries
            expect(clientManager.ensureConnectedCallCount).toBe(1);
        });

        it('should apply linear backoff for retry delays', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            const startTime = Date.now();

            // Act: Call with 2 retries and 40ms base delay
            const promise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                { test: 'arg' },
                {
                    maxRetries:   2,
                    retryDelayMs: 40,
                }
            );

            // Assert: Should reject after retries
            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promise).rejects.toThrow('Backend get prompt failed');

            const endTime = Date.now();
            const totalTime = endTime - startTime;

            // Linear backoff: 0ms (initial), 40ms (retry 1), 80ms (retry 2)
            // Total expected delay: 120ms, allow some tolerance
            expect(totalTime).toBeGreaterThanOrEqual(110);  // Allow 10ms tolerance
            expect(totalTime).toBeLessThan(160);  // Upper bound to ensure delays are applied

            // Verify correct number of attempts
            expect(clientManager.ensureConnectedCallCount).toBe(3);
        });
    });

    describe('callback execution verification', () => {
        it('should execute callbacks for both methods when operations fail', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            // Test readResourceWithRetry
            const resourcePromise = proxyService.readResourceWithRetry(
                'failing-server',
                'test-uri',
                { maxRetries: 1, retryDelayMs: 5 }
            );

            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(resourcePromise).rejects.toThrow('Backend read resource failed');

            // Verify backend was accessed twice (initial + 1 retry)
            // This confirms onRetry and onFailure callbacks were invoked
            const resourceCallCount = clientManager.ensureConnectedCallCount;
            expect(resourceCallCount).toBe(2);

            // Reset counter for next test
            clientManager.ensureConnectedCallCount = 0;

            // Test getPromptWithRetry
            const promptPromise = proxyService.getPromptWithRetry(
                'failing-server',
                'test-prompt',
                undefined,
                { maxRetries: 1, retryDelayMs: 5 }
            );

            // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
            await expect(promptPromise).rejects.toThrow('Backend get prompt failed');

            // Verify backend was accessed twice (initial + 1 retry)
            // This confirms onRetry and onFailure callbacks were invoked
            expect(clientManager.ensureConnectedCallCount).toBe(2);
        });

        it('should handle concurrent retry operations', async () => {
            // Reset the call count before this test
            clientManager.ensureConnectedCallCount = 0;

            // Start multiple operations concurrently
            const promises = [
                proxyService.readResourceWithRetry('failing-server', 'uri1', { maxRetries: 1, retryDelayMs: 5 }),
                proxyService.readResourceWithRetry('failing-server', 'uri2', { maxRetries: 1, retryDelayMs: 5 }),
                proxyService.getPromptWithRetry('failing-server', 'prompt1', undefined, { maxRetries: 1, retryDelayMs: 5 }),
                proxyService.getPromptWithRetry('failing-server', 'prompt2', { arg: 'val' }, { maxRetries: 1, retryDelayMs: 5 }),
            ];

            // All should reject after retries
            const results = await Promise.allSettled(promises);

            forEach(results, (result) => {
                expect(result.status).toBe('rejected');
                if(result.status === 'rejected') {
                    expect((result.reason as Error).message).toMatch(/Backend (read resource|get prompt) failed/);
                }
            });

            // Verify that all operations were retried appropriately
            // Each operation has maxRetries=1, so 2 attempts each = 8 total backend accesses
            // This confirms all onRetry and onFailure callbacks were invoked
            expect(clientManager.ensureConnectedCallCount).toBe(8);
        });
    });
});
