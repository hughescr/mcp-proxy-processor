#!/usr/bin/env node
/**
 * MCP Proxy Processor CLI Entry Point
 *
 * Modes:
 * - --serve <groupname>: Start MCP proxy server for specified group
 * - --admin: Launch interactive admin UI for managing groups
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        serve: {
            type: 'string',
            short: 's',
        },
        admin: {
            type: 'boolean',
            short: 'a',
        },
    },
});

async function main() {
    if (values.admin) {
        console.error('Admin mode - TODO: implement admin UI');
        // const { runAdmin } = await import('./admin/index.js');
        // await runAdmin();
    } else if (values.serve) {
        console.error(`Serving group: ${values.serve} - TODO: implement MCP server`);
        // const { startServer } = await import('./frontend/server.js');
        // await startServer(values.serve);
    } else {
        console.error('Usage: mcp-proxy --serve <groupname> | --admin');
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});