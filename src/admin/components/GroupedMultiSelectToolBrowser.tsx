/**
 * Grouped Multi-Select Tool Browser Component
 * Browse backend tools organized by server with fuzzy search and multi-select
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { isError, sortBy, groupBy, keys, map, split, trim, replace, chain } from 'lodash';
// eslint-disable-next-line n/no-missing-import -- fuse.js is a valid package
import Fuse from 'fuse.js';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ToolOverride } from '../../types/config.js';
import { loadBackendServersConfig } from '../config-utils.js';
import { ClientManager } from '../../backend/client-manager.js';
import { DiscoveryService } from '../../backend/discovery.js';

interface GroupedMultiSelectToolBrowserProps {
    onBack:         () => void
    onSubmit:       (tools: ToolOverride[]) => void
    existingTools?: ToolOverride[] // Pre-selected tools
}

interface ToolItem {
    serverName: string
    tool:       Tool
}

interface NavigationItem {
    type:        'server' | 'tool'
    serverName:  string
    tool?:       Tool
    isExpanded?: boolean
}

/**
 * Browse backend tools with grouping, search, and multi-select
 */
export function GroupedMultiSelectToolBrowser({
    onBack,
    onSubmit,
    existingTools = [],
}: GroupedMultiSelectToolBrowserProps) {
    const [tools, setTools] = useState<ToolItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingStatus, setLoadingStatus] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;
    const terminalHeight = stdout?.rows ?? 24;

    // Search and navigation state
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
    const [selectedTools, setSelectedTools] = useState<Map<string, boolean>>(new Map());
    const [navigationIndex, setNavigationIndex] = useState(0);
    const [viewportStart, setViewportStart] = useState(0);

    // Initialize selection state from existing tools
    useEffect(() => {
        const initialSelection = new Map<string, boolean>();
        for(const existingTool of existingTools) {
            const key = `${existingTool.serverName}:${existingTool.originalName}`;
            initialSelection.set(key, true);
        }
        setSelectedTools(initialSelection);
    }, [existingTools]);

    // Load and discover tools on mount
    useEffect(() => {
        void (async () => {
            try {
                setLoadingStatus('Loading backend server configuration...');
                const backendConfig = await loadBackendServersConfig();

                const serverConfigs = new Map(Object.entries(backendConfig.mcpServers));
                const serverCount = serverConfigs.size;
                const clientManager = new ClientManager(serverConfigs);

                setLoadingStatus(`Connecting to ${serverCount} backend server(s)...`);
                await clientManager.connectAll();

                setLoadingStatus('Discovering tools from backend servers...');
                const discoveryService = new DiscoveryService(clientManager);
                const toolsMap = await discoveryService.discoverAllTools();

                setLoadingStatus('Processing tool list...');
                const allTools: ToolItem[] = [];
                for(const [serverName, serverTools] of toolsMap.entries()) {
                    for(const tool of serverTools) {
                        allTools.push({ serverName, tool });
                    }
                }

                setTools(allTools);
                setLoading(false);

                // Auto-expand all servers initially
                setExpandedServers(new Set(toolsMap.keys()));

                await clientManager.disconnectAll();
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, []);

    // Fuzzy search
    const fuse = useMemo(() => new Fuse(tools, {
        keys:           ['tool.name', 'tool.description', 'serverName'],
        threshold:      0.4,
        ignoreLocation: true,
    }), [tools]);

    const filteredTools = useMemo(() => {
        if(!trim(searchQuery)) {
            return tools;
        }
        return map(fuse.search(searchQuery), 'item');
    }, [searchQuery, fuse, tools]);

    const filteredGroupedTools = useMemo(() => {
        const grouped = groupBy(filteredTools, 'serverName');
        return chain(grouped)
            .keys()
            .sortBy()
            .reduce((result, serverName) => {
                result[serverName] = sortBy(grouped[serverName], 'tool.name');
                return result;
            }, {} as Record<string, ToolItem[]>)
            .value();
    }, [filteredTools]);

    // Build navigation list (flattened for keyboard navigation)
    const navigationList = useMemo(() => {
        const items: NavigationItem[] = [];
        const servers = keys(filteredGroupedTools);

        for(const serverName of servers) {
            const serverTools = filteredGroupedTools[serverName];
            const isExpanded = expandedServers.has(serverName);

            items.push({
                type: 'server',
                serverName,
                isExpanded,
            });

            if(isExpanded) {
                for(const toolItem of serverTools) {
                    items.push({
                        type:       'tool',
                        serverName: toolItem.serverName,
                        tool:       toolItem.tool,
                    });
                }
            }
        }

        return items;
    }, [filteredGroupedTools, expandedServers]);

    // Calculate virtual scrolling viewport
    const fixedUIHeight = 11; // 5 lines top (padding + header + margin + search + margin) + 6 lines bottom (margin + footer + margin + controls(2) + padding)
    const availableHeight = Math.max(5, terminalHeight - fixedUIHeight);

    const viewportWindow = useMemo(() => {
        if(navigationList.length === 0) {
            return { start: 0, end: 0 };
        }

        const maxVisibleItems = Math.max(3, availableHeight - 2); // -2 for indicator lines
        let start = viewportStart;
        let end = Math.min(start + maxVisibleItems, navigationList.length);

        // Ensure navigationIndex is always within viewport
        if(navigationIndex < start) {
            // Cursor scrolled above viewport - adjust up
            start = navigationIndex;
            end = Math.min(start + maxVisibleItems, navigationList.length);
        }

        if(navigationIndex >= end) {
            // Cursor scrolled below viewport - adjust down
            end = navigationIndex + 1;
            start = Math.max(0, end - maxVisibleItems);
        }

        return { start, end };
    }, [navigationIndex, viewportStart, availableHeight, navigationList.length]);

    // Update viewport scroll position when window bounds change
    useEffect(() => {
        if(viewportWindow.start !== viewportStart) {
            setViewportStart(viewportWindow.start);
        }
    }, [viewportWindow.start, viewportStart]);

    const visibleNavigationList = useMemo(() => {
        return navigationList.slice(viewportWindow.start, viewportWindow.end);
    }, [navigationList, viewportWindow]);

    // Calculate totals
    const totalTools = filteredTools.length;
    const totalSelected = useMemo(() => {
        let count = 0;
        for(const isSelected of selectedTools.values()) {
            if(isSelected) {
                count++;
            }
        }
        return count;
    }, [selectedTools]);

    // Count selected tools per server
    const getServerSelectedCount = (serverName: string) => {
        let count = 0;
        const serverTools = filteredGroupedTools[serverName] ?? [];
        for(const toolItem of serverTools) {
            const key = `${serverName}:${toolItem.tool.name}`;
            if(selectedTools.get(key)) {
                count++;
            }
        }
        return count;
    };

    /**
     * Handle keyboard input with functional setState for rapid input support
     */

    function handleKeyboardInput(input: string, key: { upArrow?: boolean, downArrow?: boolean, 'return'?: boolean, leftArrow?: boolean, rightArrow?: boolean, ctrl?: boolean, escape?: boolean, tab?: boolean, backspace?: boolean, 'delete'?: boolean, meta?: boolean }) {
        if(loading) {
            return;
        }

        // Navigation - extracted to reduce complexity
        if(key.upArrow || key.downArrow) {
            handleVerticalNavigation(key.upArrow, key.downArrow);
            return;
        }

        if(key.return) {
            handleEnterKey();
            return;
        }

        if(key.leftArrow || key.rightArrow) {
            handleHorizontalNavigation(key.leftArrow);
            return;
        }

        if(key.ctrl) {
            handleCtrlKey(input);
            return;
        }

        if(key.escape) {
            handleEscape();
            return;
        }

        if(key.tab) {
            handleSubmit();
            return;
        }

        if(key.backspace || key.delete) {
            setSearchQuery(prev => prev.slice(0, -1));
            setNavigationIndex(0);
            setViewportStart(0);
            return;
        }

        if(input && !key.meta) {
            setSearchQuery(prev => prev + input);
            setNavigationIndex(0);
            setViewportStart(0);
        }
    }

    function handleVerticalNavigation(isUp?: boolean, isDown?: boolean) {
        if(isUp) {
            setNavigationIndex(prevIndex => Math.max(0, prevIndex - 1));
        } else if(isDown) {
            setNavigationIndex(prevIndex => Math.min(navigationList.length - 1, prevIndex + 1));
        }
    }

    function handleHorizontalNavigation(isLeft?: boolean) {
        const currentItem = navigationList[navigationIndex];
        if(currentItem?.type === 'server') {
            setExpandedServers((prev) => {
                const newSet = new Set(prev);
                if(isLeft) {
                    newSet.delete(currentItem.serverName);
                } else {
                    newSet.add(currentItem.serverName);
                }
                return newSet;
            });
        }
    }

    function handleCtrlKey(input: string) {
        if(input === 'a') {
            handleSelectAll();
        } else if(input === 'd') {
            setSelectedTools(new Map());
        }
    }

    function handleEnterKey() {
        const currentItem = navigationList[navigationIndex];
        if(!currentItem) {
            return;
        }

        if(currentItem.type === 'server') {
            setExpandedServers((prev) => {
                const newSet = new Set(prev);
                if(newSet.has(currentItem.serverName)) {
                    newSet.delete(currentItem.serverName);
                } else {
                    newSet.add(currentItem.serverName);
                }
                return newSet;
            });
        } else if(currentItem.type === 'tool' && currentItem.tool) {
            const key = `${currentItem.serverName}:${currentItem.tool.name}`;
            setSelectedTools((prev) => {
                const newMap = new Map(prev);
                newMap.set(key, !newMap.get(key));
                return newMap;
            });
        }
    }

    function handleSelectAll() {
        setSelectedTools((prev) => {
            const newMap = new Map(prev);
            for(const toolItem of filteredTools) {
                const key = `${toolItem.serverName}:${toolItem.tool.name}`;
                newMap.set(key, true);
            }
            return newMap;
        });
    }

    function handleEscape() {
        if(searchQuery) {
            setSearchQuery('');
            setNavigationIndex(0);
            setViewportStart(0);
        } else {
            onBack();
        }
    }

    function handleSubmit() {
        const toolOverrides: ToolOverride[] = [];
        for(const [key, isSelected] of selectedTools.entries()) {
            if(isSelected) {
                const [serverName, toolName] = split(key, ':');
                toolOverrides.push({
                    serverName,
                    originalName: toolName,
                });
            }
        }
        onSubmit(toolOverrides);
    }

    // IMPORTANT: Use functional setState for rapid input support
    // Extract handler to reduce complexity
    useInput(handleKeyboardInput);

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

    // Render main UI
    return (
        <Box flexDirection="column" padding={1}>
            {/* Header with totals */}
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Browse Backend Tools (
                    {totalTools}
                    {' '}
                    total tools,
                    {' '}
                    {totalSelected}
                    {' '}
                    selected)
                </Text>
            </Box>

            {/* Search field */}
            <Box marginBottom={1}>
                <Text>Search: </Text>
                <Text color="yellow">{searchQuery}</Text>
                <Text dimColor>_</Text>
            </Box>

            {/* Tool list with virtual scrolling */}
            <Box flexDirection="column" marginBottom={1}>
                {navigationList.length === 0
                    ? (
                        <Text dimColor>
                            No tools found matching &quot;
                            {searchQuery}
                            &quot;
                        </Text>
                    )
                    : (
                        <>
                            {viewportWindow.start > 0 && (
                                <Text dimColor>{`... (${viewportWindow.start} more above)`}</Text>
                            )}

                            {map(visibleNavigationList, (item, visibleIndex) => {
                                const index = viewportWindow.start + visibleIndex;
                                const isHighlighted = index === navigationIndex;

                                if(item.type === 'server') {
                                    const serverTools = filteredGroupedTools[item.serverName] ?? [];
                                    const selectedCount = getServerSelectedCount(item.serverName);
                                    const expandSymbol = item.isExpanded
                                        ? '▼'
                                        : '▶';
                                    const indicator = isHighlighted
                                        ? '❯'
                                        : ' ';

                                    return (
                                        <Box key={`server-${item.serverName}`}>
                                            <Text color={isHighlighted ? 'cyan' : undefined} bold>
                                                {indicator}
                                                {' '}
                                                {expandSymbol}
                                                {' '}
                                                {item.serverName}
                                                {' '}
                                                (
                                                {serverTools.length}
                                                {' '}
                                                tools,
                                                {' '}
                                                {selectedCount}
                                                {' '}
                                                selected)
                                            </Text>
                                        </Box>
                                    );
                                } else if(item.type === 'tool' && item.tool) {
                                    const key = `${item.serverName}:${item.tool.name}`;
                                    const isSelected = selectedTools.get(key) ?? false;
                                    const checkbox = isSelected
                                        ? '[x]'
                                        : '[ ]';
                                    const indicator = isHighlighted
                                        ? '❯'
                                        : ' ';

                                    // Truncate description to fit terminal
                                    const descText = item.tool.description ?? 'No description';
                                    const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
                                    const maxDescLength = Math.max(30, terminalWidth - item.tool.name.length - 20);
                                    const truncatedDesc = cleanDesc.length > maxDescLength
                                        ? `${cleanDesc.slice(0, maxDescLength)}...`
                                        : cleanDesc;

                                    return (
                                        <Box key={`tool-${key}`}>
                                            <Text color={isHighlighted ? 'cyan' : undefined}>
                                                {indicator}
                                                {' '}
                                                {checkbox}
                                                {' '}
                                                {item.tool.name}
                                                {' '}
                                                -
                                                {' '}
                                                {truncatedDesc}
                                            </Text>
                                        </Box>
                                    );
                                }

                                return null;
                            })}
                            {viewportWindow.end < navigationList.length && (
                                <Text dimColor>{`... (${navigationList.length - viewportWindow.end} more below)`}</Text>
                            )}

                        </>
                    )}
            </Box>

            {/* Footer with totals */}
            <Box marginBottom={1}>
                <Text dimColor>
                    {totalTools}
                    {' '}
                    total tools,
                    {totalSelected}
                    {' '}
                    selected
                </Text>
            </Box>

            {/* Controls help */}
            <Box flexDirection="column">
                <Text dimColor>
                    Controls: ↑/↓ Navigate | Enter Select/Deselect | ←/→ Collapse/Expand | Type to Search
                </Text>
                <Text dimColor>
                    Ctrl+A Select All | Ctrl+D Deselect All | Tab Submit | Esc Cancel
                </Text>
            </Box>
        </Box>
    );
}
