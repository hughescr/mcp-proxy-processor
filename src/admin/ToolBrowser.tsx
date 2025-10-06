/**
 * Tool Browser Component - Browse backend tools and select for adding to groups
 */

import React, { useState, useEffect } from 'react';
import { Box, useInput } from 'ink';
import { isError, map, replace, trim } from 'lodash';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ToolOverride } from '../types/config.js';
import { useBackend } from './BackendContext.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { ErrorScreen } from './components/ui/ErrorScreen.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { menuSeparator } from './design-system.js';

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
    const { discoverAllTools } = useBackend();

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
                // Discover tools using shared backend connection
                const toolsMap = await discoverAllTools();

                // Flatten into array of ToolItems
                const allTools: ToolItem[] = [];
                for(const [serverName, serverTools] of toolsMap.entries()) {
                    for(const tool of serverTools) {
                        allTools.push({ serverName, tool });
                    }
                }

                setTools(allTools);
                setLoading(false);
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, [discoverAllTools]);

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
        return <LoadingScreen title="Browse Backend Tools" message="Discovering tools from backend servers..." />;
    }

    // Show error state
    if(error) {
        return (
            <ErrorScreen
              title="Error Discovering Tools"
              message={error}
              troubleshooting={[
                  '• Check that backend servers are properly configured',
                  '• Verify backend server commands are valid and accessible',
                  '• Ensure backend servers support the MCP protocol',
                  '• Check network connectivity (for HTTP/SSE servers)',
                  '• Review error message above for specific details',
              ]}
              helpText="Press Esc to return"
            />
        );
    }

    // Build menu items
    const menuItems: { label: string, value: string, disabled?: boolean }[] = map(tools, (toolItem, index) => {
        // Clean description: remove newlines, collapse spaces
        const cleanDesc = trim(replace(replace(toolItem.tool.description ?? '', /[\r\n]+/g, ' '), /\s+/g, ' '));
        const truncatedDesc = cleanDesc.length > 80
            ? cleanDesc.slice(0, 80) + '...'
            : cleanDesc || 'No description';

        return {
            label: `${toolItem.tool.name} (${toolItem.serverName}) - ${truncatedDesc}`,
            value: String(index),
        };
    });

    menuItems.push(
        menuSeparator(),
        {
            label: '← Back',
            value: 'back',
        }
    );

    // Fixed UI height: padding(1) + header(1) + margin(1) + subtitle(1) + margin(1) + padding(1) = 6
    const fixedUIHeight = 6;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title="Browse Backend Tools"
              subtitle={tools.length === 0
                  ? 'No tools found from backend servers'
                  : `Found ${tools.length} tools. Select a tool to add to the group:`}
            />
            <VirtualScrollList
              items={menuItems}
              onSelect={handleToolSelect}
              fixedUIHeight={fixedUIHeight}
            />
        </Box>
    );
}
