/**
 * Custom SelectInput with disabled item support
 * Shows all items including disabled ones, but only allows navigation/selection of enabled items
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { findIndex, map } from 'lodash';

export interface SelectInputItem {
    label:     string
    value:     string
    key?:      string
    disabled?: boolean
}

interface SelectInputProps<T extends SelectInputItem = SelectInputItem> {
    items:          T[]
    onSelect:       (item: T) => void
    onHighlight?:   (item: T) => void
    initialIndex?:  number
    /** When provided, SelectInput runs in controlled mode - parent handles navigation */
    selectedIndex?: number
}

export function SelectInput<T extends SelectInputItem = SelectInputItem>({
    items,
    onSelect,
    onHighlight,
    initialIndex = 0,
    selectedIndex: controlledIndex,
}: SelectInputProps<T>) {
    // Determine if we're in controlled mode
    const isControlled = controlledIndex !== undefined;

    // Find first non-disabled item for initial selection
    const firstEnabledIndex = findIndex(items, item => !item.disabled);
    const [uncontrolledIndex, setUncontrolledIndex] = useState(
        items[initialIndex]?.disabled ? firstEnabledIndex : initialIndex
    );

    // Use controlled index if provided, otherwise use internal state
    const currentIndex = isControlled ? controlledIndex : uncontrolledIndex;

    // IMPORTANT: Use functional setState for rapid input support
    // When multiple keypresses arrive quickly (enabled by Ink's splitRapidInput option),
    // each must operate on the previous update's result, not stale closure state.

    useInput((input, key) => {
        // In controlled mode, parent handles navigation - we only handle selection
        if(isControlled) {
            if(key.return) {
                const selectedItem = items[currentIndex];
                if(selectedItem && !selectedItem.disabled) {
                    onSelect(selectedItem);
                }
            }
            return;
        }

        // Uncontrolled mode - handle navigation ourselves
        if(key.upArrow) {
            // Move up to previous non-disabled item
            setUncontrolledIndex((prevIndex) => {
                let newIndex = prevIndex - 1;
                while(newIndex >= 0 && items[newIndex]?.disabled) {
                    newIndex--;
                }
                if(newIndex >= 0) {
                    if(onHighlight) {
                        onHighlight(items[newIndex]);
                    }
                    return newIndex;
                }
                return prevIndex;
            });
        } else if(key.downArrow) {
            // Move down to next non-disabled item
            setUncontrolledIndex((prevIndex) => {
                let newIndex = prevIndex + 1;
                while(newIndex < items.length && items[newIndex]?.disabled) {
                    newIndex++;
                }
                if(newIndex < items.length) {
                    if(onHighlight) {
                        onHighlight(items[newIndex]);
                    }
                    return newIndex;
                }
                return prevIndex;
            });
        } else if(key.return) {
            const selectedItem = items[currentIndex];
            if(selectedItem && !selectedItem.disabled) {
                onSelect(selectedItem);
            }
        }
    });

    return (
        <Box flexDirection="column">
            {map(items, (item, index) => {
                const isSelected = index === currentIndex;
                const indicator = isSelected && !item.disabled ? '❯' : ' ';

                // Only use dimColor for separator lines (non-alphanumeric content)
                // Headers and labels should use default color even when disabled
                const isSeparator = item.disabled && /^[^a-z0-9]*$/i.test(item.label);

                return (
                    <Box key={item.key ?? item.value}>
                        <Text color={isSelected && !item.disabled ? 'cyan' : undefined} dimColor={isSeparator}>
                            {indicator}
{' '}
{item.label}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
