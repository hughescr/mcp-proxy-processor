/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Logger type from ternary expression not properly inferred by TypeScript */
/**
 * MCP Client Manager
 *
 * Manages MCP client connections to backend servers:
 * - Creates MCP Client instances for each backend server
 * - Uses StdioClientTransport to connect to subprocess stdio
 * - Handles initialization handshakes
 * - Maintains connection state
 * - Provides access to connected clients
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger as realLogger } from '@hughescr/logger';
import { logger as silentLogger } from '../utils/silent-logger.js';
import _ from 'lodash';
import type { BackendServerConfig } from '../types/config.js';

// Use silent logger in admin mode

const logger = process.env.LOG_LEVEL === 'silent' ? silentLogger : realLogger;

interface ClientState {
    client:     Client
    serverName: string
    connected:  boolean
}

/**
 * Manages MCP client connections to backend servers
 */
export class ClientManager {
    private clients = new Map<string, ClientState>();
    private serverConfigs: Map<string, BackendServerConfig>;

    constructor(serverConfigs: Map<string, BackendServerConfig>) {
        this.serverConfigs = serverConfigs;
    }

    /**
     * Attempt to connect to a backend server (single attempt, no retries)
     */
    private async attemptConnection(serverName: string, serverConfig: BackendServerConfig): Promise<Client> {
        // Only stdio transport is currently supported
        if('type' in serverConfig) {
            throw new Error(`Transport type "${serverConfig.type}" is not yet supported for server "${serverName}". Only stdio transport is currently implemented.`);
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
                    await new Promise(resolve => setTimeout(resolve, delayMs));
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

    /**
     * Connect to a specific backend server
     */
    async connect(serverName: string): Promise<Client> {
        // Check if already connected
        const existingState = this.clients.get(serverName);
        if(existingState?.connected) {
            logger.debug({ serverName }, 'Already connected to backend server');
            return existingState.client;
        }

        // Get server config
        const serverConfig = this.serverConfigs.get(serverName);
        if(!serverConfig) {
            throw new Error(`Server config not found: ${serverName}`);
        }

        logger.info({ serverName }, 'Connecting to backend server with retry logic');

        try {
            // Use retry logic for connection
            const client = await this.waitForConnection(serverName, serverConfig);

            const state: ClientState = {
                client,
                serverName,
                connected: true,
            };

            this.clients.set(serverName, state);

            // Handle unexpected disconnections by monitoring client events
            client.onclose = () => {
                logger.warn({ serverName }, 'Backend server connection closed');
                const currentState = this.clients.get(serverName);
                if(currentState) {
                    currentState.connected = false;
                }
            };

            client.onerror = (error: Error) => {
                logger.error({ serverName, error: error.message }, 'Backend server connection error');
                const currentState = this.clients.get(serverName);
                if(currentState) {
                    currentState.connected = false;
                }
            };

            return client;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Failed to connect to backend server after all retries'
            );
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

        const connectedCount = _.filter(Array.from(this.clients.values()), 'connected').length;

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
        if(!state) {
            logger.warn({ serverName }, 'Cannot disconnect: client not found');
            return;
        }

        if(!state.connected) {
            logger.warn({ serverName }, 'Cannot disconnect: client not connected');
            return;
        }

        logger.info({ serverName }, 'Disconnecting from backend server');

        try {
            await state.client.close();
            state.connected = false;
            this.clients.delete(serverName);
            logger.info({ serverName }, 'Successfully disconnected from backend server');
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Error disconnecting from backend server'
            );
            // Still remove from clients map even if close fails
            this.clients.delete(serverName);
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
     * Get a connected client by server name
     */
    getClient(serverName: string): Client | undefined {
        const state = this.clients.get(serverName);
        return state?.connected ? state.client : undefined;
    }

    /**
     * Check if connected to a specific backend server
     */
    isConnected(serverName: string): boolean {
        return this.clients.get(serverName)?.connected ?? false;
    }

    /**
     * Get all connected client names
     */
    getConnectedServerNames(): string[] {
        const entries = Array.from(this.clients.entries());
        const connected = _.filter(entries, ([_name, state]) => state.connected);
        return _.map(connected, ([name, _state]) => name);
    }

    /**
     * Get connection statistics
     */
    getStats(): { total: number, connected: number, disconnected: number } {
        const states = Array.from(this.clients.values());
        return {
            total:        states.length,
            connected:    _.filter(states, 'connected').length,
            disconnected: _.filter(states, state => !state.connected).length,
        };
    }
}

export default ClientManager;
