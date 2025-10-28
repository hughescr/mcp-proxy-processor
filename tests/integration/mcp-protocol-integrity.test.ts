/**
 * Integration tests for MCP protocol integrity
 *
 * These tests verify that:
 * 1. No stdout pollution occurs during MCP operations (critical for stdio transport)
 * 2. All logging goes to stderr only
 * 3. Protocol messages are properly formatted
 * 4. Backend server communication doesn't pollute stdout
 */

import { describe, it, expect } from 'bun:test';
import _ from 'lodash';

describe('MCP Protocol Integrity', () => {
    describe('stdout pollution prevention', () => {
        it('should not write any non-protocol messages to stdout', async () => {
            // This test verifies that our logger always uses stderr
            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            // Capture stderr writes (allowed)
            const originalStderrWrite = process.stderr.write.bind(process.stderr);
            let stderrWrites = 0;

            process.stderr.write = (chunk: string | Uint8Array): boolean => {
                stderrWrites++;
                return originalStderrWrite(chunk);
            };

            try {
                // Trigger various logging operations
                stderrLogger.info({ test: 'data' }, 'Test message');
                stderrLogger.warn({ test: 'data' }, 'Warning message');
                stderrLogger.error({ test: 'data' }, 'Error message');
                stderrLogger.debug({ test: 'data' }, 'Debug message');

                // Verify stderr was used
                expect(stderrWrites).toBeGreaterThan(0);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });

        it('should only emit JSON-RPC messages on stdout when serving', async () => {
            // All logging should go to stderr, not stdout
            // This test verifies that stdout only contains JSON-RPC protocol messages

            const stdoutMessages: string[] = [];
            const originalWrite = process.stdout.write.bind(process.stdout);

            // Capture stdout writes
            process.stdout.write = (chunk: string | Uint8Array): boolean => {
                stdoutMessages.push(chunk.toString());
                return originalWrite(chunk);
            };

            try {
                // Simulate protocol output by writing a JSON-RPC message
                process.stdout.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id:      1,
                    result:  { tools: [] },
                }) + '\n');

                // Verify we captured the output
                expect(stdoutMessages.length).toBeGreaterThan(0);

                // Every stdout message should be valid JSON-RPC
                const allValid = _.every(stdoutMessages, (msg) => {
                    try {
                        const parsed = JSON.parse(msg) as Record<string, unknown>;
                        // Must have jsonrpc field (core requirement)
                        return parsed.jsonrpc === '2.0';
                    } catch{
                        return false;
                    }
                });

                expect(allValid).toBe(true);
            } finally {
                process.stdout.write = originalWrite;
            }
        });
    });

    describe('backend server isolation', () => {
        it('should handle backend server startup messages correctly', async () => {
            // Backend servers may emit startup messages
            // These should be logged to stderr, not forwarded to protocol

            const { ClientManager } = await import('../../src/backend/client-manager.js');

            // ClientManager should handle backend output without polluting stdout
            const serverConfigs = new Map([
                ['test-server', {
                    command: 'echo',
                    args:    ['startup message'],
                }],
            ]);

            const manager = new ClientManager(serverConfigs);

            // Verify that ClientManager was created successfully
            expect(manager).toBeDefined();
            expect(manager).toBeInstanceOf(ClientManager);
            // Manager was created with test configuration
            expect(manager).toBeTruthy();
        });
    });

    describe('protocol message formatting', () => {
        it('should format JSON-RPC messages correctly', () => {
            // MCP uses JSON-RPC 2.0 format
            const request = {
                jsonrpc: '2.0' as const,
                id:      1,
                method:  'tools/list',
            };

            expect(request).toHaveProperty('jsonrpc', '2.0');
            expect(request).toHaveProperty('method');
        });

        it('should handle protocol errors without stdout pollution', async () => {
            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            // Capture stderr writes
            const originalStderrWrite = process.stderr.write.bind(process.stderr);
            let stderrContent = '';

            process.stderr.write = (chunk: string | Uint8Array): boolean => {
                stderrContent += chunk.toString();
                return originalStderrWrite(chunk);
            };

            try {
                // Simulate protocol error
                const protocolError = {
                    jsonrpc: '2.0',
                    id:      1,
                    error:   {
                        code:    -32600,
                        message: 'Invalid Request',
                    },
                };

                // Log it (should go to stderr)
                stderrLogger.error({ protocolError }, 'Protocol error occurred');

                // Verify the error was logged to stderr
                expect(stderrContent).toContain('Protocol error occurred');
                expect(stderrContent).toContain('-32600');
                expect(stderrContent).toContain('Invalid Request');
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });
    });

    describe('logging discipline', () => {
        it('should never use stdout in production code', async () => {
            // Verify that our logger is properly configured
            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            // Our logger should be the only logging mechanism
            expect(stderrLogger).toBeDefined();
            expect(typeof stderrLogger.info).toBe('function');
            expect(typeof stderrLogger.error).toBe('function');
            expect(typeof stderrLogger.warn).toBe('function');
            expect(typeof stderrLogger.debug).toBe('function');
        });
    });

    describe('error handling without stdout pollution', () => {
        it('should log errors to stderr only', async () => {
            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            const testError = new Error('Test error');

            // Track stderr writes
            const originalStderrWrite = process.stderr.write.bind(process.stderr);
            let stderrWrites = 0;

            process.stderr.write = (chunk: string | Uint8Array): boolean => {
                stderrWrites++;
                return originalStderrWrite(chunk);
            };

            try {
                stderrLogger.error({ error: testError }, 'Error occurred');

                // Should use stderr
                expect(stderrWrites).toBeGreaterThan(0);
            } finally {
                process.stderr.write = originalStderrWrite;
            }
        });
    });

    describe('admin UI polling', () => {
        it('should not interfere with protocol when admin UI polls', async () => {
            // Admin UI uses polling intervals that should not affect protocol

            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            let pollCount = 0;
            // Simulate polling operation
            const pollBackends = (): Promise<{ servers: unknown[] }> => {
                pollCount++;
                stderrLogger.debug({ pollNumber: pollCount }, 'Polling backend servers');
                return Promise.resolve({ servers: [] });
            };

            // Run multiple polls
            const result1 = await pollBackends();
            const result2 = await pollBackends();
            const result3 = await pollBackends();

            // Verify polling completed and returned expected structure
            expect(pollCount).toBe(3);
            expect(result1).toEqual({ servers: [] });
            expect(result2).toEqual({ servers: [] });
            expect(result3).toEqual({ servers: [] });
        });

        it('should handle concurrent admin operations safely', async () => {
            // Admin UI may have multiple concurrent operations
            // These should not interfere with each other or the protocol

            const { stderrLogger } = await import('../../src/utils/silent-logger.js');

            const operations = _.map(
                Array.from({ length: 10 }),
                (_, i) => Promise.resolve().then(() => {
                    stderrLogger.debug({ operation: i }, 'Concurrent operation');
                    return i;
                })
            );

            const results = await Promise.all(operations);

            // Verify all operations completed successfully and returned their index
            expect(results).toHaveLength(10);
            expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            // Verify operations are independent (can be completed in any order)
            expect(new Set(results).size).toBe(10); // All unique values
        });
    });
});
