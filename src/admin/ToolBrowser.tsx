/**
 * Tool Browser Component - Browse backend tools and select for adding to groups
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { SelectInput } from './components/SelectInput.js';
import { isError, map, repeat, replace, trim } from 'lodash';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ToolOverride } from '../types/config.js';
import { loadBackendServersConfig } from './config-utils.js';
import { ClientManager } from '../backend/client-manager.js';
import { DiscoveryService } from '../backend/discovery.js';

interface ToolBrowserProps {
    onBack:    () => void
    onSelect?: (tool: ToolOverride) => void
}

interface ToolItem {
    serverName: string
    tool:       Tool
}

/**
 * Browse backend tools from all connected servers
 */
export function ToolBrowser({ onBack, onSelect }: ToolBrowserProps) {
    const [tools, setTools] = useState<ToolItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingStatus, setLoadingStatus] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;

    // Handle Esc and Left Arrow for navigation
    useInput((input, key) => {
        if(!loading && (key.escape || key.leftArrow)) {
            onBack();
        }
    });

    // Load and discover tools on mount
    useEffect(() => {
        void (async () => {
            try {
                // Load backend server config
                setLoadingStatus('Loading backend server configuration...');
                const backendConfig = await loadBackendServersConfig();

                // Create client manager
                const serverConfigs = new Map(Object.entries(backendConfig.mcpServers));
                const serverCount = serverConfigs.size;
                const clientManager = new ClientManager(serverConfigs);

                // Connect to all servers
                setLoadingStatus(`Connecting to ${serverCount} backend server(s)...`);
                await clientManager.connectAll();

                // Discover tools
                setLoadingStatus('Discovering tools from backend servers...');
                const discoveryService = new DiscoveryService(clientManager);
                const toolsMap = await discoveryService.discoverAllTools();

                // Flatten into array of ToolItems
                setLoadingStatus('Processing tool list...');
                const allTools: ToolItem[] = [];
                for(const [serverName, serverTools] of toolsMap.entries()) {
                    for(const tool of serverTools) {
                        allTools.push({ serverName, tool });
                    }
                }

                setTools(allTools);
                setLoading(false);

                // Cleanup: disconnect from servers
                await clientManager.disconnectAll();
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, []);

    const handleToolSelect = (item: { value: string }) => {
        if(item.value === 'back') {
            onBack();
        } else {
            const index = parseInt(item.value, 10);
            const toolItem = tools[index];

            if(toolItem && onSelect) {
                // Create tool override
                const toolOverride: ToolOverride = {
                    serverName:   toolItem.serverName,
                    originalName: toolItem.tool.name,
                    // Don't set overrides initially - user can edit later
                };
                onSelect(toolOverride);
            }
        }
    };

    // Show loading state
    if(loading) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Browse Backend Tools
                </Text>
                <Box marginTop={1}>
                    <Text>{loadingStatus || 'Initializing...'}</Text>
                </Box>
            </Box>
        );
    }

    // Show error state
    if(error) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="red">
                    Error Discovering Tools
                </Text>
                <Box marginTop={1}>
                    <Text color="red">
                        {error}
                    </Text>
                </Box>
                <Box marginTop={1} flexDirection="column">
                    <Text bold>Troubleshooting:</Text>
                    <Text>• Check that backend servers are properly configured</Text>
                    <Text>• Verify backend server commands are valid and accessible</Text>
                    <Text>• Ensure backend servers support the MCP protocol</Text>
                    <Text>• Check network connectivity (for HTTP/SSE servers)</Text>
                    <Text>• Review error message above for specific details</Text>
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>Press Esc to return</Text>
                </Box>
            </Box>
        );
    }

    // Custom item component for colored rendering
    // Parse label format: "toolName (serverName) - description"
    const ToolItemComponent = ({ isSelected: _isSelected, label }: { isSelected?: boolean, label: string }) => {
        // Parse the structured label
        const match = /^(.+?) \((.+?)\) - (.+)$/.exec(label);
        if(match) {
            const [, toolName, serverName, description] = match;
            return (
                <Text>
                    <Text bold color="cyan">{toolName}</Text>
                    <Text dimColor color="yellow">
{' '}
(
{serverName}
)
                    </Text>
                    <Text>
{' '}
-
{description}
                    </Text>
                </Text>
            );
        }
        // Fallback for special items like separator and back
        return <Text>{label}</Text>;
    };
    // Build menu items with enhanced formatting and dynamic truncation
    // Build menu items with enhanced formatting and dynamic truncation
    const menuItems: { label: string, value: string, disabled?: boolean }[] = map(tools, (toolItem, index) => {
        // Clean description: remove newlines, collapse spaces
        const cleanDesc = trim(replace(replace(toolItem.tool.description ?? '', /[\r\n]+/g, ' '), /\s+/g, ' '));

        // Calculate available space for description
        const toolNameLength = toolItem.tool.name.length;
        const serverNameLength = toolItem.serverName.length;
        // Reserve space for: " (" + ") - " + "..." + indicator = ~15 chars buffer
        const reservedSpace = toolNameLength + serverNameLength + 15;
        const maxDescLength = Math.max(30, terminalWidth - reservedSpace);

        const truncatedDesc = cleanDesc
            ? cleanDesc.slice(0, maxDescLength) + (cleanDesc.length > maxDescLength ? '...' : '')
            : 'No description';

        return {
            label: `${toolItem.tool.name} (${toolItem.serverName}) - ${truncatedDesc}`,
            value: String(index),
        };
    });

    menuItems.push(
        {
            label:    repeat('\u2500', Math.min(40, terminalWidth - 5)),
            value:    'sep1',
            disabled: true,
        },
        {
            label: '\u2190 Back',
            value: 'back',
        }
    );

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Browse Backend Tools
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text dimColor>
                    {tools.length === 0
                        ? 'No tools found from backend servers'
                        : `Found ${tools.length} tools. Select a tool to add to the group:`}
                </Text>
            </Box>
            <SelectInput items={menuItems} onSelect={handleToolSelect} itemComponent={ToolItemComponent} limit={15} />
        </Box>
    );
}
