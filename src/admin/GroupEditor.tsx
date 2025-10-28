/**
 * Group Editor Component - Create and edit groups
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import _ from 'lodash';
import { CancellableTextInput } from './components/CancellableTextInput.js';
import { matchPrefixAction } from './utils/menu-actions.js';
import type { GroupConfig, ToolOverride, ResourceRef, PromptRef } from '../types/config.js';
import { GroupedMultiSelectToolBrowser } from './components/GroupedMultiSelectToolBrowser.js';
import { EnhancedToolEditor } from './components/EnhancedToolEditor.js';
import { ResourceBrowserScreen } from './components/ResourceBrowserScreen.js';
import { ResourcePriorityScreen } from './components/ResourcePriorityScreen.js';
import { PromptBrowserScreen } from './components/PromptBrowserScreen.js';
import { PromptPriorityScreen } from './components/PromptPriorityScreen.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { menuSeparator } from './design-system.js';

interface GroupEditorProps {
    groupName: string
    group:     GroupConfig
    onSave:    (originalGroupName: string, newGroupName: string, group: GroupConfig) => Promise<void>
    onDelete:  (groupName: string) => Promise<void>
    onCancel:  () => void
}

type EditMode = 'menu' | 'edit-name' | 'edit-description' | 'add-tool' | 'edit-tool' | 'edit-resources' | 'priority-resources' | 'edit-prompts' | 'priority-prompts' | 'success';

/**
 * Group editor screen
 */
