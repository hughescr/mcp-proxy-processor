/**
 * VirtualScrollList Component
 * Reusable virtual scrolling wrapper for SelectInput lists
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { SelectInput, SelectInputItem } from '../SelectInput.js';
import { calculateAvailableHeight, calculateViewportBounds } from '../../design-system.js';

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
    const [selectedIndex, setSelectedIndex] = useState(initialIndex);

    // Calculate available height for list
    const availableHeight = useMemo(() => {
        return calculateAvailableHeight(terminalHeight, fixedUIHeight);
    }, [terminalHeight, fixedUIHeight]);

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

    // Track which item in the full list is selected
    const handleHighlight = (item: T) => {
        const fullIndex = items.indexOf(item);
        if(fullIndex !== -1) {
            setSelectedIndex(fullIndex);
        }
    };

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
              onHighlight={handleHighlight}
              initialIndex={selectedIndex - viewport.start}
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
