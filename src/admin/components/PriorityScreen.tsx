/**
 * Generic Priority Screen Component
 * Reorderable list with conflict detection
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { map, repeat } from 'lodash';
import { ScreenHeader } from './ui/ScreenHeader.js';

/**
 * Generic conflict structure with item-specific keys
 */
interface ConflictGroup<T> {
    /** Array indices showing priority order */
    priority:    [number, number]
    /** Function to get conflict messages for each item */
    getMessages: (itemIndex: 0 | 1, items: [T, T]) => string[]
}

interface PriorityScreenProps<T> {
    /** Items to prioritize */
    items:            T[]
    /** Detect conflicts in the item list */
    conflictDetector: (items: T[]) => ConflictGroup<T>[]
    /** Get display label for an item */
    getItemLabel:     (item: T) => React.ReactNode
    /** Get unique key for an item */
    getItemKey:       (item: T) => string
    /** Save handler */
    onSave:           (ordered: T[]) => void
    /** Cancel handler */
    onCancel:         () => void
    /** Screen title */
    title:            string
    /** Optional instructions subtitle */
    instructions?:    string
    /** Optional conflict warning message */
    conflictWarning?: string
    /** Empty state message */
    emptyMessage?:    string
}

/**
 * Generic priority screen for reordering items and detecting conflicts
 */
export function PriorityScreen<T>({
    items,
    conflictDetector,
    getItemLabel,
    getItemKey,
    onSave,
    onCancel,
    title,
    instructions = 'Items are matched in priority order (first match wins)',
    conflictWarning = 'Some items may shadow others based on priority order',
    emptyMessage = 'No items to prioritize',
}: PriorityScreenProps<T>) {
    const [orderedItems, setOrderedItems] = useState<T[]>(items);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Detect conflicts in current order
    const conflicts = useMemo(() => {
        return conflictDetector(orderedItems);
    }, [orderedItems, conflictDetector]);

    // Group conflicts by item for easy lookup
    const conflictsByItem = useMemo(() => {
        const conflictMap = new Map<string, string[]>();

        for(const conflict of conflicts) {
            const [index1, index2] = conflict.priority;
            const item1 = orderedItems[index1];
            const item2 = orderedItems[index2];

            if(!item1 || !item2) {
                continue;
            }

            const key1 = getItemKey(item1);
            const key2 = getItemKey(item2);

            // Get conflict messages for both items
            const msgs1 = conflict.getMessages(0, [item1, item2]);
            const msgs2 = conflict.getMessages(1, [item1, item2]);

            // Add messages to conflict map
            const existingMsgs1 = conflictMap.get(key1) ?? [];
            conflictMap.set(key1, [...existingMsgs1, ...msgs1]);

            const existingMsgs2 = conflictMap.get(key2) ?? [];
            conflictMap.set(key2, [...existingMsgs2, ...msgs2]);
        }

        return conflictMap;
    }, [conflicts, orderedItems, getItemKey]);

    /**
     * Move item up in priority (lower index = higher priority)
     */
    function moveUp() {
        if(selectedIndex > 0) {
            setOrderedItems((prev) => {
                const newOrder = [...prev];
                [newOrder[selectedIndex - 1], newOrder[selectedIndex]] = [newOrder[selectedIndex], newOrder[selectedIndex - 1]];
                return newOrder;
            });
            setSelectedIndex(prev => prev - 1);
        }
    }

    /**
     * Move item down in priority
     */
    function moveDown() {
        if(selectedIndex < orderedItems.length - 1) {
            setOrderedItems((prev) => {
                const newOrder = [...prev];
                [newOrder[selectedIndex], newOrder[selectedIndex + 1]] = [newOrder[selectedIndex + 1], newOrder[selectedIndex]];
                return newOrder;
            });
            setSelectedIndex(prev => prev + 1);
        }
    }

    /**
     * Handle keyboard input with functional setState
     */
    useInput((input, key) => {
        if(key.upArrow) {
            if(key.shift) {
                moveUp();
            } else {
                setSelectedIndex(prev => Math.max(0, prev - 1));
            }
        } else if(key.downArrow) {
            if(key.shift) {
                moveDown();
            } else {
                setSelectedIndex(prev => Math.min(orderedItems.length - 1, prev + 1));
            }
        } else if(key.return) {
            onSave(orderedItems);
        } else if(key.escape || key.leftArrow) {
            onCancel();
        } else if(input === ' ') {
            // Space also moves selected item up
            moveUp();
        }
    });

    const hasConflicts = conflicts.length > 0;

    /**
     * Get priority indicator string (1st, 2nd, 3rd, 4th, etc.)
     */
    function getPriorityIndicator(index: number): string {
        if(index === 0) {
            return '1st';
        } else if(index === 1) {
            return '2nd';
        } else if(index === 2) {
            return '3rd';
        } else {
            return `${index + 1}th`;
        }
    }

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title={title}
              subtitle={instructions}
            />

            {/* Conflict warnings */}
            {hasConflicts && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="red" bold>⚠ Conflicts detected:</Text>
                    <Text color="red">{conflictWarning}</Text>
                </Box>
            )}

            {/* Item list */}
            <Box flexDirection="column" marginBottom={1}>
                {orderedItems.length === 0
                    ? (
                        <Text>{emptyMessage}</Text>
                    )
                    : (
                    map(orderedItems, (item, index) => {
                        const isSelected = index === selectedIndex;
                        const key = getItemKey(item);
                        const conflictMsgs = conflictsByItem.get(key);
                        const hasConflict = conflictMsgs && conflictMsgs.length > 0;
                        const priorityIndicator = getPriorityIndicator(index);

                        return (
                            <Box key={`${key}-${index}`} flexDirection="column">
                                <Box>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '❯' : ' '}
                                        {' '}
                                        <Text color="yellow">{priorityIndicator}</Text>
                                        {' '}
                                        {getItemLabel(item)}
                                    </Text>
                                </Box>
                                {hasConflict && conflictMsgs && map(conflictMsgs, (msg, msgIndex) => (
                                    <Box key={msgIndex} marginLeft={5}>
                                        <Text color="red">
🔴
{msg}
                                        </Text>
                                    </Box>
                                ))}
                            </Box>
                        );
                    })
                )}
            </Box>

            {/* Separator */}
            <Box marginBottom={1}>
                <Text dimColor>{repeat('─', 40)}</Text>
            </Box>

            {/* Summary */}
            <Box marginBottom={1}>
                <Text>
                    Total items:
{' '}
<Text color="yellow">{orderedItems.length}</Text>
                    {hasConflicts && (
                        <>
                            {' | '}
                            <Text color="red">
Conflicts:
{conflicts.length}
                            </Text>
                        </>
                    )}
                </Text>
            </Box>

            {/* Controls */}
            <Box flexDirection="column">
                <Text>Controls: ↑/↓ Navigate | Shift+↑/↓ Move Priority | Space Move Up</Text>
                <Text>Enter Save Order | Esc Cancel</Text>
            </Box>
        </Box>
    );
}
