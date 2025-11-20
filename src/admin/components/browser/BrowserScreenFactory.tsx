/**
 * Browser Screen Factory
 * Creates standardized browser screen components for Resources, Prompts, and Tools
 * Eliminates duplication by centralizing common patterns for search, navigation, and selection
 */

import React, { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { isError, map, keys, trim, find, toUpper } from 'lodash';
// eslint-disable-next-line n/no-missing-import -- fuse.js is a valid package
import Fuse from 'fuse.js';
import { ScreenHeader } from '../ui/ScreenHeader.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { ErrorScreen } from '../ui/ErrorScreen.js';
import {
    serializeSelectionKey,
    parseSelectionKey,
    countSelected,
    groupAndSortByServer
} from './shared-utilities.js';

/**
 * Configuration for creating a browser screen component
 */
export interface BrowserConfig<TItem, TRef> {
    /** Function to discover/fetch items from backend servers */
    fetchItems: () => Promise<Map<string, TItem[]>>

    /** Title generator function - receives counts for display */
    title: (counts: { total: number, selected: number }) => string

    /** Plural label for items (e.g., "resources", "prompts", "tools") */
    pluralLabel: string

    /** Empty state message generator - receives search query */
    emptyMessage: (searchQuery: string) => string

    /** Fuse.js search field paths (e.g., ['resource.uri', 'resource.name']) */
    searchFields: string[]

    /** Extract unique identifier from item (for selection keys) */
    getItemKey: (item: TItem) => string

    /** Extract server name from item */
    getServerName: (item: TItem) => string

    /** Convert item to reference format for submission */
    toRef: (serverName: string, item: TItem) => TRef

    /** Parse existing reference to extract server name and item key */
    parseRef: (ref: TRef) => { serverName: string, key: string }

    /** Render a single item row */
    renderItem: (context: {
        item:          TItem
        serverName:    string
        isSelected:    boolean
        isHighlighted: boolean
        terminalWidth: number
    }) => ReactNode
}

/**
 * Props for browser screen components
 */
interface BrowserScreenProps<TRef> {
    onBack:        () => void
    onSubmit:      (refs: TRef[]) => void
    existingRefs?: TRef[]
}

/**
 * Navigation item - represents either a server header or an item in the list
 */
interface NavigationItem<TItem> {
    type:        'server' | 'item'
    serverName:  string
    item?:       TItem
    isExpanded?: boolean
}

/**
 * Creates a browser screen component with standardized search, navigation, and selection
 *
 * @param config - Configuration object defining behavior and rendering
 * @returns React component that implements the browser screen
 *
 * @example
 * const ResourceBrowser = createBrowserScreen<ResourceItem, ResourceRef>({
 *   fetchItems: discoverAllResources,
 *   title: ({ total, selected }) => `Browse Resources (${total} total, ${selected} selected)`,
 *   pluralLabel: 'resources',
 *   emptyMessage: (query) => `No resources found matching "${query}"`,
 *   searchFields: ['resource.uri', 'resource.name'],
 *   getItemKey: (item) => item.resource.uri,
 *   getServerName: (item) => item.serverName,
 *   toRef: (serverName, item) => ({ serverName, uri: item.resource.uri }),
 *   parseRef: (ref) => ({ serverName: ref.serverName, key: ref.uri }),
 *   renderItem: ({ item, isSelected, isHighlighted }) => <ResourceRow {...} />
 * });
 */
export function createBrowserScreen<TItem, TRef>(
    config: BrowserConfig<TItem, TRef>
): React.FC<BrowserScreenProps<TRef>> {
    return function BrowserScreen({
        onBack,
        onSubmit,
        existingRefs = [],
    }: BrowserScreenProps<TRef>) {
        // State
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [items, setItems] = useState<TItem[]>([]);
        const [searchQuery, setSearchQuery] = useState('');
        const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
        const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
        const [navigationIndex, setNavigationIndex] = useState(0);
        const [viewportStart, setViewportStart] = useState(0);

        const { stdout } = useStdout();
        const terminalWidth = stdout?.columns ?? 80;
        const terminalHeight = stdout?.rows ?? 24;

        // Initialize selection from existing refs
        useEffect(() => {
            const initialSelection = new Map<string, boolean>();
            for(const ref of existingRefs) {
                const { serverName, key } = config.parseRef(ref);
                const selKey = serializeSelectionKey(serverName, key);
                initialSelection.set(selKey, true);
            }
            setSelection(initialSelection);
        }, [existingRefs]);

        // Discover items on mount
        useEffect(() => {
            void (async () => {
                try {
                    setLoading(true);
                    const discovered = await config.fetchItems();

                    // Flatten to array of items
                    const allItems: TItem[] = [];
                    for(const serverItems of discovered.values()) {
                        allItems.push(...serverItems);
                    }
                    setItems(allItems);

                    // Auto-expand all servers
                    setExpandedServers(new Set(discovered.keys()));

                    setError(null);
                } catch (err) {
                    setError(isError(err) ? err.message : String(err));
                } finally {
                    setLoading(false);
                }
            })();
        }, []);

        // Fuzzy search
        const fuse = useMemo(() => {
            if(items.length === 0) {
                return null;
            }
            return new Fuse(items, {
                keys:           config.searchFields,
                threshold:      0.4,
                ignoreLocation: true,
            });
        }, [items]);

        const filteredItems = useMemo(() => {
            if(!trim(searchQuery) || !fuse) {
                return items;
            }
            return map(fuse.search(searchQuery), 'item');
        }, [items, searchQuery, fuse]);

        // Group and sort items by server
        const groupedItems = useMemo(() => {
            return groupAndSortByServer(
                filteredItems,
                config.getServerName,
                config.getItemKey
            );
        }, [filteredItems]);

        // Build navigation list (flattened for keyboard navigation)
        const navigationList = useMemo(() => {
            const navItems: NavigationItem<TItem>[] = [];
            const servers = keys(groupedItems);

            for(const serverName of servers) {
                const serverItems = groupedItems[serverName] ?? [];
                const isExpanded = expandedServers.has(serverName);

                navItems.push({
                    type: 'server',
                    serverName,
                    isExpanded,
                });

                if(isExpanded) {
                    for(const item of serverItems) {
                        navItems.push({
                            type: 'item',
                            serverName,
                            item,
                        });
                    }
                }
            }

            return navItems;
        }, [groupedItems, expandedServers]);

        // Virtual scrolling viewport calculation
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
        const totalItems = filteredItems.length;
        const totalSelected = useMemo(() => countSelected(selection), [selection]);

        // Count selected items per server
        const getServerSelectedCount = (serverName: string) => {
            let count = 0;
            const serverItems = groupedItems[serverName] ?? [];
            for(const item of serverItems) {
                const key = serializeSelectionKey(serverName, config.getItemKey(item));
                if(selection.get(key)) {
                    count++;
                }
            }
            return count;
        };

        // Keyboard handlers
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
            } else if(currentItem.type === 'item' && currentItem.item) {
                const key = serializeSelectionKey(
                    currentItem.serverName,
                    config.getItemKey(currentItem.item)
                );
                setSelection((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(key, !newMap.get(key));
                    return newMap;
                });
            }
        }

        function handleSelectAll() {
            setSelection((prev) => {
                const newMap = new Map(prev);
                for(const item of filteredItems) {
                    const key = serializeSelectionKey(
                        config.getServerName(item),
                        config.getItemKey(item)
                    );
                    newMap.set(key, true);
                }
                return newMap;
            });
        }

        function handleDeselectAll() {
            setSelection(new Map());
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
            const refs: TRef[] = [];
            for(const [key, isSelected] of selection.entries()) {
                if(!isSelected) {
                    continue;
                }

                const { serverName, id } = parseSelectionKey(key);
                const item = find(items, i =>
                    config.getServerName(i) === serverName
                    && config.getItemKey(i) === id
                );

                if(item) {
                    refs.push(config.toRef(serverName, item));
                }
            }
            onSubmit(refs);
        }

        function handleCtrlKey(input: string) {
            if(input === 'a') {
                handleSelectAll();
            } else if(input === 'd') {
                handleDeselectAll();
            }
        }

        /**
         * Main keyboard input handler
         * IMPORTANT: Uses functional setState for rapid input support
         */
        function handleKeyboardInput(
            input: string,
            key: {
                upArrow?:    boolean
                downArrow?:  boolean
                'return'?:   boolean
                leftArrow?:  boolean
                rightArrow?: boolean
                ctrl?:       boolean
                escape?:     boolean
                tab?:        boolean
                backspace?:  boolean
                'delete'?:   boolean
                meta?:       boolean
            }
        ) {
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

        useInput(handleKeyboardInput);

        // Loading state
        if(loading) {
            const capitalizedLabel = `${toUpper(config.pluralLabel.charAt(0))}${config.pluralLabel.slice(1)}`;
            return (
                <LoadingScreen
                  title={`Browse Backend ${capitalizedLabel}`}
                  message={`Discovering ${config.pluralLabel} from backend servers...`}
                />
            );
        }

        // Error state
        if(error) {
            const capitalizedLabel = `${toUpper(config.pluralLabel.charAt(0))}${config.pluralLabel.slice(1)}`;
            return (
                <ErrorScreen
                  title={`Error Discovering ${capitalizedLabel}`}
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

        // Main UI
        const title = config.title({ total: totalItems, selected: totalSelected });

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

                {/* Item list with virtual scrolling */}
                <Box flexDirection="column" marginBottom={1}>
                    {navigationList.length === 0
                        ? (
                            <Text>{config.emptyMessage(searchQuery)}</Text>
                        )
                        : (
                            <>
                                {viewportWindow.start > 0 && (
                                    <Text dimColor>{`... (${viewportWindow.start} more above)`}</Text>
                                )}

                                {map(visibleNavigationList, (navItem, visibleIndex) => {
                                    const index = viewportWindow.start + visibleIndex;
                                    const isHighlighted = index === navigationIndex;

                                    if(navItem.type === 'server') {
                                        const serverItems = groupedItems[navItem.serverName] ?? [];
                                        const selectedCount = getServerSelectedCount(navItem.serverName);
                                        const expandSymbol = navItem.isExpanded ? '▼' : '▶';
                                        const indicator = isHighlighted ? '❯' : ' ';

                                        return (
                                            <Box key={`server-${navItem.serverName}`}>
                                                <Text color={isHighlighted ? 'cyan' : undefined}>
                                                    {indicator}
                                                    {' '}
                                                    {expandSymbol}
                                                    {' '}
                                                    {navItem.serverName}
                                                    {' '}
                                                    (
                                                    {serverItems.length}
                                                    {' '}
                                                    {config.pluralLabel}
                                                    ,
                                                    {' '}
                                                    {selectedCount}
                                                    {' '}
                                                    selected)
                                                </Text>
                                            </Box>
                                        );
                                    } else if(navItem.type === 'item' && navItem.item) {
                                        const key = serializeSelectionKey(
                                            navItem.serverName,
                                            config.getItemKey(navItem.item)
                                        );
                                        const isSelected = selection.get(key) ?? false;

                                        return (
                                            <Box key={`item-${key}`}>
                                                {config.renderItem({
                                                    item:       navItem.item,
                                                    serverName: navItem.serverName,
                                                    isSelected,
                                                    isHighlighted,
                                                    terminalWidth,
                                                })}
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
                        {totalItems}
                        {' '}
                        total
                        {' '}
                        {config.pluralLabel}
                        ,
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
    };
}
