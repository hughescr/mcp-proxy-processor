/**
 * Tests for ClientManager reconnection behaviour
 */

import { describe, it, expect } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import ClientManager, { ConnectionState } from '../../src/backend/client-manager.js';
import type { BackendServerConfig } from '../../src/types/config.js';

const SERVER_NAME = 'test-backend';

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
    private attemptHandlers: (() => Promise<Client>)[] = [];
    public readonly delays:  number[] = [];
    public attemptCount = 0;

    constructor(configs: Map<string, BackendServerConfig>) {
        super(configs);
    }

    enqueueAttempt(handler: () => Promise<Client>): void {
        this.attemptHandlers.push(handler);
    }

    protected override async attemptConnection(serverName: string, _serverConfig: BackendServerConfig): Promise<Client> {
        this.attemptCount += 1;
        const handler = this.attemptHandlers.shift();
        if(!handler) {
            throw new Error(`No attempt handler configured for ${serverName}`);
        }
        return handler();
    }

    protected override async delay(ms: number): Promise<void> {
        this.delays.push(ms);
        await Promise.resolve();
    }

    getState(serverName: string): InternalClientState | undefined {
        return (this as unknown as { clients: Map<string, InternalClientState> }).clients.get(serverName);
    }

    getQueueLength(serverName: string): number {
        return this.getState(serverName)?.requestQueue.length ?? 0;
    }
}

const createManager = (): TestClientManager => {
    const serverConfig: BackendServerConfig = {
        command: 'mock-command',
    };
    return new TestClientManager(new Map([[SERVER_NAME, serverConfig]]));
};

