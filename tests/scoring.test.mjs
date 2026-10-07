import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'tsx/esm/api';

register();

const { sortRecommendationsByScore } = await import('../api/services/scoring.ts');

function recommendation(ts_code, total_score) {
  return {
    ts_code,
    name: ts_code,
    tech_score: 50,
    fundamental_score: 50,
    capital_score: 50,
    total_score,
    signals: [],
    next_day_adjust: 0,
    risk_level: 'medium',
  };
}

test('capital ranking returns the highest five scores in stable order', () => {
  const input = [
    recommendation('688825.SH', 72),
    recommendation('000538.SZ', 60),
    recommendation('601088.SH', 55),
    recommendation('002475.SZ', 50),
    recommendation('600001.SH', 90),
    recommendation('600002.SH', 85),
    recommendation('600003.SH', 85),
    recommendation('600004.SH', 80),
    recommendation('600005.SH', 79),
  ];
  const originalOrder = input.map((item) => item.ts_code);

  const ranked = sortRecommendationsByScore(input);

  assert.deepEqual(
    ranked.slice(0, 5).map((item) => item.ts_code),
    ['600001.SH', '600002.SH', '600003.SH', '600004.SH', '600005.SH'],
  );
  assert.deepEqual(ranked.slice(0, 5).map((item) => item.total_score), [90, 85, 85, 80, 79]);
  assert.deepEqual(input.map((item) => item.ts_code), originalOrder);
});
