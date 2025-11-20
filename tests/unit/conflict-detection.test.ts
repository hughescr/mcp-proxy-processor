/**
 * Unit tests for conflict detection in resources and prompts
 */

import { describe, it, expect } from 'bun:test';
import {
    detectResourceConflicts,
    detectPromptConflicts,
    deduplicateTools,
    deduplicateResources,
    deduplicatePrompts
} from '../../src/utils/conflict-detection.js';
import type { ResourceRef, PromptRef, ResourceConflict as _ResourceConflict, PromptConflict as _PromptConflict } from '../../src/types/config.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import _ from 'lodash';

describe('Conflict Detection', () => {
    describe('detectResourceConflicts()', () => {
        describe('Exact Duplicate Detection', () => {
            it('should detect exact duplicate URIs', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///etc/hosts', serverName: 'server1' },
                    { uri: 'file:///etc/passwd', serverName: 'server2' },
                    { uri: 'file:///etc/hosts', serverName: 'server3' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('exact-duplicate');
                expect(conflicts[0].exampleUri).toBe('file:///etc/hosts');
                expect(conflicts[0].priority).toEqual([0, 2]);
                expect(conflicts[0].resources).toHaveLength(2);
            });

            it('should detect multiple exact duplicates', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.example.com/v1', serverName: 'api1' },
                    { uri: 'https://api.example.com/v2', serverName: 'api2' },
                    { uri: 'https://api.example.com/v1', serverName: 'api3' },
                    { uri: 'https://api.example.com/v2', serverName: 'api4' },
                    { uri: 'https://api.example.com/v1', serverName: 'api5' },
                ];

                const conflicts = detectResourceConflicts(resources);

                // Should detect all duplicate pairs
                const v1Conflicts = _.filter(conflicts, { exampleUri: 'https://api.example.com/v1' });
                const v2Conflicts = _.filter(conflicts, { exampleUri: 'https://api.example.com/v2' });

                // v1 has 3 occurrences: (0,2), (0,4), (2,4) = 3 conflicts
                expect(v1Conflicts).toHaveLength(3);
                // v2 has 2 occurrences: (1,3) = 1 conflict
                expect(v2Conflicts).toHaveLength(1);

                // All should be exact-duplicate type
                expect(_.every(conflicts, { type: 'exact-duplicate' })).toBe(true);
            });

            it('should not detect conflicts for unique URIs', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///etc/hosts', serverName: 'server1' },
                    { uri: 'file:///etc/passwd', serverName: 'server2' },
                    { uri: 'file:///var/log/app.log', serverName: 'server3' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(0);
            });
        });

        describe('Template Covers Exact Detection', () => {
            it('should detect when template covers exact URI', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///{+path}', serverName: 'fs-server' },
                    { uri: 'file:///etc/hosts', serverName: 'config-server' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('template-covers-exact');
                expect(conflicts[0].exampleUri).toBe('file:///etc/hosts');
                expect(conflicts[0].priority).toEqual([0, 1]);
            });

            it('should detect multiple template-covers-exact conflicts', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.{domain}/users', serverName: 'api-gateway' },
                    { uri: 'https://api.github.com/users', serverName: 'github' },
                    { uri: 'https://api.gitlab.com/users', serverName: 'gitlab' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(2);
                expect(_.every(conflicts, { type: 'template-covers-exact' })).toBe(true);
                expect(conflicts[0].priority).toEqual([0, 1]);
                expect(conflicts[1].priority).toEqual([0, 2]);
            });

            it('should not detect conflict if template does not match', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///{dir}/{file}', serverName: 'fs-server' },
                    { uri: 'file:///singlepath', serverName: 'config-server' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(0);
            });

            it('should not detect conflict when exact URI comes first and template does not match', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.github.com/users', serverName: 'github' },
                    { uri: 'https://api.{domain}/repos', serverName: 'api-gateway' }, // Different path, no match
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(0);
            });
        });

        describe('Exact Covered By Template Detection', () => {
            it('should detect when exact URI is covered by template', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///etc/hosts', serverName: 'config-server' },
                    { uri: 'file:///{+path}', serverName: 'fs-server' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('exact-covered-by-template');
                expect(conflicts[0].exampleUri).toBe('file:///etc/hosts');
                expect(conflicts[0].priority).toEqual([0, 1]);
            });

            it('should detect multiple exact-covered-by-template conflicts', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.github.com/repos', serverName: 'github-repos' },
                    { uri: 'https://api.gitlab.com/repos', serverName: 'gitlab-repos' },
                    { uri: 'https://api.{provider}.com/repos', serverName: 'universal-api' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(2);
                expect(_.every(conflicts, { type: 'exact-covered-by-template' })).toBe(true);
            });
        });

        describe('Template Overlap Detection', () => {
            it('should detect overlapping templates with same static parts', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///{+path}', serverName: 'fs1' },
                    { uri: 'file:///{+filename}', serverName: 'fs2' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('template-overlap');
                expect(conflicts[0].exampleUri).toMatch(/^file:\/\/\//);
                // Example URI should not contain template variables
                expect(conflicts[0].exampleUri).not.toContain('{');
            });

            it('should detect overlapping templates with nested paths', () => {
                const resources: ResourceRef[] = [
                    { uri: '/api/{version}/users', serverName: 'api1' },
                    { uri: '/api/{v}/users', serverName: 'api2' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('template-overlap');
            });

            it('should not detect overlap for different static parts', () => {
                const resources: ResourceRef[] = [
                    { uri: 'http://api.{domain}/data', serverName: 'http-api' },
                    { uri: 'https://api.{domain}/data', serverName: 'https-api' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(0);
            });

            it('should handle complex template overlaps', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.{region}.{service}.com/{endpoint}', serverName: 'multi-region' },
                    { uri: 'https://api.{zone}.{app}.com/{+path}', serverName: 'multi-zone' },
                    { uri: 'https://api.us.storage.com/files', serverName: 'storage-api' },
                ];

                const conflicts = detectResourceConflicts(resources);

                // Templates should overlap
                const templateOverlaps = _.filter(conflicts, { type: 'template-overlap' });
                expect(templateOverlaps).toHaveLength(1);

                // Exact should be covered by templates (templates come first, so template-covers-exact)
                const templateCoversExact = _.filter(conflicts, { type: 'template-covers-exact' });
                expect(templateCoversExact).toHaveLength(2);
            });
        });

        describe('Mixed Conflict Types', () => {
            it('should detect all conflict types in a mixed list', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///{+path}', serverName: 'fs1' },
                    { uri: 'file:///etc/hosts', serverName: 'config1' },
                    { uri: 'file:///{dir}/{file}', serverName: 'fs2' },
                    { uri: 'file:///etc/hosts', serverName: 'config2' },
                    { uri: 'https://api.example.com', serverName: 'api1' },
                    { uri: 'https://api.example.com', serverName: 'api2' },
                ];

                const conflicts = detectResourceConflicts(resources);

                // Should find various conflict types
                const exactDuplicates = _.filter(conflicts, { type: 'exact-duplicate' });
                const templateCoversExact = _.filter(conflicts, { type: 'template-covers-exact' });
                const templateOverlaps = _.filter(conflicts, { type: 'template-overlap' });

                expect(exactDuplicates.length).toBeGreaterThan(0);
                expect(templateCoversExact.length).toBeGreaterThan(0);
                expect(templateOverlaps.length).toBeGreaterThan(0);
            });
        });

        describe('Priority Order Reporting', () => {
            it('should report correct priority indices', () => {
                const resources: ResourceRef[] = [
                    { uri: 'resource1', serverName: 'server1' }, // index 0
                    { uri: 'resource2', serverName: 'server2' }, // index 1
                    { uri: 'resource1', serverName: 'server3' }, // index 2
                    { uri: 'resource3', serverName: 'server4' }, // index 3
                    { uri: 'resource2', serverName: 'server5' }, // index 4
                ];

                const conflicts = detectResourceConflicts(resources);

                // Check that priority indices are correct
                const resource1Conflict = _.find(conflicts, { exampleUri: 'resource1' });
                expect(resource1Conflict?.priority).toEqual([0, 2]);

                const resource2Conflict = _.find(conflicts, { exampleUri: 'resource2' });
                expect(resource2Conflict?.priority).toEqual([1, 4]);
            });
        });

        describe('Edge Cases', () => {
            it('should handle empty resource list', () => {
                const resources: ResourceRef[] = [];
                const conflicts = detectResourceConflicts(resources);
                expect(conflicts).toHaveLength(0);
            });

            it('should handle single resource', () => {
                const resources: ResourceRef[] = [
                    { uri: 'file:///single', serverName: 'server1' },
                ];
                const conflicts = detectResourceConflicts(resources);
                expect(conflicts).toHaveLength(0);
            });

            it('should handle undefined elements gracefully', () => {
                const resources: (ResourceRef | undefined)[] = [
                    { uri: 'file:///test', serverName: 'server1' },
                    undefined,
                    { uri: 'file:///test', serverName: 'server2' },
                ];
                const conflicts = detectResourceConflicts(resources as ResourceRef[]);
                expect(conflicts).toHaveLength(1);
            });
        });

        describe('Example URI Generation', () => {
            it('should generate meaningful example URIs for conflicts', () => {
                const resources: ResourceRef[] = [
                    { uri: 'https://api.{domain}/v{version}/{endpoint}', serverName: 'api1' },
                    { uri: 'https://api.example.com/v1/users', serverName: 'api2' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                // For template-covers-exact, example should be the exact URI
                expect(conflicts[0].exampleUri).toBe('https://api.example.com/v1/users');
            });

            it('should generate example URIs for template overlaps', () => {
                const resources: ResourceRef[] = [
                    { uri: '/data/{type}/{id}', serverName: 'data1' },
                    { uri: '/data/{category}/{item}', serverName: 'data2' },
                ];

                const conflicts = detectResourceConflicts(resources);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].type).toBe('template-overlap');
                // Example should be concrete (no template variables)
                expect(conflicts[0].exampleUri).not.toContain('{');
                expect(conflicts[0].exampleUri).toContain('/data/');
            });
        });
    });

    describe('detectPromptConflicts()', () => {
        describe('Duplicate Prompt Name Detection', () => {
            it('should detect duplicate prompt names', () => {
                const prompts: PromptRef[] = [
                    { name: 'code-review', serverName: 'ai1' },
                    { name: 'summarize', serverName: 'ai2' },
                    { name: 'code-review', serverName: 'ai3' },
                ];

                const conflicts = detectPromptConflicts(prompts);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].prompts).toHaveLength(2);
                expect(conflicts[0].priority).toEqual([0, 2]);
            });

            it('should detect multiple duplicate groups', () => {
                const prompts: PromptRef[] = [
                    { name: 'analyze', serverName: 'ai1' },
                    { name: 'translate', serverName: 'ai2' },
                    { name: 'analyze', serverName: 'ai3' },
                    { name: 'translate', serverName: 'ai4' },
                    { name: 'analyze', serverName: 'ai5' },
                ];

                const conflicts = detectPromptConflicts(prompts);

                // analyze has 3 occurrences: (0,2), (0,4), (2,4) = 3 conflicts
                // translate has 2 occurrences: (1,3) = 1 conflict
                expect(conflicts).toHaveLength(4);

                const analyzeConflicts = _.filter(conflicts, c =>
                    _.some(c.prompts, { name: 'analyze' })
                );
                const translateConflicts = _.filter(conflicts, c =>
                    _.some(c.prompts, { name: 'translate' })
                );

                expect(analyzeConflicts).toHaveLength(3);
                expect(translateConflicts).toHaveLength(1);
            });

            it('should not detect conflicts for unique names', () => {
                const prompts: PromptRef[] = [
                    { name: 'analyze', serverName: 'ai1' },
                    { name: 'translate', serverName: 'ai2' },
                    { name: 'summarize', serverName: 'ai3' },
                ];

                const conflicts = detectPromptConflicts(prompts);

                expect(conflicts).toHaveLength(0);
            });
        });

        describe('Priority Order Reporting', () => {
            it('should report correct priority indices', () => {
                const prompts: PromptRef[] = [
                    { name: 'prompt1', serverName: 'server1' }, // index 0
                    { name: 'prompt2', serverName: 'server2' }, // index 1
                    { name: 'prompt1', serverName: 'server3' }, // index 2
                    { name: 'prompt3', serverName: 'server4' }, // index 3
                    { name: 'prompt2', serverName: 'server5' }, // index 4
                ];

                const conflicts = detectPromptConflicts(prompts);

                // Find conflicts for each duplicate
                const prompt1Conflicts = _.filter(conflicts, c =>
                    _.some(c.prompts, { name: 'prompt1' })
                );
                const prompt2Conflicts = _.filter(conflicts, c =>
                    _.some(c.prompts, { name: 'prompt2' })
                );

                expect(prompt1Conflicts).toHaveLength(1);
                expect(prompt1Conflicts[0].priority).toEqual([0, 2]);

                expect(prompt2Conflicts).toHaveLength(1);
                expect(prompt2Conflicts[0].priority).toEqual([1, 4]);
            });

            it('should handle multiple duplicates with correct indices', () => {
                const prompts: PromptRef[] = [
                    { name: 'same', serverName: 'server1' }, // index 0
                    { name: 'same', serverName: 'server2' }, // index 1
                    { name: 'same', serverName: 'server3' }, // index 2
                    { name: 'same', serverName: 'server4' }, // index 3
                ];

                const conflicts = detectPromptConflicts(prompts);

                // With 4 duplicates, we should have C(4,2) = 6 conflicts
                expect(conflicts).toHaveLength(6);

                // Check that all priority pairs are present
                const priorityPairs = _.map(conflicts, 'priority').sort((a, b) => {
                    if(a[0] !== b[0]) {
                        return a[0] - b[0];
                    }
                    return a[1] - b[1];
                });

                expect(priorityPairs).toEqual([
                    [0, 1], [0, 2], [0, 3],
                    [1, 2], [1, 3],
                    [2, 3],
                ]);
            });
        });

        describe('Edge Cases', () => {
            it('should handle empty prompt list', () => {
                const prompts: PromptRef[] = [];
                const conflicts = detectPromptConflicts(prompts);
                expect(conflicts).toHaveLength(0);
            });

            it('should handle single prompt', () => {
                const prompts: PromptRef[] = [
                    { name: 'single', serverName: 'server1' },
                ];
                const conflicts = detectPromptConflicts(prompts);
                expect(conflicts).toHaveLength(0);
            });

            it('should handle undefined elements gracefully', () => {
                const prompts: (PromptRef | undefined)[] = [
                    { name: 'test', serverName: 'server1' },
                    undefined,
                    { name: 'test', serverName: 'server2' },
                ];
                const conflicts = detectPromptConflicts(prompts as PromptRef[]);
                expect(conflicts).toHaveLength(1);
            });
        });

        describe('Case Sensitivity', () => {
            it('should treat prompt names as case-sensitive', () => {
                const prompts: PromptRef[] = [
                    { name: 'Analyze', serverName: 'server1' },
                    { name: 'analyze', serverName: 'server2' },
                    { name: 'ANALYZE', serverName: 'server3' },
                ];

                const conflicts = detectPromptConflicts(prompts);

                // Different cases should not conflict
                expect(conflicts).toHaveLength(0);
            });
        });

        describe('Server Information', () => {
            it('should preserve server information in conflicts', () => {
                const prompts: PromptRef[] = [
                    { name: 'test', serverName: 'server-alpha' },
                    { name: 'test', serverName: 'server-beta' },
                ];

                const conflicts = detectPromptConflicts(prompts);

                expect(conflicts).toHaveLength(1);
                expect(conflicts[0].prompts[0].serverName).toBe('server-alpha');
                expect(conflicts[0].prompts[1].serverName).toBe('server-beta');
            });
        });
    });

    describe('deduplicateTools()', () => {
        it('should keep first occurrence when tools have duplicate names', () => {
            const tools: Tool[] = [
                { name: 'search', description: 'Search tool from server1', inputSchema: { type: 'object' } },
                { name: 'list', description: 'List tool', inputSchema: { type: 'object' } },
                { name: 'search', description: 'Search tool from server2', inputSchema: { type: 'object' } },
            ];

            const result = deduplicateTools(tools);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('search');
            expect(result[0].description).toBe('Search tool from server1');
            expect(result[1].name).toBe('list');
        });

        it('should return all tools when no duplicates exist', () => {
            const tools: Tool[] = [
                { name: 'search', description: 'Search tool', inputSchema: { type: 'object' } },
                { name: 'list', description: 'List tool', inputSchema: { type: 'object' } },
                { name: 'create', description: 'Create tool', inputSchema: { type: 'object' } },
            ];

            const result = deduplicateTools(tools);

            expect(result).toHaveLength(3);
            expect(result).toEqual(tools);
        });

        it('should handle empty array', () => {
            const result = deduplicateTools([]);
            expect(result).toEqual([]);
        });

        it('should preserve priority order (first wins)', () => {
            const tools: Tool[] = [
                { name: 'tool1', description: 'Priority 1', inputSchema: { type: 'object' } },
                { name: 'tool2', description: 'Priority 2', inputSchema: { type: 'object' } },
                { name: 'tool1', description: 'Priority 3', inputSchema: { type: 'object' } },
                { name: 'tool2', description: 'Priority 4', inputSchema: { type: 'object' } },
                { name: 'tool1', description: 'Priority 5', inputSchema: { type: 'object' } },
            ];

            const result = deduplicateTools(tools);

            expect(result).toHaveLength(2);
            expect(result[0].description).toBe('Priority 1');
            expect(result[1].description).toBe('Priority 2');
        });
    });

    describe('deduplicateResources()', () => {
        it('should keep first occurrence when resources have duplicate URIs', () => {
            const resources: Resource[] = [
                { uri: 'file:///config', name: 'Config from server1', mimeType: 'text/plain' },
                { uri: 'file:///data', name: 'Data', mimeType: 'text/plain' },
                { uri: 'file:///config', name: 'Config from server2', mimeType: 'text/plain' },
            ];

            const result = deduplicateResources(resources);

            expect(result).toHaveLength(2);
            expect(result[0].uri).toBe('file:///config');
            expect(result[0].name).toBe('Config from server1');
            expect(result[1].uri).toBe('file:///data');
        });

        it('should return all resources when no duplicates exist', () => {
            const resources: Resource[] = [
                { uri: 'file:///config', name: 'Config', mimeType: 'text/plain' },
                { uri: 'file:///data', name: 'Data', mimeType: 'text/plain' },
                { uri: 'file:///log', name: 'Log', mimeType: 'text/plain' },
            ];

            const result = deduplicateResources(resources);

            expect(result).toHaveLength(3);
            expect(result).toEqual(resources);
        });

        it('should handle empty array', () => {
            const result = deduplicateResources([]);
            expect(result).toEqual([]);
        });
    });

    describe('deduplicatePrompts()', () => {
        it('should keep first occurrence when prompts have duplicate names', () => {
            const prompts: Prompt[] = [
                { name: 'summarize', description: 'Summarize from server1' },
                { name: 'translate', description: 'Translate' },
                { name: 'summarize', description: 'Summarize from server2' },
            ];

            const result = deduplicatePrompts(prompts);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('summarize');
            expect(result[0].description).toBe('Summarize from server1');
            expect(result[1].name).toBe('translate');
        });

        it('should return all prompts when no duplicates exist', () => {
            const prompts: Prompt[] = [
                { name: 'summarize', description: 'Summarize' },
                { name: 'translate', description: 'Translate' },
                { name: 'analyze', description: 'Analyze' },
            ];

            const result = deduplicatePrompts(prompts);

            expect(result).toHaveLength(3);
            expect(result).toEqual(prompts);
        });

        it('should handle empty array', () => {
            const result = deduplicatePrompts([]);
            expect(result).toEqual([]);
        });
    });
});
