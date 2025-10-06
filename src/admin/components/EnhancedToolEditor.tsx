/**
 * Enhanced Tool Editor Component - Edit tool overrides with full context
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { trim, repeat, isError, find, map, padEnd, filter as _filter, startsWith, truncate as _truncate } from 'lodash';
import { CancellableTextInput } from './CancellableTextInput.js';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ToolOverride, ArgumentMapping } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { MultiLineTextEditor } from './MultiLineTextEditor.js';
import { ParameterMappingEditor } from './ParameterMappingEditor.js';
import { SchemaGenerator } from '../../middleware/schema-generator.js';
import { analyzeParameters } from '../utils/parameter-analysis.js';
import { ScreenHeader } from './ui/ScreenHeader.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import { VirtualScrollList } from './ui/VirtualScrollList.js';
import { ScrollableJsonViewer } from './ui/ScrollableJsonViewer.js';
import { textSeparator, menuSeparator } from '../design-system.js';

interface EnhancedToolEditorProps {
    tool:      ToolOverride
    groupName: string
    onSave:    (tool: ToolOverride) => void
    onRemove?: () => void
    onCancel:  () => void
}

type EditMode = 'loading' | 'menu' | 'edit-name' | 'edit-description' | 'edit-argument-mapping';

const DESCRIPTION_GUIDANCE = `
✨ Writing Effective Tool Descriptions

Example:
"Searches the web using Tavily API. Accepts a query string and returns relevant results with URLs and snippets. Use for factual information and current events. Requires TAVILY_API_KEY."

Keep descriptions concise but informative (aim for 1-3 sentences):

✓ DO:
  • Start with what the tool does (action verb)
  • Specify key parameters and their purpose
  • Note important constraints or requirements
  • Mention when to use (or not use) this tool

✗ DON'T:
  • Repeat information from the tool name
  • Include implementation details
  • Use overly technical jargon
  • Make assumptions about context
`;

/**
 * Enhanced tool override editor with backend tool context
 */
