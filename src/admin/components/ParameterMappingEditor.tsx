/**
 * Parameter Mapping Editor Component - Edit argument mappings for tools
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { EnhancedSelectInput } from 'ink-enhanced-select-input';
import TextInput from 'ink-text-input';
import { repeat, map, keys, startsWith, replace } from 'lodash';
import type { ArgumentMapping, TemplateMapping, ParameterMapping } from '../../types/config.js';
import { ArgumentTransformer } from '../../middleware/argument-transformer.js';

interface ParameterMappingEditorProps {
    /** Current argument mapping (may be undefined if none exists) */
    mapping:        ArgumentMapping | undefined
    /** Client input schema to validate against */
    clientSchema?:  Record<string, unknown>
    /** Backend input schema for reference */
    backendSchema?: Record<string, unknown>
    /** Called when user saves the mapping */
    onSave:         (mapping: ArgumentMapping | undefined) => void
    /** Called when user cancels */
    onCancel:       () => void
}

type EditorMode
    = | 'menu'
      | 'select-type'
      | 'select-param'
      | 'select-source'
      | 'edit-mapping'
      | 'edit-value'
      | 'test-preview';

interface MappingEditorState {
    /** Parameter name being edited */
    paramName:    string
    /** Mapping configuration */
    paramMapping: ParameterMapping
}

const MAPPING_TYPE_OPTIONS = [
    { label: 'Passthrough - Copy parameter unchanged', value: 'passthrough' },
    { label: 'Constant - Always use a fixed value', value: 'constant' },
    { label: 'Default - Use client value or default', value: 'default' },
    { label: 'Rename - Copy from different parameter', value: 'rename' },
];

const GUIDANCE_TEXT = `
📋 Argument Mapping Guide

Template Mappings:
• Passthrough: Copy parameter from client to backend unchanged
• Constant: Always use a fixed value, ignore client input
• Default: Use client's value if provided, otherwise use default
• Rename: Copy from a different client parameter name

Each backend parameter can have one mapping.
Missing parameters won't be sent to backend.
`;

/**
 * Editor for argument mappings with type-specific controls
 */
