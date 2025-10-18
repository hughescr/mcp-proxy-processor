/**
 * MCP Proxy Processor CLI Entry Point
 *
 * Modes:
 * - serve <groupname>: Start MCP proxy server for specified group
 * - admin: Launch interactive admin UI for managing groups
 * - list-groups: List all configured groups
 * - describe-group <name>: Show details about a specific group
 * - list-backends: List all configured backend servers
 * - validate: Validate configuration files
 * - config-path: Show the configuration directory path
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { keys, findIndex, values, isError, trim } from 'lodash';

interface PackageJson {
    version:     string
    description: string
}

const packageJson = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf-8')) as PackageJson;

const program = new Command();

program
    .name('mcp-proxy')
    .description(packageJson.description)
    .version(packageJson.version);

// Serve command - start MCP server for a group
program
    .command('serve')
    .description('Start MCP proxy server for specified group')
    .argument('<groupname>', 'Name of the group to serve')
    .action(async (groupname: string) => {
        const { startServer } = await import('./frontend/index.js');
        await startServer(groupname);
    });

// Admin command - launch interactive UI
program
    .command('admin')
    .description('Launch interactive admin UI for managing groups')
    .action(async () => {
        // Suppress logger output in admin mode to avoid cluttering the UI
        process.env.LOG_LEVEL = 'silent';
        const { runAdmin } = await import('./admin/index.js');
        await runAdmin();
    });

// List groups command
program
    .command('list-groups')
    .description('List all configured groups')
    .action(async () => {
        const { loadGroupsConfig } = await import('./admin/config-utils.js');
        const config = await loadGroupsConfig();
        const groups = values(config.groups);

        if(groups.length === 0) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('No groups configured.');
            return;
        }

        // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
        console.log('\nConfigured Groups:\n');
        for(const group of groups) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`  ${group.name}`);
            if(group.description) {
                // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                console.log(`    ${group.description}`);
            }
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`    Tools: ${group.tools?.length ?? 0}, Resources: ${group.resources?.length ?? 0}`);
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log();
        }
    });

// Describe group command
program
    .command('describe-group')
    .description('Show details about a specific group')
    .argument('<name>', 'Name of the group to describe')
    .action(async (name: string) => {
        const { loadGroupsConfig } = await import('./admin/config-utils.js');
        const config = await loadGroupsConfig();
        const group = config.groups[name];

        if(!group) {
            // eslint-disable-next-line no-console -- CLI error message to stderr is appropriate
            console.error(`Group '${name}' not found.`);
            throw new Error(`Group '${name}' not found`);
        }

        // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
        console.log(`\nGroup: ${group.name}`);
        if(group.description) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`Description: ${group.description}`);
        }

        if(group.tools && group.tools.length > 0) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`\nTools (${group.tools.length}):`);
            for(const tool of group.tools) {
                // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                console.log(`  - ${tool.name ?? tool.originalName} (from ${tool.serverName})`);
                if(tool.description) {
                    // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                    console.log(`    ${tool.description}`);
                }
            }
        }

        if(group.resources && group.resources.length > 0) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`\nResources (${group.resources.length}):`);
            for(const resource of group.resources) {
                // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                console.log(`  - ${resource.uri} (from ${resource.serverName})`);
            }
        }

        if(group.prompts && group.prompts.length > 0) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`\nPrompts (${group.prompts.length}):`);
            for(const prompt of group.prompts) {
                // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                console.log(`  - ${prompt.name} (from ${prompt.serverName})`);
            }
        }

        // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
        console.log();
    });

// List backends command
program
    .command('list-backends')
    .description('List all configured backend servers')
    .action(async () => {
        const { loadBackendServersConfig } = await import('./admin/config-utils.js');
        const config = await loadBackendServersConfig();

        const servers = Object.entries(config.mcpServers);
        if(servers.length === 0) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('No backend servers configured.');
            return;
        }

        // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
        console.log('\nConfigured Backend Servers:\n');
        for(const [name, server] of servers) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`  ${name}`);

            // Check if this is a stdio server config (has command property)
            // All servers use stdio transport
            const args = server.args ?? [];
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`    Command: ${trim(`${server.command} ${args.join(' ')}`)}`);
            if(server.env && keys(server.env).length > 0) {
                // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
                console.log(`    Env vars: ${keys(server.env).join(', ')}`);
            }

            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log();
        }
    });

// Validate command
program
    .command('validate')
    .description('Validate configuration files')
    .action(async () => {
        try {
            const { loadBackendServersConfig, loadGroupsConfig } = await import('./admin/config-utils.js');

            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('Validating configuration files...');

            await loadBackendServersConfig();
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('✓ Backend configuration is valid');

            await loadGroupsConfig();
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('✓ Groups configuration is valid');

            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('\nAll configuration files are valid.');
        } catch (error) {
            // eslint-disable-next-line no-console -- CLI error message to stderr is appropriate
            console.error('\nValidation failed:', isError(error) ? error.message : String(error));
            throw error;
        }
    });

// Config-path command - show where config files are located
program
    .command('config-path')
    .description('Show the configuration directory path')
    .option('-v, --verbose', 'Show detailed paths for all config files')
    .action(async (options: { verbose?: boolean }) => {
        const { getConfigDir, getGroupsConfigPath, getBackendServersConfigPath } = await import('./utils/config-paths.js');

        if(options.verbose) {
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log('\nConfiguration paths:');
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`  Config directory: ${getConfigDir()}`);
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`  Groups config:    ${getGroupsConfigPath()}`);
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(`  Backend config:   ${getBackendServersConfigPath()}`);
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log();
        } else {
            // Just output the directory path for easy scripting
            // eslint-disable-next-line no-console -- CLI output to stdout is appropriate
            console.log(getConfigDir());
        }
    });

// Legacy compatibility: support --serve and --admin flags for backwards compatibility
if(process.argv.includes('--serve') || process.argv.includes('-s')) {
    const serveIndex = findIndex(process.argv, arg => arg === '--serve' || arg === '-s');
    const groupname = process.argv[serveIndex + 1];
    if(groupname) {
        // Convert --serve <group> to serve <group>
        process.argv.splice(serveIndex, 2, 'serve', groupname);
    }
}

if(process.argv.includes('--admin') || process.argv.includes('-a')) {
    const adminIndex = findIndex(process.argv, arg => arg === '--admin' || arg === '-a');
    process.argv.splice(adminIndex, 1, 'admin');
}

program.parse();