describe('ClientManager reconnection', () => {
    it('automatically reconnects on unexpected disconnect', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);
        expect(manager.isConnected(SERVER_NAME)).toBe(true);

        const reconnectedClient = new MockClientWrapper('reconnected');
        manager.enqueueAttempt(async () => reconnectedClient.client);

        initialClient.triggerClose();

        const client = await manager.ensureConnected(SERVER_NAME);
        expect(client).toBe(reconnectedClient.client);
        expect(manager.isConnected(SERVER_NAME)).toBe(true);
        expect(manager.delays).toEqual([1000]);
    });

    it('uses exponential backoff delays (1s, 2s, 4s, 8s, 16s)', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        manager.enqueueAttempt(async () => {
            throw new Error('attempt 1 failed');
        });
        manager.enqueueAttempt(async () => {
            throw new Error('attempt 2 failed');
        });
        manager.enqueueAttempt(async () => {
            throw new Error('attempt 3 failed');
        });
        manager.enqueueAttempt(async () => {
            throw new Error('attempt 4 failed');
        });

        const successClient = new MockClientWrapper('success');
        manager.enqueueAttempt(async () => successClient.client);

        initialClient.triggerClose();

        const client = await manager.ensureConnected(SERVER_NAME);
        expect(client).toBe(successClient.client);
        expect(manager.delays).toEqual([1000, 2000, 4000, 8000, 16000]);
        expect(manager.attemptCount).toBe(6); // 1 initial connect + 5 reconnection attempts
    });

    it('queues multiple requests during reconnection and flushes them on success', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        const successClient = new MockClientWrapper('success');
        manager.enqueueAttempt(async () => successClient.client);

        initialClient.triggerClose();

        const queuedOne = manager.ensureConnected(SERVER_NAME, 1000);
        const queuedTwo = manager.ensureConnected(SERVER_NAME, 1000);

        expect(manager.getQueueLength(SERVER_NAME)).toBe(2);

        const [resolvedOne, resolvedTwo] = await Promise.all([queuedOne, queuedTwo]);
        expect(resolvedOne).toBe(successClient.client);
        expect(resolvedTwo).toBe(successClient.client);
        expect(manager.getQueueLength(SERVER_NAME)).toBe(0);
        expect(manager.isConnected(SERVER_NAME)).toBe(true);
    });

    it('enforces per-request queue timeouts', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        const delayedClient = new MockClientWrapper('delayed');
        let completeAttempt: (() => void) | undefined;
        manager.enqueueAttempt(async () => new Promise<Client>((resolve) => {
            completeAttempt = () => resolve(delayedClient.client);
        }));

        initialClient.triggerClose();

        const queued = manager.ensureConnected(SERVER_NAME, 50);

        // eslint-disable-next-line @typescript-eslint/await-thenable -- expect().rejects returns a promise
        await expect(queued).rejects.toThrow('Request timeout');

        completeAttempt?.();
        const client = await manager.ensureConnected(SERVER_NAME);
        expect(client).toBe(delayedClient.client);
    });

    it('shares reconnection promises to prevent duplicate attempts', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        const sharedClient = new MockClientWrapper('shared');
        let resolveAttempt: (() => void) | undefined;
        manager.enqueueAttempt(async () => new Promise<Client>((resolve) => {
            resolveAttempt = () => resolve(sharedClient.client);
        }));

        initialClient.triggerClose();
        await Promise.resolve(); // Allow reconnection flow to schedule

        const first = manager.ensureConnected(SERVER_NAME);
        const second = manager.ensureConnected(SERVER_NAME);

        // Wait for async callback to set resolveAttempt
        // eslint-disable-next-line no-unmodified-loop-condition -- resolveAttempt is set by async callback, not in loop
        for(let i = 0; i < 10 && !resolveAttempt; i++) {
            await Promise.resolve();
        }

        if(!resolveAttempt) {
            throw new Error('Reconnection attempt did not start');
        }

        resolveAttempt();
        const [resolvedFirst, resolvedSecond] = await Promise.all([first, second]);
        expect(resolvedFirst).toBe(sharedClient.client);
        expect(resolvedSecond).toBe(sharedClient.client);
        expect(manager.attemptCount).toBe(2); // initial connect + shared reconnection attempt
    });

    it('fails queued requests when maximum retries are exceeded', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        for(let i = 0; i < 5; i++) {
            manager.enqueueAttempt(async () => {
                throw new Error(`reconnect attempt ${i + 1} failed`);
            });
        }

        initialClient.triggerClose();

        const queued = manager.ensureConnected(SERVER_NAME);
        let capturedError: Error | undefined;
        try {
            await queued;
        } catch (error) {
            capturedError = error as Error;
        }

        expect(capturedError).toBeDefined();
        expect(capturedError?.message).toBe(`Backend server ${SERVER_NAME} reconnection failed after 5 attempts, manual intervention required`);
        expect(manager.isConnected(SERVER_NAME)).toBe(false);
        expect(manager.getState(SERVER_NAME)?.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('transitions state CONNECTED -> RECONNECTING -> CONNECTED after recovery', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        expect(manager.getState(SERVER_NAME)?.state).toBe(ConnectionState.CONNECTED);

        const recoveredClient = new MockClientWrapper('recovered');
        manager.enqueueAttempt(async () => recoveredClient.client);

        initialClient.triggerClose();
        expect(manager.getState(SERVER_NAME)?.state).toBe(ConnectionState.RECONNECTING);

        await manager.ensureConnected(SERVER_NAME);
        expect(manager.getState(SERVER_NAME)?.state).toBe(ConnectionState.CONNECTED);
    });

    it('treats manual disconnects as terminal without auto-reconnection', async () => {
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        await manager.disconnect(SERVER_NAME);

        const state = manager.getState(SERVER_NAME);
        expect(state?.state).toBe(ConnectionState.DISCONNECTED);
        expect(state?.reconnectionPromise).toBeUndefined();
        expect(manager.isConnected(SERVER_NAME)).toBe(false);
    });

    it('should allow queued requests to succeed during final reconnection attempt', async () => {
        /**
         * REGRESSION TEST: Ensures queue timeout (36s) exceeds total backoff delays (31s)
         * This prevents premature timeouts before the 5th retry completes.
         *
         * Bug fix: Previously, queue timeout was 30s but total backoff was 31s (1+2+4+8+16),
         * causing queued requests to timeout before the final reconnection attempt.
         */
        const manager = createManager();

        const initialClient = new MockClientWrapper('initial');
        manager.enqueueAttempt(async () => initialClient.client);
        await manager.connect(SERVER_NAME);

        // Fail first 4 attempts, succeed on 5th
        for(let i = 0; i < 4; i++) {
            manager.enqueueAttempt(async () => {
                throw new Error(`reconnect attempt ${i + 1} failed`);
            });
        }

        const successClient = new MockClientWrapper('success');
        manager.enqueueAttempt(async () => successClient.client);

        initialClient.triggerClose();

        // Queue a request with default timeout (36s)
        const queued = manager.ensureConnected(SERVER_NAME);

        // Verify the request eventually succeeds (doesn't timeout)
        const client = await queued;
        expect(client).toBe(successClient.client);

        // Verify all backoff delays occurred (total: 1+2+4+8+16 = 31s)
        expect(manager.delays).toEqual([1000, 2000, 4000, 8000, 16000]);

        // Verify the 5th attempt was reached
        expect(manager.attemptCount).toBe(6); // 1 initial + 5 reconnection attempts
    });
});
