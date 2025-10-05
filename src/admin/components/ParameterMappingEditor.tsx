/**
 * Parameter Mapping Editor Component - Edit argument mappings for tools
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SelectInput } from './SelectInput.js';
import TextInput from 'ink-text-input';
import { repeat, map, keys, isArray as _isArray } from 'lodash';
import type { ArgumentMapping, TemplateMapping, ParameterMapping } from '../../types/config.js';

interface ParameterMappingEditorProps {
    /** Current argument mapping (may be undefined if none exists) */
    mapping:             ArgumentMapping | undefined
    /** Client input schema to validate against */
    clientSchema?:       Record<string, unknown>
    /** Backend input schema for reference */
    backendSchema?:      Record<string, unknown>
    /** Backend parameter name to edit directly (skips main menu) */
    initialParamToEdit?: string
    /** Called when user saves the mapping */
    onSave:              (mapping: ArgumentMapping | undefined) => void
    /** Called when user cancels */
    onCancel:            () => void
}

type EditorMode
    = | 'select-type'
      | 'select-source'
      | 'edit-mapping'
      | 'edit-value'
      | 'edit-name'
      | 'edit-description';

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
    { label: 'Omit - Hide parameter from agent', value: 'omit' },
];

/**
 * Build menu items for parameter mapping editor
 */
const buildMappingEditorMenuItems = (paramMapping: ParameterMapping): { label: string, value: string, disabled?: boolean }[] => {
    const menuItems: { label: string, value: string, disabled?: boolean }[] = [];

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
        menuItems.push({
            label: `Constant Value: ${JSON.stringify(paramMapping.value)}`,
            value: 'edit-constant',
        });
    }

    if(paramMapping.type === 'default') {
        menuItems.push({
            label: `Default Value: ${JSON.stringify(paramMapping.default)}`,
            value: 'edit-default',
        });
    }

    // Add name/description editors for non-constant/non-omit types
    if(paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename') {
        menuItems.push({
            label: `Agent Parameter Name: ${paramMapping.name ?? '(use backend name)'}`,
            value: 'edit-name',
        }, {
            label: `Agent Parameter Description: ${paramMapping.description ?? '(use backend description)'}`,
            value: 'edit-description',
        });
    }

    menuItems.push(
        { label: repeat('─', 40), value: 'sep', disabled: true } as { label: string, value: string, disabled?: boolean },
        { label: '💾 Save Parameter', value: 'save-param' },
        { label: '← Back', value: 'back' }
    );

    return menuItems;
};

/**
 * Editor for argument mappings with type-specific controls
 */
