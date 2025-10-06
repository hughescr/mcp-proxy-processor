/**
 * Prompt Priority Screen Component
 * Reorderable list of prompts with conflict detection
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { map, repeat } from 'lodash';
import type { PromptRef } from '../../types/config.js';
import { detectPromptConflicts } from '../../middleware/conflict-detection.js';
import { ScreenHeader } from './ui/ScreenHeader.js';

interface PromptPriorityScreenProps {
    prompts:  PromptRef[]
    onSave:   (prompts: PromptRef[]) => void
    onCancel: () => void
}

/**
 * Priority screen for reordering prompts and detecting conflicts
 */
export function PromptPriorityScreen({
    prompts,
    onSave,
    onCancel,
}: PromptPriorityScreenProps) {
    const [orderedPrompts, setOrderedPrompts] = useState<PromptRef[]>(prompts);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Detect conflicts in current order
    const conflicts = useMemo(() => {
        return detectPromptConflicts(orderedPrompts);
    }, [orderedPrompts]);

    // Group conflicts by prompt for easy lookup
    const conflictsByPrompt = useMemo(() => {
        const conflictMap = new Map<string, string[]>();

        for(const conflict of conflicts) {
            const [prompt1, prompt2] = conflict.prompts;
            const key1 = `${prompt1.serverName}:${prompt1.name}`;
            const key2 = `${prompt2.serverName}:${prompt2.name}`;

            // Add conflict message for first prompt
            const msgs1 = conflictMap.get(key1) ?? [];
            msgs1.push(`Duplicate name with #${conflict.priority[1] + 1}`);
            conflictMap.set(key1, msgs1);

            // Add conflict message for second prompt
            const msgs2 = conflictMap.get(key2) ?? [];
            msgs2.push(`Duplicate name with #${conflict.priority[0] + 1}`);
            conflictMap.set(key2, msgs2);
        }

        return conflictMap;
    }, [conflicts]);

    /**
     * Move prompt up in priority (lower index = higher priority)
     */
    function moveUp() {
        if(selectedIndex > 0) {
            setOrderedPrompts((prev) => {
                const newOrder = [...prev];
                [newOrder[selectedIndex - 1], newOrder[selectedIndex]] = [newOrder[selectedIndex], newOrder[selectedIndex - 1]];
                return newOrder;
            });
            setSelectedIndex(prev => prev - 1);
        }
    }

    /**
     * Move prompt down in priority
     */
    function moveDown() {
        if(selectedIndex < orderedPrompts.length - 1) {
            setOrderedPrompts((prev) => {
                const newOrder = [...prev];
                [newOrder[selectedIndex], newOrder[selectedIndex + 1]] = [newOrder[selectedIndex + 1], newOrder[selectedIndex]];
                return newOrder;
            });
            setSelectedIndex(prev => prev + 1);
        }
    }

    /**
     * Handle keyboard input with functional setState
     */
    useInput((input, key) => {
        if(key.upArrow) {
            if(key.shift) {
                moveUp();
            } else {
                setSelectedIndex(prev => Math.max(0, prev - 1));
            }
        } else if(key.downArrow) {
            if(key.shift) {
                moveDown();
            } else {
                setSelectedIndex(prev => Math.min(orderedPrompts.length - 1, prev + 1));
            }
        } else if(key.return) {
            onSave(orderedPrompts);
        } else if(key.escape || key.leftArrow) {
            onCancel();
        } else if(input === ' ') {
            // Space also moves selected item up
            moveUp();
        }
    });

    const hasConflicts = conflicts.length > 0;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title="Set Prompt Priority"
              subtitle="Prompts are matched in priority order (first match wins)"
            />

            {/* Conflict warnings */}
            {hasConflicts && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="red" bold>⚠ Conflicts detected:</Text>
                    <Text color="red">Some prompts have duplicate names</Text>
                </Box>
            )}

            {/* Prompt list */}
            <Box flexDirection="column" marginBottom={1}>
                {orderedPrompts.length === 0
                    ? (
                        <Text>No prompts to prioritize</Text>
                    )
                    : (
                    map(orderedPrompts, (prompt, index) => {
                        const isSelected = index === selectedIndex;
                        const key = `${prompt.serverName}:${prompt.name}`;
                        const conflictMsgs = conflictsByPrompt.get(key);
                        const hasConflict = conflictMsgs && conflictMsgs.length > 0;

                        // Priority indicator
                        let priorityIndicator = '';
                        if(index === 0) {
                            priorityIndicator = '1st';
                        } else if(index === 1) {
                            priorityIndicator = '2nd';
                        } else if(index === 2) {
                            priorityIndicator = '3rd';
                        } else {
                            priorityIndicator = `${index + 1}th`;
                        }

                        return (
                            <Box key={`${key}-${index}`} flexDirection="column">
                                <Box>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '❯' : ' '}
                                        {' '}
                                        <Text color="yellow">{priorityIndicator}</Text>
                                        {' '}
                                        <Text bold>{prompt.name}</Text>
                                        {' '}
                                        <Text>from</Text>
                                        {' '}
                                        <Text color="yellow">{prompt.serverName}</Text>
                                    </Text>
                                </Box>
                                {hasConflict && conflictMsgs && map(conflictMsgs, (msg, msgIndex) => (
                                    <Box key={msgIndex} marginLeft={5}>
                                        <Text color="red">
🔴
{msg}
                                        </Text>
                                    </Box>
                                ))}
                            </Box>
                        );
                    })
                )}
            </Box>

            {/* Separator */}
            <Box marginBottom={1}>
                <Text dimColor>{repeat('─', 40)}</Text>
            </Box>

            {/* Summary */}
            <Box marginBottom={1}>
                <Text>
                    Total prompts:
{' '}
<Text color="yellow">{orderedPrompts.length}</Text>
                    {hasConflicts && (
                        <>
                            {' | '}
                            <Text color="red">
Conflicts:
{conflicts.length}
                            </Text>
                        </>
                    )}
                </Text>
            </Box>

            {/* Controls */}
            <Box flexDirection="column">
                <Text>Controls: ↑/↓ Navigate | Shift+↑/↓ Move Priority | Space Move Up</Text>
                <Text>Enter Save Order | Esc Cancel</Text>
            </Box>
        </Box>
    );
}
