/**
 * Admin CLI Interface
 *
 * This module is responsible for:
 * - Presenting an interactive CLI/TUI for group management
 * - Discovering available backend tools/resources
 * - Creating/editing groups
 * - Adding/removing tools from groups
 * - Overriding tool names, descriptions, schemas
 * - Saving group configurations to groups.json
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

/**
 * Run the admin interface
 */
export async function runAdmin(): Promise<void> {
    // Migrate config files from old location if needed
    const { migrateConfigFiles } = await import('../utils/config-migration.js');
    await migrateConfigFiles();

    // Set ADMIN_MODE environment variable to suppress backend server logs
    // This is read by the dynamic logger in silent-logger.ts
    process.env.ADMIN_MODE = 'true';

    // Render the Ink app
    const { waitUntilExit } = render(React.createElement(App));

    // Wait for the app to exit
    await waitUntilExit();

    // Clean up environment variable
    delete process.env.ADMIN_MODE;
}
