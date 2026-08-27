/** 诊断 bagholder_raw.json 的数据完整性 */
import { readFile } from 'node:fs/promises';

async function main() {
  const r = JSON.parse(await readFile('api/data/bagholder_raw.json', 'utf-8')) as {
    long_dates: string[];
    short_dates: string[];
    stocks: Record<string, { turnover: (number | null)[]; close: (number | null)[] }>;
  };
  const keys = Object.keys(r.stocks);

  // 每个日期有多少股票有 turnover
  const perDate: Record<string, number> = {};
  for (let i = 0; i < r.long_dates.length; i++) {
    let n = 0;
    for (const k of keys) if (r.stocks[k].turnover[i] !== null) n++;
    perDate[r.long_dates[i]] = n;
  }
  const bad = Object.entries(perDate).filter(([, n]) => n < 500);
  console.log(`turnover 覆盖<500只的日期: ${bad.length}/${r.long_dates.length}`);
  for (const [d, n] of bad.slice(0, 20)) console.log(`  ${d}: ${n} 只`);

  // 每个日期 close 覆盖
  const perDateClose: Record<string, number> = {};
  for (let i = 0; i < r.short_dates.length; i++) {
    let n = 0;
    for (const k of keys) if (r.stocks[k].close[i] !== null) n++;
    perDateClose[r.short_dates[i]] = n;
  }
  const badClose = Object.entries(perDateClose).filter(([, n]) => n < 500);
  console.log(`close 覆盖<500只的日期: ${badClose.length}/${r.short_dates.length}`);
  for (const [d, n] of badClose.slice(0, 10)) console.log(`  ${d}: ${n} 只`);
}

main().catch(console.error);
