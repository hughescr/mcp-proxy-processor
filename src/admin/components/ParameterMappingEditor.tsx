/**
 * Parameter Mapping Editor Component - Edit argument mappings for tools
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './SelectInput.js';
import TextInput from 'ink-text-input';
import { MultiLineTextEditor } from './MultiLineTextEditor.js';
import { repeat, map, keys, startsWith, replace, isArray as _isArray } from 'lodash';
import type { ArgumentMapping, TemplateMapping, ParameterMapping, JsonataMapping } from '../../types/config.js';
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
      | 'edit-name'
      | 'edit-description'
      | 'edit-jsonata-expression'
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
    { label: 'Omit - Hide parameter from agent', value: 'omit' },
];

const GUIDANCE_TEXT = `
📋 Argument Mapping Guide

Template Mappings:
• Passthrough: Copy parameter from client to backend unchanged
  - Use 'name' field to rename the parameter for the agent
• Constant: Always use a fixed value, ignore client input
• Default: Use client's value if provided, otherwise use default
  - Use 'name' field to rename the parameter for the agent
• Omit: Hide parameter from agent (not included in schema)

JSONata Expressions:
• Complex transformations with conditional logic
• Object restructuring and nested value extraction
• String manipulation and array operations
• Full JSONata expression language support

Each backend parameter can have one mapping.
Missing parameters won't be sent to backend.
`;

const JSONATA_GUIDANCE = `
📋 JSONata Expression Guide

JSONata provides powerful transformation capabilities:

• Access client args directly: query, limit, timezone
• Conditional logic: condition ? trueValue : falseValue
• Default values: field ? field : "default"
• Object restructuring: { "newKey": oldKey, "nested": { "value": field } }
• String operations: $uppercase(name), $substring(text, 0, 10)
• Array operations: items[0], $map(items, function($i) { $i.name })

Example:
{
  "search": {
    "q": query,
    "limit": limit ? limit : 10
  },
  "apiKey": "secret-key",
  "timezone": timezone ? timezone : "UTC"
}

The expression receives client arguments as input and must return
the object to send to the backend server.
`;

/**
 * Handle keyboard input for navigation
 */
const useEditorKeyboardNav = (
    mode: EditorMode,
    setMode: (mode: EditorMode) => void,
    onCancel: () => void
) => {
    useInput((_input, key) => {
        if(mode === 'menu' && (key.escape || key.leftArrow)) {
            onCancel();
        } else if(mode === 'test-preview' && key.escape) {
            setMode('menu');
        }
    });
};

/**
 * Get parameter mapping description for menu display
 */
const getParamMappingDescription = (paramMapping: ParameterMapping): string => {
    switch(paramMapping.type) {
        case 'passthrough':
            return `← ${paramMapping.source}`;
        case 'constant':
            return `= ${JSON.stringify(paramMapping.value)}`;
        case 'default':
            return `${paramMapping.source} || ${JSON.stringify(paramMapping.default)}`;
        case 'rename':
            return `← ${paramMapping.source} (renamed)`;
        case 'omit':
            return '(omitted from agent)';
    }
};

/**
 * Check if parameter mapping type has name/description overrides
 */
const hasNameDescriptionOverrides = (type: ParameterMapping['type']): boolean => {
    return type !== 'constant' && type !== 'omit';
};

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
    if(hasNameDescriptionOverrides(paramMapping.type) && (paramMapping.type === 'passthrough' || paramMapping.type === 'default' || paramMapping.type === 'rename')) {
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
    useEditorKeyboardNav(mode, setMode, onCancel);
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
            case 'add-jsonata':
                setInputValue('');
                setMode('edit-jsonata-expression');
                break;
            case 'edit-jsonata':
                setInputValue(currentMapping?.type === 'jsonata' ? currentMapping.expression : '');
                setMode('edit-jsonata-expression');
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
        setMode('menu');
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
            setCurrentMapping(templateMapping);
            setEditState(null);
            setMode('menu');
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
                    <SelectInput items={menuItems} onSelect={handleEditMenuSelect} />
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
                    <SelectInput items={paramItems} onSelect={handleParamSelect} />
                </Box>
            </Box>
        );
    };

    const handleJsonataSubmit = (expression: string) => {
        const jsonataMapping: JsonataMapping = {
            type:       'jsonata',
            expression: expression,
        };
        setCurrentMapping(jsonataMapping);
        setMode('menu');
    };

    const renderJsonataEditor = () => {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Edit JSONata Expression
                    </Text>
                </Box>

                <Box flexDirection="row" gap={2}>
                    {/* Left side - Editor */}
                    <Box flexDirection="column" flexGrow={1} minWidth="50%">
                        <Text bold underline>
                            JSONata Expression:
                        </Text>
                        <Box marginTop={1}>
                            <MultiLineTextEditor
                              value={inputValue}
                              onSubmit={handleJsonataSubmit}
                              onCancel={() => setMode('menu')}
                              showLineNumbers={false}
                            />
                        </Box>
                    </Box>

                    {/* Right side - Guidance */}
                    <Box flexDirection="column" flexGrow={1} minWidth="40%" borderStyle="single" paddingX={1}>
                        <Text color="yellow">
                            {JSONATA_GUIDANCE}
                        </Text>
                    </Box>
                </Box>
            </Box>
        );
    };

    const buildMenuItems = () => {
        const menuItems: { label: string, value: string, disabled?: boolean }[] = [];

        if(!currentMapping) {
            menuItems.push(
                { label: '➕ Add Template Mapping', value: 'add-param' },
                { label: '➕ Add JSONata Expression', value: 'add-jsonata' },
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
                    const description = getParamMappingDescription(paramMapping);
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
        } else if(currentMapping.type === 'jsonata') {
            // Show JSONata expression
            const expressionPreview = currentMapping.expression.length > 100
                ? currentMapping.expression.slice(0, 100) + '...'
                : currentMapping.expression;

            menuItems.push(
                { label: '📋 Current JSONata Expression:', value: 'header', disabled: true },
                { label: `  ${expressionPreview}`, value: 'edit-jsonata' },
                { label: repeat('─', 60), value: 'sep2', disabled: true },
                { label: '🧪 Test Preview', value: 'test-preview' },
                { label: '🗑️  Remove Expression', value: 'remove-template' }
            );
        }

        menuItems.push(
            { label: repeat('─', 60), value: 'sep3', disabled: true },
            { label: '💾 Save', value: 'save' },
            { label: '← Cancel', value: 'cancel' }
        );

        return menuItems;
    };

    const renderMainMenu = () => {
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

                <SelectInput items={menuItems} onSelect={handleMenuSelect} />
            </Box>
        );
    };

    // Mode-based rendering
    if(mode === 'edit-jsonata-expression') {
        return renderJsonataEditor();
    }
    if(mode === 'test-preview') {
        return renderTestPreview();
    }
    if(mode === 'select-param') {
        return renderParamSelector();
    }
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

    // Default to main menu
    return renderMainMenu();
}
