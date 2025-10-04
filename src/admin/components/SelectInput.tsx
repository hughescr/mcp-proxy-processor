/**
 * Custom SelectInput wrapper with disabled item support
 * Wraps ink-select-input to add disabled property functionality
 */

import React from 'react';
import InkSelectInput from 'ink-select-input';
import { filter, forEach, find, findIndex } from 'lodash';

export interface SelectInputItem {
    label:     string
    value:     string
    key?:      string
    disabled?: boolean
}

interface SelectInputProps<T extends SelectInputItem = SelectInputItem> {
    items:               T[]
    onSelect:            (item: T) => void
    onHighlight?:        (item: T) => void
    initialIndex?:       number
    limit?:              number
    indicatorComponent?: React.ComponentType
    itemComponent?:      React.ComponentType
}

/**
 * SelectInput component with disabled item support
 * Filters out disabled items before passing to ink-select-input
 * and remaps the selection back to the original item
 */
export function SelectInput<T extends SelectInputItem = SelectInputItem>({
    items,
    onSelect,
    onHighlight,
    initialIndex,
    limit,
    indicatorComponent,
    itemComponent,
}: SelectInputProps<T>) {
    // Filter out disabled items
    const enabledItems = filter(items, item => !item.disabled);

    // Create a map from enabled index to original index
    const enabledToOriginalIndex = new Map<number, number>();
    let enabledIdx = 0;
    forEach(items, (item, originalIdx) => {
        if(!item.disabled) {
            enabledToOriginalIndex.set(enabledIdx, originalIdx);
            enabledIdx++;
        }
    });

    // Adjust initial index if it points to a disabled item
    let adjustedInitialIndex = initialIndex;
    if(initialIndex !== undefined) {
        // If the initial index item is disabled, find the next enabled item
        if(items[initialIndex]?.disabled) {
            const nextEnabledIdx = findIndex(items, (item, idx) => idx >= initialIndex && !item.disabled);
            if(nextEnabledIdx !== -1) {
                // Convert from original index to enabled index
                let enabledCounter = 0;
                for(let i = 0; i <= nextEnabledIdx; i++) {
                    if(!items[i]?.disabled) {
                        if(i === nextEnabledIdx) {
                            adjustedInitialIndex = enabledCounter;
                            break;
                        }
                        enabledCounter++;
                    }
                }
            } else {
                adjustedInitialIndex = 0;
            }
        } else {
            // Convert from original index to enabled index
            let enabledCounter = 0;
            for(let i = 0; i < items.length; i++) {
                if(!items[i]?.disabled) {
                    if(i === initialIndex) {
                        adjustedInitialIndex = enabledCounter;
                        break;
                    }
                    enabledCounter++;
                }
            }
        }
    }

    const handleSelect = (item: T) => {
        // Find the original item by value (since we're working with filtered array)
        const originalItem = find(items, { value: item.value });
        if(originalItem) {
            onSelect(originalItem);
        }
    };

    const handleHighlight = onHighlight
        ? (item: T) => {
            const originalItem = find(items, { value: item.value });
            if(originalItem) {
                onHighlight(originalItem);
            }
        }
        : undefined;

    return (
        <InkSelectInput
          items={enabledItems}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          initialIndex={adjustedInitialIndex}
          limit={limit}
          indicatorComponent={indicatorComponent}
          itemComponent={itemComponent}
        />
    );
}
