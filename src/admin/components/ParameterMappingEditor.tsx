/**
 * Parameter Mapping Editor Component - Edit argument mappings for tools
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './SelectInput.js';
import { CancellableTextInput } from './CancellableTextInput.js';
import { map, keys, isArray as _isArray } from 'lodash';
import type { ArgumentMapping, TemplateMapping, ParameterMapping } from '../../types/config.js';
import { ScreenHeader } from './ui/ScreenHeader.js';
import { ScrollableJsonViewer } from './ui/ScrollableJsonViewer.js';
import { menuSeparator } from '../design-system.js';

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
        menuSeparator(),
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
    const [editState, setEditState] = useState<MappingEditorState | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [initialized, setInitialized] = useState(false);

    // Handle Esc key in edit-mapping mode
    useInput((input, key) => {
        if(mode === 'edit-mapping' && key.escape) {
            onCancel();
        }
    });

    // Initialize with direct parameter edit if specified
    useEffect(() => {
        if(initialParamToEdit && !initialized) {
            setInitialized(true);

            const templateMapping: TemplateMapping = mapping?.type === 'template'
                ? mapping
                : { type: 'template', mappings: {} };

            const paramMapping = templateMapping.mappings[initialParamToEdit] ?? {
                type:   'passthrough',
                source: initialParamToEdit,
            };

            setEditState({ paramName: initialParamToEdit, paramMapping });
            setMode('edit-mapping');
        }
    }, [initialParamToEdit, initialized, mapping]);

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

        setEditState({ ...editState, paramMapping: updatedMapping });
        setMode('edit-mapping');
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

        const title = `Edit ${label} for: ${editState.paramName}`;
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />
                <Box marginTop={1}>
                    <Text>Value (use JSON for non-strings): </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleValueSubmit}
                      onCancel={() => setMode('edit-mapping')}
                    />
                </Box>
                <Box marginTop={1}>
                    <Text>
Examples: "text", 123, true,
{'{"{"key":"value"}"}'}
                    </Text>
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
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

        const title = `Edit Agent Parameter Name for: ${editState.paramName}`;
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />

                <Box marginTop={1} borderStyle="single" paddingX={1}>
                    <Box flexDirection="column">
                        <Text color="yellow">Backend Parameter Info:</Text>
                        <Text>{getBackendParamInfo(editState.paramName)}</Text>
                    </Box>
                </Box>

                <Box marginTop={1}>
                    <Text>Agent Parameter Name: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
                      onCancel={() => setMode('edit-mapping')}
                      placeholder={editState.paramName}
                    />
                </Box>

                {currentName && (
                    <Box marginTop={1}>
                        <Text>
                            Current:
{' '}
{currentName}
                        </Text>
                    </Box>
                )}

                <Box marginTop={1}>
                    <Text>Leave empty to use backend name. Press Enter to save, Esc to cancel</Text>
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

        const title = `Edit Agent Parameter Description for: ${editState.paramName}`;

        // Get backend parameter schema for display
        const backendParamSchema = backendSchema?.properties
            ? (backendSchema.properties as Record<string, unknown>)[editState.paramName]
            : undefined;

        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />

                {/* Top row - Editor and Schema */}
                <Box flexDirection="row" gap={2}>
                    {/* Left side - Editor */}
                    <Box flexDirection="column" flexGrow={1} minWidth="50%">
                        <Text bold underline>
                            Edit Description:
                        </Text>
                        <Box marginTop={1}>
                            <Text>Agent Parameter Description: </Text>
                            <CancellableTextInput
                              value={inputValue}
                              onChange={setInputValue}
                              onSubmit={handleDescriptionSubmit}
                              onCancel={() => setMode('edit-mapping')}
                              placeholder="Enter description for agent"
                            />
                        </Box>

                        {currentDescription && (
                            <Box marginTop={1}>
                                <Text>
                                    Current:
{' '}
{currentDescription}
                                </Text>
                            </Box>
                        )}
                    </Box>

                    {/* Right side - Backend Parameter Schema */}
                    <Box flexDirection="column" flexGrow={1} minWidth="40%" borderStyle="single" paddingX={1}>
                        <Text bold underline>
                            Backend Parameter Schema:
                        </Text>
                        {backendParamSchema
                            ? (
                                <Box marginTop={1}>
                                    <ScrollableJsonViewer
                                      data={backendParamSchema as Record<string, unknown>}
                                      viewportHeight={12}
                                      color="green"
                                    />
                                </Box>
                            )
                            : (
                                <Box marginTop={1}>
                                    <Text>No schema available</Text>
                                </Box>
                            )}
                    </Box>
                </Box>

                <Box marginTop={1}>
                    <Text>Leave empty to use backend description. Press Enter to save, Esc to cancel</Text>
                </Box>
            </Box>
        );
    };

    const renderTypeSelector = () => {
        if(!editState) {
            return null;
        }

        const title = `Select Mapping Type for: ${editState.paramName}`;
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />
                <SelectInput
                  items={MAPPING_TYPE_OPTIONS}
                  onSelect={handleMappingTypeSelect}
                />
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

        const title = `Select Source Parameter for: ${editState.paramName}`;
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />
                <SelectInput
                  items={sourceItems}
                  onSelect={handleSourceSelect}
                />
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
            const templateMapping: TemplateMapping = mapping?.type === 'template'
                ? mapping
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

        const title = `Edit Mapping for: ${editState.paramName}`;
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />
                <SelectInput items={menuItems} onSelect={handleEditMenuSelect} />
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
