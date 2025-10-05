/**
 * Environment Variable Editor Component - Manage environment variables with individual key/value editing
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './components/SelectInput.js';
import _ from 'lodash';
import { CancellableTextInput } from './components/CancellableTextInput.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { menuSeparator } from './design-system.js';

interface EnvVarEditorProps {
    env:      Record<string, string>
    onSave:   (env: Record<string, string>) => void
    onCancel: () => void
}

type EditMode
    = | 'list'
      | 'var-menu'
      | 'edit-key'
      | 'edit-value'
      | 'confirm-delete';

interface EnvVar {
    key:   string
    value: string
}

/**
 * Editor for environment variables with per-variable editing
 */
export function EnvVarEditor({ env, onSave, onCancel }: EnvVarEditorProps) {
    const [mode, setMode] = useState<EditMode>('list');
    const [variables, setVariables] = useState<EnvVar[]>(
        _(env).toPairs().map(([key, value]) => ({ key, value })).value()
    );
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [inputValue, setInputValue] = useState('');

    // Handle Esc for navigation
    useInput((input, key) => {
        if(key.escape) {
            if(mode === 'list') {
                onCancel();
            } else if(mode === 'var-menu') {
                setSelectedIndex(null);
                setMode('list');
            } else {
                // From edit modes, go back to var-menu
                setMode('var-menu');
            }
        } else if(mode === 'list' && key.leftArrow) {
            onCancel();
        }
    });

    const handleSave = () => {
        // Convert variables array back to Record
        const newEnv = _(variables)
            .keyBy('key')
            .mapValues('value')
            .value();
        onSave(newEnv);
    };

    const handleListSelect = (item: { value: string }) => {
        const { value } = item;

        if(value === 'add') {
            // Add new variable with empty key/value
            setVariables([...variables, { key: '', value: '' }]);
            setSelectedIndex(variables.length);
            setInputValue('');
            setMode('edit-key');
        } else if(value === 'save') {
            handleSave();
        } else if(value === 'cancel') {
            onCancel();
        } else {
            // It's a variable index - show var menu
            const index = _.toNumber(value);
            setSelectedIndex(index);
            setMode('var-menu');
        }
    };

    const handleEditKey = () => {
        if(selectedIndex !== null) {
            setInputValue(variables[selectedIndex]?.key ?? '');
            setMode('edit-key');
        }
    };

    const handleEditValue = () => {
        if(selectedIndex !== null) {
            setInputValue(variables[selectedIndex]?.value ?? '');
            setMode('edit-value');
        }
    };

    const handleRemove = () => {
        setMode('confirm-delete');
    };

    const handleVarMenuSelect = (item: { value: string }) => {
        const { value } = item;

        if(value === 'edit-key') {
            handleEditKey();
        } else if(value === 'edit-value') {
            handleEditValue();
        } else if(value === 'remove') {
            handleRemove();
        } else if(value === 'back') {
            setSelectedIndex(null);
            setMode('list');
        }
    };

    const handleKeySubmit = (value: string) => {
        if(selectedIndex !== null) {
            const newVars = [...variables];
            const currentVar = newVars[selectedIndex];
            if(currentVar) {
                currentVar.key = value;
                setVariables(newVars);
            }
            setMode('var-menu');
        }
    };

    const handleValueSubmit = (value: string) => {
        if(selectedIndex !== null) {
            const newVars = [...variables];
            const currentVar = newVars[selectedIndex];
            if(currentVar) {
                currentVar.value = value;
                setVariables(newVars);
            }
            setMode('var-menu');
        }
    };

    const handleConfirmDelete = (item: { value: string }) => {
        if(item.value === 'yes' && selectedIndex !== null) {
            const newVars = _.filter(variables, (_, i) => i !== selectedIndex);
            setVariables(newVars);
            setSelectedIndex(null);
        }
        setMode('list');
    };

    // Edit key mode
    if(mode === 'edit-key') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Variable Name" />
                <Box marginTop={1}>
                    <Text>Variable Name: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleKeySubmit}
                      onCancel={() => setMode('var-menu')}
                    />
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Edit value mode
    if(mode === 'edit-value') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Variable Value" />
                <Box marginTop={1}>
                    <Text>Value: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleValueSubmit}
                      onCancel={() => setMode('var-menu')}
                    />
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // Confirm delete mode
    if(mode === 'confirm-delete' && selectedIndex !== null) {
        const varToDelete = variables[selectedIndex];
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Confirm Delete" />
                <Box marginTop={1}>
                    <Text>
                        Delete variable "
                        {varToDelete?.key}
                        "?
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <SelectInput
                      items={[
                          { label: 'Yes, delete it', value: 'yes' },
                          { label: 'No, keep it', value: 'no' },
                      ]}
                      onSelect={handleConfirmDelete}
                    />
                </Box>
            </Box>
        );
    }

    // Variable-specific menu (when a variable is selected)
    if(mode === 'var-menu' && selectedIndex !== null && variables[selectedIndex]) {
        const selectedVar = variables[selectedIndex];
        const varMenuItems = [
            { label: `Name: ${selectedVar.key}`, value: 'edit-key' },
            { label: `Value: ${selectedVar.value}`, value: 'edit-value' },
            menuSeparator(),
            { label: '🗑️  Remove variable', value: 'remove' },
            { label: '← Back to list', value: 'back' },
        ];

        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Environment Variable" />
                <SelectInput items={varMenuItems} onSelect={handleVarMenuSelect} />
            </Box>
        );
    }

    // Main list - show all variables directly with actions
    const varListItems = _.map(variables, (v, i) => ({
        label: `${v.key} = ${v.value}`,
        value: String(i),
    }));

    const listItems: { label: string, value: string, disabled?: boolean }[] = [
        ...varListItems,
        ...(varListItems.length > 0 ? [menuSeparator()] : []),
        { label: '➕ Add new variable', value: 'add' },
        { label: '💾 Save and return', value: 'save' },
        { label: '← Cancel', value: 'cancel' },
    ];

    // Calculate fixed UI height for virtual scrolling
    // 1 (padding) + 2 (ScreenHeader) + optional subtitle + 1 (padding)
    const fixedUIHeight = variables.length === 0 ? 5 : 4;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader
              title="Edit Environment Variables"
              subtitle={variables.length === 0 ? 'No variables defined yet' : undefined}
            />
            <VirtualScrollList items={listItems} onSelect={handleListSelect} fixedUIHeight={fixedUIHeight} />
        </Box>
    );
}
