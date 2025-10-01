/**
 * Tool Editor Component - Edit tool overrides
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { trim, repeat } from 'lodash';
import type { ToolOverride } from '../types/config.js';

interface ToolEditorProps {
    tool:     ToolOverride
    onSave:   (tool: ToolOverride) => void
    onCancel: () => void
}

type EditMode = 'menu' | 'edit-name' | 'edit-description' | 'edit-schema';

/**
 * Tool override editor
 */
export function ToolEditor({ tool, onSave, onCancel }: ToolEditorProps) {
    const [mode, setMode] = useState<EditMode>('menu');
    const [currentTool, setCurrentTool] = useState<ToolOverride>(tool);
    const [inputValue, setInputValue] = useState('');

    // Handle Esc for navigation - works in all modes
    useInput((input, key) => {
        if(key.escape) {
            if(mode === 'menu') {
                // Esc in menu mode goes back to parent
                onCancel();
            } else {
                // Esc in any input mode cancels and returns to menu
                setMode('menu');
            }
        } else if(mode === 'menu' && key.leftArrow) {
            // Left arrow also works in menu mode
            onCancel();
        }
    });

    const handleMenuSelect = (item: { value: string }) => {
        if(item.value === 'save') {
            onSave(currentTool);
        } else if(item.value === 'cancel') {
            onCancel();
        } else if(item.value === 'edit-name') {
            setInputValue(currentTool.name ?? currentTool.originalName);
            setMode('edit-name');
        } else if(item.value === 'edit-description') {
            setInputValue(currentTool.description ?? '');
            setMode('edit-description');
        } else if(item.value === 'clear-name') {
            setCurrentTool({ ...currentTool, name: undefined });
        } else if(item.value === 'clear-description') {
            setCurrentTool({ ...currentTool, description: undefined });
        } else if(item.value === 'edit-schema') {
            setInputValue(JSON.stringify(currentTool.inputSchema ?? {}, null, 2));
            setMode('edit-schema');
        } else if(item.value === 'clear-schema') {
            setCurrentTool({ ...currentTool, inputSchema: undefined });
        }
    };

    const handleNameSubmit = (value: string) => {
        setCurrentTool({ ...currentTool, name: trim(value) || undefined });
        setMode('menu');
    };

    const handleDescriptionSubmit = (value: string) => {
        setCurrentTool({ ...currentTool, description: trim(value) || undefined });
        setMode('menu');
    };

    const handleSchemaSubmit = (value: string) => {
        try {
            const schema = JSON.parse(value) as Record<string, unknown>;
            setCurrentTool({ ...currentTool, inputSchema: schema });
            setMode('menu');
        } catch{
            // Invalid JSON, stay in edit mode
            setInputValue(value);
        }
    };

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Tool Name Override</Text>
                <Box marginTop={1}>
                    <Text dimColor>
                        Original:
                        {currentTool.originalName}
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <Text>Override: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
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
                <Text bold>Edit Tool Description Override</Text>
                <Box marginTop={1}>
                    <Text>Description: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleDescriptionSubmit}
                    />
                </Box>
                <Text dimColor>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Schema input (JSON)
    if(mode === 'edit-schema') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Input Schema (JSON)</Text>
                <Box marginTop={1}>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleSchemaSubmit}
                    />
                </Box>
                <Text dimColor>Enter valid JSON and press Enter to save</Text>
            </Box>
        );
    }

    // Build menu items
    const menuItems = [
        {
            label:      `Server: ${currentTool.serverName}`,
            value:      'server-info',
            isDisabled: true,
        },
        {
            label:      `Original Name: ${currentTool.originalName}`,
            value:      'original-name-info',
            isDisabled: true,
        },
        { label: repeat('─', 40), value: 'separator1', isDisabled: true },
        {
            label: `Name Override: ${currentTool.name ?? '(using original)'}`,
            value: 'edit-name',
        },
    ];

    if(currentTool.name) {
        menuItems.push({ label: '  ✕ Clear Name Override', value: 'clear-name' });
    }

    menuItems.push({
        label: `Description: ${currentTool.description ? currentTool.description.slice(0, 50) + '...' : '(using original)'}`,
        value: 'edit-description',
    });

    if(currentTool.description) {
        menuItems.push({ label: '  ✕ Clear Description Override', value: 'clear-description' });
    }

    menuItems.push({
        label: `Input Schema: ${currentTool.inputSchema ? '(custom)' : '(using original)'}`,
        value: 'edit-schema',
    });

    if(currentTool.inputSchema) {
        menuItems.push({ label: '  ✕ Clear Schema Override', value: 'clear-schema' });
    }

    menuItems.push(
        { label: repeat('─', 40), value: 'separator2', isDisabled: true },
        { label: '💾 Save Tool', value: 'save' },
        { label: '← Cancel', value: 'cancel' }
    );

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Edit Tool:
                    {' '}
                    {currentTool.name ?? currentTool.originalName}
                </Text>
            </Box>
            <SelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
    );
}
