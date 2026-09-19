// Read-only audit of an already running local application; never reads credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:3001');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Use a local application URL');
const response = await fetch(new URL('/api/data-quality', origin), { signal: AbortSignal.timeout(90000) });
if (!response.ok) throw new Error(`Audit HTTP ${response.status}`);
const report = await response.json();
if (!report.success || !Array.isArray(report.data) || !report.data.length) throw new Error('No audit data');
report.summary = {
  stocks: report.data.length,
  issues: report.data.filter(row => ['missing', 'stale', 'conflict'].includes(row.market_value.status)).length,
  cross_checked: report.data.filter(row => row.market_value.comparison).length,
};
const directory = resolve(process.argv[3] || '.test-output/market-audits');
await mkdir(directory, { recursive: true });
const file = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ...report.summary, file }));
process.exitCode = report.summary.issues ? 1 : 0;
