/**
 * Backend Connection Context for Admin UI
 *
 * Provides shared backend server connections that persist throughout the admin session.
 * Initializes servers asynchronously on startup and only blocks when access is needed.
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { isError, keys } from 'lodash';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { BackendServersConfig } from '../types/config.js';
import { ClientManager } from '../backend/client-manager.js';
import { DiscoveryService } from '../backend/discovery.js';
import { loadBackendServersConfig } from './config-utils.js';

/**
 * Connection status for a single backend server
 */
export type ServerStatus = 'connecting' | 'connected' | 'failed' | 'unavailable';

export interface ServerConnectionState {
    status:       ServerStatus
    error?:       string
    lastAttempt?: number
    connectedAt?: number
}

/**
 * Backend context state
 */
interface BackendContextState {
    /** Current initialization/connection status */
    isInitialized:       boolean
    initializationError: string | null

    /** Client manager instance */
    clientManager: ClientManager | null

    /** Discovery service instance */
    discoveryService: DiscoveryService | null

    /** Per-server connection status */
    serverStatus: Map<string, ServerConnectionState>

    /** Ensure a specific server is ready (blocks if connecting) */
    ensureServerReady: (serverName: string) => Promise<void>

    /** Discover tools from all servers */
    discoverAllTools: () => Promise<Map<string, Tool[]>>

    /** Discover resources from all servers */
    discoverAllResources: () => Promise<Map<string, Resource[]>>

    /** Discover prompts from all servers */
    discoverAllPrompts: () => Promise<Map<string, Prompt[]>>

    /** Reload backend configuration and restart servers */
    reloadBackendConfig: () => Promise<void>

    /** Get list of all configured server names */
    getServerNames: () => string[]
}

const BackendContext = createContext<BackendContextState | null>(null);

interface BackendProviderProps {
    children: ReactNode
}

/**
 * Provider component that manages backend server connections
 */
