/**
 * VirtualScrollList Component
 * Reusable virtual scrolling wrapper for SelectInput lists
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { SelectInput, type SelectInputItem } from '../SelectInput.js';
import { calculateAvailableHeight, calculateViewportBounds } from '../../design-system.js';
import { useNotification } from './NotificationContext.js';
import { findIndex } from 'lodash';

interface VirtualScrollListProps<T extends SelectInputItem = SelectInputItem> {
    /** All items to display */
    items:           T[]
    /** Callback when item is selected */
    onSelect:        (item: T) => void
    /** Fixed UI height consumed by headers/footers/etc (excluding the list itself) */
    fixedUIHeight:   number
    /** Initial selected index (default: 0) */
    initialIndex?:   number
    /** Show "N more above/below" indicators (default: true) */
    showIndicators?: boolean
}

/**
 * Virtual scrolling list wrapper for SelectInput
 * Automatically handles viewport calculation and scroll indicators
 */
export function VirtualScrollList<T extends SelectInputItem = SelectInputItem>({
    items,
    onSelect,
    fixedUIHeight,
    initialIndex = 0,
    showIndicators = true,
}: VirtualScrollListProps<T>) {
    const { stdout } = useStdout();
    const terminalHeight = stdout?.rows ?? 24;
    const [viewportStart, setViewportStart] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(() => {
        // Find first non-disabled item for initial selection
        const firstEnabledIndex = findIndex(items, item => !item.disabled);
        const proposedIndex = initialIndex ?? 0;
        return items[proposedIndex]?.disabled ? firstEnabledIndex : proposedIndex;
    });
    const { notificationHeight } = useNotification();

    // Calculate available height for list (adjust for notification bar)
    const availableHeight = useMemo(() => {
        return calculateAvailableHeight(terminalHeight, fixedUIHeight + notificationHeight);
    }, [terminalHeight, fixedUIHeight, notificationHeight]);

    // Calculate max visible items (reserve 2 lines for indicators if shown)
    const maxVisibleItems = useMemo(() => {
        return Math.max(3, showIndicators ? availableHeight - 2 : availableHeight);
    }, [availableHeight, showIndicators]);

    // Calculate viewport bounds
    const viewport = useMemo(() => {
        return calculateViewportBounds(selectedIndex, viewportStart, items.length, maxVisibleItems);
    }, [selectedIndex, viewportStart, items.length, maxVisibleItems]);

    // Update viewport start when bounds change
    useEffect(() => {
        if(viewport.start !== viewportStart) {
            setViewportStart(viewport.start);
        }
    }, [viewport.start, viewportStart]);

    // Get visible items
    const visibleItems = useMemo(() => {
        return items.slice(viewport.start, viewport.end);
    }, [items, viewport.start, viewport.end]);

    // IMPORTANT: Use functional setState for rapid input support
    // Handle keyboard navigation in the full items array
    useInput((input, key) => {
        if(key.upArrow) {
            setSelectedIndex((prevIndex) => {
                let newIndex = prevIndex - 1;
                // Skip disabled items
                while(newIndex >= 0 && items[newIndex]?.disabled) {
                    newIndex--;
                }
                return newIndex >= 0 ? newIndex : prevIndex;
            });
        } else if(key.downArrow) {
            setSelectedIndex((prevIndex) => {
                let newIndex = prevIndex + 1;
                // Skip disabled items
                while(newIndex < items.length && items[newIndex]?.disabled) {
                    newIndex++;
                }
                return newIndex < items.length ? newIndex : prevIndex;
            });
        } else if(key.pageUp) {
            setSelectedIndex((prevIndex) => {
                let newIndex = Math.max(0, prevIndex - maxVisibleItems);
                // Skip disabled items going backward
                while(newIndex >= 0 && items[newIndex]?.disabled) {
                    newIndex--;
                }
                return newIndex >= 0 ? newIndex : prevIndex;
            });
        } else if(key.pageDown) {
            setSelectedIndex((prevIndex) => {
                let newIndex = Math.min(items.length - 1, prevIndex + maxVisibleItems);
                // Skip disabled items going forward
                while(newIndex < items.length && items[newIndex]?.disabled) {
                    newIndex++;
                }
                return newIndex < items.length ? newIndex : prevIndex;
            });
        }
    });

    return (
        <Box flexDirection="column">
            {showIndicators && viewport.start > 0 && (
                <Text dimColor>
... (
{viewport.start}
{' '}
more above)
                </Text>
            )}

            <SelectInput
              items={visibleItems}
              onSelect={onSelect}
              selectedIndex={selectedIndex - viewport.start}
            />

            {showIndicators && viewport.end < items.length && (
                <Text dimColor>
... (
{items.length - viewport.end}
{' '}
more below)
                </Text>
            )}
        </Box>
    );
}
