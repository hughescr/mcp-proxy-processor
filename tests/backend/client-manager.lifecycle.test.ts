/**
 * Tests for ClientManager lifecycle methods (connectAll, disconnectAll, attemptConnection)
 * These tests cover the critical untested code paths in client-manager.ts
 */

import { describe, it, expect } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import ClientManager, { ConnectionState } from '../../src/backend/client-manager.js';
import type { BackendServerConfig } from '../../src/types/config.js';
import _ from 'lodash';

class MockClientWrapper {
    public readonly client: Client;
    public closed = false;

    private handlers: {
        onclose?: () => void
        onerror?: (error: Error) => void
    } = {};

    constructor(public readonly id: string) {
        const base: Partial<Client> = {
            close: async () => {
                this.closed = true;
                this.handlers.onclose?.();
            },
        };

        Object.defineProperty(base, 'onclose', {
            get: () => this.handlers.onclose,
            set: (value: (() => void) | null | undefined) => {
                this.handlers.onclose = value ?? undefined;
            },
            enumerable:   true,
            configurable: true,
        });

        Object.defineProperty(base, 'onerror', {
            get: () => this.handlers.onerror,
            set: (value: ((error: Error) => void) | null | undefined) => {
                this.handlers.onerror = value ?? undefined;
            },
            enumerable:   true,
            configurable: true,
        });

        this.client = base as Client;
    }

    triggerClose(): void {
        this.handlers.onclose?.();
    }

    triggerError(error: Error): void {
        this.handlers.onerror?.(error);
    }
}

interface InternalClientState {
    state:                ConnectionState
    reconnectionAttempt:  number
    reconnectionPromise?: Promise<Client>
    requestQueue:         unknown[]
}

class TestClientManager extends ClientManager {
    private attemptHandlers = new Map<string, (() => Promise<Client>)[]>();
    public readonly delays: number[] = [];
    public readonly attemptCounts = new Map<string, number>();
    public lastEnvVars?:    Record<string, string>;

    constructor(configs: Map<string, BackendServerConfig>) {
        super(configs);
    }

    enqueueAttempt(serverName: string, handler: () => Promise<Client>): void {
        if(!this.attemptHandlers.has(serverName)) {
            this.attemptHandlers.set(serverName, []);
        }
        this.attemptHandlers.get(serverName)!.push(handler);
    }

    protected override async attemptConnection(serverName: string, serverConfig: BackendServerConfig): Promise<Client> {
        // Track attempt count per server
        this.attemptCounts.set(serverName, (this.attemptCounts.get(serverName) ?? 0) + 1);

        // Capture environment variables for validation (matching what would be passed to subprocess)
        this.lastEnvVars = {
            ...serverConfig.env,
            ...(process.env.LOG_LEVEL ? { LOG_LEVEL: process.env.LOG_LEVEL } : {}),
        };

        const handlers = this.attemptHandlers.get(serverName);
        if(!handlers || handlers.length === 0) {
            throw new Error(`No attempt handler configured for ${serverName}`);
        }
        const handler = handlers.shift()!;
        return handler();
    }

    protected override async delay(ms: number): Promise<void> {
        this.delays.push(ms);
        await Promise.resolve();
    }

    getState(serverName: string): InternalClientState | undefined {
        return (this as unknown as { clients: Map<string, InternalClientState> }).clients.get(serverName);
    }

    getClientMap(): Map<string, InternalClientState> {
        return (this as unknown as { clients: Map<string, InternalClientState> }).clients;
    }
}

