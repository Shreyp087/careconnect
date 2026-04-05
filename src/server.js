import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import { startReminderJob } from './jobs/reminders.js';
import adminRoutes from './routes/admin.js';
import appointmentRoutes from './routes/appointments.js';
import chatRoutes from './routes/chat.js';
import providerRoutes from './routes/providers.js';
import voiceRoutes from './routes/voice.js';
import { logger, morganStream } from './utils/logger.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../client/dist');
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
const isPm2Run = typeof process.env.pm_id !== 'undefined';
const shouldStartServer = isDirectRun || isPm2Run;
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many chat requests. Please wait a moment and try again.'
  }
});

const allowedOrigins = new Set(
  [frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean)
);

const isAllowedOrigin = (origin = '') => {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname === 'elevenlabs.io' || hostname.endsWith('.elevenlabs.io');
  } catch {
    return false;
  }
};

app.set('trust proxy', 1);
app.use(
  cors((request, callback) => {
    const origin = request.header('Origin');
    const isVoiceRoute = request.path.startsWith('/api/voice/');

    if (isVoiceRoute || isAllowedOrigin(origin)) {
      return callback(null, {
        origin: true,
        credentials: true
      });
    }

    return callback(new Error('Not allowed by CORS'));
  })
);
app.use(morgan('combined', { stream: morganStream }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/chat', (request, response, next) => {
  if (request.path === '/' || request.path === '') {
    return chatRateLimiter(request, response, next);
  }

  return next();
});

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    timestamp: new Date()
  });
});

app.use('/api', chatRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/voice', voiceRoutes);

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api')) {
      return next();
    }

    return response.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  logger.error(error);
  response.status(500).json({
    error: 'CareConnect hit an unexpected error.',
    details: error.message
  });
});

if (shouldStartServer) {
  startReminderJob();

  app.listen(port, () => {
    logger.info(`CareConnect server listening on port ${port}`);
  });
}

export default app;
