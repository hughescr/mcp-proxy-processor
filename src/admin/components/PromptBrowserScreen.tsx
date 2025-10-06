/**
 * Prompt Browser Screen Component
 * Browse backend prompts organized by server with fuzzy search and multi-select
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { isError, sortBy, groupBy, keys, map, split, trim, replace, chain } from 'lodash';
// eslint-disable-next-line n/no-missing-import -- fuse.js is a valid package
import Fuse from 'fuse.js';
import type { Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { PromptRef } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { ScreenHeader } from './ui/ScreenHeader.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { ErrorScreen } from './ui/ErrorScreen.js';

interface PromptBrowserScreenProps {
    onBack:           () => void
    onSubmit:         (prompts: PromptRef[]) => void
    existingPrompts?: PromptRef[] // Pre-selected prompts
}

interface PromptItem {
    serverName: string
    prompt:     Prompt
}

interface NavigationItem {
    type:        'server' | 'prompt'
    serverName:  string
    prompt?:     Prompt
    isExpanded?: boolean
}

/**
 * Browse backend prompts with grouping, search, and multi-select
 */
export function PromptBrowserScreen({
    onBack,
    onSubmit,
    existingPrompts = [],
}: PromptBrowserScreenProps) {
    const [prompts, setPrompts] = useState<PromptItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { discoverAllPrompts } = useBackend();
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns ?? 80;
    const terminalHeight = stdout?.rows ?? 24;

    // Search and navigation state
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
    const [selectedPrompts, setSelectedPrompts] = useState<Map<string, boolean>>(new Map());
    const [navigationIndex, setNavigationIndex] = useState(0);
    const [viewportStart, setViewportStart] = useState(0);

    // Initialize selection state from existing prompts
    useEffect(() => {
        const initialSelection = new Map<string, boolean>();
        for(const existingPrompt of existingPrompts) {
            const key = `${existingPrompt.serverName}:${existingPrompt.name}`;
            initialSelection.set(key, true);
        }
        setSelectedPrompts(initialSelection);
    }, [existingPrompts]);

    // Load and discover prompts on mount
    useEffect(() => {
        void (async () => {
            try {
                // Discover prompts using shared backend connection
                const promptsMap = await discoverAllPrompts();

                // Flatten into array of PromptItems
                const allPrompts: PromptItem[] = [];
                for(const [serverName, serverPrompts] of promptsMap.entries()) {
                    for(const prompt of serverPrompts) {
                        allPrompts.push({ serverName, prompt });
                    }
                }

                setPrompts(allPrompts);
                setLoading(false);

                // Auto-expand all servers initially
                setExpandedServers(new Set(promptsMap.keys()));
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, [discoverAllPrompts]);

    // Fuzzy search
    const fuse = useMemo(() => new Fuse(prompts, {
        keys:           ['prompt.name', 'prompt.description', 'serverName'],
        threshold:      0.4,
        ignoreLocation: true,
    }), [prompts]);

    const filteredPrompts = useMemo(() => {
        if(!trim(searchQuery)) {
            return prompts;
        }
        return map(fuse.search(searchQuery), 'item');
    }, [searchQuery, fuse, prompts]);

    const filteredGroupedPrompts = useMemo(() => {
        const grouped = groupBy(filteredPrompts, 'serverName');
        return chain(grouped)
            .keys()
            .sortBy()
            .reduce((result, serverName) => {
                result[serverName] = sortBy(grouped[serverName], 'prompt.name');
                return result;
            }, {} as Record<string, PromptItem[]>)
            .value();
    }, [filteredPrompts]);

    // Build navigation list (flattened for keyboard navigation)
    const navigationList = useMemo(() => {
        const items: NavigationItem[] = [];
        const servers = keys(filteredGroupedPrompts);

        for(const serverName of servers) {
            const serverPrompts = filteredGroupedPrompts[serverName];
            const isExpanded = expandedServers.has(serverName);

            items.push({
                type: 'server',
                serverName,
                isExpanded,
            });

            if(isExpanded) {
                for(const promptItem of serverPrompts) {
                    items.push({
                        type:       'prompt',
                        serverName: promptItem.serverName,
                        prompt:     promptItem.prompt,
                    });
                }
            }
        }

        return items;
    }, [filteredGroupedPrompts, expandedServers]);

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
    const totalPrompts = filteredPrompts.length;
    const totalSelected = useMemo(() => {
        let count = 0;
        for(const isSelected of selectedPrompts.values()) {
            if(isSelected) {
                count++;
            }
        }
        return count;
    }, [selectedPrompts]);

    // Count selected prompts per server
    const getServerSelectedCount = (serverName: string) => {
        let count = 0;
        const serverPrompts = filteredGroupedPrompts[serverName] ?? [];
        for(const promptItem of serverPrompts) {
            const key = `${serverName}:${promptItem.prompt.name}`;
            if(selectedPrompts.get(key)) {
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
            setSelectedPrompts(new Map());
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
        } else if(currentItem.type === 'prompt' && currentItem.prompt) {
            const key = `${currentItem.serverName}:${currentItem.prompt.name}`;
            setSelectedPrompts((prev) => {
                const newMap = new Map(prev);
                newMap.set(key, !newMap.get(key));
                return newMap;
            });
        }
    }

    function handleSelectAll() {
        setSelectedPrompts((prev) => {
            const newMap = new Map(prev);
            for(const promptItem of filteredPrompts) {
                const key = `${promptItem.serverName}:${promptItem.prompt.name}`;
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
        const promptRefs: PromptRef[] = [];
        for(const [key, isSelected] of selectedPrompts.entries()) {
            if(isSelected) {
                const [serverName, ...nameParts] = split(key, ':');
                const name = nameParts.join(':'); // Handle names that contain colons
                promptRefs.push({
                    serverName,
                    name,
                });
            }
        }
        onSubmit(promptRefs);
    }

    // IMPORTANT: Use functional setState for rapid input support
    useInput(handleKeyboardInput);

    // Show loading state
    if(loading) {
        return <LoadingScreen title="Browse Backend Prompts" message="Discovering prompts from backend servers..." />;
    }

    // Show error state
    if(error) {
        return (
            <ErrorScreen
              title="Error Discovering Prompts"
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
    const title = `Browse Backend Prompts (${totalPrompts} total prompts, ${totalSelected} selected)`;

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

            {/* Prompt list with virtual scrolling */}
            <Box flexDirection="column" marginBottom={1}>
                {navigationList.length === 0
                    ? (
                        <Text>
                            No prompts found matching &quot;
                            {searchQuery}
                            &quot;
                        </Text>
                    )
                    : (
                        <>
                            {viewportWindow.start > 0 && (
                                <Text dimColor>{`... (${viewportWindow.start} more above)`}</Text>
                            )}

                            {/* eslint-disable-next-line complexity -- Complex rendering logic for server/prompt navigation items */}
                            {map(visibleNavigationList, (item, visibleIndex) => {
                                const index = viewportWindow.start + visibleIndex;
                                const isHighlighted = index === navigationIndex;

                                if(item.type === 'server') {
                                    const serverPrompts = filteredGroupedPrompts[item.serverName] ?? [];
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
                                                {serverPrompts.length}
                                                {' '}
                                                prompts,
                                                {' '}
                                                {selectedCount}
                                                {' '}
                                                selected)
                                            </Text>
                                        </Box>
                                    );
                                } else if(item.type === 'prompt' && item.prompt) {
                                    const key = `${item.serverName}:${item.prompt.name}`;
                                    const isSelected = selectedPrompts.get(key) ?? false;
                                    const checkbox = isSelected ? '☑' : '☐';
                                    const indicator = isHighlighted ? '❯' : ' ';

                                    // Show prompt arguments if any
                                    const argCount = item.prompt.arguments?.length ?? 0;
                                    const argText = argCount > 0 ? ` (${argCount} args)` : '';

                                    // Truncate description to fit terminal
                                    const descText = item.prompt.description ?? 'No description';
                                    const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
                                    const maxDescLength = Math.max(30, terminalWidth - item.prompt.name.length - argText.length - 20);
                                    const truncatedDesc = cleanDesc.length > maxDescLength
                                        ? `${cleanDesc.slice(0, maxDescLength)}...`
                                        : cleanDesc;

                                    return (
                                        <Box key={`prompt-${key}`}>
                                            <Text color={isHighlighted ? 'cyan' : undefined}>
                                                {indicator}
                                                {' '}
                                                {checkbox}
                                                {' '}
                                                <Text bold>{item.prompt.name}</Text>
                                                {argCount > 0 && <Text color="yellow">{argText}</Text>}
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
                    {totalPrompts}
                    {' '}
                    total prompts,
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
