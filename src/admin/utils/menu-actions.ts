/**
 * Menu action routing utilities for TUI components
 */

import { startsWith } from 'lodash';

/**
 * Match and execute handlers for menu items with prefixed values
 *
 * @param value - The menu item value to match
 * @param patterns - Map of prefix patterns to handler functions
 * @returns true if a pattern matched and handler was executed, false otherwise
 *
 * @example
 * ```typescript
 * const handled = matchPrefixAction(item.value, {
 *   'edit-tool-': (id) => handleEditTool(parseInt(id, 10)),
 *   'remove-tool-': (id) => handleRemoveTool(parseInt(id, 10)),
 * });
 * ```
 */
export function matchPrefixAction(
    value: string,
    patterns: Record<string, (id: string) => void>
): boolean {
    for(const [prefix, handler] of Object.entries(patterns)) {
        if(startsWith(value, prefix)) {
            const id = value.substring(prefix.length);
            handler(id);
            return true;
        }
    }
    return false;
}
