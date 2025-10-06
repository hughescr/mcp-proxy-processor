import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface Notification {
  id:        string
  type:      NotificationType
  message:   string
  details?:  string
  timestamp: number
}

interface NotificationContextValue {
  currentNotification: Notification | null
  notificationHeight:  number
  showNotification:    (type: NotificationType, message: string, details?: string) => void
  clearNotification:   () => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const AUTO_DISMISS_TIMES: Record<NotificationType, number> = {
  info:    5000,
  success: 5000,
  warning: 10000,
  error:   30000,
};

interface NotificationProviderProps {
  children: ReactNode
}

export function NotificationProvider({ children }: NotificationProviderProps): React.JSX.Element {
  const [currentNotification, setCurrentNotification] = useState<Notification | null>(null);
  const [queue, setQueue] = useState<Notification[]>([]);

  const showNotification = useCallback((type: NotificationType, message: string, details?: string) => {
    const notification: Notification = {
      id:        `${Date.now()}-${Math.random()}`,
      type,
      message,
      details,
      timestamp: Date.now(),
    };

    setQueue(prevQueue => [...prevQueue, notification]);
  }, []);

  const clearNotification = useCallback(() => {
    setCurrentNotification(null);
  }, []);

  // Process queue: show next notification when current is dismissed
  useEffect(() => {
    if(!currentNotification && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrentNotification(next);
      setQueue(rest);
    }
  }, [currentNotification, queue]);

  // Auto-dismiss current notification after timeout
  useEffect(() => {
    if(!currentNotification) {
      return;
    }

    const timeout = AUTO_DISMISS_TIMES[currentNotification.type];
    const timer = setTimeout(() => {
      setCurrentNotification(null);
    }, timeout);

    return () => clearTimeout(timer);
  }, [currentNotification]);

  const notificationHeight = currentNotification ? 2 : 0;

  const value: NotificationContextValue = {
    currentNotification,
    notificationHeight,
    showNotification,
    clearNotification,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotification(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if(!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
}
