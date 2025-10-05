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
import { LoadingScreen } from './components/ui/LoadingScreen.js';
import { ErrorScreen } from './components/ui/ErrorScreen.js';
import { menuSeparator } from './design-system.js';
import { BackendProvider, useBackend, useBackendStatus } from './BackendContext.js';

type Screen = 'main' | 'groups' | 'servers' | 'tools';

/**
 * Main app content with navigation between screens
 */
function AppContent() {
    const [screen, setScreen] = useState<Screen>('main');
    const { isInitialized, initializationError } = useBackend();
    const { isReady, connectedServers, connectingServers, failedServers, totalServers } = useBackendStatus();

    // IMPORTANT: ALL hooks must be called before any conditional returns (Rules of Hooks)
    // Handle Esc at main menu to exit
    useInput((input, key) => {
        if(screen === 'main' && key.escape) {
            // eslint-disable-next-line n/no-process-exit -- Intentional exit from admin UI
            process.exit(0);
        }
    });

    // Show loading screen while initializing
    if(!isInitialized) {
        const statusMessage = connectingServers > 0
            ? `Connecting to ${connectingServers} backend server(s)...`
            : 'Initializing backend connections...';

        return <LoadingScreen title="MCP Proxy Processor - Admin Interface" message={statusMessage} />;
    }

    // Show error screen if initialization failed
    if(initializationError) {
        return (
            <ErrorScreen
              title="Failed to Initialize Backend"
              message={initializationError}
              troubleshooting={[
                  '• Check that backend-servers.json exists and is valid',
                  '• Verify backend server commands are correct',
                  '• Ensure required dependencies are installed',
                  '• Check server logs for specific errors',
              ]}
              helpText="Press Esc to exit (some features may still be available)"
            />
        );
    }

    // Show warning if no servers connected (but allow continuing)
    const showWarning = isInitialized && totalServers > 0 && connectedServers === 0;

    // Main menu items
    const mainMenuItems: { label: string, value: string, disabled?: boolean }[] = [
        { label: 'Manage Groups', value: 'groups' },
        { label: 'Manage Backend Servers', value: 'servers' },
        { label: 'Browse Backend Tools', value: 'tools', disabled: !isReady },
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

    // Build subtitle with connection status
    let subtitle = 'Select an option:';
    if(showWarning) {
        subtitle = `⚠ Warning: ${failedServers} server(s) failed to connect. Some features unavailable.`;
    } else if(connectedServers > 0) {
        subtitle = `✓ Connected to ${connectedServers}/${totalServers} backend server(s). ${subtitle}`;
    }

    return (
        <Box flexDirection="column" padding={1}>
            <ScreenHeader title="MCP Proxy Processor - Admin Interface" subtitle={subtitle} />
            <VirtualScrollList
              items={mainMenuItems}
              onSelect={handleMainMenuSelect}
              fixedUIHeight={fixedUIHeight}
            />
        </Box>
    );
}

/**
 * App wrapper with BackendProvider
 */
export function App() {
    return (
        <BackendProvider>
            <AppContent />
        </BackendProvider>
    );
}
