/**
 * MCP Client Manager
 *
 * Manages MCP client connections to backend servers:
 * - Creates MCP Client instances for each backend server
 * - Uses StdioClientTransport to connect to subprocess stdio
 * - Handles initialization handshakes
 * - Maintains connection state with automatic reconnection
 * - Provides access to connected clients
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import _ from 'lodash';
import type { BackendServerConfig } from '../types/config.js';

export enum ConnectionState {
    CONNECTED = 'connected',
    DISCONNECTING = 'disconnecting',
    DISCONNECTED = 'disconnected',
    RECONNECTING = 'reconnecting'
}

interface RequestQueueItem {
    resolve:   (client: Client) => void
    reject:    (error: Error) => void
    timestamp: number
    timeoutMs: number
}

interface ManagedRequestQueueItem extends RequestQueueItem {
    timeoutHandle: ReturnType<typeof setTimeout>
}

interface ClientState {
    client?:              Client
    serverName:           string
    state:                ConnectionState
    reconnectionAttempt:  number
    reconnectionPromise?: Promise<Client>
    requestQueue:         ManagedRequestQueueItem[]
}

/**
 * Manages MCP client connections to backend servers
 */
export class ClientManager {
    private clients = new Map<string, ClientState>();
    private serverConfigs: Map<string, BackendServerConfig>;

    // Reconnection backoff configuration
    private readonly RECONNECT_INITIAL_DELAY_MS = 1000;   // 1 second
    private readonly RECONNECT_MAX_DELAY_MS = 30000;      // 30 seconds (cap)
    private readonly RECONNECT_MAX_ATTEMPTS = 5;

    /**
     * Request queue timeout must exceed total reconnection time to allow all retry attempts.
     *
     * Calculation:
     * - Backoff delays: 1s + 2s + 4s + 8s + 16s = 31 seconds
     * - Connection operation buffer: +5 seconds (for actual connection attempts)
     * - Total: 36 seconds
     *
     * This ensures queued requests can benefit from all 5 reconnection attempts
     * instead of timing out before the final attempt completes.
     */
    private readonly REQUEST_QUEUE_TIMEOUT_MS = 36000;    // 36 seconds

    constructor(serverConfigs: Map<string, BackendServerConfig>) {
        this.serverConfigs = serverConfigs;
    }

    /**
     * Attempt to connect to a backend server (single attempt, no retries)
     */
    protected async attemptConnection(serverName: string, serverConfig: BackendServerConfig): Promise<Client> {
        // Only stdio transport is currently supported
        if('type' in serverConfig) {
            const unknownType = (serverConfig as { type: unknown }).type;
            throw new Error(`Transport type "${String(unknownType)}" is not yet supported for server "${serverName}". Only stdio transport is currently implemented.`);
        }

        // Type guard confirms this is stdio config
        const stdioConfig = serverConfig;

        logger.debug({ serverName, command: stdioConfig.command }, 'Attempting connection to backend server');

        // StdioClientTransport needs StdioServerParameters
        const serverParams: StdioServerParameters = {
            command: stdioConfig.command,
            args:    stdioConfig.args ?? [],
            env:     {
                ...stdioConfig.env,
                // Propagate silent mode to backend servers
                ...(process.env.LOG_LEVEL ? { LOG_LEVEL: process.env.LOG_LEVEL } : {}),
            },
            // Ignore stderr in admin mode to prevent UI clutter
            // In serve mode, inherit stderr for debugging
            stderr: process.env.LOG_LEVEL === 'silent' ? 'ignore' : 'inherit',
        };

        // Create transport - this will spawn the process
        const transport = new StdioClientTransport(serverParams);

        // Create client
        const client = new Client({
            name:    'mcp-proxy-processor',
            version: '0.1.0',
        }, {
            capabilities: {
                // Request all capabilities from backend servers
                tools:     {},
                resources: {},
            },
        });

        // Connect and initialize
        await client.connect(transport);

        return client;
    }

    /**
     * Wait for a backend server to be ready to accept connections
     * Retries connection with exponential backoff
     */
    private async waitForConnection(serverName: string, serverConfig: BackendServerConfig, maxAttempts = 3): Promise<Client> {
        let lastError: Error | undefined;

        for(let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Create client and attempt connection
                const client = await this.attemptConnection(serverName, serverConfig);

                // Connection successful
                logger.info({ serverName, attempt }, 'Successfully connected to backend server');
                return client;
            } catch (error) {
                lastError = _.isError(error) ? error : new Error(String(error));

                if(attempt < maxAttempts) {
                    // Exponential backoff: 500ms, 1000ms, 2000ms
                    const delayMs = 500 * Math.pow(2, attempt - 1);
                    logger.warn(
                        { serverName, attempt, maxAttempts, delayMs, error: lastError.message },
                        'Connection attempt failed, retrying'
                    );
                    await this.delay(delayMs);
                } else {
                    logger.error(
                        { serverName, attempt, error: lastError.message },
                        'All connection attempts failed'
                    );
                }
            }
        }

