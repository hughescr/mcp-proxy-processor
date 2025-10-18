/**
 * Server Editor Component - Create and edit backend MCP servers
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './components/SelectInput.js';
import _ from 'lodash';
import { CancellableTextInput } from './components/CancellableTextInput.js';
import type { BackendServerConfig } from '../types/config.js';
import { BackendServerConfigSchema } from '../types/config.js';
import { EnvVarEditor } from './EnvVarEditor.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { menuSeparator } from './design-system.js';

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
      | 'edit-command-line'
      | 'edit-env'
      | 'edit-cwd'
      | 'edit-json'
      | 'success';

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

    // Handle Esc for navigation - only in menu mode
    // Note: Input modes handle ESC via CancellableTextInput or their own handlers (edit-env)
    useInput((input, key) => {
        if(mode === 'menu' && !saving) {
            if(key.escape || key.leftArrow) {
                onCancel();
            }
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
            await onDelete(serverName);
        } catch (err) {
            setError(_.isError(err) ? err.message : String(err));
            setSaving(false);
        }
    };

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
        setCurrentServer({ ...currentServer, cwd: value || undefined });
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

    // Name input
    if(mode === 'edit-name') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Server Name" />
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

    // Command line input (stdio) - combines command and args
    if(mode === 'edit-command-line') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit Command Line" />
                <Box marginTop={1}>
                    <Text>Command line: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCommandLineSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text>
                    Enter full command with arguments. Use quotes for args with spaces.
                </Text>
                <Text>Example: uvx mcp-server-time --local-timezone "America/Los Angeles"</Text>
                <Text>Press Enter to save, Esc to cancel</Text>
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
                <ScreenHeader title="Edit Working Directory" />
                <Box marginTop={1}>
                    <Text>Working Directory: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleCwdSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                <Text>Press Enter to save, Esc to cancel</Text>
            </Box>
        );
    }

    // JSON input
    if(mode === 'edit-json') {
        return (
            <Box flexDirection="column" padding={1}>
                <ScreenHeader title="Edit as JSON" />
                <Box marginTop={1}>
                    <Text>Paste mcp.json snippet: </Text>
                    <CancellableTextInput
                      value={inputValue}
                      onChange={setInputValue}
                      onSubmit={handleJsonSubmit}
                      onCancel={() => setMode('menu')}
                    />
                </Box>
                {error && (
                    <Box marginTop={1}>
                        <Text color="red">
                            {error}
                        </Text>
                    </Box>
                )}
                <Text>Press Enter to parse, Esc to cancel</Text>
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
                    ✓ Server saved successfully!
                </Text>
            </Box>
        );
    }

    // Build menu items - stdio only
    // Build command line preview
    const command = currentServer.command || '(not set)';
    const args = currentServer.args ?? [];
    const quotedArgs = _.map(args, (arg) => {
        if(/[\s"'\\]/.test(arg)) {
            return `"${_.replace(_.replace(arg, /\\/g, '\\\\'), /"/g, '\\"')}"`;
        }
        return arg;
    });
    const commandLine = command === '(not set)'
        ? '(not set)'
        : _.join([command, ...quotedArgs], ' ');

    const menuItems: { label: string, value: string, disabled?: boolean }[] = [
        { label: `Server Name: ${currentServerName || '(not set)'}`, value: 'edit-name' },
        { label: `Command: ${commandLine}`, value: 'edit-command-line' },
        {
            label: `Environment: ${currentServer.env && _.keys(currentServer.env).length > 0
                ? `${_.keys(currentServer.env).length} var(s)`
                : '(none)'}`,
            value: 'edit-env',
        },
        { label: `Working Directory: ${currentServer.cwd ?? '(default)'}`, value: 'edit-cwd' },
    ];

    menuItems.push(
        menuSeparator(),
        { label: '📋 Edit as JSON', value: 'edit-json' },
        { label: '💾 Save Server', value: 'save' }
    );

    if(!isNewServer) {
        menuItems.push({ label: '🗑️  Delete Server', value: 'delete' });
    }

    menuItems.push({ label: '← Cancel', value: 'cancel' });

    const title = isNewServer ? 'Create New Backend Server' : `Edit Server: ${serverName}`;

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
            <SelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
    );
}
