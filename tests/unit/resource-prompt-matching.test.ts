/**
 * Unit tests for resource/prompt matching and deduplication utilities
 */

import { describe, it, expect } from 'bun:test';
import {
    findMatchingResourceRefs,
    findMatchingPromptRefs,
    deduplicateResources,
    deduplicatePrompts
} from '../../src/utils/conflict-detection.js';
import type { ResourceRef, PromptRef } from '../../src/types/config.js';
import type { Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import _ from 'lodash';

describe('Resource and Prompt Matching', () => {
    describe('findMatchingResourceRefs()', () => {
        it('should find exact URI matches', () => {
            const resourceRefs: ResourceRef[] = [
                { uri: 'file:///etc/hosts', serverName: 'server1' },
                { uri: 'file:///etc/passwd', serverName: 'server2' },
                { uri: 'file:///var/log/app.log', serverName: 'server3' },
            ];

            const matches = findMatchingResourceRefs('file:///etc/hosts', resourceRefs);

            expect(matches).toHaveLength(1);
            expect(matches[0].serverName).toBe('server1');
        });

        it('should find template matches', () => {
            const resourceRefs: ResourceRef[] = [
                { uri: 'file:///{+path}', serverName: 'fs-server' },
                { uri: 'https://api.example.com/{endpoint}', serverName: 'api-server' },
            ];

            const matches = findMatchingResourceRefs('file:///etc/hosts', resourceRefs);

            expect(matches).toHaveLength(1);
            expect(matches[0].serverName).toBe('fs-server');
        });

        it('should find multiple matching templates in priority order', () => {
            const resourceRefs: ResourceRef[] = [
                { uri: 'file:///{+path}', serverName: 'fs-primary' },
                { uri: 'file:///etc/hosts', serverName: 'hosts-specific' },
                { uri: 'file:///{dir}/{file}', serverName: 'fs-backup' },
            ];

            const matches = findMatchingResourceRefs('file:///etc/hosts', resourceRefs);

            // Should match all three (template, exact, template)
            expect(matches).toHaveLength(3);
            expect(matches[0].serverName).toBe('fs-primary');
            expect(matches[1].serverName).toBe('hosts-specific');
            expect(matches[2].serverName).toBe('fs-backup');
        });

        it('should return empty array when no matches found', () => {
            const resourceRefs: ResourceRef[] = [
                { uri: 'https://api.example.com', serverName: 'api-server' },
                { uri: 'sqlite:///data/app.db', serverName: 'db-server' },
            ];

            const matches = findMatchingResourceRefs('file:///etc/hosts', resourceRefs);

            expect(matches).toHaveLength(0);
        });

        it('should handle empty resource list', () => {
            const resourceRefs: ResourceRef[] = [];
            const matches = findMatchingResourceRefs('file:///etc/hosts', resourceRefs);
            expect(matches).toHaveLength(0);
        });

        it('should match complex template patterns', () => {
            const resourceRefs: ResourceRef[] = [
                { uri: 'https://api.{domain}/v{version}/{+path}', serverName: 'api-gateway' },
            ];

            const matches = findMatchingResourceRefs('https://api.github.com/v1/users/octocat', resourceRefs);

            expect(matches).toHaveLength(1);
            expect(matches[0].serverName).toBe('api-gateway');
        });
    });

    describe('findMatchingPromptRefs()', () => {
        it('should find prompts by exact name match', () => {
            const promptRefs: PromptRef[] = [
                { name: 'code-review', serverName: 'ai1' },
                { name: 'summarize', serverName: 'ai2' },
                { name: 'translate', serverName: 'ai3' },
            ];

            const matches = findMatchingPromptRefs('code-review', promptRefs);

            expect(matches).toHaveLength(1);
            expect(matches[0].serverName).toBe('ai1');
        });

        it('should find multiple prompts with same name in priority order', () => {
            const promptRefs: PromptRef[] = [
                { name: 'code-review', serverName: 'ai-v2' },
                { name: 'summarize', serverName: 'text-processor' },
                { name: 'code-review', serverName: 'ai-v1' },
                { name: 'code-review', serverName: 'legacy' },
            ];

            const matches = findMatchingPromptRefs('code-review', promptRefs);

            expect(matches).toHaveLength(3);
            expect(matches[0].serverName).toBe('ai-v2');
            expect(matches[1].serverName).toBe('ai-v1');
            expect(matches[2].serverName).toBe('legacy');
        });

        it('should return empty array when no matches found', () => {
            const promptRefs: PromptRef[] = [
                { name: 'summarize', serverName: 'ai1' },
                { name: 'translate', serverName: 'ai2' },
            ];

            const matches = findMatchingPromptRefs('code-review', promptRefs);

            expect(matches).toHaveLength(0);
        });

        it('should handle empty prompt list', () => {
            const promptRefs: PromptRef[] = [];
            const matches = findMatchingPromptRefs('code-review', promptRefs);
            expect(matches).toHaveLength(0);
        });

        it('should be case-sensitive for prompt names', () => {
            const promptRefs: PromptRef[] = [
                { name: 'CodeReview', serverName: 'ai1' },
                { name: 'code-review', serverName: 'ai2' },
                { name: 'CODEREVIEW', serverName: 'ai3' },
            ];

            const matches = findMatchingPromptRefs('code-review', promptRefs);

            expect(matches).toHaveLength(1);
            expect(matches[0].serverName).toBe('ai2');
        });
    });
});

describe('Resource and Prompt Deduplication', () => {
    describe('deduplicateResources()', () => {
        it('should keep first occurrence of duplicate URIs', () => {
            const resources: Resource[] = [
                {
                    uri:         'file:///etc/hosts',
                    name:        'Hosts File (Primary)',
                    description: 'Primary hosts file',
                    mimeType:    'text/plain',
                },
                {
                    uri:      'file:///etc/passwd',
                    name:     'Password File',
                    mimeType: 'text/plain',
                },
                {
                    uri:         'file:///etc/hosts',
                    name:        'Hosts File (Secondary)',
                    description: 'Secondary hosts file',
                    mimeType:    'text/plain',
                },
            ];

            const deduplicated = deduplicateResources(resources);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated[0].uri).toBe('file:///etc/hosts');
            expect(deduplicated[0].name).toBe('Hosts File (Primary)');
            expect(deduplicated[1].uri).toBe('file:///etc/passwd');
        });

        it('should handle resources with no duplicates', () => {
            const resources: Resource[] = [
                { uri: 'file:///etc/hosts', name: 'Hosts', mimeType: 'text/plain' },
                { uri: 'file:///etc/passwd', name: 'Passwd', mimeType: 'text/plain' },
                { uri: 'file:///var/log/app.log', name: 'App Log', mimeType: 'text/plain' },
            ];

            const deduplicated = deduplicateResources(resources);

            expect(deduplicated).toHaveLength(3);
            expect(deduplicated).toEqual(resources);
        });

        it('should handle empty resource list', () => {
            const resources: Resource[] = [];
            const deduplicated = deduplicateResources(resources);
            expect(deduplicated).toHaveLength(0);
        });

        it('should handle multiple duplicates', () => {
            const resources: Resource[] = [
                { uri: 'file:///a', name: 'A1', mimeType: 'text/plain' },
                { uri: 'file:///b', name: 'B1', mimeType: 'text/plain' },
                { uri: 'file:///a', name: 'A2', mimeType: 'text/plain' },
                { uri: 'file:///b', name: 'B2', mimeType: 'text/plain' },
                { uri: 'file:///a', name: 'A3', mimeType: 'text/plain' },
            ];

            const deduplicated = deduplicateResources(resources);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated[0].name).toBe('A1');
            expect(deduplicated[1].name).toBe('B1');
        });

        it('should preserve template URIs as-is', () => {
            const resources: Resource[] = [
                { uri: 'file:///{+path}', name: 'File System', mimeType: 'text/plain' },
                { uri: 'file:///etc/hosts', name: 'Hosts File', mimeType: 'text/plain' },
                { uri: 'file:///{+path}', name: 'File System Duplicate', mimeType: 'text/plain' },
            ];

            const deduplicated = deduplicateResources(resources);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated[0].uri).toBe('file:///{+path}');
            expect(deduplicated[0].name).toBe('File System');
            expect(deduplicated[1].uri).toBe('file:///etc/hosts');
        });
    });

    describe('deduplicatePrompts()', () => {
        it('should keep first occurrence of duplicate names', () => {
            const prompts: Prompt[] = [
                {
                    name:        'code-review',
                    description: 'Advanced code review (v2)',
                    arguments:   [
                        { name: 'language', description: 'Programming language', required: true },
                        { name: 'style', description: 'Review style', required: false },
                    ],
                },
                {
                    name:        'summarize',
                    description: 'Text summarization',
                },
                {
                    name:        'code-review',
                    description: 'Basic code review (v1)',
                    arguments:   [
                        { name: 'language', description: 'Language', required: true },
                    ],
                },
            ];

            const deduplicated = deduplicatePrompts(prompts);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated[0].name).toBe('code-review');
            expect(deduplicated[0].description).toBe('Advanced code review (v2)');
            expect(deduplicated[0].arguments).toHaveLength(2);
            expect(deduplicated[1].name).toBe('summarize');
        });

        it('should handle prompts with no duplicates', () => {
            const prompts: Prompt[] = [
                { name: 'analyze', description: 'Analyze code' },
                { name: 'translate', description: 'Translate text' },
                { name: 'summarize', description: 'Summarize content' },
            ];

            const deduplicated = deduplicatePrompts(prompts);

            expect(deduplicated).toHaveLength(3);
            expect(deduplicated).toEqual(prompts);
        });

        it('should handle empty prompt list', () => {
            const prompts: Prompt[] = [];
            const deduplicated = deduplicatePrompts(prompts);
            expect(deduplicated).toHaveLength(0);
        });

        it('should handle multiple duplicates', () => {
            const prompts: Prompt[] = [
                { name: 'analyze', description: 'Analyze v3' },
                { name: 'translate', description: 'Translate v2' },
                { name: 'analyze', description: 'Analyze v2' },
                { name: 'translate', description: 'Translate v1' },
                { name: 'analyze', description: 'Analyze v1' },
            ];

            const deduplicated = deduplicatePrompts(prompts);

            expect(deduplicated).toHaveLength(2);
            expect(deduplicated[0].name).toBe('analyze');
            expect(deduplicated[0].description).toBe('Analyze v3');
            expect(deduplicated[1].name).toBe('translate');
            expect(deduplicated[1].description).toBe('Translate v2');
        });

        it('should be case-sensitive for prompt names', () => {
            const prompts: Prompt[] = [
                { name: 'CodeReview', description: 'Pascal case' },
                { name: 'code-review', description: 'Kebab case' },
                { name: 'CODEREVIEW', description: 'Upper case' },
            ];

            const deduplicated = deduplicatePrompts(prompts);

            // All names are different (case-sensitive), so no deduplication
            expect(deduplicated).toHaveLength(3);
        });
    });
});