export function ParameterMappingEditor({
    mapping,
    clientSchema,
    backendSchema,
    initialParamToEdit,
    onSave,
    onCancel,
}: ParameterMappingEditorProps) {
    const [mode, setMode] = useState<EditorMode>('edit-mapping');
    const [currentMapping, setCurrentMapping] = useState<ArgumentMapping | undefined>(mapping);
    const [editState, setEditState] = useState<MappingEditorState | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [initialized, setInitialized] = useState(false);

    // Initialize with direct parameter edit if specified
    useEffect(() => {
        if(initialParamToEdit && !initialized) {
            setInitialized(true);

            const templateMapping: TemplateMapping = currentMapping?.type === 'template'
                ? currentMapping
                : { type: 'template', mappings: {} };

            const paramMapping = templateMapping.mappings[initialParamToEdit] ?? {
                type:   'passthrough',
                source: initialParamToEdit,
            };

            setEditState({ paramName: initialParamToEdit, paramMapping });
            setMode('edit-mapping');
        }
    }, [initialParamToEdit, initialized, currentMapping]);

    const getClientParams = (): string[] => {
        if(!clientSchema?.properties) {
            return [];
        }
        const props = clientSchema.properties as Record<string, unknown>;
        return keys(props);
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

    const createOmitMapping = (): ParameterMapping => ({
        type: 'omit',
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
            case 'omit':
                newParamMapping = createOmitMapping();
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
        onCancel();
    };

    const handleNameSubmit = (value: string) => {
        if(!editState) {
            return;
        }

        const { paramMapping } = editState;
        let updatedMapping = paramMapping;

        if(paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename') {
            updatedMapping = { ...paramMapping, name: value || undefined };
        }

        // Save to current mapping
        const templateMapping: TemplateMapping = currentMapping?.type === 'template'
            ? currentMapping
            : { type: 'template', mappings: {} };

        templateMapping.mappings[editState.paramName] = updatedMapping;
        setCurrentMapping(templateMapping);
        setEditState({ ...editState, paramMapping: updatedMapping });
        setMode('edit-mapping');
    };

    const handleDescriptionSubmit = (value: string) => {
        if(!editState) {
            return;
        }

        const { paramMapping } = editState;
        let updatedMapping = paramMapping;

        if(paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename') {
            updatedMapping = { ...paramMapping, description: value || undefined };
        }

        // Save to current mapping
        const templateMapping: TemplateMapping = currentMapping?.type === 'template'
            ? currentMapping
            : { type: 'template', mappings: {} };

        templateMapping.mappings[editState.paramName] = updatedMapping;
        setCurrentMapping(templateMapping);
        setEditState({ ...editState, paramMapping: updatedMapping });
        setMode('edit-mapping');
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
{'{"{"key":"value"}"}'}
                    </Text>
                </Box>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    };

    const getBackendParamInfo = (paramName: string): string => {
        if(!backendSchema?.properties) {
            return 'No schema available';
        }
        const props = backendSchema.properties as Record<string, unknown>;
        const paramSchema = props[paramName] as Record<string, unknown> | undefined;
        if(!paramSchema) {
            return 'Parameter not found in schema';
        }

        const required = _isArray(backendSchema.required) && backendSchema.required.includes(paramName);
        const type = paramSchema.type as string | undefined ?? 'unknown';
        const description = paramSchema.description as string | undefined ?? '';

        let info = `Type: ${type}`;
        if(required) {
            info += ' (required)';
        }
        if(description) {
            info += `\nDescription: ${description}`;
        }

        return info;
    };

    const renderNameEditor = () => {
        if(!editState) {
            return null;
        }

        const { paramMapping } = editState;
        const currentName = paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename'
            ? paramMapping.name
            : undefined;

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Edit Agent Parameter Name for:
{' '}
{editState.paramName}
                </Text>

                <Box marginTop={1} borderStyle="single" paddingX={1}>
                    <Box flexDirection="column">
                        <Text bold color="yellow">Backend Parameter Info:</Text>
                        <Text>{getBackendParamInfo(editState.paramName)}</Text>
                    </Box>
                </Box>

                <Box marginTop={1}>
                    <Text>Agent Parameter Name: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
                      placeholder={editState.paramName}
                    />
                </Box>

                {currentName && (
                    <Box marginTop={1}>
                        <Text dimColor>
                            Current:
{' '}
{currentName}
                        </Text>
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Leave empty to use backend name. Press Enter to save</Text>
                </Box>
            </Box>
        );
    };

    const renderDescriptionEditor = () => {
        if(!editState) {
            return null;
        }

        const { paramMapping } = editState;
        const currentDescription = paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename'
            ? paramMapping.description
            : undefined;

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Edit Agent Parameter Description for:
{' '}
{editState.paramName}
                </Text>

                <Box marginTop={1} borderStyle="single" paddingX={1}>
                    <Box flexDirection="column">
                        <Text bold color="yellow">Backend Parameter Info:</Text>
                        <Text>{getBackendParamInfo(editState.paramName)}</Text>
                    </Box>
                </Box>

                <Box marginTop={1}>
                    <Text>Agent Parameter Description: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleDescriptionSubmit}
                      placeholder="Enter description for agent"
                    />
                </Box>

                {currentDescription && (
                    <Box marginTop={1}>
                        <Text dimColor>
                            Current:
{' '}
{currentDescription}
                        </Text>
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text dimColor>Press Enter to save</Text>
                </Box>
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
                    <SelectInput
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
                    <SelectInput
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
        const menuItems = buildMappingEditorMenuItems(paramMapping);

        const handleSaveParam = () => {
            const templateMapping: TemplateMapping = currentMapping?.type === 'template'
                ? currentMapping
                : { type: 'template', mappings: {} };

            templateMapping.mappings[editState.paramName] = editState.paramMapping;

            // Always in direct parameter edit mode - save and exit to parent
            onSave(templateMapping);
        };

        const handleEditName = () => {
            const currentName = paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename'
                ? paramMapping.name ?? ''
                : '';
            setInputValue(currentName);
            setMode('edit-name');
        };

        const handleEditDescription = () => {
            const currentDescription = paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename'
                ? paramMapping.description ?? ''
                : '';
            setInputValue(currentDescription);
            setMode('edit-description');
        };

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
                case 'edit-name':
                    handleEditName();
                    break;
                case 'edit-description':
                    handleEditDescription();
                    break;
                case 'save-param':
                    handleSaveParam();
                    break;
                case 'back':
                    onCancel();
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
                    <SelectInput items={menuItems} onSelect={handleEditMenuSelect} />
                </Box>
            </Box>
        );
    };

    // Mode-based rendering
    if(mode === 'select-source') {
        return renderSourceSelector();
    }

    // Edit state required modes
    if(editState) {
        if(mode === 'edit-value') {
            return renderValueEditor();
        }
        if(mode === 'select-type') {
            return renderTypeSelector();
        }
        if(mode === 'edit-mapping') {
            return renderMappingEditor();
        }
        if(mode === 'edit-name') {
            return renderNameEditor();
        }
        if(mode === 'edit-description') {
            return renderDescriptionEditor();
        }
    }

    return null;
}
