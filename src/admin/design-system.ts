/**
 * Admin UI Design System
 *
 * Defines consistent colors, spacing, and utilities for the admin TUI
 */

import { repeat } from 'lodash';

/**
 * Spacing Constants
 */
export const SPACING = {
    /** Standard padding for screens */
    SCREEN_PADDING: 1,
    /** Margin between major sections */
    SECTION_MARGIN: 1,
    /** Standard box padding X */
    BOX_PADDING_X:  1,
} as const;

/**
 * Separator Lengths
 */
export const SEPARATOR_LENGTHS = {
    /** Separator length for menu items */
    MENU: 40,
    /** Separator length for text blocks */
    TEXT: 60,
    /** Separator length for wide content */
    WIDE: 80,
    /** Minimum separator length for narrow terminals */
    MIN:  20,
} as const;

/**
 * Typography & Color Guidelines (for documentation)
 *
 * These are not constants but guidelines for consistent usage:
 *
 * 1. Screen Title (H1): <Text bold color="cyan">
 * 2. Data Values: <Text bold> (default color) - EXCLUSIVELY for editable data
 * 3. Metadata/Context: <Text color="yellow"> - Server names, counts, types
 * 4. Labels: <Text> - Field labels
 * 5. Selected Items: color="cyan" (automatic in SelectInput)
 * 6. Section Headers: <Text underline> or default
 * 7. Body/Instructions: <Text> - User guidance
 * 8. Success: <Text color="green">
 * 9. Errors: <Text color="red">
 * 10. Decorative: <Text dimColor> - Separator lines ONLY
 */

/**
 * Create a menu separator item for SelectInput
 * @param length - Length of separator (default: MENU)
 * @returns SelectInput menu item
 */
export function menuSeparator(length: number = SEPARATOR_LENGTHS.MENU): { label: string, value: string, disabled: true } {
    return {
        label:    repeat('─', length),
        value:    `sep-${Math.random().toString(36).slice(2, 9)}`,
        disabled: true,
    };
}

/**
 * Create a text separator string
 * @param length - Length of separator (default: TEXT)
 * @returns Separator string
 */
export function textSeparator(length: number = SEPARATOR_LENGTHS.TEXT): string {
    return repeat('─', length);
}

/**
 * Calculate available height for virtual scrolling
 * @param terminalHeight - Total terminal height
 * @param fixedUIHeight - Height consumed by headers, footers, margins
 * @returns Available height for scrollable content
 */
export function calculateAvailableHeight(terminalHeight: number, fixedUIHeight: number): number {
    return Math.max(5, terminalHeight - fixedUIHeight);
}

/**
 * Virtual scroll viewport calculation
 * @param navigationIndex - Current cursor position
 * @param viewportStart - Current viewport start
 * @param listLength - Total list length
 * @param maxVisible - Max visible items
 * @returns Viewport bounds { start, end }
 */
export function calculateViewportBounds(
    navigationIndex: number,
    viewportStart: number,
    listLength: number,
    maxVisible: number
): { start: number, end: number } {
    if(listLength === 0) {
        return { start: 0, end: 0 };
    }

    let start = viewportStart;
    let end = Math.min(start + maxVisible, listLength);

    // Ensure navigationIndex is always within viewport
    if(navigationIndex < start) {
        // Cursor scrolled above viewport - adjust up
        start = navigationIndex;
        end = Math.min(start + maxVisible, listLength);
    }

    if(navigationIndex >= end) {
        // Cursor scrolled below viewport - adjust down
        end = navigationIndex + 1;
        start = Math.max(0, end - maxVisible);
    }

    return { start, end };
}
