/**
 * ScreenHeader Component
 * Standardized screen title (H1) with cyan bold styling
 */

import React from 'react';
import { Box, Text } from 'ink';

interface ScreenHeaderProps {
    /** Screen title text */
    title:         string
    /** Optional subtitle or context */
    subtitle?:     string
    /** Bottom margin (default: 1) */
    marginBottom?: number
}

/**
 * Standardized screen header component
 */
export function ScreenHeader({ title, subtitle, marginBottom = 1 }: ScreenHeaderProps) {
    return (
        <Box flexDirection="column" marginBottom={marginBottom}>
            <Text bold color="cyan">
                {title}
            </Text>
            {subtitle && (
                <Text>
                    {subtitle}
                </Text>
            )}
        </Box>
    );
}
