/**
 * Server List Component - Display and manage backend MCP servers
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, useInput } from 'ink';
import { isError, keys, chain, compact } from 'lodash';
import type { BackendServerConfig } from '../types/config.js';
import { loadBackendServersConfig, saveBackendServersConfig } from './config-utils.js';
import { useBackend, useBackendStatus } from './BackendContext.js';
import { ServerEditor } from './ServerEditor.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { ErrorScreen } from './components/ui/ErrorScreen.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { useNotification } from './components/ui/NotificationContext.js';
import { menuSeparator } from './design-system.js';

interface ServerListProps {
    onBack: () => void
}

type View = 'list' | 'edit' | 'create';

/**
 * Get a human-readable description of server transport type
 */
function getTransportDescription(config: BackendServerConfig): string {
    if('type' in config) {
        return config.type === 'streamable-http' ? 'HTTP' : 'SSE';
    }
    return 'stdio';
}

/**
 * Server list and management screen
 */
export function ServerList({ onBack }: ServerListProps) {
    const [view, setView] = useState<View>('list');
    const [servers, setServers] = useState<Record<string, BackendServerConfig>>({});
    const [selectedServerName, setSelectedServerName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { reloadBackendConfig, serverStatus } = useBackend();
    const { connectedServers, connectingServers, failedServers } = useBackendStatus();
    const { showNotification } = useNotification();
    const notifiedFailures = useRef<Set<string>>(new Set());

    // Handle Esc and Left Arrow for navigation
    useInput((input, key) => {
        if(!loading && view === 'list' && (key.escape || key.leftArrow)) {
            onBack();
        }
    });

    const [loadingStatus, setLoadingStatus] = useState<string>('Loading backend servers configuration...');

    // Load servers on mount
    useEffect(() => {
        void (async () => {
            try {
                setLoadingStatus('Reading backend servers configuration...');
                const config = await loadBackendServersConfig();
                setLoadingStatus('Processing servers...');
                setServers(config.mcpServers);
                setLoading(false);
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, []);

    // Watch for server connection failures and emit notifications
    useEffect(() => {
        if(view !== 'list') {
            return;
        }

        for(const [serverName, state] of serverStatus) {
            if(state.status === 'failed' && !notifiedFailures.current.has(serverName)) {
                notifiedFailures.current.add(serverName);
                showNotification('error', `Failed to connect to server: ${serverName}`, state.error);
            }
        }
    }, [serverStatus, view, showNotification]);

    const handleServerSelect = (item: { value: string }) => {
        if(item.value === 'back') {
            onBack();
        } else if(item.value === 'create') {
            setSelectedServerName(null);
            setView('create');
        } else {
            setSelectedServerName(item.value);
            setView('edit');
        }
    };

    const handleSaveServer = async (serverName: string, server: BackendServerConfig) => {
        try {
            const newServers = { ...servers, [serverName]: server };
            await saveBackendServersConfig({ mcpServers: newServers });
            setServers(newServers);

            // Reload backend connections with new configuration
            await reloadBackendConfig();

            setView('list');
            setError(null);
        } catch (err) {
            setError(isError(err) ? err.message : String(err));
        }
    };

    const handleDeleteServer = async (serverName: string) => {
        try {
            const newServers = { ...servers };
            delete newServers[serverName];
            await saveBackendServersConfig({ mcpServers: newServers });
            setServers(newServers);

            // Reload backend connections with new configuration
            await reloadBackendConfig();

            setView('list');
            setError(null);
        } catch (err) {
            setError(isError(err) ? err.message : String(err));
        }
    };

    const handleCancel = () => {
        setView('list');
        setSelectedServerName(null);
    };

    // Show server editor
    if(view === 'edit' && selectedServerName) {
        return (
            <ServerEditor
              serverName={selectedServerName}
              server={servers[selectedServerName]}
              onSave={handleSaveServer}
              onDelete={handleDeleteServer}
              onCancel={handleCancel}
            />
        );
    }

    // Show server creator
    if(view === 'create') {
        return (
            <ServerEditor
              serverName=""
              server={{ command: '', args: [], env: {} }}
              onSave={handleSaveServer}
              onDelete={async () => { /* noop for new server */ }}
              onCancel={handleCancel}
            />
        );
    }

    // Show loading state
    if(loading) {
        return <LoadingScreen message={loadingStatus} />;
    }

    // Show error state
    if(error) {
        return (
            <ErrorScreen
              title="Error Loading Backend Servers"
              message={error}
              troubleshooting={[
                  '• Check that config/backend-servers.json exists and is readable',
                  '• Verify the file contains valid JSON',
                  '• Ensure server configurations follow the correct schema',
                  '• Confirm you have permission to read the file',
              ]}
              helpText="Press Esc to return to main menu"
            />
        );
    }

    // Helper to get status character for string labels
    const getStatusChar = (status: 'connected' | 'connecting' | 'failed' | 'unavailable'): string => {
        if(status === 'connected') {
            return '✓';
        }
        if(status === 'failed') {
            return '✗';
        }
        if(status === 'unavailable') {
            return '○';
        }
        return '⋯';  // connecting
    };

    // Build menu items with text-only labels
    const serverItems = chain(servers)
        .keys()
        .map((name) => {
            const rawStatus = serverStatus.get(name)?.status ?? 'connecting';
            const status = rawStatus === 'unavailable' ? 'failed' : rawStatus;
            const statusChar = getStatusChar(status);
            return {
                label: `${statusChar} ${name} (${getTransportDescription(servers[name])})`,
                value: name,
            };
        })
        .value();

    const menuItems = [
        ...serverItems,
        ...(serverItems.length > 0 ? [menuSeparator()] : []),
        { label: '+ Create New Server', value: 'create' },
        { label: '← Back', value: 'back' },
    ];

    // Build status summary as plain text
    const statusSummary = keys(servers).length === 0
        ? 'No backend servers configured. Create a new server to get started.'
        : compact([
            connectedServers > 0 && `✓ ${connectedServers} connected`,
            connectingServers > 0 && `⋯ ${connectingServers} connecting`,
            failedServers > 0 && `✗ ${failedServers} failed`,
        ]).join(', ');
    // Fixed UI height: padding(1) + header(1) + margin(1) + subtitle(1) + margin(1) + padding(1) = 6
    const fixedUIHeight = 6;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title="Backend Server Management"
              subtitle={statusSummary}
            />
            <VirtualScrollList
              items={menuItems}
              onSelect={handleServerSelect}
              fixedUIHeight={fixedUIHeight}
            />
        </Box>
    );
}