export function ParameterMappingEditor({
    mapping,
    clientSchema,
    backendSchema,
    onSave,
    onCancel,
}: ParameterMappingEditorProps) {
    const [mode, setMode] = useState<EditorMode>('menu');
    const [currentMapping, setCurrentMapping] = useState<ArgumentMapping | undefined>(mapping);
    const [editState, setEditState] = useState<MappingEditorState | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [testInput, setTestInput] = useState('{}');
    const [testOutput, setTestOutput] = useState<string | null>(null);

    const transformer = new ArgumentTransformer();

    // Handle Esc for navigation
    useInput((input, key) => {
        if(mode === 'menu') {
            if(key.escape || key.leftArrow) {
                onCancel();
            }
        } else if(mode === 'test-preview') {
            if(key.escape) {
                setMode('menu');
            }
        } else if(mode === 'edit-value') {
            if(key.escape) {
                setMode('edit-mapping');
            }
        }
    });

    const getClientParams = (): string[] => {
        if(!clientSchema?.properties) {
            return [];
        }
        const props = clientSchema.properties as Record<string, unknown>;
        return keys(props);
    };

    const getBackendParams = (): string[] => {
        if(!backendSchema?.properties) {
            return [];
        }
        const props = backendSchema.properties as Record<string, unknown>;
        return keys(props);
    };

    const handleRemoveParam = (paramName: string) => {
        if(currentMapping?.type === 'template') {
            const newMappings = { ...currentMapping.mappings };
            delete newMappings[paramName];
            setCurrentMapping({
                type:     'template',
                mappings: newMappings,
            });
        }
    };

    const handleEditParam = (paramName: string) => {
        if(currentMapping?.type === 'template') {
            const paramMapping = currentMapping.mappings[paramName];
            if(paramMapping) {
                setEditState({ paramName, paramMapping });
                setMode('edit-mapping');
            }
        }
    };

    const handleMenuSelect = (item: { value: string }) => {
        switch(item.value) {
            case 'save':
                onSave(currentMapping);
                break;
            case 'cancel':
                onCancel();
                break;
            case 'clear-mapping':
                setCurrentMapping(undefined);
                break;
            case 'add-param':
                setMode('select-param');
                break;
            case 'test-preview':
                setMode('test-preview');
                break;
            case 'remove-template':
                setCurrentMapping(undefined);
                break;
            default:
                // Editing specific parameter
                if(startsWith(item.value, 'edit-')) {
                    const paramName = replace(item.value, 'edit-', '');
                    handleEditParam(paramName);
                } else if(startsWith(item.value, 'remove-')) {
                    const paramName = replace(item.value, 'remove-', '');
                    handleRemoveParam(paramName);
                }
                break;
        }
    };

    const handleParamSelect = (item: { value: string }) => {
        if(item.value === 'cancel') {
            setMode('menu');
            return;
        }

        // Initialize new parameter mapping with passthrough
        const newMapping: ParameterMapping = {
            type:   'passthrough',
            source: item.value,
        };

        setEditState({
            paramName:    item.value,
            paramMapping: newMapping,
        });
        setMode('edit-mapping');
    };

    const createPassthroughMapping = (paramName: string): ParameterMapping => ({
        type:   'passthrough',
        source: paramName,
    });

    const createConstantMapping = (): ParameterMapping => ({
        type:  'constant',
        value: '',
    });

    const createDefaultMapping = (paramName: string): ParameterMapping => ({
        type:      'default',
        source:    paramName,
        'default': '',
    });

    const createRenameMapping = (): ParameterMapping => ({
        type:   'rename',
        source: '',
    });

    const handleMappingTypeSelect = (item: { value: string }) => {
        if(!editState) {
            return;
        }

        let newParamMapping: ParameterMapping;

        switch(item.value) {
            case 'passthrough':
                newParamMapping = createPassthroughMapping(editState.paramName);
                break;
            case 'constant':
                newParamMapping = createConstantMapping();
                break;
            case 'default':
                newParamMapping = createDefaultMapping(editState.paramName);
                break;
            case 'rename':
                newParamMapping = createRenameMapping();
                break;
            default:
                return;
        }

        setEditState({ ...editState, paramMapping: newParamMapping });
        setMode('edit-mapping');
    };

    const updateMappingValue = (mapping: ParameterMapping, parsedValue: unknown): ParameterMapping => {
        if(mapping.type === 'constant') {
            return { ...mapping, value: parsedValue };
        }
        if(mapping.type === 'default') {
            return { ...mapping, 'default': parsedValue };
        }
        return mapping;
    };

    const handleValueSubmit = (value: string) => {
        if(!editState) {
            return;
        }

        let parsedValue: unknown = value;
        // Try to parse as JSON for non-string values
        try {
            parsedValue = JSON.parse(value) as unknown;
        } catch{
            // Use as string if not valid JSON
            parsedValue = value;
        }

        const updatedMapping = updateMappingValue(editState.paramMapping, parsedValue);

        // Save to current mapping
        const templateMapping: TemplateMapping = currentMapping?.type === 'template'
            ? currentMapping
            : { type: 'template', mappings: {} };

        templateMapping.mappings[editState.paramName] = updatedMapping;
        setCurrentMapping(templateMapping);
        setEditState(null);
        setMode('menu');
    };

    const updateMappingSource = (mapping: ParameterMapping, source: string): ParameterMapping => {
        if(mapping.type === 'rename') {
            return { ...mapping, source };
        }
        if(mapping.type === 'default') {
            return { ...mapping, source };
        }
        if(mapping.type === 'passthrough') {
            return { ...mapping, source };
        }
        return mapping;
    };

    const handleSourceSelect = (item: { value: string }) => {
        if(!editState) {
            return;
        }

        const updatedMapping = updateMappingSource(editState.paramMapping, item.value);

        setEditState({ ...editState, paramMapping: updatedMapping });
        setMode('edit-mapping');
    };

    const handleTestPreview = async () => {
        if(!currentMapping) {
            return;
        }

        try {
            const input = JSON.parse(testInput) as unknown;
            const result = await transformer.test(input, currentMapping);

            if(result.success) {
                setTestOutput(JSON.stringify(result.output, null, 2));
            } else {
                setTestOutput(`Error: ${result.error}`);
            }
        } catch (err) {
            setTestOutput(`Invalid JSON: ${String(err)}`);
        }
    };

    const renderTestPreview = () => {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">Test Argument Mapping</Text>

                <Box marginTop={1}>
                    <Text>Sample Input (JSON): </Text>
                </Box>
                <Box marginLeft={2}>
                    <TextInput
                      value={testInput}
                      onChange={setTestInput}
                      onSubmit={() => void handleTestPreview()}
                    />
                </Box>

                {testOutput && (
                    <Box marginTop={1} flexDirection="column">
                        <Text bold>Output:</Text>
                        <Box marginLeft={2} borderStyle="single" paddingX={1}>
                            <Text color="green">{testOutput}</Text>
                        </Box>
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press Enter to test, Esc to return to menu</Text>
                </Box>
            </Box>
        );
    };

    const renderValueEditor = () => {
        if(!editState) {
            return null;
        }

        const isConstant = editState.paramMapping.type === 'constant';
        const label = isConstant ? 'Constant Value' : 'Default Value';

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Edit
{' '}
{label}
{' '}
for:
{' '}
{editState.paramName}
                </Text>
                <Box marginTop={1}>
                    <Text>Value (use JSON for non-strings): </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleValueSubmit}
                    />
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>
Examples: "text", 123, true,
{'{"key":"value"}'}
                    </Text>
                </Box>
                <Text dimColor>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    };

    const renderTypeSelector = () => {
        if(!editState) {
            return null;
        }

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Select Mapping Type for:
{' '}
{editState.paramName}
                </Text>
                <Box marginTop={1}>
                    <EnhancedSelectInput
                      items={MAPPING_TYPE_OPTIONS}
                      onSelect={handleMappingTypeSelect}
                    />
                </Box>
            </Box>
        );
    };

    const renderSourceSelector = () => {
        if(!editState) {
            return null;
        }

        const clientParams = getClientParams();
        const sourceItems = map(clientParams, param => ({
            label: param,
            value: param,
        }));
        sourceItems.push({ label: '← Cancel', value: 'cancel' });

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Select Source Parameter for:
{' '}
{editState.paramName}
                </Text>
                <Box marginTop={1}>
                    <EnhancedSelectInput
                      items={sourceItems}
                      onSelect={handleSourceSelect}
                    />
                </Box>
            </Box>
        );
    };

    const renderMappingEditor = () => {
        if(!editState) {
            return null;
        }

        const { paramMapping } = editState;

        const menuItems: { label: string, value: string }[] = [];

        menuItems.push({
            label: `Type: ${paramMapping.type}`,
            value: 'change-type',
        });

        if(paramMapping.type === 'passthrough' || paramMapping.type === 'rename' || paramMapping.type === 'default') {
            menuItems.push({
                label: `Source Parameter: ${paramMapping.source || '(not set)'}`,
                value: 'select-source',
            });
        }

        if(paramMapping.type === 'constant') {
            const valueStr = JSON.stringify(paramMapping.value);
            menuItems.push({
                label: `Constant Value: ${valueStr}`,
                value: 'edit-constant',
            });
        }

        if(paramMapping.type === 'default') {
            const defaultStr = JSON.stringify(paramMapping.default);
            menuItems.push({
                label: `Default Value: ${defaultStr}`,
                value: 'edit-default',
            });
        }

        menuItems.push(
            { label: repeat('─', 40), value: 'sep' },
            { label: '💾 Save Parameter', value: 'save-param' },
            { label: '← Back', value: 'back' }
        );

        const handleEditMenuSelect = (item: { value: string }) => {
            switch(item.value) {
                case 'change-type':
                    setMode('select-type');
                    break;
                case 'select-source':
                    setMode('select-source');
                    break;
                case 'edit-constant':
                    setInputValue(JSON.stringify(paramMapping.type === 'constant' ? paramMapping.value : ''));
                    setMode('edit-value');
                    break;
                case 'edit-default':
                    setInputValue(JSON.stringify(paramMapping.type === 'default' ? paramMapping.default : ''));
                    setMode('edit-value');
                    break;
                case 'save-param':
                    {
                        const templateMapping: TemplateMapping = currentMapping?.type === 'template'
                            ? currentMapping
                            : { type: 'template', mappings: {} };

                        templateMapping.mappings[editState.paramName] = editState.paramMapping;
                        setCurrentMapping(templateMapping);
                        setEditState(null);
                        setMode('menu');
                    }
                    break;
                case 'back':
                    setEditState(null);
                    setMode('menu');
                    break;
            }
        };

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Edit Mapping for:
{' '}
{editState.paramName}
                </Text>
                <Box marginTop={1}>
                    <EnhancedSelectInput items={menuItems} onSelect={handleEditMenuSelect} />
                </Box>
            </Box>
        );
    };

    const renderParamSelector = () => {
        const backendParams = getBackendParams();
        const paramItems = map(backendParams, param => ({
            label: param,
            value: param,
        }));
        paramItems.push({ label: '← Cancel', value: 'cancel' });

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Select Backend Parameter to Map
                </Text>
                <Box marginTop={1}>
                    <EnhancedSelectInput items={paramItems} onSelect={handleParamSelect} />
                </Box>
            </Box>
        );
    };

    // Mode-based rendering
    if(mode === 'test-preview') {
        return renderTestPreview();
    }

    if(mode === 'edit-value' && editState) {
        return renderValueEditor();
    }

    if(mode === 'select-type' && editState) {
        return renderTypeSelector();
    }

    if(mode === 'edit-mapping' && editState) {
        return renderMappingEditor();
    }

    if(mode === 'select-param') {
        return renderParamSelector();
    }

    if(mode === 'select-source') {
        return renderSourceSelector();
    }

    // Main menu
    const buildMenuItems = () => {
        const menuItems: { label: string, value: string, disabled?: boolean }[] = [];

        if(!currentMapping) {
            menuItems.push(
                { label: '➕ Add Template Mapping', value: 'add-param' },
                { label: repeat('─', 60), value: 'sep1', disabled: true }
            );
        } else if(currentMapping.type === 'template') {
            // Show existing mappings
            menuItems.push({ label: '📋 Current Mappings:', value: 'header', disabled: true });

            const mappingEntries = Object.entries(currentMapping.mappings);
            if(mappingEntries.length === 0) {
                menuItems.push({ label: '  (no parameters mapped)', value: 'empty', disabled: true });
            } else {
                for(const [paramName, paramMapping] of mappingEntries) {
                    let description = '';
                    switch(paramMapping.type) {
                        case 'passthrough':
                            description = `← ${paramMapping.source}`;
                            break;
                        case 'constant':
                            description = `= ${JSON.stringify(paramMapping.value)}`;
                            break;
                        case 'default':
                            description = `${paramMapping.source} || ${JSON.stringify(paramMapping.default)}`;
                            break;
                        case 'rename':
                            description = `← ${paramMapping.source} (renamed)`;
                            break;
                    }
                    menuItems.push({
                        label: `  ${paramName}: ${description}`,
                        value: `edit-${paramName}`,
                    });
                    menuItems.push({
                        label: '    ✕ Remove',
                        value: `remove-${paramName}`,
                    });
                }
            }

            menuItems.push(
                { label: repeat('─', 60), value: 'sep2', disabled: true },
                { label: '➕ Add Parameter Mapping', value: 'add-param' },
                { label: '🧪 Test Preview', value: 'test-preview' },
                { label: '🗑️  Remove All Mappings', value: 'remove-template' }
            );
        }

        menuItems.push(
            { label: repeat('─', 60), value: 'sep3', disabled: true },
            { label: '💾 Save', value: 'save' },
            { label: '← Cancel', value: 'cancel' }
        );

        return menuItems;
    };

    const menuItems = buildMenuItems();

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Edit Argument Mapping
                </Text>
            </Box>

            <Box marginBottom={1} borderStyle="single" paddingX={1}>
                <Text color="yellow">{GUIDANCE_TEXT}</Text>
            </Box>

            {backendSchema && (
                <Box marginBottom={1}>
                    <Text dimColor>
                        Backend Parameters:
{' '}
{getBackendParams().join(', ') || '(none)'}
                    </Text>
                </Box>
            )}

            <EnhancedSelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
    );
}
