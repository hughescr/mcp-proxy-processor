/**
 * Group List Component - Display and manage groups
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { EnhancedSelectInput } from 'ink-enhanced-select-input';
import { isError, keys, chain, repeat } from 'lodash';
import type { GroupConfig } from '../types/config.js';
import { loadGroupsConfig, saveGroupsConfig } from './config-utils.js';
import { GroupEditor } from './GroupEditor.js';

interface GroupListProps {
    onBack: () => void
}

type View = 'list' | 'edit' | 'create';

/**
 * Group list and management screen
 */
export function GroupList({ onBack }: GroupListProps) {
    const [view, setView] = useState<View>('list');
    const [groups, setGroups] = useState<Record<string, GroupConfig>>({});
    const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Handle Esc and Left Arrow for navigation
    useInput((input, key) => {
        if(!loading && view === 'list' && (key.escape || key.leftArrow)) {
            onBack();
        }
    });

    // Load groups on mount
    useEffect(() => {
        void (async () => {
            try {
                const config = await loadGroupsConfig();
                setGroups(config.groups);
                setLoading(false);
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setLoading(false);
            }
        })();
    }, []);

    const handleGroupSelect = (item: { value: string }) => {
        if(item.value === 'back') {
            onBack();
        } else if(item.value === 'create') {
            setSelectedGroupName(null);
            setView('create');
        } else {
            setSelectedGroupName(item.value);
            setView('edit');
        }
    };

    const handleSaveGroup = async (groupName: string, group: GroupConfig) => {
        try {
            const newGroups = { ...groups, [groupName]: group };
            await saveGroupsConfig({ groups: newGroups });
            setGroups(newGroups);
            setView('list');
            setError(null);
        } catch (err) {
            setError(isError(err) ? err.message : String(err));
        }
    };

    const handleDeleteGroup = async (groupName: string) => {
        try {
            const newGroups = { ...groups };
            delete newGroups[groupName];
            await saveGroupsConfig({ groups: newGroups });
            setGroups(newGroups);
            setView('list');
            setError(null);
        } catch (err) {
            setError(isError(err) ? err.message : String(err));
        }
    };

    const handleCancel = () => {
        setView('list');
        setSelectedGroupName(null);
    };

    // Show group editor
    if(view === 'edit' && selectedGroupName) {
        return (
            <GroupEditor
              groupName={selectedGroupName}
              group={groups[selectedGroupName]}
              onSave={handleSaveGroup}
              onDelete={handleDeleteGroup}
              onCancel={handleCancel}
            />
        );
    }

    // Show group creator
    if(view === 'create') {
        return (
            <GroupEditor
              groupName=""
              group={{
                    name:        '',
                    description: '',
                    tools:       [],
                    resources:   [],
                }}
              onSave={handleSaveGroup}
              onDelete={async () => { /* noop for new group */ }}
              onCancel={handleCancel}
            />
        );
    }

    // Show loading state
    if(loading) {
        return (
            <Box padding={1}>
                <Text>Loading groups...</Text>
            </Box>
        );
    }

    // Show error state
    if(error) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="red">
                    Error:
                    {error}
                </Text>
                <Text dimColor>Press Esc to go back</Text>
            </Box>
        );
    }

    // Build menu items
    const menuItems: { label: string, value: string, disabled?: boolean }[] = [
        ...chain(groups)
            .keys()
            .map(name => ({
                label: `${name} (${groups[name].tools.length} tools)`,
                value: name,
            }))
            .value(),
        { label: repeat('─', 40), value: 'sep1', disabled: true },
        { label: '+ Create New Group', value: 'create' },
        { label: '← Back', value: 'back' },
    ];

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Group Management
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text dimColor>
                    {keys(groups).length === 0
                        ? 'No groups configured. Create a new group to get started.'
                        : 'Select a group to edit, or create a new one:'}
                </Text>
            </Box>
            <EnhancedSelectInput items={menuItems} onSelect={handleGroupSelect} />
        </Box>
    );
}
