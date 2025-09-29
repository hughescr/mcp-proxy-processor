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
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '@hughescr/logger';
import type { ServerManager } from './server-manager.js';

interface ClientState {
    client: Client;
    serverName: string;
    connected: boolean;
}

/**
 * Manages MCP client connections to backend servers
 */
export class ClientManager {
    private clients: Map<string, ClientState> = new Map();
    private serverManager: ServerManager;

    constructor(serverManager: ServerManager) {
        this.serverManager = serverManager;
    }

    /**
     * Connect to a specific backend server
     */
    async connect(serverName: string): Promise<Client> {
        // Check if already connected
        const existingState = this.clients.get(serverName);
        if (existingState?.connected) {
            logger.debug({ serverName }, 'Already connected to backend server');
            return existingState.client;
        }

        // Get the server process
        const serverProcess = this.serverManager.getServerProcess(serverName);
        if (!serverProcess) {
            throw new Error(`Server process not found: ${serverName}`);
        }

        if (!serverProcess.stdin || !serverProcess.stdout) {
            throw new Error(`Server process ${serverName} does not have valid stdin/stdout`);
        }

        logger.info({ serverName, pid: serverProcess.pid }, 'Connecting to backend server');

        try {
            // Create transport using the subprocess stdio
            const transport = new StdioClientTransport({
                stdin: serverProcess.stdin,
                stdout: serverProcess.stdout,
            });

            // Create client
            const client = new Client({
                name: 'mcp-proxy-processor',
                version: '0.1.0',
            }, {
                capabilities: {
                    // Request all capabilities from backend servers
                    tools: {},
                    resources: {},
                },
            });

            // Connect and initialize
            await client.connect(transport);

            const state: ClientState = {
                client,
                serverName,
                connected: true,
            };

            this.clients.set(serverName, state);

            logger.info({ serverName }, 'Successfully connected to backend server');

            // Handle unexpected disconnections
            transport.onclose = () => {
                logger.warn({ serverName }, 'Backend server connection closed');
                const currentState = this.clients.get(serverName);
                if (currentState) {
                    currentState.connected = false;
                }
            };

            transport.onerror = (error: Error) => {
                logger.error({ serverName, error: error.message }, 'Backend server connection error');
                const currentState = this.clients.get(serverName);
                if (currentState) {
                    currentState.connected = false;
                }
            };

            return client;
        } catch (error) {
            logger.error(
                { serverName, error: error instanceof Error ? error.message : String(error) },
                'Failed to connect to backend server'
            );
            throw new Error(`Failed to connect to backend server ${serverName}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Connect to all available backend servers
     */
    async connectAll(): Promise<void> {
        const serverNames = this.serverManager.getServerNames();

        logger.info({ serverCount: serverNames.length }, 'Connecting to all backend servers');

        const connectPromises = serverNames.map(async (serverName) => {
            try {
                await this.connect(serverName);
            } catch (error) {
                logger.error(
                    { serverName, error: error instanceof Error ? error.message : String(error) },
                    'Failed to connect to backend server during connectAll'
                );
                // Continue with other servers even if one fails
            }
        });

        await Promise.all(connectPromises);

        const connectedCount = Array.from(this.clients.values()).filter(s => s.connected).length;
        logger.info({ connectedCount, totalServers: serverNames.length }, 'Finished connecting to backend servers');
    }

    /**
     * Disconnect from a specific backend server
     */
    async disconnect(serverName: string): Promise<void> {
        const state = this.clients.get(serverName);
        if (!state) {
            logger.warn({ serverName }, 'Cannot disconnect: client not found');
            return;
        }

        if (!state.connected) {
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
                { serverName, error: error instanceof Error ? error.message : String(error) },
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

        const disconnectPromises = Array.from(this.clients.keys()).map(async (serverName) => {
            try {
                await this.disconnect(serverName);
            } catch (error) {
                logger.error(
                    { serverName, error: error instanceof Error ? error.message : String(error) },
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
        return Array.from(this.clients.entries())
            .filter(([_, state]) => state.connected)
            .map(([name, _]) => name);
    }

    /**
     * Get connection statistics
     */
    getStats(): { total: number; connected: number; disconnected: number } {
        const states = Array.from(this.clients.values());
        return {
            total: states.length,
            connected: states.filter(s => s.connected).length,
            disconnected: states.filter(s => !s.connected).length,
        };
    }
}

export default ClientManager;