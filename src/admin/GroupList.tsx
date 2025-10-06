/**
 * Group List Component - Display and manage groups
 */

import React, { useState, useEffect } from 'react';
import { Box, useInput } from 'ink';
import { isError, keys, chain } from 'lodash';
import type { GroupConfig } from '../types/config.js';
import { loadGroupsConfig, saveGroupsConfig } from './config-utils.js';
import { GroupEditor } from './GroupEditor.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { ErrorScreen } from './components/ui/ErrorScreen.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { menuSeparator } from './design-system.js';

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

    const [loadingStatus, setLoadingStatus] = useState<string>('Loading groups configuration...');

    // Load groups on mount
    useEffect(() => {
        void (async () => {
            try {
                setLoadingStatus('Reading groups configuration...');
                const config = await loadGroupsConfig();
                setLoadingStatus('Processing groups...');
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

    const handleSaveGroup = async (originalGroupName: string, newGroupName: string, group: GroupConfig) => {
        try {
            const newGroups = { ...groups };

            // If renaming, remove the old group entry
            if(originalGroupName && originalGroupName !== newGroupName) {
                delete newGroups[originalGroupName];
            }

            // Add/update the group with the new name
            newGroups[newGroupName] = group;

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
                    prompts:     [],
              }}
              onSave={handleSaveGroup}
              onDelete={async () => { /* noop for new group */ }}
              onCancel={handleCancel}
            />
        );
    }

    // Show loading state
    if(loading) {
        return <LoadingScreen message={loadingStatus} />;
    }

    // Show error state
    if(error) {
        return (
            <ErrorScreen
              title="Error Loading Groups"
              message={error}
              troubleshooting={[
                  '• Check that config/groups.json exists and is readable',
                  '• Verify the file contains valid JSON',
                  '• Ensure you have permission to read the file',
              ]}
              helpText="Press Esc to return to main menu"
            />
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
        menuSeparator(),
        { label: '+ Create New Group', value: 'create' },
        { label: '← Back', value: 'back' },
    ];

    // Fixed UI height: padding(1) + header(1) + margin(1) + subtitle(1) + margin(1) + padding(1) = 6
    const fixedUIHeight = 6;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title="Group Management"
              subtitle={keys(groups).length === 0
                  ? 'No groups configured. Create a new group to get started.'
                  : 'Select a group to edit, or create a new one:'}
            />
            <VirtualScrollList
              items={menuItems}
              onSelect={handleGroupSelect}
              fixedUIHeight={fixedUIHeight}
            />
        </Box>
    );
}