        throw new Error(`Failed to connect to backend server ${serverName} after ${maxAttempts} attempts: ${lastError?.message ?? 'Unknown error'}`);
    }

    private getServerConfig(serverName: string): BackendServerConfig {
        const serverConfig = this.serverConfigs.get(serverName);
        if(!serverConfig) {
            throw new Error(`Server config not found: ${serverName}`);
        }
        return serverConfig;
    }

    private getOrCreateState(serverName: string): ClientState {
        const existing = this.clients.get(serverName);
        if(existing) {
            return existing;
        }

        const state: ClientState = {
            client:              undefined,
            serverName,
            state:               ConnectionState.DISCONNECTED,
            reconnectionAttempt: 0,
            reconnectionPromise: undefined,
            requestQueue:        [],
        };

        this.clients.set(serverName, state);
        return state;
    }

    private attachClientHandlers(serverName: string, client: Client): void {
        client.onclose = () => {
            logger.warn({ serverName }, 'Backend server connection closed');
            this.handleDisconnect(serverName);
        };

        client.onerror = (error: Error) => {
            logger.error({ serverName, error: error.message }, 'Backend server connection error');
            this.handleDisconnect(serverName, error);
        };
    }

    private handleDisconnect(serverName: string, error?: Error): void {
        const state = this.clients.get(serverName);
        if(!state) {
            return;
        }

        if(state.state === ConnectionState.DISCONNECTING) {
            state.client = undefined;
            state.state = ConnectionState.DISCONNECTED;
            state.reconnectionAttempt = 0;
            state.reconnectionPromise = undefined;
            return;
        }

        if(state.state === ConnectionState.RECONNECTING) {
            return;
        }

        state.client = undefined;
        void this.startReconnection(serverName, state, error);
    }

    private startReconnection(serverName: string, state: ClientState, error?: Error): Promise<Client> {
        if(state.reconnectionPromise) {
            return state.reconnectionPromise;
        }

        state.state = ConnectionState.RECONNECTING;
        state.reconnectionAttempt = 0;

        logger.warn(
            {
                serverName,
                error: error ? error.message : undefined,
            },
            'Backend server disconnected, starting reconnection'
        );

        const promise = this.reconnect(serverName, state);

        state.reconnectionPromise = promise;

        promise
            .catch(() => undefined)
            .finally(() => {
                state.reconnectionPromise = undefined;
            })
            .catch(() => undefined);

        return promise;
    }

    private async reconnect(serverName: string, state: ClientState): Promise<Client> {
        const serverConfig = this.getServerConfig(serverName);
        const maxAttempts = this.RECONNECT_MAX_ATTEMPTS;
        const startTime = Date.now();

        for(let attempt = 1; attempt <= maxAttempts; attempt++) {
            if(state.state !== ConnectionState.RECONNECTING) {
                throw new Error(`Reconnection aborted for backend server ${serverName}`);
            }

            state.reconnectionAttempt = attempt;

            const delayMs = Math.min(
                this.RECONNECT_INITIAL_DELAY_MS * Math.pow(2, attempt - 1),
                this.RECONNECT_MAX_DELAY_MS
            );

            logger.warn(
                { serverName, attempt, maxAttempts, delayMs },
                'Reconnection attempt scheduled'
            );

            await this.delay(delayMs);

            logger.info({ serverName, attempt }, 'Attempting backend reconnection');

            try {
                const client = await this.attemptConnection(serverName, serverConfig);

                this.attachClientHandlers(serverName, client);

                state.client = client;
                state.state = ConnectionState.CONNECTED;
                state.reconnectionAttempt = 0;

                const { successful, failed } = this.flushRequestQueue(state, client, serverName);

                logger.info(
                    {
                        serverName,
                        attempt,
                        totalDurationMs:    Date.now() - startTime,
                        successfulRequests: successful,
                        failedRequests:     failed,
                    },
                    'Backend reconnection succeeded'
                );

                return client;
            } catch (error) {
                const attemptError = _.isError(error) ? error : new Error(String(error));
                const willRetry = attempt < maxAttempts;

                logger.error(
                    { serverName, attempt, error: attemptError.message, willRetry },
                    'Backend reconnection attempt failed'
                );

                if(!willRetry) {
                    break;
                }
            }
        }

        const failureError = new Error(`Backend server ${serverName} reconnection failed after ${maxAttempts} attempts, manual intervention required`);

        logger.error(
            {
                serverName,
                totalAttempts:  maxAttempts,
                queuedRequests: state.requestQueue.length,
            },
            'Backend reconnection failed after max attempts'
        );

        this.failRequestQueue(state, failureError, serverName);

        state.state = ConnectionState.DISCONNECTED;
        state.client = undefined;
        state.reconnectionAttempt = 0;

        throw failureError;
    }

    private queueRequest(serverName: string, state: ClientState, timeoutMs: number): Promise<Client> {
        let timeoutHandle: ReturnType<typeof setTimeout>;

        return new Promise<Client>((resolve, reject) => {
            const item: ManagedRequestQueueItem = {
                resolve: (client: Client) => {
                    clearTimeout(timeoutHandle);
                    resolve(client);
                },
                reject: (error: Error) => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                },
                timestamp:     Date.now(),
                timeoutMs,
                timeoutHandle: undefined as unknown as ReturnType<typeof setTimeout>,
            };

            timeoutHandle = setTimeout(() => {
                state.requestQueue = _.filter(state.requestQueue, entry => entry !== item);
                const error = new Error(`Request timeout: backend server ${serverName} reconnection took longer than ${timeoutMs}ms`);
                logger.error(
                    {
                        serverName,
                        timeoutMs,
                        queueLength: state.requestQueue.length,
                    },
                    error.message
                );
                item.reject(error);
            }, timeoutMs);

            item.timeoutHandle = timeoutHandle;

            state.requestQueue.push(item);

            const attempt = state.reconnectionAttempt === 0 ? 1 : state.reconnectionAttempt;

            logger.warn(
                {
                    serverName,
                    attempt,
                    maxAttempts: this.RECONNECT_MAX_ATTEMPTS,
                    queueLength: state.requestQueue.length,
                    timeoutMs,
                },
                `Backend server ${serverName} is reconnecting (attempt ${attempt}/${this.RECONNECT_MAX_ATTEMPTS}), request queued`
            );
        });
    }

    private flushRequestQueue(state: ClientState, client: Client, serverName: string): { successful: number, failed: number } {
        if(state.requestQueue.length === 0) {
            return { successful: 0, failed: 0 };
        }

        const queue = [...state.requestQueue];
        state.requestQueue = [];

        let successful = 0;
        let failed = 0;

        for(const item of queue) {
            clearTimeout(item.timeoutHandle);
            try {
                item.resolve(client);
                successful += 1;
            } catch (error) {
                failed += 1;
                logger.error(
                    {
                        serverName,
                        error: _.isError(error) ? error.message : String(error),
                    },
                    'Failed to resolve queued request after reconnection'
                );
            }
        }

        logger.info(
            { serverName, successfulRequests: successful, failedRequests: failed },
            'Request queue flushed after reconnection'
        );

        return { successful, failed };
    }

    private failRequestQueue(state: ClientState, error: Error, serverName: string): void {
        if(state.requestQueue.length === 0) {
            return;
        }

        const queue = [...state.requestQueue];
        state.requestQueue = [];

        for(const item of queue) {
            clearTimeout(item.timeoutHandle);
            item.reject(error);
        }

        logger.warn(
            { serverName, failedRequests: queue.length },
            'Request queue rejected due to reconnection failure'
        );
    }

    protected async delay(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Connect to a specific backend server
     */
    async connect(serverName: string): Promise<Client> {
        const state = this.getOrCreateState(serverName);

        if(state.state === ConnectionState.CONNECTED && state.client) {
            logger.debug({ serverName }, 'Already connected to backend server');
            return state.client;
        }

        const serverConfig = this.getServerConfig(serverName);

        logger.info({ serverName }, 'Connecting to backend server with retry logic');

        try {
            const client = await this.waitForConnection(serverName, serverConfig);

            this.attachClientHandlers(serverName, client);

            state.client = client;
            state.state = ConnectionState.CONNECTED;
            state.reconnectionAttempt = 0;
            state.reconnectionPromise = undefined;
            state.requestQueue = [];

            return client;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Failed to connect to backend server after all retries'
            );
            state.state = ConnectionState.DISCONNECTED;
            state.client = undefined;
            state.reconnectionAttempt = 0;
            throw new Error(`Failed to connect to backend server ${serverName}: ${_.isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Connect to all available backend servers
     * Returns connection results indicating success/failure for each server
     */
    async connectAll(): Promise<{ successful: string[], failed: { serverName: string, error: string }[] }> {
        const serverNames = Array.from(this.serverConfigs.keys());

        logger.info({ serverCount: serverNames.length }, 'Connecting to all backend servers');

        const successful: string[] = [];
        const failed: { serverName: string, error: string }[] = [];

        const connectPromises = _.map(serverNames, async (serverName) => {
            try {
                await this.connect(serverName);
                successful.push(serverName);
            } catch (error) {
                const errorMessage = _.isError(error) ? error.message : String(error);
                failed.push({ serverName, error: errorMessage });
                logger.error(
                    { serverName, error: errorMessage },
                    'Failed to connect to backend server during connectAll'
                );
                // Continue with other servers even if one fails
            }
        });

        await Promise.all(connectPromises);

        const connectedCount = _.filter(
            Array.from(this.clients.values()),
            { state: ConnectionState.CONNECTED }
        ).length;

        if(failed.length > 0) {
            logger.warn(
                {
                    connectedCount,
                    totalServers: serverNames.length,
                    successful,
                    failedCount:  failed.length,
                    failures:     failed,
                },
                'Finished connecting to backend servers with some failures'
            );
        } else {
            logger.info({ connectedCount, totalServers: serverNames.length }, 'Finished connecting to backend servers');
        }

        return { successful, failed };
    }

    /**
     * Disconnect from a specific backend server
     */
    async disconnect(serverName: string): Promise<void> {
        const state = this.clients.get(serverName);
        if(!state?.client) {
            logger.warn({ serverName }, 'Cannot disconnect: client not found');
            return;
        }

        if(state.state !== ConnectionState.CONNECTED) {
            logger.warn({ serverName, state: state.state }, 'Cannot disconnect: client not connected');
            return;
        }

        logger.info({ serverName }, 'Disconnecting from backend server');

        state.state = ConnectionState.DISCONNECTING;

        try {
            await state.client.close();
            state.client = undefined;
            state.state = ConnectionState.DISCONNECTED;
            state.reconnectionAttempt = 0;
            state.reconnectionPromise = undefined;
            state.requestQueue = [];
            logger.info({ serverName }, 'Successfully disconnected from backend server');
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Error disconnecting from backend server'
            );
            state.client = undefined;
            state.state = ConnectionState.DISCONNECTED;
            state.reconnectionAttempt = 0;
        }
    }

    /**
     * Disconnect from all backend servers
     */
    async disconnectAll(): Promise<void> {
        logger.info({ clientCount: this.clients.size }, 'Disconnecting from all backend servers');

        const disconnectPromises = _.map(Array.from(this.clients.keys()), async (serverName) => {
            try {
                await this.disconnect(serverName);
            } catch (error) {
                logger.error(
                    { serverName, error: _.isError(error) ? error.message : String(error) },
                    'Error disconnecting during disconnectAll'
                );
            }
        });

        await Promise.all(disconnectPromises);

        this.clients.clear();
        logger.info('Disconnected from all backend servers');
    }

    /**
     * Ensure a backend server client is connected (with automatic reconnection)
     */
    async ensureConnected(serverName: string, timeoutMs = this.REQUEST_QUEUE_TIMEOUT_MS): Promise<Client> {
        const state = this.getOrCreateState(serverName);

        if(state.state === ConnectionState.CONNECTED && state.client) {
            return state.client;
        }

        if(state.state === ConnectionState.DISCONNECTING) {
            throw new Error(`Backend server ${serverName} is disconnecting`);
        }

        if(state.state === ConnectionState.RECONNECTING) {
            return this.queueRequest(serverName, state, timeoutMs);
        }

        // If we reach here, state is DISCONNECTED (or unexpected but without client)
        void this.startReconnection(serverName, state);

        return this.queueRequest(serverName, state, timeoutMs);
    }

    /**
     * Check if connected to a specific backend server
     */
    isConnected(serverName: string): boolean {
        const state = this.clients.get(serverName);
        return state?.state === ConnectionState.CONNECTED;
    }

    /**
     * Get all connected client names
     */
    getConnectedServerNames(): string[] {
        const entries = Array.from(this.clients.entries());
        const connected = _.filter(entries, ['1.state', ConnectionState.CONNECTED]);
        return _.map(connected, '0');
    }

    /**
     * Get connection statistics
     */
    getStats(): { total: number, connected: number, disconnected: number } {
        const states = Array.from(this.clients.values());
        return {
            total:        states.length,
            connected:    _.filter(states, { state: ConnectionState.CONNECTED }).length,
            disconnected: _.reject(states, { state: ConnectionState.CONNECTED }).length,
        };
    }
}

export default ClientManager;
