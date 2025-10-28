/**
 * Shared utilities for browser screen components
 */

import _ from 'lodash';

/**
 * Serialize a server name and item ID into a selection key
 * Handles IDs that contain colons by using a single colon separator
 *
 * @param serverName - The backend server name
 * @param id - The item identifier (uri, name, etc.)
 * @returns Selection key in format "serverName:id"
 *
 * @example
 * serializeSelectionKey('filesystem', 'file://path/to/file')
 * // Returns: 'filesystem:file://path/to/file'
 */
export function serializeSelectionKey(serverName: string, id: string): string {
    return `${serverName}:${id}`;
}

/**
 * Parse a selection key back into server name and item ID
 *
 * @param key - Selection key in format "serverName:id"
 * @returns Object with serverName and id properties
 *
 * @example
 * parseSelectionKey('filesystem:file://path/to/file')
 * // Returns: { serverName: 'filesystem', id: 'file://path/to/file' }
 */
export function parseSelectionKey(key: string): { serverName: string, id: string } {
    const parts = _.split(key, ':');
    const [serverName, ...idParts] = parts;
    return {
        serverName: serverName ?? '',
        id:         _.join(idParts, ':'),
    };
}

/**
 * Count the number of selected items in a selection map
 *
 * @param selectionMap - Map of selection keys to boolean selection state
 * @returns Count of items that are selected (true values)
 */
export function countSelected(selectionMap: Map<string, boolean>): number {
    let count = 0;
    for(const isSelected of selectionMap.values()) {
        if(isSelected) {
            count++;
        }
    }
    return count;
}

/**
 * Group items by server name and sort both servers and items
 *
 * @param items - Array of items to group
 * @param getServerName - Function to extract server name from an item
 * @param getSortKey - Function to extract sort key from an item
 * @returns Object with server names as keys and sorted item arrays as values
 *
 * @example
 * groupAndSortByServer(
 *   resources,
 *   (r) => r.serverName,
 *   (r) => r.resource.uri
 * )
 */
export function groupAndSortByServer<T>(
    items: T[],
    getServerName: (item: T) => string,
    getSortKey: (item: T) => string
): Record<string, T[]> {
    const grouped = _.groupBy(items, getServerName);
    const sortedServerNames = _(grouped).keys().sortBy().value();

    return _.reduce(sortedServerNames, (result: Record<string, T[]>, serverName: string) => {
        result[serverName] = _.sortBy(grouped[serverName], getSortKey);
        return result;
    }, {} as Record<string, T[]>);
}
