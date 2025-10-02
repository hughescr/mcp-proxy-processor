/**
 * Server Editor Component - Create and edit backend MCP servers
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { EnhancedSelectInput } from 'ink-enhanced-select-input';
import TextInput from 'ink-text-input';
import _ from 'lodash';
import type { BackendServerConfig, StdioServerConfig, StreamableHttpServerConfig, SseServerConfig } from '../types/config.js';
import { BackendServerConfigSchema } from '../types/config.js';
import { EnvVarEditor } from './EnvVarEditor.js';

interface ServerEditorProps {
    serverName: string
    server:     BackendServerConfig
    onSave:     (serverName: string, server: BackendServerConfig) => Promise<void>
    onDelete:   (serverName: string) => Promise<void>
    onCancel:   () => void
}

type EditMode
    = | 'menu'
      | 'edit-name'
      | 'edit-transport'
      | 'edit-command-line'
      | 'edit-env'
      | 'edit-cwd'
      | 'edit-url'
      | 'edit-headers'
      | 'edit-json';

type TransportType = 'stdio' | 'streamable-http' | 'sse';

/**
 * Get transport type from server config
 */
function getTransportType(config: BackendServerConfig): TransportType {
    if('type' in config) {
        return config.type;
    }
    return 'stdio';
}

/**
 * Server editor screen with support for form-based and JSON-based editing
 */
