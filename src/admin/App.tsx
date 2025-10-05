/**
 * Admin Interface Root Component
 */

import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import { GroupList } from './GroupList.js';
import { ToolBrowser } from './ToolBrowser.js';
import { ServerList } from './ServerList.js';
import { ScreenHeader } from './components/ui/ScreenHeader.js';
import { VirtualScrollList } from './components/ui/VirtualScrollList.js';
import { menuSeparator } from './design-system.js';

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
    const mainMenuItems: { label: string, value: string, disabled?: boolean }[] = [
        { label: 'Manage Groups', value: 'groups' },
        { label: 'Manage Backend Servers', value: 'servers' },
        { label: 'Browse Backend Tools', value: 'tools' },
        menuSeparator(),
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

    // Main menu - Fixed UI height: padding(1) + header(1) + margin(1) + subtitle(1) + margin(1) + padding(1) = 6
    const fixedUIHeight = 6;

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader title="MCP Proxy Processor - Admin Interface" subtitle="Select an option:" />
            <VirtualScrollList
              items={mainMenuItems}
              onSelect={handleMainMenuSelect}
              fixedUIHeight={fixedUIHeight}
            />
        </Box>
    );
}
