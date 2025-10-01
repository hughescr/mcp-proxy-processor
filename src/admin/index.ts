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
    // Render the Ink app
    render(React.createElement(App));
}
