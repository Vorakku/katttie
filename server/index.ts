import 'dotenv/config';
import { createApplication } from './app';

const application = createApplication();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const localOnly = process.env.LOCAL_PROTOTYPE === 'true';
application.httpServer.listen(port, localOnly ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Our Little Radio is listening on port ${port}${localOnly ? ' (local prototype only)' : ''}.`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void application.close().then(() => process.exit(0)); });
