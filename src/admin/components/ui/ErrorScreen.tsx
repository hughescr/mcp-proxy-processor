/**
 * ErrorScreen Component
 * Standardized error display with troubleshooting tips
 */

import React from 'react';
import { Box, Text } from 'ink';
import { map } from 'lodash';

interface ErrorScreenProps {
    /** Error title */
    title:            string
    /** Error message */
    message:          string
    /** Troubleshooting tips */
    troubleshooting?: string[]
    /** Help text (default: "Press Esc to return") */
    helpText?:        string
    /** Callback when user wants to go back */
    onBack?:          () => void
}

/**
 * Standardized error screen with troubleshooting
 */
export function ErrorScreen({
    title,
    message,
    troubleshooting,
    helpText = 'Press Esc to return',
}: ErrorScreenProps) {
    return (
        <Box flexDirection="column" padding={1}>
            <Text bold color="red">
                {title}
            </Text>
            <Box marginTop={1}>
                <Text color="red">
                    {message}
                </Text>
            </Box>
            {troubleshooting && troubleshooting.length > 0 && (
                <Box marginTop={1} flexDirection="column">
                    <Text bold>Troubleshooting:</Text>
                    {map(troubleshooting, (tip, index) => (
                        <Text key={index}>{tip}</Text>
                    ))}
                </Box>
            )}
            <Box marginTop={1}>
                <Text>{helpText}</Text>
            </Box>
        </Box>
    );
}