// eslint-disable-next-line complexity -- UI state machine inherently complex
export function ServerEditor({ serverName, server, onSave, onDelete, onCancel }: ServerEditorProps) {
    const [mode, setMode] = useState<EditMode>('menu');
    const [currentServerName, setCurrentServerName] = useState(serverName);
    const [currentServer, setCurrentServer] = useState<BackendServerConfig>(server);
    const [inputValue, setInputValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isNewServer = serverName === '';
    const transportType = getTransportType(currentServer);

    // Handle Esc for navigation
    // Note: Don't handle ESC for modes using TextInput - user must press Enter
    // edit-env is a separate component that handles its own ESC
    useInput((input, key) => {
        if(key.escape) {
            if(mode === 'menu' && !saving) {
                // Esc in menu mode goes back to parent
                onCancel();
            }
            // Don't handle ESC in text input modes - TextInput doesn't have onCancel
            // edit-env has its own input handler
        } else if(mode === 'menu' && !saving && key.leftArrow) {
            // Left arrow also works in menu mode
            onCancel();
        }
    });

    const handleSave = async () => {
        // Validate
        if(!_.trim(currentServerName)) {
            setError('Server name is required');
            return;
        }

        try {
            // Validate server config
            BackendServerConfigSchema.parse(currentServer);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            return;
        }

        setSaving(true);
        try {
            await onSave(currentServerName, currentServer);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setSaving(true);
        try {
            await onDelete(serverName);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            setSaving(false);
        }
    };

    // eslint-disable-next-line complexity -- Menu selection handler with many options
    const handleMenuSelect = (item: { value: string }) => {
        const { value } = item;

        // Handle actions
        if(value === 'save') {
            void handleSave();
            return;
        }
        if(value === 'delete') {
            void handleDelete();
            return;
        }
        if(value === 'cancel') {
            onCancel();
            return;
        }

        // Handle field editors
        if(value === 'edit-name') {
            setInputValue(currentServerName);
            setMode('edit-name');
        } else if(value === 'edit-transport') {
            setMode('edit-transport');
        } else if(value === 'edit-command-line') {
            // Combine command and args into a single shell-style command line
            if('command' in currentServer) {
                const command = currentServer.command;
                const args = currentServer.args ?? [];
                // Quote arguments that contain spaces or special characters
                const quotedArgs = _.map(args, (arg) => {
                    if(/[\s"'\\]/.test(arg)) {
                        // Escape quotes and backslashes, then wrap in quotes
                        return `"${_.replace(_.replace(arg, /\\/g, '\\\\'), /"/g, '\\"')}"`;
                    }
                    return arg;
                });
                setInputValue(_.join([command, ...quotedArgs], ' '));
            } else {
                setInputValue('');
            }
            setMode('edit-command-line');
        } else if(value === 'edit-env') {
            setMode('edit-env');
        } else if(value === 'edit-cwd') {
            setInputValue('cwd' in currentServer && currentServer.cwd ? currentServer.cwd : '');
            setMode('edit-cwd');
        } else if(value === 'edit-url') {
            setInputValue('url' in currentServer ? currentServer.url : '');
            setMode('edit-url');
        } else if(value === 'edit-headers') {
            const headers = 'headers' in currentServer && currentServer.headers ? currentServer.headers : {};
            setInputValue(_(headers).toPairs().map(([k, v]) => `${k}: ${v}`)
                .join('\n'));
            setMode('edit-headers');
        } else if(value === 'edit-json') {
            // Convert current config to JSON for editing
            setInputValue(JSON.stringify({ [currentServerName || 'server-name']: currentServer }, null, 2));
            setMode('edit-json');
        }
    };

    const handleNameSubmit = (value: string) => {
        setCurrentServerName(value);
        setMode('menu');
    };

    const handleTransportSelect = (item: { value: string }) => {
        const newType = item.value as TransportType;

        if(newType === 'stdio') {
            setCurrentServer({
                command: '',
                args:    [],
                env:     {},
            } satisfies StdioServerConfig);
        } else if(newType === 'streamable-http') {
            setCurrentServer({
                type:    'streamable-http',
                url:     '',
                headers: {},
            } satisfies StreamableHttpServerConfig);
        } else if(newType === 'sse') {
            setCurrentServer({
                type:    'sse',
                url:     '',
                headers: {},
            } satisfies SseServerConfig);
        }

        setMode('menu');
    };

    // eslint-disable-next-line complexity -- Shell parsing inherently complex
    const handleCommandLineSubmit = (value: string) => {
        // Parse shell-style command line into command and args
        const trimmed = _.trim(value);
        if(!trimmed) {
            setMode('menu');
            return;
        }

        // Simple shell-style parser that handles quoted strings
        const parts: string[] = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';
        let escaped = false;

        const chars = _.split(trimmed, '');
        for(const char of chars) {
            if(escaped) {
                current += char;
                escaped = false;
                continue;
            }

            if(char === '\\') {
                escaped = true;
                continue;
            }

            if((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
                continue;
            }

            if(char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
                continue;
            }

            if(char === ' ' && !inQuotes) {
                if(current) {
                    parts.push(current);
                    current = '';
                }
                continue;
            }

            current += char;
        }

        if(current) {
            parts.push(current);
        }

        if(parts.length === 0) {
            setMode('menu');
            return;
        }

        const [command, ...args] = parts;

        if('command' in currentServer || !('type' in currentServer)) {
            setCurrentServer({
                ...currentServer,
                command,
                args: args.length > 0 ? args : undefined,
            });
        }
        setMode('menu');
    };

    const handleEnvSave = (env: Record<string, string>) => {
        if('env' in currentServer || !('type' in currentServer)) {
            setCurrentServer({ ...currentServer, env });
        }
        setMode('menu');
    };

    const handleCwdSubmit = (value: string) => {
        if('cwd' in currentServer || !('type' in currentServer)) {
            setCurrentServer({ ...currentServer, cwd: value || undefined });
        }
        setMode('menu');
    };

    const handleUrlSubmit = (value: string) => {
        if('url' in currentServer) {
            setCurrentServer({ ...currentServer, url: value });
        }
        setMode('menu');
    };

    const handleHeadersSubmit = (value: string) => {
        const headers: Record<string, string> = {};
        const trimmed = _.trim(value);
        if(trimmed) {
            _.forEach(_.split(trimmed, '\n'), (line) => {
                const parts = _.split(line, ':');
                const key = _.head(parts);
                const valueParts = _.tail(parts);
                if(key && valueParts.length > 0) {
                    headers[_.trim(key)] = _.trim(_.join(valueParts, ':'));
                }
            });
        }
        if('headers' in currentServer) {
            setCurrentServer({ ...currentServer, headers });
        }
        setMode('menu');
    };

    const handleJsonSubmit = (value: string) => {
        try {
            const parsed: unknown = JSON.parse(value);

            // Try to extract server config from the JSON
            let serverConfig: BackendServerConfig;

            if(_.isObject(parsed) && parsed !== null) {
                // Check if it's a wrapped format like { "server-name": { config } }
                const entries = _.toPairs(parsed);
                if(entries.length === 1) {
                    const [name, config] = entries[0] as [string, unknown];
                    setCurrentServerName(name);
                    serverConfig = BackendServerConfigSchema.parse(config);
                } else {
                    // Assume it's a direct server config
                    serverConfig = BackendServerConfigSchema.parse(parsed);
                }

                setCurrentServer(serverConfig);
                setError(null);
                setMode('menu');
            } else {
                setError('Invalid JSON format');
            }
        } catch (err) {
            setError(`Invalid JSON: ${_.isError(err) ? err.message : String(err)}`);
        }
    };

    // Transport type selector
    if(mode === 'edit-transport') {
        const transportItems = [
            { label: 'stdio (Standard Input/Output)', value: 'stdio' },
            { label: 'streamable-http (Streamable HTTP)', value: 'streamable-http' },
            { label: 'sse (Server-Sent Events - legacy)', value: 'sse' },
        ];

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Select Transport Type</Text>
                <Box marginTop={1}>
                    <EnhancedSelectInput items={transportItems} onSelect={handleTransportSelect} />
                </Box>
            </Box>
        );
    }

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Server Name</Text>
                <Box marginTop={1}>
                    <Text>Name: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleNameSubmit}
                    />
                </Box>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    }

    // Command line input (stdio) - combines command and args
    if(mode === 'edit-command-line') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Command Line</Text>
                <Box marginTop={1}>
                    <Text>Command line: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCommandLineSubmit}
                    />
                </Box>
                <Text dimColor>
                    Enter full command with arguments. Use quotes for args with spaces.
                </Text>
                <Text dimColor>Example: uvx mcp-server-time --local-timezone "America/Los Angeles"</Text>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    }

    // Env editor (stdio)
    if(mode === 'edit-env') {
        const env = 'env' in currentServer && currentServer.env ? currentServer.env : {};
        return (
            <EnvVarEditor
              env={env}
              onSave={handleEnvSave}
              onCancel={() => setMode('menu')}
            />
        );
    }

    // CWD input (stdio)
    if(mode === 'edit-cwd') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Working Directory</Text>
                <Box marginTop={1}>
                    <Text>Working Directory: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCwdSubmit}
                    />
                </Box>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    }

    // URL input (http/sse)
    if(mode === 'edit-url') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit URL</Text>
                <Box marginTop={1}>
                    <Text>URL: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleUrlSubmit}
                    />
                </Box>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    }

    // Headers input (http/sse)
    if(mode === 'edit-headers') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit Headers</Text>
                <Box marginTop={1}>
                    <Text>Headers (Header: Value, one per line): </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleHeadersSubmit}
                    />
                </Box>
                <Text dimColor>Press Enter to save</Text>
            </Box>
        );
    }

    // JSON input
    if(mode === 'edit-json') {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold>Edit as JSON</Text>
                <Box marginTop={1}>
                    <Text>Paste mcp.json snippet: </Text>
                    <TextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleJsonSubmit}
                    />
                </Box>
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">
                            {error}
                        </Text>
                    </Box>
                )}
                <Text dimColor>Press Enter to parse</Text>
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

    // Build menu items based on transport type
    const menuItems: { label: string, value: string, disabled?: boolean }[] = [
        { label: `Server Name: ${currentServerName || '(not set)'}`, value: 'edit-name' },
        { label: `Transport Type: ${transportType}`, value: 'edit-transport' },
    ];

    if(transportType === 'stdio') {
        const stdioConfig = currentServer as StdioServerConfig;
        // Build command line preview
        const command = stdioConfig.command || '(not set)';
        const args = stdioConfig.args ?? [];
        const quotedArgs = _.map(args, (arg) => {
            if(/[\s"'\\]/.test(arg)) {
                return `"${_.replace(_.replace(arg, /\\/g, '\\\\'), /"/g, '\\"')}"`;
            }
            return arg;
        });
        const commandLine = command === '(not set)'
            ? '(not set)'
            : _.join([command, ...quotedArgs], ' ');

        menuItems.push(
            { label: `Command: ${commandLine}`, value: 'edit-command-line' },
            {
                label: `Environment: ${stdioConfig.env && _.keys(stdioConfig.env).length > 0
                    ? `${_.keys(stdioConfig.env).length} var(s)`
                    : '(none)'}`,
                value: 'edit-env',
            },
            { label: `Working Directory: ${stdioConfig.cwd ?? '(default)'}`, value: 'edit-cwd' }
        );
    } else {
        const httpConfig = currentServer as StreamableHttpServerConfig | SseServerConfig;
        menuItems.push(
            { label: `URL: ${httpConfig.url || '(not set)'}`, value: 'edit-url' },
            {
                label: `Headers: ${httpConfig.headers && _.keys(httpConfig.headers).length > 0
                    ? `${_.keys(httpConfig.headers).length} header(s)`
                    : '(none)'}`,
                value: 'edit-headers',
            }
        );
    }

    menuItems.push(
        { label: '───────────────────', value: 'sep1', disabled: true },
        { label: '📋 Edit as JSON', value: 'edit-json' },
        { label: '💾 Save Server', value: 'save' }
    );

    if(!isNewServer) {
        menuItems.push({ label: '🗑️  Delete Server', value: 'delete' });
    }

    menuItems.push({ label: '← Cancel', value: 'cancel' });

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    {isNewServer ? 'Create New Backend Server' : `Edit Server: ${serverName}`}
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
