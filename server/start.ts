import { homedir } from 'node:os';
import { join } from 'node:path';
import { createService } from './service.ts';

const service = createService({ translationDelayMs: Number(process.env.SEEFOOD_TRANSLATION_DELAY_MS || 0), workerDelayMs: Number(process.env.SEEFOOD_WORKER_DELAY_MS || 20), mockScenario: process.env.SEEFOOD_MOCK_SCENARIO, dataDir: process.env.SEEFOOD_DATA_DIR || join(homedir(), '.seefood', 'development'),
  enableDevSession: process.env.SEEFOOD_DEV_IDENTITY === '1' && process.env.NODE_ENV !== 'production',
  devIdentities: (process.env.SEEFOOD_DEV_IDENTITIES || 'demo-owner-a,demo-owner-b').split(',').filter(Boolean) });
service.server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  const address = service.server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP address');
  console.log(JSON.stringify({ url: `http://${process.env.HOST || '127.0.0.1'}:${address.port}` }));
});
process.once('SIGTERM', () => void service.close());
process.once('SIGINT', () => void service.close());
