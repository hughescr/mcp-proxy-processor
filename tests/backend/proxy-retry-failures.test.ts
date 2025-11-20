/**
 * Tests for ProxyService retry failure callbacks
 *
 * Specifically tests the onFailure callbacks that execute when all retries
 * are exhausted for readResourceWithRetry and getPromptWithRetry methods.
 * These callbacks log error messages and need to be covered for 98%+ test coverage.
 */

import { describe, it, expect, beforeEach, spyOn, afterEach, mock } from 'bun:test';
import { forEach, constant, some as _some } from 'lodash';
import { ProxyService } from '../../src/backend/proxy.js';
import { ClientManager } from '../../src/backend/client-manager.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Type for mock spy (matches what spyOn returns)
type MockSpy = ReturnType<typeof spyOn<typeof process.stderr, 'write'>>;

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
    let stderrSpy: MockSpy;

    // Helper to count log messages matching criteria
    function countLogMessages(levelFilter: 'warn' | 'error', messageFilter: string): number {
        const calls = stderrSpy.mock.calls;
        let count = 0;
        forEach(calls, (call) => {
            const output = String(call[0]);
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
                const logEntry = JSON.parse(output);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- log entry structure
                if(logEntry.level === levelFilter && String(logEntry.message ?? '').includes(messageFilter)) {
                    count++;
                }
            } catch{
                // Not JSON, skip
            }
        });
        return count;
    }

    // Helper to verify a log message exists with specific properties
    function hasLogMessage(levelFilter: 'warn' | 'error', properties: Record<string, unknown>): boolean {
        const calls = stderrSpy.mock.calls;
        return _some(calls, (call) => {
            const output = String(call[0]);
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
                const logEntry = JSON.parse(output);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- log entry structure
                if(logEntry.level !== levelFilter) {
                    return false;
                }

                // Check all required properties match
                let allMatch = true;
                forEach(Object.entries(properties), ([key, value]) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- log entry structure
                    if(logEntry[key] !== value) {
                        allMatch = false;
                    }
                });
                return allMatch;
            } catch{
                return false;
            }
        });
    }

    beforeEach(() => {
        // Create fresh instances
        clientManager = new TestClientManager();
        proxyService = new ProxyService(clientManager);

        // Spy on stderr.write to capture logger output
        // The logger uses winston which writes to stderr
        stderrSpy = spyOn(process.stderr, 'write').mockImplementation(constant(true)) as unknown as MockSpy;
    });

    afterEach(() => {
        // Restore all spies to avoid test pollution
        mock.restore();
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

            // Verify onRetry callback was invoked for each retry attempt (logged as warnings)
            const retryCount = countLogMessages('warn', 'will retry');
            expect(retryCount).toBe(2); // 2 retries

            // Verify onRetry was called with correct parameters
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                uri:        'test-uri',
                attempt:    1,
                maxRetries: 2,
                message:    'Resource read failed, will retry',
            })).toBe(true);

            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                uri:        'test-uri',
                attempt:    2,
                maxRetries: 2,
                message:    'Resource read failed, will retry',
            })).toBe(true);

            // Verify onFailure callback was invoked after all retries exhausted
            const failureCount = countLogMessages('error', 'after all retries');
            expect(failureCount).toBe(1);

            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                uri:        'test-uri',
                maxRetries: 2,
                message:    'Resource read failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed the correct number of times (initial + 2 retries)
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

            // Verify onRetry callback was invoked with default maxRetries value
            expect(countLogMessages('warn', 'will retry')).toBe(2); // 2 default retries
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                uri:        'test-uri',
                maxRetries: 2, // Default value
                message:    'Resource read failed, will retry',
            })).toBe(true);

            // Verify onFailure callback was invoked
            expect(countLogMessages('error', 'after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                uri:        'test-uri',
                maxRetries: 2, // Default value
                message:    'Resource read failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed the correct number of times (initial + 2 default retries)
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

            // Verify onRetry callback was NOT called (zero retries)
            expect(countLogMessages('warn', 'will retry')).toBe(0);

            // Verify onFailure callback was still invoked
            expect(countLogMessages('error', 'after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                uri:        'test-uri',
                maxRetries: 0,
                message:    'Resource read failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed exactly once (initial attempt only)
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

            // Verify onRetry and onFailure callbacks were invoked
            expect(countLogMessages('warn', 'will retry')).toBe(2);
            expect(countLogMessages('error', 'after all retries')).toBe(1);

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

            // Verify onRetry callback was invoked for each retry attempt
            expect(countLogMessages('warn', 'will retry')).toBe(3); // 3 retries

            // Verify onRetry was called with correct parameters
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                name:       'test-prompt',
                attempt:    1,
                maxRetries: 3,
                message:    'Prompt get failed, will retry',
            })).toBe(true);

            // Verify onFailure callback was invoked after all retries exhausted
            expect(countLogMessages('error', 'after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                name:       'test-prompt',
                maxRetries: 3,
                message:    'Prompt get failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed the correct number of times (initial + 3 retries)
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

            // Verify onRetry callback was invoked with default maxRetries value
            expect(countLogMessages('warn', 'will retry')).toBe(2); // 2 default retries
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                name:       'test-prompt',
                maxRetries: 2, // Default value
                message:    'Prompt get failed, will retry',
            })).toBe(true);

            // Verify onFailure callback was invoked
            expect(countLogMessages('error', 'after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                name:       'test-prompt',
                maxRetries: 2, // Default value
                message:    'Prompt get failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed the correct number of times (initial + 2 default retries)
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

            // Verify onRetry and onFailure callbacks were invoked
            expect(countLogMessages('warn', 'will retry')).toBe(1); // 1 retry
            expect(countLogMessages('error', 'after all retries')).toBe(1);

            // Verify proper number of attempts (initial + 1 retry)
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

            // Verify onRetry callback was NOT called (zero retries)
            expect(countLogMessages('warn', 'will retry')).toBe(0);

            // Verify onFailure callback was still invoked
            expect(countLogMessages('error', 'after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                name:       'test-prompt',
                maxRetries: 0,
                message:    'Prompt get failed after all retries',
            })).toBe(true);

            // Verify that the backend was accessed exactly once (initial attempt only)
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

            // Verify onRetry and onFailure callbacks were invoked
            expect(countLogMessages('warn', 'will retry')).toBe(2);
            expect(countLogMessages('error', 'after all retries')).toBe(1);

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

            // Verify onRetry and onFailure callbacks were invoked for readResource
            expect(countLogMessages('warn', 'Resource read failed, will retry')).toBe(1); // 1 retry
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                uri:        'test-uri',
                message:    'Resource read failed, will retry',
            })).toBe(true);
            expect(countLogMessages('error', 'Resource read failed after all retries')).toBe(1);
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                uri:        'test-uri',
                message:    'Resource read failed after all retries',
            })).toBe(true);

            // Verify backend was accessed twice (initial + 1 retry)
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

            // Verify onRetry and onFailure callbacks were invoked for getPrompt
            expect(countLogMessages('warn', 'Prompt get failed, will retry')).toBe(1); // 1 from getPrompt only (after reset)
            expect(hasLogMessage('warn', {
                serverName: 'failing-server',
                name:       'test-prompt',
                message:    'Prompt get failed, will retry',
            })).toBe(true);
            expect(countLogMessages('error', 'Prompt get failed after all retries')).toBe(1); // 1 from getPrompt only
            expect(hasLogMessage('error', {
                serverName: 'failing-server',
                name:       'test-prompt',
                message:    'Prompt get failed after all retries',
            })).toBe(true);

            // Verify backend was accessed twice (initial + 1 retry)
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

            // Verify onRetry callbacks were invoked for all operations
            // 4 operations × 1 retry each = 4 onRetry calls
            expect(countLogMessages('warn', 'will retry')).toBe(4);

            // Verify onFailure callbacks were invoked for all operations
            // 4 operations × 1 onFailure each = 4 onFailure calls
            expect(countLogMessages('error', 'after all retries')).toBe(4);

            // Verify that all operations were retried appropriately
            // Each operation has maxRetries=1, so 2 attempts each = 8 total backend accesses
            expect(clientManager.ensureConnectedCallCount).toBe(8);
        });
    });
});
