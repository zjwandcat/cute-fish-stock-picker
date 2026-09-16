import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

test('monthly job returns progress promptly, shares one worker and rejects stale output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'monthly-job-'));
  const saved = { ...process.env };
  try {
    const bridge = join(dir, 'bridge.mjs');
    const runs = join(dir, 'runs.txt');
    const bundle = join(dir, 'service.mjs');
    await writeFile(bridge, `import {appendFile,writeFile} from 'node:fs/promises';
      await appendFile(${JSON.stringify(runs)}, 'run\\n');
      const month = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date()).replace(/\\D/g,'');
      await writeFile(process.env.TENQ_PROGRESS_FILE, JSON.stringify({stage:'m0', message:'fixture progress', recommendation_month:month}));
      await new Promise(resolve => setTimeout(resolve, 300));
      console.log(JSON.stringify({success:true,data:Array.from({length:10},(_,i)=>({ts_code:String(i)})),report:{status:'ready',is_current:true,recommendation_month:process.env.MONTHLY_TEST_STALE === '1' ? '200001' : month}}));`);
    Object.assign(process.env, { CUTE_FISH_DATA_DIR: dir, TENQ_RUNNER: bridge, TENQ_PYTHON: process.execPath });
    await build({ entryPoints: ['api/services/monthlyRecommendations.ts'], outfile: bundle, platform: 'node', format: 'esm', bundle: true });
    const service = await import(pathToFileURL(bundle).href);
    const start = performance.now();
    const responses = await Promise.all(Array.from({ length: 8 }, () => service.getMonthlyRecommendations()));
    assert.ok(performance.now() - start < 1000);
    assert.ok(responses.every(result => result.report.status === 'updating' && result.data.length === 0));
    const waitResult = async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const result = await service.getMonthlyRecommendations();
        if (result.report.status !== 'updating') return result;
      }
      throw new Error('fixture worker timed out');
    };
    const ready = await waitResult();
    assert.equal(ready.report.recommendation_month, service.recommendationMonth());
    assert.equal(ready.data.length, 10);
    assert.equal((await readFile(runs, 'utf8')).trim().split('\n').length, 1);
    process.env.MONTHLY_TEST_STALE = '1';
    await service.getMonthlyRecommendations(true);
    const rejected = await waitResult();
    assert.equal(rejected.report.status, 'error');
    assert.deepEqual(rejected.data, []);
    assert.deepEqual(rejected.report.high, []);
    assert.equal(rejected.report.recommendation_month, service.recommendationMonth());
  } finally {
    process.env = saved;
    await rm(dir, { recursive: true, force: true });
  }
});