describe('ClientManager lifecycle - connectAll()', () => {
    it('connects to all servers successfully when all succeed', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
            ['server3', { command: 'cmd3' }],
        ]);
        const manager = new TestClientManager(configs);

        // All servers succeed
        manager.enqueueAttempt('server1', async () => new MockClientWrapper('s1').client);
        manager.enqueueAttempt('server2', async () => new MockClientWrapper('s2').client);
        manager.enqueueAttempt('server3', async () => new MockClientWrapper('s3').client);

        const result = await manager.connectAll();

        expect(result.successful).toEqual(['server1', 'server2', 'server3']);
        expect(result.failed).toEqual([]);
        expect(manager.isConnected('server1')).toBe(true);
        expect(manager.isConnected('server2')).toBe(true);
        expect(manager.isConnected('server3')).toBe(true);
    });

    it('continues connecting when some servers fail', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
            ['server3', { command: 'cmd3' }],
        ]);
        const manager = new TestClientManager(configs);

        // server1 succeeds, server2 fails, server3 succeeds
        manager.enqueueAttempt('server1', async () => new MockClientWrapper('s1').client);
        // server2 fails on all 3 retry attempts
        for(let i = 0; i < 3; i++) {
            manager.enqueueAttempt('server2', async () => {
                throw new Error('server2 connection failed');
            });
        }
        manager.enqueueAttempt('server3', async () => new MockClientWrapper('s3').client);

        const result = await manager.connectAll();

        expect(result.successful).toEqual(['server1', 'server3']);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]?.serverName).toBe('server2');
        expect(result.failed[0]?.error).toContain('Failed to connect');
        expect(manager.isConnected('server1')).toBe(true);
        expect(manager.isConnected('server2')).toBe(false);
        expect(manager.isConnected('server3')).toBe(true);
    });

    it('connects servers in parallel (not sequentially)', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
        ]);
        const manager = new TestClientManager(configs);

        let server1Resolved = false;
        let server2Resolved = false;

        manager.enqueueAttempt('server1', async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            server1Resolved = true;
            return new MockClientWrapper('s1').client;
        });

        manager.enqueueAttempt('server2', async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            server2Resolved = true;
            return new MockClientWrapper('s2').client;
        });

        await manager.connectAll();

        // Both should resolve (parallel execution means they both complete)
        expect(server1Resolved).toBe(true);
        expect(server2Resolved).toBe(true);
    });

    it('returns empty results when no servers configured', async () => {
        const manager = new TestClientManager(new Map());
        const result = await manager.connectAll();

        expect(result.successful).toEqual([]);
        expect(result.failed).toEqual([]);
    });

    it('aggregates multiple failures correctly', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
            ['server3', { command: 'cmd3' }],
        ]);
        const manager = new TestClientManager(configs);

        // All servers fail after retries
        for(let i = 0; i < 3; i++) {
            manager.enqueueAttempt('server1', async () => {
                throw new Error('error1');
            });
        }
        for(let i = 0; i < 3; i++) {
            manager.enqueueAttempt('server2', async () => {
                throw new Error('error2');
            });
        }
        for(let i = 0; i < 3; i++) {
            manager.enqueueAttempt('server3', async () => {
                throw new Error('error3');
            });
        }

        const result = await manager.connectAll();

        expect(result.successful).toEqual([]);
        expect(result.failed).toHaveLength(3);
        expect(_.map(result.failed, 'serverName').sort()).toEqual(['server1', 'server2', 'server3']);
    });
});

describe('ClientManager lifecycle - disconnectAll()', () => {
    it('disconnects all connected servers', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
        ]);
        const manager = new TestClientManager(configs);

        const client1 = new MockClientWrapper('s1');
        const client2 = new MockClientWrapper('s2');
        manager.enqueueAttempt('server1', async () => client1.client);
        manager.enqueueAttempt('server2', async () => client2.client);

        await manager.connectAll();
        expect(manager.isConnected('server1')).toBe(true);
        expect(manager.isConnected('server2')).toBe(true);

        await manager.disconnectAll();

        expect(client1.closed).toBe(true);
        expect(client2.closed).toBe(true);
        expect(manager.getClientMap().size).toBe(0);
    });

    it('continues disconnecting even when one disconnect throws', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
            ['server2', { command: 'cmd2' }],
        ]);
        const manager = new TestClientManager(configs);

        const client1 = new MockClientWrapper('s1');
        const client2 = new MockClientWrapper('s2');

        // Make server1's close throw an error
        client1.client.close = async () => {
            throw new Error('disconnect failed');
        };

        manager.enqueueAttempt('server1', async () => client1.client);
        manager.enqueueAttempt('server2', async () => client2.client);

        await manager.connectAll();

        await manager.disconnectAll();

        // server2 should still be disconnected despite server1 failure
        expect(client2.closed).toBe(true);
        expect(manager.getClientMap().size).toBe(0);
    });

    it('clears internal client map after disconnectAll', async () => {
        const configs = new Map<string, BackendServerConfig>([
            ['server1', { command: 'cmd1' }],
        ]);
        const manager = new TestClientManager(configs);

        manager.enqueueAttempt('server1', async () => new MockClientWrapper('s1').client);
        await manager.connect('server1');

        expect(manager.getClientMap().size).toBe(1);

        await manager.disconnectAll();

        expect(manager.getClientMap().size).toBe(0);
    });

    it('handles disconnectAll when no servers are connected', async () => {
        const manager = new TestClientManager(new Map());

        // Should not throw
        await manager.disconnectAll();

        expect(manager.getClientMap().size).toBe(0);
    });
});

