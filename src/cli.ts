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
            type:    'string',
            'short': 's',
        },
        admin: {
            type:    'boolean',
            'short': 'a',
        },
    },
});

async function main() {
    if(values.admin) {
        const { runAdmin } = await import('./admin/index.js');
        await runAdmin();
    } else if(values.serve) {
        const { startServer } = await import('./frontend/index.js');
        await startServer(values.serve);
    } else {
        // eslint-disable-next-line no-console -- CLI error message to stderr is appropriate
        console.error('Usage: mcp-proxy --serve <groupname> | --admin');
        throw new Error('No valid mode specified');
    }
}

main().catch((error: Error) => {
    // eslint-disable-next-line no-console -- CLI fatal error output to stderr is appropriate
    console.error('Fatal error:', error);
    throw error;
});
