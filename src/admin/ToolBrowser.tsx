/**
 * Tool Browser Component - Browse backend tools and select for adding to groups
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
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
    const [error, setError] = useState<string | null>(null);

    // Load and discover tools on mount
    useEffect(() => {
        void (async () => {
            try {
                // Load backend server config
                const backendConfig = await loadBackendServersConfig();

                // Create client manager
                const serverConfigs = new Map(Object.entries(backendConfig.mcpServers));
                const clientManager = new ClientManager(serverConfigs);

                // Connect to all servers
                await clientManager.connectAll();

                // Discover tools
                const discoveryService = new DiscoveryService(clientManager);
                const toolsMap = await discoveryService.discoverAllTools();

                // Flatten into array of ToolItems
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
                    <Text>Connecting to backend servers and discovering tools...</Text>
                </Box>
            </Box>
        );
    }

    // Show error state
    if(error) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Browse Backend Tools
                </Text>
                <Box marginTop={1}>
                    <Text color="red">
                        Error:
                        {error}
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>Press Ctrl+C to go back</Text>
                </Box>
            </Box>
        );
    }

    // Build menu items
    const menuItems = map(tools, (toolItem, index) => {
        // Clean and truncate description: remove newlines, collapse spaces, then truncate
        const cleanDesc = trim(replace(replace(toolItem.tool.description ?? '', /[\r\n]+/g, ' '), /\s+/g, ' '));
        const description = cleanDesc
            ? cleanDesc.slice(0, 40) + (cleanDesc.length > 40 ? '...' : '')
            : 'No description';
        return {
            label: `${toolItem.tool.name} (${toolItem.serverName}) - ${description}`,
            value: String(index),
        };
    });

    menuItems.push(
        { label: repeat('─', 40), value: 'separator' },
        { label: '← Back', value: 'back' }
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
            <SelectInput items={menuItems} onSelect={handleToolSelect} limit={15} />
        </Box>
    );
}
