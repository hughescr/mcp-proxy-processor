import { describe, it, expect } from 'bun:test';
import _ from 'lodash';
import {
    serializeSelectionKey,
    parseSelectionKey,
    countSelected,
    groupAndSortByServer
} from './shared-utilities.js';

describe('Browser Shared Utilities', () => {
    describe('serializeSelectionKey', () => {
        it('should serialize server name and ID with colon separator', () => {
            expect(serializeSelectionKey('server1', 'item1')).toBe('server1:item1');
        });

        it('should handle IDs containing colons', () => {
            expect(serializeSelectionKey('filesystem', 'file://path/to/file')).toBe(
                'filesystem:file://path/to/file'
            );
        });

        it('should handle IDs with multiple colons', () => {
            expect(serializeSelectionKey('server', 'a:b:c:d')).toBe('server:a:b:c:d');
        });
    });

    describe('parseSelectionKey', () => {
        it('should parse simple selection key', () => {
            expect(parseSelectionKey('server1:item1')).toEqual({
                serverName: 'server1',
                id:         'item1',
            });
        });

        it('should parse key with ID containing colons', () => {
            expect(parseSelectionKey('filesystem:file://path/to/file')).toEqual({
                serverName: 'filesystem',
                id:         'file://path/to/file',
            });
        });

        it('should handle multiple colons in ID', () => {
            expect(parseSelectionKey('server:a:b:c:d')).toEqual({
                serverName: 'server',
                id:         'a:b:c:d',
            });
        });

        it('should handle empty parts gracefully', () => {
            expect(parseSelectionKey(':item')).toEqual({
                serverName: '',
                id:         'item',
            });
        });
    });

    describe('countSelected', () => {
        it('should count true values in selection map', () => {
            const map = new Map([
                ['key1', true],
                ['key2', false],
                ['key3', true],
                ['key4', false],
                ['key5', true],
            ]);
            expect(countSelected(map)).toBe(3);
        });

        it('should return 0 for empty map', () => {
            expect(countSelected(new Map())).toBe(0);
        });

        it('should return 0 when all false', () => {
            const map = new Map([
                ['key1', false],
                ['key2', false],
            ]);
            expect(countSelected(map)).toBe(0);
        });

        it('should count all when all true', () => {
            const map = new Map([
                ['key1', true],
                ['key2', true],
                ['key3', true],
            ]);
            expect(countSelected(map)).toBe(3);
        });
    });

    describe('groupAndSortByServer', () => {
        interface TestItem {
            serverName: string
            name:       string
        }

        it('should group items by server name', () => {
            const items: TestItem[] = [
                { serverName: 'server2', name: 'item1' },
                { serverName: 'server1', name: 'item2' },
                { serverName: 'server2', name: 'item3' },
            ];

            const result = groupAndSortByServer(
                items,
                item => item.serverName,
                item => item.name
            );

            expect(_.keys(result)).toEqual(['server1', 'server2']);
            expect(result.server1).toHaveLength(1);
            expect(result.server2).toHaveLength(2);
        });

        it('should sort servers alphabetically', () => {
            const items: TestItem[] = [
                { serverName: 'zebra', name: 'item1' },
                { serverName: 'alpha', name: 'item2' },
                { serverName: 'beta', name: 'item3' },
            ];

            const result = groupAndSortByServer(
                items,
                item => item.serverName,
                item => item.name
            );

            expect(_.keys(result)).toEqual(['alpha', 'beta', 'zebra']);
        });

        it('should sort items within each server group', () => {
            const items: TestItem[] = [
                { serverName: 'server1', name: 'c' },
                { serverName: 'server1', name: 'a' },
                { serverName: 'server1', name: 'b' },
            ];

            const result = groupAndSortByServer(
                items,
                item => item.serverName,
                item => item.name
            );

            expect(_.map(result.server1, 'name')).toEqual(['a', 'b', 'c']);
        });

        it('should handle empty array', () => {
            const result = groupAndSortByServer(
                [],
                (item: TestItem) => item.serverName,
                (item: TestItem) => item.name
            );

            expect(_.keys(result)).toEqual([]);
        });
    });
});
