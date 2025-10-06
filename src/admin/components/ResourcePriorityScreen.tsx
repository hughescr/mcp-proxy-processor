/**
 * Resource Priority Screen Component
 * Reorderable list of resources with conflict detection
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { map, repeat } from 'lodash';
import type { ResourceRef } from '../../types/config.js';
import { detectResourceConflicts } from '../../middleware/conflict-detection.js';
import { ScreenHeader } from './ui/ScreenHeader.js';

interface ResourcePriorityScreenProps {
    resources: ResourceRef[]
    onSave:    (resources: ResourceRef[]) => void
    onCancel:  () => void
}

/**
 * Priority screen for reordering resources and detecting conflicts
 */
export function ResourcePriorityScreen({
    resources,
    onSave,
    onCancel,
}: ResourcePriorityScreenProps) {
    const [orderedResources, setOrderedResources] = useState<ResourceRef[]>(resources);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Detect conflicts in current order
    const conflicts = useMemo(() => {
        return detectResourceConflicts(orderedResources);
    }, [orderedResources]);

    // Group conflicts by resource for easy lookup
    const conflictsByResource = useMemo(() => {
        const conflictMap = new Map<string, string[]>();

        for(const conflict of conflicts) {
            const [res1, res2] = conflict.resources;
            const key1 = `${res1.serverName}:${res1.uri}`;
            const key2 = `${res2.serverName}:${res2.uri}`;

            // Add conflict message for first resource
            const msgs1 = conflictMap.get(key1) ?? [];
            let msg = '';
            switch(conflict.type) {
                case 'exact-duplicate':
                    msg = `Duplicate of #${conflict.priority[1] + 1}`;
                    break;
                case 'template-covers-exact':
                    msg = `Template covers exact URI at #${conflict.priority[1] + 1}`;
                    break;
                case 'exact-covered-by-template':
                    msg = `Covered by template at #${conflict.priority[1] + 1}`;
                    break;
                case 'template-overlap':
                    msg = `May overlap with template at #${conflict.priority[1] + 1}`;
                    break;
            }
            msgs1.push(msg);
            conflictMap.set(key1, msgs1);

            // Add conflict message for second resource (inverse)
            const msgs2 = conflictMap.get(key2) ?? [];
            switch(conflict.type) {
                case 'exact-duplicate':
                    msg = `Duplicate of #${conflict.priority[0] + 1}`;
                    break;
                case 'template-covers-exact':
                    msg = `Exact URI covered by template at #${conflict.priority[0] + 1}`;
                    break;
                case 'exact-covered-by-template':
                    msg = `Template covers exact URI at #${conflict.priority[0] + 1}`;
                    break;
                case 'template-overlap':
                    msg = `May overlap with template at #${conflict.priority[0] + 1}`;
                    break;
            }
            msgs2.push(msg);
            conflictMap.set(key2, msgs2);
        }

        return conflictMap;
    }, [conflicts]);

    /**
     * Move resource up in priority (lower index = higher priority)
     */
    function moveUp() {
        if(selectedIndex > 0) {
            setOrderedResources((prev) => {
                const newOrder = [...prev];
                [newOrder[selectedIndex - 1], newOrder[selectedIndex]] = [newOrder[selectedIndex], newOrder[selectedIndex - 1]];
                return newOrder;
            });
            setSelectedIndex(prev => prev - 1);
        }
    }

    /**
     * Move resource down in priority
     */
    function moveDown() {
        if(selectedIndex < orderedResources.length - 1) {
            setOrderedResources((prev) => {
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
                setSelectedIndex(prev => Math.min(orderedResources.length - 1, prev + 1));
            }
        } else if(key.return) {
            onSave(orderedResources);
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
              title="Set Resource Priority"
              subtitle="Resources are matched in priority order (first match wins)"
            />

            {/* Conflict warnings */}
            {hasConflicts && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="red" bold>⚠ Conflicts detected:</Text>
                    <Text color="red">Some resources may shadow others based on priority order</Text>
                </Box>
            )}

            {/* Resource list */}
            <Box flexDirection="column" marginBottom={1}>
                {orderedResources.length === 0
                    ? (
                        <Text>No resources to prioritize</Text>
                    )
                    : (
                    map(orderedResources, (resource, index) => {
                        const isSelected = index === selectedIndex;
                        const key = `${resource.serverName}:${resource.uri}`;
                        const conflictMsgs = conflictsByResource.get(key);
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
                            <Box key={key} flexDirection="column">
                                <Box>
                                    <Text color={isSelected ? 'cyan' : undefined}>
                                        {isSelected ? '❯' : ' '}
                                        {' '}
                                        <Text color="yellow">{priorityIndicator}</Text>
                                        {' '}
                                        <Text bold>{resource.uri}</Text>
                                        {' '}
                                        <Text>from</Text>
                                        {' '}
                                        <Text color="yellow">{resource.serverName}</Text>
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
                    Total resources:
{' '}
<Text color="yellow">{orderedResources.length}</Text>
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
