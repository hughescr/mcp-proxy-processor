/**
 * Backend MCP Server Management
 *
 * This module is responsible for:
 * - Reading backend server configurations
 * - Launching backend MCP servers as stdio subprocesses
 * - Managing client connections to backend servers
 * - Discovering available tools and resources
 * - Proxying tool and resource requests to backend servers
 */

export { ServerManager } from './server-manager.js';
export { ClientManager } from './client-manager.js';
export { DiscoveryService } from './discovery.js';
export { ProxyService } from './proxy.js';
export type { ProxyConfig } from './proxy.js';