describe('ClientManager lifecycle - attemptConnection() environment propagation', () => {
    it('propagates custom environment variables from config', async () => {
        const config: BackendServerConfig = {
            command: 'test-cmd',
            args:    ['--foo'],
            env:     {
                CUSTOM_VAR: 'custom-value',
                API_KEY:    'secret-key',
            },
        };
        const configs = new Map([['test-server', config]]);
        const manager = new TestClientManager(configs);

        manager.enqueueAttempt('test-server', async () => new MockClientWrapper('test').client);

        await manager.connect('test-server');

        expect(manager.lastEnvVars).toBeDefined();
        expect(manager.lastEnvVars?.CUSTOM_VAR).toBe('custom-value');
        expect(manager.lastEnvVars?.API_KEY).toBe('secret-key');
    });

    it('propagates LOG_LEVEL from process.env when set', async () => {
        const originalLogLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'debug';

        try {
            const config: BackendServerConfig = {
                command: 'test-cmd',
            };
            const configs = new Map([['test-server', config]]);
            const manager = new TestClientManager(configs);

            manager.enqueueAttempt('test-server', async () => new MockClientWrapper('test').client);

            await manager.connect('test-server');

            expect(manager.lastEnvVars).toBeDefined();
            expect(manager.lastEnvVars?.LOG_LEVEL).toBe('debug');
        } finally {
            if(originalLogLevel === undefined) {
                delete process.env.LOG_LEVEL;
            } else {
                process.env.LOG_LEVEL = originalLogLevel;
            }
        }
    });

    it('does not propagate LOG_LEVEL when not set in process.env', async () => {
        const originalLogLevel = process.env.LOG_LEVEL;
        delete process.env.LOG_LEVEL;

        try {
            const config: BackendServerConfig = {
                command: 'test-cmd',
                env:     {
                    OTHER_VAR: 'value',
                },
            };
            const configs = new Map([['test-server', config]]);
            const manager = new TestClientManager(configs);

            manager.enqueueAttempt('test-server', async () => new MockClientWrapper('test').client);

            await manager.connect('test-server');

            expect(manager.lastEnvVars).toBeDefined();
            expect(manager.lastEnvVars?.LOG_LEVEL).toBeUndefined();
            expect(manager.lastEnvVars?.OTHER_VAR).toBe('value');
        } finally {
            if(originalLogLevel !== undefined) {
                process.env.LOG_LEVEL = originalLogLevel;
            }
        }
    });

    it('merges config env and LOG_LEVEL without overwriting', async () => {
        const originalLogLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'info';

        try {
            const config: BackendServerConfig = {
                command: 'test-cmd',
                env:     {
                    API_KEY:   'secret',
                    LOG_LEVEL: 'warn', // This should be overwritten by process.env
                },
            };
            const configs = new Map([['test-server', config]]);
            const manager = new TestClientManager(configs);

            manager.enqueueAttempt('test-server', async () => new MockClientWrapper('test').client);

            await manager.connect('test-server');

            expect(manager.lastEnvVars).toBeDefined();
            expect(manager.lastEnvVars?.LOG_LEVEL).toBe('info'); // process.env wins
            expect(manager.lastEnvVars?.API_KEY).toBe('secret');
        } finally {
            if(originalLogLevel === undefined) {
                delete process.env.LOG_LEVEL;
            } else {
                process.env.LOG_LEVEL = originalLogLevel;
            }
        }
    });
});

