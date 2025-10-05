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
    items:         T[]
    onSelect:      (item: T) => void
    onHighlight?:  (item: T) => void
    initialIndex?: number
}

export function SelectInput<T extends SelectInputItem = SelectInputItem>({
    items,
    onSelect,
    onHighlight,
    initialIndex = 0,
}: SelectInputProps<T>) {
    // Find first non-disabled item for initial selection
    const firstEnabledIndex = findIndex(items, item => !item.disabled);
    const [selectedIndex, setSelectedIndex] = useState(
        items[initialIndex]?.disabled ? firstEnabledIndex : initialIndex
    );

    // IMPORTANT: Use functional setState for rapid input support
    // When multiple keypresses arrive quickly (enabled by Ink's splitRapidInput option),
    // each must operate on the previous update's result, not stale closure state.

    useInput((input, key) => {
        if(key.upArrow) {
            // Move up to previous non-disabled item
            setSelectedIndex((prevIndex) => {
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
            setSelectedIndex((prevIndex) => {
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
            const selectedItem = items[selectedIndex];
            if(selectedItem && !selectedItem.disabled) {
                onSelect(selectedItem);
            }
        }
    });

    return (
        <Box flexDirection="column">
            {map(items, (item, index) => {
                const isSelected = index === selectedIndex;
                const indicator = isSelected && !item.disabled ? '❯' : ' ';

                return (
                    <Box key={item.key ?? item.value}>
                        <Text color={isSelected && !item.disabled ? 'cyan' : undefined} dimColor={item.disabled}>
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
