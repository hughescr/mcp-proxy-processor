/**
 * Resource Browser Screen Component
 * Browse backend resources organized by server with fuzzy search and multi-select
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { isError, sortBy, groupBy, keys, map, split, trim, replace, chain } from 'lodash';
// eslint-disable-next-line n/no-missing-import -- fuse.js is a valid package
import Fuse from 'fuse.js';
import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import type { ResourceRef } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { ScreenHeader } from './ui/ScreenHeader.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { ErrorScreen } from './ui/ErrorScreen.js';

interface ResourceBrowserScreenProps {
    onBack:             () => void
    onSubmit:           (resources: ResourceRef[]) => void
    existingResources?: ResourceRef[] // Pre-selected resources
}

interface ResourceItem {
    serverName: string
    resource:   Resource
}

interface NavigationItem {
    type:        'server' | 'resource'
    serverName:  string
    resource?:   Resource
    isExpanded?: boolean
}

/**
 * Browse backend resources with grouping, search, and multi-select
 */
export function ResourceBrowserScreen({
    onBack,
    onSubmit,
    existingResources = [],
}: ResourceBrowserScreenProps) {
    const [resources, setResources] = useState<ResourceItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { discoverAllResources } = useBackend();
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;
    const terminalHeight = stdout?.rows ?? 24;

    // Search and navigation state
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
    const [selectedResources, setSelectedResources] = useState<Map<string, boolean>>(new Map());
    const [navigationIndex, setNavigationIndex] = useState(0);
    const [viewportStart, setViewportStart] = useState(0);

    // Initialize selection state from existing resources
    useEffect(() => {
        const initialSelection = new Map<string, boolean>();
        for(const existingResource of existingResources) {
            const key = `${existingResource.serverName}:${existingResource.uri}`;
            initialSelection.set(key, true);
        }
        setSelectedResources(initialSelection);
    }, [existingResources]);

    // Load and discover resources on mount
    useEffect(() => {
        void (async () => {
            try {
                // Discover resources using shared backend connection
                const resourcesMap = await discoverAllResources();

                // Flatten into array of ResourceItems
                const allResources: ResourceItem[] = [];
                for(const [serverName, serverResources] of resourcesMap.entries()) {
                    for(const resource of serverResources) {
                        allResources.push({ serverName, resource });
                    }
                }

                setResources(allResources);
                setLoading(false);

                // Auto-expand all servers initially
                setExpandedServers(new Set(resourcesMap.keys()));
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, [discoverAllResources]);

    // Fuzzy search
    const fuse = useMemo(() => new Fuse(resources, {
        keys:           ['resource.uri', 'resource.name', 'resource.description', 'serverName'],
        threshold:      0.4,
        ignoreLocation: true,
    }), [resources]);

    const filteredResources = useMemo(() => {
        if(!trim(searchQuery)) {
            return resources;
        }
        return map(fuse.search(searchQuery), 'item');
    }, [searchQuery, fuse, resources]);

    const filteredGroupedResources = useMemo(() => {
        const grouped = groupBy(filteredResources, 'serverName');
        return chain(grouped)
            .keys()
            .sortBy()
            .reduce((result, serverName) => {
                result[serverName] = sortBy(grouped[serverName], 'resource.uri');
                return result;
            }, {} as Record<string, ResourceItem[]>)
            .value();
    }, [filteredResources]);

    // Build navigation list (flattened for keyboard navigation)
    const navigationList = useMemo(() => {
        const items: NavigationItem[] = [];
        const servers = keys(filteredGroupedResources);

        for(const serverName of servers) {
            const serverResources = filteredGroupedResources[serverName];
            const isExpanded = expandedServers.has(serverName);

            items.push({
                type: 'server',
                serverName,
                isExpanded,
            });

            if(isExpanded) {
                for(const resourceItem of serverResources) {
                    items.push({
                        type:       'resource',
                        serverName: resourceItem.serverName,
                        resource:   resourceItem.resource,
                    });
                }
            }
        }

        return items;
    }, [filteredGroupedResources, expandedServers]);

    // Calculate virtual scrolling viewport
    const fixedUIHeight = 11; // 5 lines top + 6 lines bottom
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
            start = navigationIndex;
            end = Math.min(start + maxVisibleItems, navigationList.length);
        }

        if(navigationIndex >= end) {
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
    const totalResources = filteredResources.length;
    const totalSelected = useMemo(() => {
        let count = 0;
        for(const isSelected of selectedResources.values()) {
            if(isSelected) {
                count++;
            }
        }
        return count;
    }, [selectedResources]);

    // Count selected resources per server
    const getServerSelectedCount = (serverName: string) => {
        let count = 0;
        const serverResources = filteredGroupedResources[serverName] ?? [];
        for(const resourceItem of serverResources) {
            const key = `${serverName}:${resourceItem.resource.uri}`;
            if(selectedResources.get(key)) {
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

        // Navigation
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
            setSelectedResources(new Map());
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
        } else if(currentItem.type === 'resource' && currentItem.resource) {
            const key = `${currentItem.serverName}:${currentItem.resource.uri}`;
            setSelectedResources((prev) => {
                const newMap = new Map(prev);
                newMap.set(key, !newMap.get(key));
                return newMap;
            });
        }
    }

    function handleSelectAll() {
        setSelectedResources((prev) => {
            const newMap = new Map(prev);
            for(const resourceItem of filteredResources) {
                const key = `${resourceItem.serverName}:${resourceItem.resource.uri}`;
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
        const resourceRefs: ResourceRef[] = [];
        for(const [key, isSelected] of selectedResources.entries()) {
            if(isSelected) {
                const [serverName, ...uriParts] = split(key, ':');
                const uri = uriParts.join(':'); // Handle URIs that contain colons
                resourceRefs.push({
                    serverName,
                    uri,
                });
            }
        }
        onSubmit(resourceRefs);
    }

    // IMPORTANT: Use functional setState for rapid input support
    useInput(handleKeyboardInput);

    // Show loading state
    if(loading) {
        return <LoadingScreen title="Browse Backend Resources" message="Discovering resources from backend servers..." />;
    }

    // Show error state
    if(error) {
        return (
            <ErrorScreen
              title="Error Discovering Resources"
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

    // Render main UI
    const title = `Browse Backend Resources (${totalResources} total resources, ${totalSelected} selected)`;

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header with totals */}
            <ScreenHeader title={title} />

            {/* Search field */}
            <Box marginBottom={1}>
                <Text>Search: </Text>
                <Text bold>{searchQuery}</Text>
                <Text>_</Text>
            </Box>

            {/* Resource list with virtual scrolling */}
            <Box flexDirection="column" marginBottom={1}>
                {navigationList.length === 0
                    ? (
                        <Text>
                            No resources found matching &quot;
                            {searchQuery}
                            &quot;
                        </Text>
                    )
                    : (
                        <>
                            {viewportWindow.start > 0 && (
                                <Text dimColor>{`... (${viewportWindow.start} more above)`}</Text>
                            )}

                            {/* eslint-disable-next-line complexity -- Complex rendering logic for server/resource navigation items */}
                            {map(visibleNavigationList, (item, visibleIndex) => {
                                const index = viewportWindow.start + visibleIndex;
                                const isHighlighted = index === navigationIndex;

                                if(item.type === 'server') {
                                    const serverResources = filteredGroupedResources[item.serverName] ?? [];
                                    const selectedCount = getServerSelectedCount(item.serverName);
                                    const expandSymbol = item.isExpanded ? '▼' : '▶';
                                    const indicator = isHighlighted ? '❯' : ' ';

                                    return (
                                        <Box key={`server-${item.serverName}`}>
                                            <Text color={isHighlighted ? 'cyan' : undefined}>
                                                {indicator}
                                                {' '}
                                                {expandSymbol}
                                                {' '}
                                                {item.serverName}
                                                {' '}
                                                (
                                                {serverResources.length}
                                                {' '}
                                                resources,
                                                {' '}
                                                {selectedCount}
                                                {' '}
                                                selected)
                                            </Text>
                                        </Box>
                                    );
                                } else if(item.type === 'resource' && item.resource) {
                                    const key = `${item.serverName}:${item.resource.uri}`;
                                    const isSelected = selectedResources.get(key) ?? false;
                                    const checkbox = isSelected ? '☑' : '☐';
                                    const indicator = isHighlighted ? '❯' : ' ';

                                    // Format URI (may be template with {variables})
                                    const uriDisplay = item.resource.uri;
                                    const hasTemplate = uriDisplay.includes('{');

                                    // Truncate description to fit terminal
                                    const descText = item.resource.description ?? item.resource.name ?? 'No description';
                                    const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
                                    const maxDescLength = Math.max(30, terminalWidth - uriDisplay.length - 20);
                                    const truncatedDesc = cleanDesc.length > maxDescLength
                                        ? `${cleanDesc.slice(0, maxDescLength)}...`
                                        : cleanDesc;

                                    return (
                                        <Box key={`resource-${key}`}>
                                            <Text color={isHighlighted ? 'cyan' : undefined}>
                                                {indicator}
                                                {' '}
                                                {checkbox}
                                                {' '}
                                                <Text bold>{uriDisplay}</Text>
                                                {hasTemplate && <Text color="yellow"> (template)</Text>}
                                                {' - '}
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
                <Text>
                    {totalResources}
                    {' '}
                    total resources,
                    {' '}
                    {totalSelected}
                    {' '}
                    selected
                </Text>
            </Box>

            {/* Controls help */}
            <Box flexDirection="column">
                <Text>
                    Controls: ↑/↓ Navigate | Enter Select/Deselect | ←/→ Collapse/Expand | Type to Search
                </Text>
                <Text>
                    Ctrl+A Select All | Ctrl+D Deselect All | Tab Submit | Esc Cancel
                </Text>
            </Box>
        </Box>
    );
}
