/**
 * Group Editor Component - Create and edit groups
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { EnhancedSelectInput } from 'ink-enhanced-select-input';
import _ from 'lodash';
import { CancellableTextInput } from './components/CancellableTextInput.js';
import type { GroupConfig, ToolOverride } from '../types/config.js';
import { ToolBrowser } from './ToolBrowser.js';
import { EnhancedToolEditor } from './components/EnhancedToolEditor.js';

interface GroupEditorProps {
    groupName: string
    group:     GroupConfig
    onSave:    (groupName: string, group: GroupConfig) => Promise<void>
    onDelete:  (groupName: string) => Promise<void>
    onCancel:  () => void
}

type EditMode = 'menu' | 'edit-name' | 'edit-description' | 'add-tool' | 'edit-tool' | 'success';

/**
 * Group editor screen
 */
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
            await onSave(currentGroup.name, groupToSave);
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
        if(item.value === 'save') {
            void handleSave();
        } else if(item.value === 'delete') {
            void handleDelete();
        } else if(item.value === 'cancel') {
            onCancel();
        } else if(item.value === 'edit-name') {
            setInputValue(currentGroup.name);
            setMode('edit-name');
        } else if(item.value === 'edit-description') {
            setInputValue(currentGroup.description ?? '');
            setMode('edit-description');
        } else if(item.value === 'add-tool') {
            setMode('add-tool');
        } else if(_.startsWith(item.value, 'remove-tool-')) {
            const index = parseInt(_.replace(item.value, 'remove-tool-', ''), 10);
            handleRemoveTool(index);
        } else if(_.startsWith(item.value, 'edit-tool-')) {
            const index = parseInt(_.replace(item.value, 'edit-tool-', ''), 10);
            setEditingToolIndex(index);
            setMode('edit-tool');
        }
    };

    const handleAddTool = (tool: ToolOverride) => {
        setCurrentGroup({
            ...currentGroup,
            tools: [...currentGroup.tools, tool],
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

    // Tool browser for adding tools
    if(mode === 'add-tool') {
        return (
            <ToolBrowser
              onBack={() => setMode('menu')}
              onSelect={handleAddTool}
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

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Group Name</Text>
                <Box marginTop={1}>
                    <Text>Name: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text dimColor>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Description input
    if(mode === 'edit-description') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Group Description</Text>
                <Box marginTop={1}>
                    <Text>Description: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleDescriptionSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text dimColor>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Show saving state
    if(saving) {
        return (
            <Box padding={1}>
                <Text>Saving...</Text>
            </Box>
        );
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
        { label: _.repeat('─', 40), value: 'sep1', disabled: true },
        { label: `Tools (${currentGroup.tools.length}):`, value: 'tools-header', disabled: true },
        ..._.map(currentGroup.tools, (tool, index) => ({
            label: `  ${tool.name ?? tool.originalName} (${tool.serverName})`,
            value: `edit-tool-${index}`,
        })),
        { label: '+ Add Tool', value: 'add-tool' },
        { label: _.repeat('─', 40), value: 'sep2', disabled: true },
        { label: '💾 Save Group', value: 'save' },
    ];

    if(!isNewGroup) {
        menuItems.push({ label: '🗑️  Delete Group', value: 'delete' });
    }

    menuItems.push({ label: '← Cancel', value: 'cancel' });
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    {isNewGroup ? 'Create New Group' : `Edit Group: ${groupName}`}
                </Text>
            </Box>
            {error && (
                <Box marginBottom={1}>
                    <Text color="red">
                        Error:
                        {error}
                    </Text>
                </Box>
            )}
            <EnhancedSelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
    );
}
