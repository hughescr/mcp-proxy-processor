/**
 * Server List Component - Display and manage backend MCP servers
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './components/SelectInput.js';
import { isError, keys, chain } from 'lodash';
import type { BackendServerConfig } from '../types/config.js';
import { loadBackendServersConfig, saveBackendServersConfig } from './config-utils.js';
import { ServerEditor } from './ServerEditor.js';

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
        return (
            <Box padding={1}>
                <Text>{loadingStatus}</Text>
            </Box>
        );
    }

    // Show error state
    if(error) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="red">
                    Error Loading Backend Servers
                </Text>
                <Box marginTop={1}>
                    <Text color="red">
                        {error}
                    </Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                    <Text bold>Troubleshooting:</Text>
                    <Text>• Check that config/backend-servers.json exists and is readable</Text>
                    <Text>• Verify the file contains valid JSON</Text>
                    <Text>• Ensure server configurations follow the correct schema</Text>
                    <Text>• Confirm you have permission to read the file</Text>
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>Press Esc to return to main menu</Text>
                </Box>
            </Box>
        );
    }

    // Build menu items with separators
    const serverItems = chain(servers)
        .keys()
        .map(name => ({
            label: `${name} (${getTransportDescription(servers[name])})`,
            value: name,
        }))
        .value();

    const menuItems = [
        ...serverItems,
        ...(serverItems.length > 0 ? [{ label: '───────────────────', value: 'sep1', disabled: true }] : []),
        { label: '+ Create New Server', value: 'create' },
        { label: '← Back', value: 'back' },
    ];

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Backend Server Management
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text dimColor>
                    {keys(servers).length === 0
                        ? 'No backend servers configured. Create a new server to get started.'
                        : 'Select a server to edit, or create a new one:'}
                </Text>
            </Box>
            <SelectInput items={menuItems} onSelect={handleServerSelect} />
        </Box>
    );
}
