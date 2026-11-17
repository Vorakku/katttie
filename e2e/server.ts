import { createApplication } from '../server/app';

// The real server and socket protocol run unchanged; only Google's remote lookup is replaced.
const application = createApplication({ videoStatus: { check: async () => ({ madeForKids: false, title: 'Our test song' }) } });
application.httpServer.listen(3000, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void application.close().then(() => process.exit(0)); });
