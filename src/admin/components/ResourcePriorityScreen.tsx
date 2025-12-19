/**
 * Resource Priority Screen Component
 * Reorderable list of resources with conflict detection
 */

import React from 'react';
import { Text } from 'ink';
import _ from 'lodash';
import type { ResourceRef, ResourceConflict } from '../../types/config.js';
import { detectResourceConflicts } from '../../utils/conflict-detection.js';
import { PriorityScreen } from './PriorityScreen.js';

interface ResourcePriorityScreenProps {
    resources: ResourceRef[]
    onSave:    (resources: ResourceRef[]) => void
    onCancel:  () => void
}

/**
 * Convert ResourceConflict to generic ConflictGroup format
 */
function convertResourceConflict(conflict: ResourceConflict) {
    return {
        priority:    conflict.priority,
        getMessages: (itemIndex: 0 | 1, _items: [ResourceRef, ResourceRef]): string[] => {
            const otherIndex = itemIndex === 0 ? 1 : 0;
            const priorityNum = conflict.priority[otherIndex] + 1;

            switch(conflict.type) {
                case 'exact-duplicate':
                    return [`Duplicate of #${priorityNum}`];
                case 'template-covers-exact':
                    return itemIndex === 0
                        ? [`Template covers exact URI at #${priorityNum}`]
                        : [`Exact URI covered by template at #${priorityNum}`];
                case 'exact-covered-by-template':
                    return itemIndex === 0
                        ? [`Covered by template at #${priorityNum}`]
                        : [`Template covers exact URI at #${priorityNum}`];
                case 'template-overlap':
                    return [`May overlap with template at #${priorityNum}`];
            }
        },
    };
}

/**
 * Priority screen for reordering resources and detecting conflicts
 */
export function ResourcePriorityScreen({
    resources,
    onSave,
    onCancel,
}: ResourcePriorityScreenProps) {
    const conflictDetector = (items: ResourceRef[]) => {
        const conflicts = detectResourceConflicts(items);
        return _.map(conflicts, convertResourceConflict);
    };

    return (
        <PriorityScreen
          items={resources}
          conflictDetector={conflictDetector}
          getItemLabel={resource => (
                <>
                    <Text bold>{resource.uri}</Text>
                    {' '}
                    <Text>from</Text>
                    {' '}
                    <Text color="yellow">{resource.serverName}</Text>
                </>
            )}
          getItemKey={resource => `${resource.serverName}:${resource.uri}`}
          onSave={onSave}
          onCancel={onCancel}
          title="Set Resource Priority"
          instructions="Resources are matched in priority order (first match wins)"
          conflictWarning="Some resources may shadow others based on priority order"
          emptyMessage="No resources to prioritize"
        />
    );
}