export function BackendProvider({ children }: BackendProviderProps) {
    const [isInitialized, setIsInitialized] = useState(false);
    const [initializationError, setInitializationError] = useState<string | null>(null);
    const [serverStatus, setServerStatus] = useState<Map<string, ServerConnectionState>>(new Map());

    // Use refs to maintain stable instances across renders
    const clientManagerRef = useRef<ClientManager | null>(null);
    const discoveryServiceRef = useRef<DiscoveryService | null>(null);
    const serverConfigRef = useRef<BackendServersConfig | null>(null);

    // Ref to track current server status (for polling callbacks)
    const serverStatusRef = useRef<Map<string, ServerConnectionState>>(new Map());

    /**
     * Keep ref synchronized with state for polling callbacks
     */
    useEffect(() => {
        serverStatusRef.current = serverStatus;
    }, [serverStatus]);

    /**
     * Update status for a single server
     */
    const updateServerStatus = useCallback((serverName: string, update: Partial<ServerConnectionState>) => {
        setServerStatus((prev) => {
            const next = new Map(prev);
            const current = next.get(serverName) ?? { status: 'connecting' };
            next.set(serverName, { ...current, ...update });
            return next;
        });
    }, []);

    /**
     * Initialize backend connections
     */
    const initialize = useCallback(async () => {
        try {
            // Load backend server config
            const backendConfig = await loadBackendServersConfig();
            serverConfigRef.current = backendConfig;

            const serverConfigs = new Map(Object.entries(backendConfig.mcpServers));
            const serverNames = Array.from(serverConfigs.keys());

            // Initialize all servers as 'connecting'
            const initialStatus = new Map<string, ServerConnectionState>();
            for(const serverName of serverNames) {
                initialStatus.set(serverName, {
                    status:      'connecting',
                    lastAttempt: Date.now(),
                });
            }
            setServerStatus(initialStatus);

            // Create client manager
            const clientManager = new ClientManager(serverConfigs);
            clientManagerRef.current = clientManager;

            // Create discovery service
            const discoveryService = new DiscoveryService(clientManager);
            discoveryServiceRef.current = discoveryService;

            // Connect to all servers asynchronously (non-blocking)
            void (async () => {
                const results = await clientManager.connectAll();

                // Update status for successful connections
                for(const serverName of results.successful) {
                    updateServerStatus(serverName, {
                        status:      'connected',
                        connectedAt: Date.now(),
                    });
                }

                // Update status for failed connections
                for(const { serverName, error } of results.failed) {
                    updateServerStatus(serverName, {
                        status: 'failed',
                        error,
                    });
                }
            })();

            setIsInitialized(true);
            setInitializationError(null);
        } catch (error) {
            const errorMessage = isError(error) ? error.message : String(error);
            setInitializationError(errorMessage);
            setIsInitialized(true); // Still mark as initialized to allow error display
        }
    }, [updateServerStatus]);

    /**
     * Initialize on mount
     */
    useEffect(() => {
        void initialize();

        // Cleanup: disconnect all clients on unmount
        return () => {
            if(clientManagerRef.current) {
                void clientManagerRef.current.disconnectAll();
            }
        };
    }, [initialize]);

    /**
     * Wait for a connecting server to finish connecting
     */
    const waitForConnection = useCallback(async (serverName: string): Promise<void> => {
        const maxWaitMs = 30000; // 30 seconds max
        const startTime = Date.now();

        while(Date.now() - startTime < maxWaitMs) {
            // Read from ref to get current state (not stale closure)
            const currentStatus = serverStatusRef.current.get(serverName);

            if(currentStatus?.status === 'connected') {
                return;
            }

            if(currentStatus?.status === 'failed') {
                throw new Error(`Server ${serverName} failed to connect: ${currentStatus.error ?? 'Unknown error'}`);
            }

            // Wait 100ms before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error(`Timeout waiting for server ${serverName} to connect`);
    }, []); // Empty deps - relies on ref

    /**
     * Attempt to connect to a server
     */
    const connectToServer = useCallback(async (serverName: string): Promise<void> => {
        const clientManager = clientManagerRef.current;
        if(!clientManager) {
            throw new Error('Backend not initialized');
        }

        updateServerStatus(serverName, {
            status:      'connecting',
            lastAttempt: Date.now(),
        });

        try {
            await clientManager.connect(serverName);
            updateServerStatus(serverName, {
                status:      'connected',
                connectedAt: Date.now(),
            });
        } catch (error) {
            const errorMessage = isError(error) ? error.message : String(error);
            updateServerStatus(serverName, {
                status: 'failed',
                error:  errorMessage,
            });
            throw error;
        }
    }, [updateServerStatus]);

    /**
     * Ensure a specific server is ready (blocks until connected or failed)
     */
    const ensureServerReady = useCallback(async (serverName: string): Promise<void> => {
        const clientManager = clientManagerRef.current;
        if(!clientManager) {
            throw new Error('Backend not initialized');
        }

        // Read from ref to get current state (not stale closure)
        const status = serverStatusRef.current.get(serverName);

        // If already connected, return immediately
        if(status?.status === 'connected') {
            return;
        }

        // If failed or unavailable, throw error
        if(status?.status === 'failed') {
            throw new Error(`Server ${serverName} failed to connect: ${status.error ?? 'Unknown error'}`);
        }

        if(status?.status === 'unavailable') {
            throw new Error(`Server ${serverName} is not configured`);
        }

        // If connecting, wait for connection to complete
        if(status?.status === 'connecting') {
            await waitForConnection(serverName);
            return;
        }

        // Server not found in status map - try to connect
        await connectToServer(serverName);
    }, [waitForConnection, connectToServer]); // Removed serverStatus from deps

    /**
     * Discover all tools from all connected servers
     */
    const discoverAllTools = useCallback(async (): Promise<Map<string, Tool[]>> => {
        const discoveryService = discoveryServiceRef.current;
        if(!discoveryService) {
            throw new Error('Backend not initialized');
        }

        return discoveryService.discoverAllTools();
    }, []);

    /**
     * Discover all resources from all connected servers
     */
    const discoverAllResources = useCallback(async (): Promise<Map<string, Resource[]>> => {
        const discoveryService = discoveryServiceRef.current;
        if(!discoveryService) {
            throw new Error('Backend not initialized');
        }

        return discoveryService.discoverAllResources();
    }, []);

    /**
     * Discover all prompts from all connected servers
     */
    const discoverAllPrompts = useCallback(async (): Promise<Map<string, Prompt[]>> => {
        const discoveryService = discoveryServiceRef.current;
        if(!discoveryService) {
            throw new Error('Backend not initialized');
        }

        return discoveryService.discoverAllPrompts();
    }, []);

    /**
     * Reload backend configuration (e.g., after adding/editing/deleting servers)
     */
    const reloadBackendConfig = useCallback(async () => {
        // Disconnect current servers
        if(clientManagerRef.current) {
            await clientManagerRef.current.disconnectAll();
        }

        // Clear current state
        clientManagerRef.current = null;
        discoveryServiceRef.current = null;
        serverConfigRef.current = null;
        setServerStatus(new Map());
        setIsInitialized(false);
        setInitializationError(null);

        // Re-initialize with new config
        await initialize();
    }, [initialize]);

    /**
     * Get list of all configured server names
     */
    const getServerNames = useCallback((): string[] => {
        if(!serverConfigRef.current) {
            return [];
        }
        return keys(serverConfigRef.current.mcpServers);
    }, []);

    const contextValue: BackendContextState = {
        isInitialized,
        initializationError,
        clientManager:    clientManagerRef.current,
        discoveryService: discoveryServiceRef.current,
        serverStatus,
        ensureServerReady,
        discoverAllTools,
        discoverAllResources,
        discoverAllPrompts,
        reloadBackendConfig,
        getServerNames,
    };

    return (
        <BackendContext.Provider value={contextValue}>
            {children}
        </BackendContext.Provider>
    );
}

/**
 * Hook to access backend context
 */
export function useBackend(): BackendContextState {
    const context = useContext(BackendContext);
    if(!context) {
        throw new Error('useBackend must be used within BackendProvider');
    }
    return context;
}

/**
 * Hook to get backend status summary
 */
export function useBackendStatus(): {
    totalServers:      number
    connectedServers:  number
    connectingServers: number
    failedServers:     number
    isReady:           boolean
} {
    const { serverStatus, isInitialized } = useBackend();

    let connectedServers = 0;
    let connectingServers = 0;
    let failedServers = 0;

    for(const state of serverStatus.values()) {
        if(state.status === 'connected') {
            connectedServers++;
        } else if(state.status === 'connecting') {
            connectingServers++;
        } else if(state.status === 'failed') {
            failedServers++;
        }
    }

    const totalServers = serverStatus.size;
    const isReady = isInitialized && (connectedServers > 0 || totalServers === 0);

    return {
        totalServers,
        connectedServers,
        connectingServers,
        failedServers,
        isReady,
    };
}
