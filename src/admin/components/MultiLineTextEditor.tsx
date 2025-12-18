/**
 * Multi-line Text Editor Component for Ink
 * Allows editing multi-line text with cursor navigation
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import _ from 'lodash';

interface CursorPosition {
    row: number
    col: number
}

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

function moveUp(cursor: CursorPosition, lines: string[]): CursorPosition {
    if(cursor.row > 0) {
        const newRow = cursor.row - 1;
        return { row: newRow, col: Math.min(cursor.col, lines[newRow].length) };
    }
    return cursor;
}

function moveDown(cursor: CursorPosition, lines: string[]): CursorPosition {
    if(cursor.row < lines.length - 1) {
        const newRow = cursor.row + 1;
        return { row: newRow, col: Math.min(cursor.col, lines[newRow].length) };
    }
    return cursor;
}

function moveLeft(cursor: CursorPosition, lines: string[]): CursorPosition {
    if(cursor.col > 0) {
        return { ...cursor, col: cursor.col - 1 };
    }
    if(cursor.row > 0) {
        return { row: cursor.row - 1, col: lines[cursor.row - 1].length };
    }
    return cursor;
}

function moveRight(cursor: CursorPosition, lines: string[]): CursorPosition {
    if(cursor.col < lines[cursor.row].length) {
        return { ...cursor, col: cursor.col + 1 };
    }
    if(cursor.row < lines.length - 1) {
        return { row: cursor.row + 1, col: 0 };
    }
    return cursor;
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
    const [cursor, setCursor] = useState<CursorPosition>({ row: 0, col: value ? (_.split(value, '\n').pop()?.length ?? 0) : 0 });
    // IMPORTANT: Use functional setState for rapid input support
    // When multiple keypresses arrive quickly (enabled by Ink's splitRapidInput option),
    // each must operate on the previous update's result, not stale closure state.
    const handleNavigation = (_input: string, key: { upArrow?: boolean, downArrow?: boolean, leftArrow?: boolean, rightArrow?: boolean }) => {
        if(key.upArrow) {
            setCursor(prev => moveUp(prev, lines));
            return;
        }
        if(key.downArrow) {
            setCursor(prev => moveDown(prev, lines));
            return;
        }
        if(key.leftArrow) {
            setCursor(prev => moveLeft(prev, lines));
            return;
        }
        if(key.rightArrow) {
            setCursor(prev => moveRight(prev, lines));
            return;
        }
    };

    const handleEditing = (input: string, key: { 'return'?: boolean, backspace?: boolean, 'delete'?: boolean, ctrl?: boolean, meta?: boolean }) => {
        if(key.return) {
            // Use functional setState to avoid race conditions with rapid input
            setCursor((prevCursor) => {
                setLines((prevLines) => {
                    const currentLine = prevLines[prevCursor.row];
                    const before = _.slice(currentLine, 0, prevCursor.col).join('');
                    const after = _.slice(currentLine, prevCursor.col).join('');

                    const newLines = [...prevLines];
                    newLines[prevCursor.row] = before;
                    newLines.splice(prevCursor.row + 1, 0, after);

                    return newLines;
                });

                return { row: prevCursor.row + 1, col: 0 };
            });
            return;
        }

        if(key.backspace || key.delete) {
            setCursor((prevCursor) => {
                // For line joining, capture the previous line length BEFORE the merge
                let prevLineLength = 0;

                setLines((prevLines) => {
                    if(prevCursor.col > 0) {
                        const currentLine = prevLines[prevCursor.row];
                        const before = _.slice(currentLine, 0, prevCursor.col - 1).join('');
                        const after = _.slice(currentLine, prevCursor.col).join('');
                        const newLine = before + after;
                        const newLines = [...prevLines];
                        newLines[prevCursor.row] = newLine;
                        return newLines;
                    } else if(prevCursor.row > 0) {
                        const prevLine = prevLines[prevCursor.row - 1];
                        prevLineLength = prevLine.length; // Capture BEFORE merge
                        const currentLine = prevLines[prevCursor.row];
                        const newLines = [...prevLines];
                        newLines[prevCursor.row - 1] = prevLine + currentLine;
                        newLines.splice(prevCursor.row, 1);
                        return newLines;
                    }
                    return prevLines;
                });

                if(prevCursor.col > 0) {
                    return { row: prevCursor.row, col: prevCursor.col - 1 };
                } else if(prevCursor.row > 0) {
                    return { row: prevCursor.row - 1, col: prevLineLength };
                }
                return prevCursor;
            });
            return;
        }

        if(input && !key.ctrl && !key.meta) {
            setCursor((prevCursor) => {
                setLines((prevLines) => {
                    const currentLine = prevLines[prevCursor.row];
                    const before = _.slice(currentLine, 0, prevCursor.col).join('');
                    const after = _.slice(currentLine, prevCursor.col).join('');
                    const newLine = before + input + after;
                    const newLines = [...prevLines];
                    newLines[prevCursor.row] = newLine;

                    return newLines;
                });

                return { row: prevCursor.row, col: prevCursor.col + input.length };
            });
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
                    const isCursorLine = index === cursor.row;

                    if(isCursorLine) {
                        const before = _.slice(line, 0, cursor.col).join('');
                        const cursorChar = line[cursor.col] ?? ' ';
                        const after = _.slice(line, cursor.col + 1).join('');

                        return (
                            <Text key={index}>
                                {showLineNumbers && <Text dimColor>{lineNumber}</Text>}
                                {before}
                                <Text backgroundColor="white" color="black">{cursorChar}</Text>
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
                <Text>Ctrl+S to save • Esc to cancel • Arrow keys to navigate</Text>
            </Box>
        </Box>
    );
}
