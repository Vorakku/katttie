import express from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { ClientEvents, ServerEvents } from '../src/shared/protocol';
import { RoomManager, type Identity } from './room-manager';
import { YouTubeVideoStatusService, type VideoStatusService } from './youtube-video-status';
import { attachSocketHandlers, isLocalRequest, SlidingWindowLimits } from './socket-handlers';
import { MAX_NOTE_BYTES } from '../src/shared/notepad';

export type ApplicationOptions = {
  videoStatus?: VideoStatusService; youtubeApiKey?: string; prototypeMode?: boolean;
  now?: () => number; staticDir?: string; maxRooms?: number; maxQueueLength?: number; maxPendingIntents?: number;
};
export type SocketData = { identity?: Identity };

export function createApplication(options: ApplicationOptions = {}) {
  const prototypeMode = options.prototypeMode ?? process.env.LOCAL_PROTOTYPE === 'true';
  const app = express();
  app.disable('x-powered-by');
  const limits = new SlidingWindowLimits(options.now);
  app.use(helmet({
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
      frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
      imgSrc: ["'self'", 'data:', 'https://i.ytimg.com'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://www.youtube.com'],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    } },
  }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use((req, res, next) => {
    if (prototypeMode && !isLocalRequest(req)) { res.status(403).json({ message: 'Local prototype mode accepts loopback access only.' }); return; }
    // A cross-origin browser must never create rooms using this server's quota.
    if (req.headers.origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* Invalid origins are rejected. */ }
      if (!sameOrigin) { res.status(403).json({ message: 'Use the same origin.' }); return; }
    }
    next();
  });
  app.use(express.json({ limit: '8kb', strict: true }));
  const rooms = new RoomManager({
    ...options, prototypeMode,
    videoStatus: options.videoStatus ?? new YouTubeVideoStatusService({ apiKey: options.youtubeApiKey ?? process.env.YOUTUBE_DATA_API_KEY, prototypeMode, now: options.now }),
  });
  app.get('/api/health', (_req, res) => { res.json({ ok: true, prototypeMode }); });
  app.post('/api/rooms', (req, res) => {
    if (!limits.allow(`create:${req.socket.remoteAddress}`, 20, 60 * 60 * 1000)) { res.status(429).json({ message: 'Please wait before creating another room.' }); return; }
    if (!z.object({}).strict().safeParse(req.body ?? {}).success) { res.status(400).json({ message: 'Invalid room request.' }); return; }
    const created = rooms.create();
    if (!created) { res.status(503).json({ message: 'The server is full. Please try later.' }); return; }
    res.status(201).json(created);
  });
  app.use('/api', (_req, res) => { res.status(404).json({ message: 'Not found.' }); });
  const staticDir = resolve(options.staticDir ?? 'dist');
  app.use(express.static(staticDir, { index: false }));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/socket.io') || !existsSync(resolve(staticDir, 'index.html'))) { res.status(404).end(); return; }
    res.sendFile(resolve(staticDir, 'index.html'));
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error && typeof error === 'object' && 'status' in error && error.status === 413 ? 413 : 400;
    res.status(status).json({ message: status === 413 ? 'Request is too large.' : 'Invalid request.' });
  });
  const httpServer = createServer(app);
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: MAX_NOTE_BYTES + 8192,
    allowRequest: (req, callback) => {
      let sameOrigin = true;
      try { if (req.headers.origin) sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { sameOrigin = false; }
      callback(null, sameOrigin && (!prototypeMode || isLocalRequest(req)));
    },
  });
  attachSocketHandlers(io, rooms, limits);
  const timer = setInterval(() => rooms.cleanup(), 60 * 1000);
  timer.unref();
  const close = async () => {
    clearInterval(timer);
    await new Promise<void>(resolveClose => io.close(() => resolveClose()));
    if (httpServer.listening) await new Promise<void>((resolveClose, reject) => httpServer.close(error => error ? reject(error) : resolveClose()));
  };
  return { app, httpServer, io, rooms, close };
}
