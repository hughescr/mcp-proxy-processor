/**
 * Multi-line Text Editor Component for Ink
 * Allows editing multi-line text with cursor navigation
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import _ from 'lodash';

interface MultiLineTextEditorProps {
    /** Initial text value (can contain newlines) */
    value:            string
    /** Placeholder text when empty */
    placeholder?:     string
    /** Called when user submits (Ctrl+D or Ctrl+S) */
    onSubmit:         (value: string) => void
    /** Called when user cancels (Esc) */
    onCancel:         () => void
    /** Show line numbers */
    showLineNumbers?: boolean
}

/**
 * Multi-line text editor for terminal UI
 *
 * Controls:
 * - Arrow keys: Navigate cursor
 * - Enter: New line
 * - Backspace/Delete: Delete characters
 * - Ctrl+D or Ctrl+S: Submit
 * - Esc: Cancel
 */
export function MultiLineTextEditor({
    value,
    placeholder = '',
    onSubmit,
    onCancel,
    showLineNumbers = false,
}: MultiLineTextEditorProps) {
    const [lines, setLines] = useState<string[]>(value ? _.split(value, '\n') : ['']);
    const [cursorRow, setCursorRow] = useState(0);
    const [cursorCol, setCursorCol] = useState(value ? (_.split(value, '\n').pop()?.length ?? 0) : 0);
    // IMPORTANT: Use functional setState for rapid input support
    // When multiple keypresses arrive quickly (enabled by Ink's splitRapidInput option),
    // each must operate on the previous update's result, not stale closure state.
    const handleNavigation = (_input: string, key: { upArrow?: boolean, downArrow?: boolean, leftArrow?: boolean, rightArrow?: boolean }) => {
        if(key.upArrow) {
            setCursorRow((prevRow) => {
                if(prevRow > 0) {
                    const newRow = prevRow - 1;
                    setCursorCol(prevCol => Math.min(prevCol, lines[newRow].length));
                    return newRow;
                }
                return prevRow;
            });
            return;
        }

        if(key.downArrow) {
            setCursorRow((prevRow) => {
                if(prevRow < lines.length - 1) {
                    const newRow = prevRow + 1;
                    setCursorCol(prevCol => Math.min(prevCol, lines[newRow].length));
                    return newRow;
                }
                return prevRow;
            });
            return;
        }

        if(key.leftArrow) {
            setCursorCol((prevCol) => {
                if(prevCol > 0) {
                    return prevCol - 1;
                }
                // Move to end of previous line
                setCursorRow((prevRow) => {
                    if(prevRow > 0) {
                        const newRow = prevRow - 1;
                        setCursorCol(lines[newRow].length);
                        return newRow;
                    }
                    return prevRow;
                });
                return prevCol;
            });
            return;
        }

        if(key.rightArrow) {
            setCursorRow((prevRow) => {
                setCursorCol((prevCol) => {
                    if(prevCol < lines[prevRow].length) {
                        return prevCol + 1;
                    }
                    // Move to start of next line
                    if(prevRow < lines.length - 1) {
                        setCursorRow(prevRow + 1);
                        return 0;
                    }
                    return prevCol;
                });
                return prevRow;
            });
        }
    };

    const handleEditing = (input: string, key: { 'return'?: boolean, backspace?: boolean, 'delete'?: boolean, ctrl?: boolean, meta?: boolean }) => {
        if(key.return) {
            const currentLine = lines[cursorRow];
            const before = _.slice(currentLine, 0, cursorCol).join('');
            const after = _.slice(currentLine, cursorCol).join('');

            const newLines = [...lines];
            newLines[cursorRow] = before;
            newLines.splice(cursorRow + 1, 0, after);

            setLines(newLines);
            setCursorRow(cursorRow + 1);
            setCursorCol(0);
            return;
        }

        if(key.backspace || key.delete) {
            if(cursorCol > 0) {
                const currentLine = lines[cursorRow];
                const before = _.slice(currentLine, 0, cursorCol - 1).join('');
                const after = _.slice(currentLine, cursorCol).join('');
                const newLine = before + after;
                const newLines = [...lines];
                newLines[cursorRow] = newLine;
                setLines(newLines);
                setCursorCol(cursorCol - 1);
            } else if(cursorRow > 0) {
                const prevLine = lines[cursorRow - 1];
                const currentLine = lines[cursorRow];
                const newLines = [...lines];
                newLines[cursorRow - 1] = prevLine + currentLine;
                newLines.splice(cursorRow, 1);
                setLines(newLines);
                setCursorRow(cursorRow - 1);
                setCursorCol(prevLine.length);
            }
            return;
        }

        if(input && !key.ctrl && !key.meta) {
            const currentLine = lines[cursorRow];
            const before = _.slice(currentLine, 0, cursorCol).join('');
            const after = _.slice(currentLine, cursorCol).join('');
            const newLine = before + input + after;
            const newLines = [...lines];
            newLines[cursorRow] = newLine;
            setLines(newLines);
            setCursorCol(cursorCol + input.length);
        }
    };

    const handleInput = (input: string, key: { escape?: boolean, ctrl?: boolean, meta?: boolean, upArrow?: boolean, downArrow?: boolean, leftArrow?: boolean, rightArrow?: boolean, 'return'?: boolean, backspace?: boolean, 'delete'?: boolean }) => {
        if(key.escape) {
            onCancel();
            return;
        }

        if(key.ctrl && (input === 'd' || input === 's')) {
            onSubmit(_.join(lines, '\n'));
            return;
        }

        handleNavigation(input, key);
        handleEditing(input, key);
    };

    useInput(handleInput);

    const isEmpty = lines.length === 1 && lines[0] === '';

    return (
        <Box flexDirection="column">
            {isEmpty && placeholder
? (
                <Text dimColor>{placeholder}</Text>
            )
: (
                _.map(lines, (line, index) => {
                    const lineNumber = showLineNumbers ? `${_.padStart(String(index + 1), 3, ' ')} │ ` : '';
                    const isCursorLine = index === cursorRow;

                    if(isCursorLine) {
                        const before = _.slice(line, 0, cursorCol).join('');
                        const cursor = line[cursorCol] ?? ' ';
                        const after = _.slice(line, cursorCol + 1).join('');

                        return (
                            <Text key={index}>
                                {showLineNumbers && <Text dimColor>{lineNumber}</Text>}
                                {before}
                                <Text backgroundColor="white" color="black">{cursor}</Text>
                                {after}
                            </Text>
                        );
                    }

                    return (
                        <Text key={index}>
                            {showLineNumbers && <Text dimColor>{lineNumber}</Text>}
                            {line || ' '}
                        </Text>
                    );
                })
            )}
            <Box marginTop={1}>
                <Text dimColor>Ctrl+S to save • Esc to cancel • Arrow keys to navigate</Text>
            </Box>
        </Box>
    );
}
