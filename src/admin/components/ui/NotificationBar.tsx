import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useNotification, type NotificationType } from './NotificationContext.js';

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  error:   'red',
  warning: 'yellow',
  info:    'cyan',
  success: 'green',
};

const AUTO_DISMISS_TIMES: Record<NotificationType, number> = {
  info:    5000,
  success: 5000,
  warning: 10000,
  error:   30000,
};

export function NotificationBar(): React.JSX.Element | null {
  const { currentNotification } = useNotification();
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  useEffect(() => {
    if(!currentNotification) {
      setSecondsRemaining(0);
      return;
    }

    const totalSeconds = Math.ceil(AUTO_DISMISS_TIMES[currentNotification.type] / 1000);
    setSecondsRemaining(totalSeconds);

    const interval = setInterval(() => {
      setSecondsRemaining(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [currentNotification]);

  if(!currentNotification) {
    return null;
  }

  const color = NOTIFICATION_COLORS[currentNotification.type];
  const message = currentNotification.details
    ? `${currentNotification.message}: ${currentNotification.details}`
    : currentNotification.message;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={color}>{message}</Text>
      <Text dimColor>
        Auto-dismiss in
{' '}
{secondsRemaining}
s
      </Text>
    </Box>
  );
}
