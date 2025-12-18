/**
 * Prompt Priority Screen Component
 * Reorderable list of prompts with conflict detection
 */

import React from 'react';
import { Text } from 'ink';
import _ from 'lodash';
import type { PromptRef, PromptConflict } from '../../types/config.js';
import { detectPromptConflicts } from '../../utils/conflict-detection.js';
import { PriorityScreen } from './PriorityScreen.js';

interface PromptPriorityScreenProps {
    prompts:  PromptRef[]
    onSave:   (prompts: PromptRef[]) => void
    onCancel: () => void
}

/**
 * Convert PromptConflict to generic ConflictGroup format
 */
function convertPromptConflict(conflict: PromptConflict) {
    return {
        priority:    conflict.priority,
        getMessages: (itemIndex: 0 | 1, _items: [PromptRef, PromptRef]): string[] => {
            const otherIndex = itemIndex === 0 ? 1 : 0;
            const priorityNum = conflict.priority[otherIndex] + 1;
            return [`Duplicate name with #${priorityNum}`];
        },
    };
}

/**
 * Priority screen for reordering prompts and detecting conflicts
 */
export function PromptPriorityScreen({
    prompts,
    onSave,
    onCancel,
}: PromptPriorityScreenProps) {
    const conflictDetector = (items: PromptRef[]) => {
        const conflicts = detectPromptConflicts(items);
        return _.map(conflicts, convertPromptConflict);
    };

    return (
        <PriorityScreen
          items={prompts}
          conflictDetector={conflictDetector}
          getItemLabel={prompt => (
                <>
                    <Text bold>{prompt.name}</Text>
                    {' '}
                    <Text>from</Text>
                    {' '}
                    <Text color="yellow">{prompt.serverName}</Text>
                </>
            )}
          getItemKey={prompt => `${prompt.serverName}:${prompt.name}`}
          onSave={onSave}
          onCancel={onCancel}
          title="Set Prompt Priority"
          instructions="Prompts are matched in priority order (first match wins)"
          conflictWarning="Some prompts have duplicate names"
          emptyMessage="No prompts to prioritize"
        />
    );
}
