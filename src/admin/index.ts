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
import { constant } from 'lodash';
import { App } from './App.js';

/**
 * Run the admin interface
 */
export async function runAdmin(): Promise<void> {
    // Migrate config files from old location if needed
    const { migrateConfigFiles } = await import('../utils/config-migration.js');
    await migrateConfigFiles();

    // Silence stderr to prevent backend server logs from polluting the UI
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    // Override stderr.write to suppress logs during admin UI
    process.stderr.write = constant(true) as typeof process.stderr.write;

    // Render the Ink app
    const { waitUntilExit } = render(React.createElement(App));

    // Wait for the app to exit
    await waitUntilExit();

    // Restore stderr
    process.stderr.write = originalStderrWrite;
}
