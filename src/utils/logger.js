const serializeArg = (value) => {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const writeLog = (method, args) => {
  const timestamp = new Date().toISOString();
  const message = args.map(serializeArg).join(' ');

  console[method](`[${timestamp}] ${message}`);
};

export const logger = {
  info: (...args) => writeLog('log', args),
  warn: (...args) => writeLog('warn', args),
  error: (...args) => writeLog('error', args)
};

export const morganStream = {
  write: (message) => {
    const trimmed = String(message || '').trim();

    if (trimmed) {
      logger.info(trimmed);
    }
  }
};