export function EnhancedToolEditor({ tool, groupName, onSave, onRemove, onCancel }: EnhancedToolEditorProps) {
    const [mode, setMode] = useState<EditMode>('loading');
    const [currentTool, setCurrentTool] = useState<ToolOverride>(tool);
    const [backendTool, setBackendTool] = useState<Tool | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [initialParamToEdit, setInitialParamToEdit] = useState<string | undefined>(undefined);
    const { discoverAllTools } = useBackend();

    const schemaGenerator = useMemo(() => new SchemaGenerator(), []);

    // Generate client schema from backend schema + mapping
    const clientSchema = useMemo(() => {
        if(!currentTool.argumentMapping) {
            return backendTool?.inputSchema ?? {};
        }
        if(currentTool.argumentMapping.type === 'jsonata') {
            return backendTool?.inputSchema ?? {};
        }
        return schemaGenerator.generateClientSchema(backendTool?.inputSchema, currentTool.argumentMapping);
    }, [backendTool?.inputSchema, currentTool.argumentMapping, schemaGenerator]);

    // Analyze parameters for table display
    const parameters = useMemo(() => {
        return analyzeParameters(backendTool?.inputSchema, clientSchema, currentTool.argumentMapping);
    }, [backendTool?.inputSchema, clientSchema, currentTool.argumentMapping]);

    // Handle Esc for navigation
    useInput((input, key) => {
        if(mode === 'menu') {
            if(key.escape || key.leftArrow) {
                onCancel();
            }
        }
    });

    // Load backend tool information on mount
    useEffect(() => {
        void (async () => {
            try {
                // Discover tools using shared backend connection
                const toolsMap = await discoverAllTools();

                const serverTools = toolsMap.get(tool.serverName);
                const foundTool = find(serverTools, { name: tool.originalName });

                if(foundTool) {
                    setBackendTool(foundTool);
                    // Debug logging to see what we received
                    if(process.env.LOG_LEVEL !== 'silent') {
                        // eslint-disable-next-line no-console -- Debug logging for tool discovery
                        console.error(`[DEBUG] Found tool ${tool.originalName} from ${tool.serverName}:`, {
                            hasDescription: !!foundTool.description,
                            description:    foundTool.description,
                            hasInputSchema: !!foundTool.inputSchema,
                            inputSchema:    foundTool.inputSchema,
                        });
                    }
                } else if(process.env.LOG_LEVEL !== 'silent') {
                    // eslint-disable-next-line no-console -- Debug logging for tool discovery
                    console.error(`[DEBUG] Tool ${tool.originalName} not found in server ${tool.serverName}. Available tools:`, map(serverTools, 'name'));
                }

                setMode('menu');
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setMode('menu');
            }
        })();
    }, [tool.serverName, tool.originalName, discoverAllTools]);

    // eslint-disable-next-line complexity -- Menu handler with multiple edit modes
    const handleMenuSelect = (item: { value: string }) => {
        // Handle parameter row selection - jump directly to editing that parameter
        if(startsWith(item.value, 'param-')) {
            const indexStr = item.value.substring(6); // Remove 'param-' prefix
            const index = parseInt(indexStr, 10);
            const param = parameters[index];
            if(param) {
                setInitialParamToEdit(param.backendName);
            }
            setMode('edit-argument-mapping');
            return;
        }

        switch(item.value) {
            case 'save':
                onSave(currentTool);
                break;
            case 'remove':
                if(onRemove) {
                    onRemove();
                }
                break;
            case 'cancel':
                onCancel();
                break;
            case 'edit-name':
                setInputValue(currentTool.name ?? currentTool.originalName);
                setMode('edit-name');
                break;
            case 'edit-description':
                setInputValue(currentTool.description ?? backendTool?.description ?? '');
                setMode('edit-description');
                break;
            case 'reset-mapping':
                setCurrentTool({ ...currentTool, argumentMapping: undefined });
                break;
            case 'clear-name':
                setCurrentTool({ ...currentTool, name: undefined });
                break;
            case 'clear-description':
                setCurrentTool({ ...currentTool, description: undefined });
                break;
            default:
                break;
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

    // Loading state
    if(mode === 'loading') {
        return <LoadingScreen title="Loading Tool Information..." />;
    }

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Tool Name" />
                <Box marginTop={1}>
                    <Text>
                        Original:
                        {' '}
                        <Text bold>{currentTool.originalName}</Text>
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <Text>Override: </Text>
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

    const renderDescriptionEditor = () => {
        const originalDesc = backendTool?.description ?? '(no description)';
        const title = `Edit Tool Description - Group: ${groupName} | Tool: ${currentTool.name ?? currentTool.originalName}`;

        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title={title} />

                {/* Top row - Editor and Context */}
                <Box flexDirection="row" gap={2}>
                    {/* Left side - Editor */}
                    <Box flexDirection="column" flexGrow={1} minWidth="50%">
                        <Text bold underline>
                            Edit Description:
                        </Text>
                        <Box marginTop={1}>
                            <MultiLineTextEditor
                              value={inputValue}
                              onSubmit={handleDescriptionSubmit}
                              onCancel={() => setMode('menu')}
                              showLineNumbers={false}
                            />
                        </Box>
                    </Box>

                    {/* Right side - Original Description & Schema */}
                    <Box flexDirection="column" flexGrow={1} minWidth="40%" borderStyle="single" paddingX={1}>
                        <Text bold underline>
                            Original Description:
                        </Text>
                        <Text wrap="wrap">
                            {originalDesc}
                        </Text>

                        {backendTool?.inputSchema && (
                            <>
                                <Box marginTop={1}>
                                    <Text bold underline>
                                        Input Schema:
                                    </Text>
                                </Box>
                                <Box marginTop={1}>
                                    <ScrollableJsonViewer
                                      data={backendTool.inputSchema}
                                      viewportHeight={12}
                                      color="green"
                                    />
                                </Box>
                            </>
                        )}
                    </Box>
                </Box>

                {/* Bottom row - Guidance */}
                <Box marginTop={1} borderStyle="single" paddingX={1}>
                    <Text color="yellow">
                        {DESCRIPTION_GUIDANCE}
                    </Text>
                </Box>
            </Box>
        );
    };

    // Description input with guidance
    if(mode === 'edit-description') {
        return renderDescriptionEditor();
    }

    // Argument mapping editor
    if(mode === 'edit-argument-mapping') {
        const handleMappingSave = (mapping: ArgumentMapping | undefined) => {
            setCurrentTool({ ...currentTool, argumentMapping: mapping });
            setInitialParamToEdit(undefined);
            setMode('menu');
        };

        return (
            <ParameterMappingEditor
              mapping={currentTool.argumentMapping}
              clientSchema={backendTool?.inputSchema}
              backendSchema={backendTool?.inputSchema}
              initialParamToEdit={initialParamToEdit}
              onSave={handleMappingSave}
              onCancel={() => {
                  setInitialParamToEdit(undefined);
                  setMode('menu');
              }}
            />
        );
    }

    const buildMenuItems = () => {
        const effectiveName = currentTool.name ?? currentTool.originalName;
        const effectiveDescription = currentTool.description ?? backendTool?.description ?? '(no description)';

        const menuItems: { label: string, value: string, disabled?: boolean }[] = [];

        const descPreview = effectiveDescription.length > 80
            ? effectiveDescription.slice(0, 80) + '...'
            : effectiveDescription;

        // Calculate optimal column widths for parameter table
        const calculateColumnWidths = () => {
            if(parameters.length === 0) {
                return { backend: 16, client: 17, type: 13, details: 30 };
            }

            const backendLengths = map(parameters, 'backendName.length') as number[];
            const clientLengths = map(parameters, param => (param.clientName ?? '(hidden)').length);
            const typeLengths = map(parameters, 'mappingType.length') as number[];

            const maxBackendLen = Math.max(...backendLengths, 7);
            const maxClientLen = Math.max(...(clientLengths), 6);
            const maxTypeLen = Math.max(...typeLengths, 4);

            // Add padding within cells
            const backendWidth = Math.max(maxBackendLen + 2, 'Backend'.length + 2);
            const clientWidth = Math.max(maxClientLen + 2, 'Client'.length + 2);
            const typeWidth = Math.max(maxTypeLen + 2, 'Type'.length + 2);
            const detailsWidth = 30; // Flexible

            return { backend: backendWidth, client: clientWidth, type: typeWidth, details: detailsWidth };
        };

        const colWidths = calculateColumnWidths();

        // Tool Name
        menuItems.push(
            {
                label: `Tool Name: ${effectiveName}${currentTool.name ? ' (overridden)' : ''}`,
                value: 'edit-name',
            }
        );

        if(currentTool.name) {
            menuItems.push({ label: '  ✕ Clear Name Override', value: 'clear-name' });
        }

        // Description
        menuItems.push({
            label: `Description: ${descPreview}${currentTool.description ? ' (overridden)' : ''}`,
            value: 'edit-description',
        });

        if(currentTool.description) {
            menuItems.push({ label: '  ✕ Clear Description Override', value: 'clear-description' });
        }

        // Parameter table - always show if there are parameters
        if(parameters.length > 0) {
            const totalBackend = parameters.length;
            const totalClient = _filter(parameters, p => !p.isHidden).length;
            const totalHidden = totalBackend - totalClient;

            // Summary line
            menuItems.push({
                label:    `Argument Mapping: ${totalBackend} backend → ${totalClient} client${totalHidden > 0 ? ` (${totalHidden} hidden)` : ''}`,
                value:    'mapping-header',
                disabled: true,
            });

            // Top border
            menuItems.push({
                label:    `┌─${repeat('─', colWidths.backend)}─┬─${repeat('─', colWidths.client)}─┬─${repeat('─', colWidths.type)}─┬─${repeat('─', colWidths.details)}─┐`,
                value:    'table-top-border',
                disabled: true,
            });

            // Table header
            menuItems.push({
                label:    `│ ${padEnd('Backend', colWidths.backend)} │ ${padEnd('Client', colWidths.client)} │ ${padEnd('Type', colWidths.type)} │ ${padEnd('Details', colWidths.details)} │`,
                value:    'table-header',
                disabled: true,
            });

            // Header separator
            menuItems.push({
                label:    `├─${repeat('─', colWidths.backend)}─┼─${repeat('─', colWidths.client)}─┼─${repeat('─', colWidths.type)}─┼─${repeat('─', colWidths.details)}─┤`,
                value:    'table-header-sep',
                disabled: true,
            });

            // Parameter rows (navigable)
            const paramRows = map(parameters, (param, index) => {
                const detailsText = _truncate(param.mappingDetails, { length: colWidths.details });
                return {
                    label: `│ ${padEnd(param.backendName, colWidths.backend)} │ ${padEnd(param.clientName ?? '(hidden)', colWidths.client)} │ ${padEnd(param.mappingType, colWidths.type)} │ ${padEnd(detailsText, colWidths.details)} │`,
                    value: `param-${index}`,
                };
            });
            menuItems.push(...paramRows);

            // Bottom border
            menuItems.push({
                label:    `└─${repeat('─', colWidths.backend)}─┴─${repeat('─', colWidths.client)}─┴─${repeat('─', colWidths.type)}─┴─${repeat('─', colWidths.details)}─┘`,
                value:    'table-bottom',
                disabled: true,
            });

            // Reset option - only show if there's a custom mapping
            if(currentTool.argumentMapping) {
                menuItems.push({
                    label: '🔄 Reset all to passthrough',
                    value: 'reset-mapping',
                });
            }
        }

        // Actions separator
        menuItems.push(
            menuSeparator(60),
            { label: '💾 Save Tool', value: 'save' }
        );

        if(onRemove) {
            menuItems.push({ label: '🗑️  Remove from Group', value: 'remove' });
        }

        menuItems.push({ label: '← Cancel', value: 'cancel' });

        return menuItems;
    };

    // Build menu items
    const menuItems = buildMenuItems();
    const effectiveName = currentTool.name ?? currentTool.originalName;

    const infoSection = (
        <Box flexDirection="column" marginBottom={1}>
            <Text>
                📦 Group:
                {' '}
                <Text bold>{groupName}</Text>
            </Text>
            <Text>
                🔧 Backend Server:
                {' '}
                <Text color="yellow">{currentTool.serverName}</Text>
            </Text>
            <Text>
                📝 Original Tool Name:
                {' '}
                <Text bold>{currentTool.originalName}</Text>
            </Text>
            {error && (
                <Text color="red">
                    ⚠️  Error loading backend tool:
                    {' '}
                    {error}
                </Text>
            )}
            <Text dimColor>{textSeparator()}</Text>
        </Box>
    );

    const title = `Edit Tool: ${effectiveName}`;

    // Calculate fixed UI height for virtual scrolling
    // 1 (padding) + 2 (ScreenHeader) + info section lines + 1 (padding)
    const infoSectionHeight = error ? 6 : 5; // Info section has 5-6 lines depending on error
    const fixedUIHeight = 1 + 2 + infoSectionHeight + 1;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader title={title} />
            {infoSection}
            <VirtualScrollList items={menuItems} onSelect={handleMenuSelect} fixedUIHeight={fixedUIHeight} />
        </Box>
    );
}
