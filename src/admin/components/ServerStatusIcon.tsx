import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { ServerStatus } from '../BackendContext.js';

const SPINNER_FRAMES = ['⋮', '⋰', '⋯', '⋱'];
const SPINNER_INTERVAL = 200;

interface ServerStatusIconProps {
  status: ServerStatus
}

export function ServerStatusIcon({ status }: ServerStatusIconProps): React.JSX.Element {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if(status !== 'connecting') {
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);

    return () => clearInterval(interval);
  }, [status]);

  if(status === 'connected') {
    return <Text color="green">✓</Text>;
  }

  if(status === 'failed') {
    return <Text color="red">✗</Text>;
  }

  // connecting
  return <Text color="yellow">{SPINNER_FRAMES[spinnerFrame]}</Text>;
}
