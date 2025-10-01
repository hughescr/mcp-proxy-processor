/**
 * Admin Interface Root Component
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { GroupList } from './GroupList.js';
import { ToolBrowser } from './ToolBrowser.js';
import { ServerList } from './ServerList.js';

type Screen = 'main' | 'groups' | 'servers' | 'tools';

/**
 * Main app component with navigation between screens
 */
export function App() {
    const [screen, setScreen] = useState<Screen>('main');

    // Handle Esc at main menu to exit
    useInput((input, key) => {
        if(screen === 'main' && key.escape) {
            // eslint-disable-next-line n/no-process-exit -- Intentional exit from admin UI
            process.exit(0);
        }
    });

    // Main menu items
    const mainMenuItems = [
        { label: 'Manage Groups', value: 'groups' },
        { label: 'Manage Backend Servers', value: 'servers' },
        { label: 'Browse Backend Tools', value: 'tools' },
        { label: 'Exit', value: 'exit' },
    ];

    const handleMainMenuSelect = (item: { value: string }) => {
        if(item.value === 'exit') {
            // eslint-disable-next-line n/no-process-exit -- Intentional exit from admin UI
            process.exit(0);
        } else {
            setScreen(item.value as Screen);
        }
    };

    // Render current screen
    if(screen === 'groups') {
        return <GroupList onBack={() => setScreen('main')} />;
    }

    if(screen === 'servers') {
        return <ServerList onBack={() => setScreen('main')} />;
    }

    if(screen === 'tools') {
        return <ToolBrowser onBack={() => setScreen('main')} />;
    }

    // Main menu
    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    MCP Proxy Processor - Admin Interface
                </Text>
            </Box>
            <Box marginBottom={1}>
                <Text dimColor>Select an option:</Text>
            </Box>
            <SelectInput items={mainMenuItems} onSelect={handleMainMenuSelect} />
        </Box>
    );
}
