/**
 * TypeScript declarations for @modelcontextprotocol/sdk
 */

declare module '@modelcontextprotocol/sdk/client/stdio' {
    import type { IOType } from 'node:child_process';
    import type { Stream } from 'node:stream';
    import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
    import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types';

    export interface StdioServerParameters {
        command: string
        args?:   string[]
        env?:    Record<string, string>
        stderr?: IOType | Stream | number
        cwd?:    string
    }

    export class StdioClientTransport implements Transport {
        constructor(server: StdioServerParameters);
        start(): Promise<void>;
        close(): Promise<void>;
        send(message: JSONRPCMessage): Promise<void>;
        onclose?:   () => void;
        onerror?:   (error: Error) => void;
        onmessage?: (message: JSONRPCMessage) => void;
        get pid(): number | null;
        get stderr(): Stream | null;
    }

    export function getDefaultEnvironment(): Record<string, string>;
    export const DEFAULT_INHERITED_ENV_VARS: string[];
}

declare module '@modelcontextprotocol/sdk/shared/transport' {
    import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types';

    export interface Transport {
        start(): Promise<void>
        send(message: JSONRPCMessage): Promise<void>
        close(): Promise<void>
        onclose?:   () => void
        onerror?:   (error: Error) => void
        onmessage?: (message: JSONRPCMessage) => void
    }
}

declare module '@modelcontextprotocol/sdk/types' {
    export interface ListToolsResult {
        tools: Tool[]
    }

    export interface Tool {
        name:         string
        description?: string
        inputSchema: {
            type:          'object'
            properties?:   Record<string, unknown>
            required?:     string[]
            [key: string]: unknown
        }
    }

    export interface ListResourcesResult {
        resources: Resource[]
    }

    export interface Resource {
        uri:          string
        name:         string
        description?: string
        mimeType?:    string
    }

    export interface CallToolResult {
        content: {
            type:          string
            text?:         string
            [key: string]: unknown
        }[]
        isError?: boolean
    }

    export interface ReadResourceResult {
        contents: {
            uri:       string
            mimeType?: string
            text?:     string
            blob?:     string
        }[]
    }
}
