/**
 * LoadingScreen Component
 * Standardized loading state display
 */

import React from 'react';
import { Box, Text } from 'ink';

interface LoadingScreenProps {
    /** Loading message/status */
    message?: string
    /** Screen title (optional) */
    title?:   string
}

/**
 * Standardized loading screen
 */
export function LoadingScreen({ message = 'Loading...', title }: LoadingScreenProps) {
    return (
        <Box flexDirection="column" padding={1}>
            {title && (
                <Text bold color="cyan">
                    {title}
                </Text>
            )}
            <Box marginTop={title ? 1 : 0}>
                <Text>{message}</Text>
            </Box>
        </Box>
    );
}