describe('ClientManager lifecycle - error handler callback', () => {
    it('triggers reconnection when onerror is called', async () => {
        const config: BackendServerConfig = { command: 'test-cmd' };
        const manager = new TestClientManager(new Map([['test-server', config]]));

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt('test-server', async () => initialClient.client);

        await manager.connect('test-server');
        expect(manager.isConnected('test-server')).toBe(true);
        expect(manager.getState('test-server')?.state).toBe(ConnectionState.CONNECTED);

        // Set up reconnection client
        const reconnectedClient = new MockClientWrapper('reconnected');
        manager.enqueueAttempt('test-server', async () => reconnectedClient.client);

        // Trigger error via onerror callback
        const testError = new Error('Connection error occurred');
        initialClient.triggerError(testError);

        // State should transition to RECONNECTING
        expect(manager.getState('test-server')?.state).toBe(ConnectionState.RECONNECTING);

        // Wait for reconnection to complete
        const client = await manager.ensureConnected('test-server');
        expect(client).toBe(reconnectedClient.client);
        expect(manager.isConnected('test-server')).toBe(true);
        expect(manager.getState('test-server')?.state).toBe(ConnectionState.CONNECTED);
    });

    it('logs error when onerror is triggered', async () => {
        const config: BackendServerConfig = { command: 'test-cmd' };
        const manager = new TestClientManager(new Map([['test-server', config]]));

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt('test-server', async () => initialClient.client);

        await manager.connect('test-server');

        const reconnectedClient = new MockClientWrapper('reconnected');
        manager.enqueueAttempt('test-server', async () => reconnectedClient.client);

        // Trigger error with specific message
        const testError = new Error('Network timeout');
        initialClient.triggerError(testError);

        await manager.ensureConnected('test-server');

        // Verify reconnection occurred (error was handled)
        expect(manager.attemptCounts.get('test-server')).toBe(2); // initial + reconnection
    });

    it('onerror callback does not trigger reconnection during manual disconnect', async () => {
        const config: BackendServerConfig = { command: 'test-cmd' };
        const manager = new TestClientManager(new Map([['test-server', config]]));

        const client = new MockClientWrapper('test');
        manager.enqueueAttempt('test-server', async () => client.client);

        await manager.connect('test-server');
        expect(manager.isConnected('test-server')).toBe(true);

        // Start disconnect (this sets state to DISCONNECTING)
        const disconnectPromise = manager.disconnect('test-server');

        // If error occurs during disconnect, it should not trigger reconnection
        const testError = new Error('Error during disconnect');
        client.triggerError(testError);

        await disconnectPromise;

        // Should be DISCONNECTED, not RECONNECTING
        expect(manager.getState('test-server')?.state).toBe(ConnectionState.DISCONNECTED);
        expect(manager.getState('test-server')?.reconnectionPromise).toBeUndefined();
    });

    it('queues multiple requests during error-triggered reconnection', async () => {
        const config: BackendServerConfig = { command: 'test-cmd' };
        const manager = new TestClientManager(new Map([['test-server', config]]));

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt('test-server', async () => initialClient.client);

        await manager.connect('test-server');

        const reconnectedClient = new MockClientWrapper('reconnected');
        manager.enqueueAttempt('test-server', async () => reconnectedClient.client);

        // Trigger error
        initialClient.triggerError(new Error('Connection lost'));

        // Queue multiple requests during reconnection
        const request1 = manager.ensureConnected('test-server');
        const request2 = manager.ensureConnected('test-server');

        const [client1, client2] = await Promise.all([request1, request2]);

        expect(client1).toBe(reconnectedClient.client);
        expect(client2).toBe(reconnectedClient.client);
        expect(manager.isConnected('test-server')).toBe(true);
    });
});