// eslint-disable-next-line complexity -- Component manages 9 different edit modes with conditional rendering
export function GroupEditor({ groupName, group, onSave, onDelete, onCancel }: GroupEditorProps) {
    const [mode, setMode] = useState<EditMode>('menu');
    const [currentGroup, setCurrentGroup] = useState<GroupConfig>(group);
    const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isNewGroup = groupName === '';

    // Handle Esc for navigation - only in menu mode
    // Note: Input modes (edit-name, edit-description) handle ESC via CancellableTextInput
    useInput((input, key) => {
        if(mode === 'menu' && !saving) {
            if(key.escape || key.leftArrow) {
                onCancel();
            }
        }
    });

    const handleSave = async () => {
        // Validate
        if(!_.trim(currentGroup.name)) {
            setError('Group name is required');
            return;
        }

        setSaving(true);
        try {
            // Ensure name matches the group config
            const groupToSave = { ...currentGroup, name: currentGroup.name };
            await onSave(groupName, currentGroup.name, groupToSave);
            // Show success message
            setMode('success');
            setSaving(false);
            // Auto-dismiss after 1.5 seconds
            setTimeout(() => {
                onCancel();
            }, 1500);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setSaving(true);
        try {
            await onDelete(groupName);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            setSaving(false);
        }
    };

    const handleRemoveTool = (index: number) => {
        const newTools = [...currentGroup.tools];
        newTools.splice(index, 1);
        setCurrentGroup({ ...currentGroup, tools: newTools });
    };

    const handleMenuSelect = (item: { value: string }) => {
        // Define exact match actions
        const menuActions: Record<string, () => void> = {
            save: () => {
                void handleSave();
            },
            'delete': () => {
                void handleDelete();
            },
            cancel: () => {
                onCancel();
            },
            'edit-name': () => {
                setInputValue(currentGroup.name);
                setMode('edit-name');
            },
            'edit-description': () => {
                setInputValue(currentGroup.description ?? '');
                setMode('edit-description');
            },
            'add-tool': () => {
                setMode('add-tool');
            },
            'edit-resources': () => {
                setMode('edit-resources');
            },
            'priority-resources': () => {
                setMode('priority-resources');
            },
            'edit-prompts': () => {
                setMode('edit-prompts');
            },
            'priority-prompts': () => {
                setMode('priority-prompts');
            },
        };

        // Try exact match first
        const action = menuActions[item.value];
        if(action) {
            action();
            return;
        }

        // Handle prefixed items
        matchPrefixAction(item.value, {
            'remove-tool-': (index) => {
                handleRemoveTool(parseInt(index, 10));
            },
            'edit-tool-': (index) => {
                setEditingToolIndex(parseInt(index, 10));
                setMode('edit-tool');
            },
            'view-resource-': () => {
                // Clicking on individual resource item navigates to resource browser
                setMode('edit-resources');
            },
            'view-prompt-': () => {
                // Clicking on individual prompt item navigates to prompt browser
                setMode('edit-prompts');
            },
        });
    };
    const handleAddTools = (tools: ToolOverride[]) => {
        setCurrentGroup({
            ...currentGroup,
            tools,
        });
        setMode('menu');
    };

    const handleEditTool = (index: number, tool: ToolOverride) => {
        const newTools = [...currentGroup.tools];
        newTools[index] = tool;
        setCurrentGroup({ ...currentGroup, tools: newTools });
        setMode('menu');
    };

    const handleNameSubmit = (value: string) => {
        setCurrentGroup({ ...currentGroup, name: value });
        setMode('menu');
    };

    const handleDescriptionSubmit = (value: string) => {
        setCurrentGroup({ ...currentGroup, description: value });
        setMode('menu');
    };

    const handleResourcesSubmit = (resources: ResourceRef[]) => {
        setCurrentGroup({
            ...currentGroup,
            resources,
        });
        setMode('priority-resources');
    };

    const handleResourcesPriority = (resources: ResourceRef[]) => {
        setCurrentGroup({
            ...currentGroup,
            resources,
        });
        setMode('menu');
    };

    const handlePromptsSubmit = (prompts: PromptRef[]) => {
        setCurrentGroup({
            ...currentGroup,
            prompts,
        });
        setMode('priority-prompts');
    };

    const handlePromptsPriority = (prompts: PromptRef[]) => {
        setCurrentGroup({
            ...currentGroup,
            prompts,
        });
        setMode('menu');
    };

    // Tool browser for adding tools
    if(mode === 'add-tool') {
        return (
            <GroupedMultiSelectToolBrowser
              onBack={() => setMode('menu')}
              onSubmit={handleAddTools}
              existingTools={currentGroup.tools}
            />
        );
    }

    // Tool editor for editing existing tool
    if(mode === 'edit-tool' && editingToolIndex !== null) {
        const handleRemoveCurrentTool = () => {
            handleRemoveTool(editingToolIndex);
            setEditingToolIndex(null);
            setMode('menu');
        };

        return (
            <EnhancedToolEditor
              tool={currentGroup.tools[editingToolIndex]}
              groupName={currentGroup.name}
              onSave={tool => handleEditTool(editingToolIndex, tool)}
              onRemove={handleRemoveCurrentTool}
              onCancel={() => setMode('menu')}
            />
        );
    }

    // Resource browser
    if(mode === 'edit-resources') {
        return (
            <ResourceBrowserScreen
              onBack={() => setMode('menu')}
              onSubmit={handleResourcesSubmit}
              existingResources={currentGroup.resources ?? []}
            />
        );
    }

    // Resource priority screen
    if(mode === 'priority-resources') {
        return (
            <ResourcePriorityScreen
              resources={currentGroup.resources ?? []}
              onSave={handleResourcesPriority}
              onCancel={() => setMode('menu')}
            />
        );
    }

    // Prompt browser
    if(mode === 'edit-prompts') {
        return (
            <PromptBrowserScreen
              onBack={() => setMode('menu')}
              onSubmit={handlePromptsSubmit}
              existingPrompts={currentGroup.prompts ?? []}
            />
        );
    }

    // Prompt priority screen
    if(mode === 'priority-prompts') {
        return (
            <PromptPriorityScreen
              prompts={currentGroup.prompts ?? []}
              onSave={handlePromptsPriority}
              onCancel={() => setMode('menu')}
            />
        );
    }

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Group Name" />
                <Box marginTop={1}>
                    <Text>Name: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Description input
    if(mode === 'edit-description') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Group Description" />
                <Box marginTop={1}>
                    <Text>Description: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleDescriptionSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Show saving state
    if(saving) {
        return <LoadingScreen message="Saving..." />;
    }

    // Show success state
    if(mode === 'success') {
        return (
            <Box padding={1}>
                <Text color="green">
                    ✓ Group saved successfully!
                </Text>
            </Box>
        );
    }

    // Build menu items
    const menuItems: { label: string, value: string, disabled?: boolean }[] = [
        { label: `Name: ${currentGroup.name ?? '(not set)'}`, value: 'edit-name' },
        { label: `Description: ${currentGroup.description ?? '(none)'}`, value: 'edit-description' },
        menuSeparator(),
        { label: `Tools (${currentGroup.tools.length}):`, value: 'tools-header', disabled: true },
        ..._.map(currentGroup.tools, (tool, index) => ({
            label: `  ${tool.name ?? tool.originalName} (${tool.serverName})`,
            value: `edit-tool-${index}`,
        })),
        { label: '⚙️  Activate/Deactivate Tools', value: 'add-tool' },
        menuSeparator(),
        { label: `Resources (${currentGroup.resources?.length ?? 0}):`, value: 'resources-header', disabled: true },
        ..._(currentGroup.resources ?? [])
            .sortBy('uri')
            .map((resource, index) => ({
                label: `  ${resource.uri} (${resource.serverName})`,
                value: `view-resource-${index}`,
            }))
            .value(),
        { label: '⚙️  Activate/Deactivate Resources', value: 'edit-resources' },
        {
            label: currentGroup.resources && currentGroup.resources.length > 0
                ? '📊 Set Resource Priority'
                : '📊 Set Resource Priority (add resources first)',
            value:    'priority-resources',
            disabled: !currentGroup.resources || currentGroup.resources.length === 0
        },
        menuSeparator(),
        { label: `Prompts (${currentGroup.prompts?.length ?? 0}):`, value: 'prompts-header', disabled: true },
        ..._(currentGroup.prompts ?? [])
            .sortBy('name')
            .map((prompt, index) => ({
                label: `  ${prompt.name} (${prompt.serverName})`,
                value: `view-prompt-${index}`,
            }))
            .value(),
        { label: '⚙️  Activate/Deactivate Prompts', value: 'edit-prompts' },
        {
            label: currentGroup.prompts && currentGroup.prompts.length > 0
                ? '📊 Set Prompt Priority'
                : '📊 Set Prompt Priority (add prompts first)',
            value:    'priority-prompts',
            disabled: !currentGroup.prompts || currentGroup.prompts.length === 0
        },
        menuSeparator(),
        { label: '💾 Save Group', value: 'save' },
    ];

    if(!isNewGroup) {
        menuItems.push({ label: '🗑️  Delete Group', value: 'delete' });
    }

    menuItems.push({ label: '← Cancel', value: 'cancel' });

    const title = isNewGroup ? 'Create New Group' : `Edit Group: ${groupName}`;

    // Calculate fixed UI height for virtual scrolling
    // 1 (padding) + 2 (ScreenHeader) + optional error (2 lines) + 1 (padding)
    const fixedUIHeight = error ? 6 : 4;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader title={title} />
            {error && (
                <Box marginBottom={1}>
                    <Text color="red">
                        Error:
                        {' '}
                        {error}
                    </Text>
                </Box>
            )}
            <VirtualScrollList items={menuItems} onSelect={handleMenuSelect} fixedUIHeight={fixedUIHeight} />
        </Box>
    );
}
