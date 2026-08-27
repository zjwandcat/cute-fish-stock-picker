/**
 * 手工校正的真实收盘价覆盖表(2026-06-18)。
 *
 * 数据源:用户手动校正,优先级高于 Tushare daily_basic。
 * 单位:元/股。
 */
export interface PriceOverride {
  price: number;
  change_pct: number;
  total_mv: number; // 亿元
  turnover_rate: number; // %
  pe_ttm: number;
  pb: number;
}

export const PRICE_OVERRIDE_JUN18: Record<string, PriceOverride> = {
  '688256.SH': { price: 1507.46, change_pct: 7.66, total_mv: 9468, turnover_rate: 2.46, pe_ttm: 308.71, pb: 65.17 },
  '300308.SZ': { price: 1367.88, change_pct: 8.36, total_mv: 15253, turnover_rate: 3.08, pe_ttm: 92.88, pb: 39.02 },
  '002475.SZ': { price: 69.93, change_pct: 6.89, total_mv: 5095, turnover_rate: 2.20, pe_ttm: 28.84, pb: 5.62 },
  '600111.SH': { price: 51.40, change_pct: 2.10, total_mv: 1858, turnover_rate: 3.86, pe_ttm: 66.63, pb: 7.13 },
  '300274.SZ': { price: 146.98, change_pct: 0.23, total_mv: 3047, turnover_rate: 3.56, pe_ttm: 25.92, pb: 6.35 },
  '002371.SZ': { price: 721.04, change_pct: 2.25, total_mv: 5227, turnover_rate: 1.73, pe_ttm: 88.68, pb: 12.58 },
  '600309.SH': { price: 69.05, change_pct: 2.55, total_mv: 2161, turnover_rate: 2.02, pe_ttm: 17.48, pb: 2.07 },
  '600406.SH': { price: 23.06, change_pct: 0.95, total_mv: 1852, turnover_rate: 0.82, pe_ttm: 22.65, pb: 3.52 },
  '688012.SH': { price: 360.00, change_pct: 5.28, total_mv: 3373, turnover_rate: 2.76, pe_ttm: 109.87, pb: 12.33 },
  '601985.SH': { price: 9.12, change_pct: 0.11, total_mv: 1876, turnover_rate: 0.80, pe_ttm: 23.11, pb: 1.59 },
  '300124.SZ': { price: 71.18, change_pct: 3.19, total_mv: 1927, turnover_rate: 1.42, pe_ttm: 39.58, pb: 5.16 },
  '603501.SH': { price: 89.97, change_pct: 3.15, total_mv: 1135, turnover_rate: 1.56, pe_ttm: 30.39, pb: 3.41 },
  '601689.SH': { price: 62.30, change_pct: 1.78, total_mv: 1083, turnover_rate: 1.70, pe_ttm: 38.77, pb: 4.36 },
  '002600.SZ': { price: 16.82, change_pct: 7.35, total_mv: 1229, turnover_rate: 2.81, pe_ttm: 51.99, pb: 4.51 },
  '002837.SZ': { price: 74.37, change_pct: 6.73, total_mv: 948, turnover_rate: 4.79, pe_ttm: 186.26, pb: 25.96 },
  '301269.SZ': { price: 104.00, change_pct: 7.49, total_mv: 567, turnover_rate: 2.92, pe_ttm: 0, pb: 10.66 },
  '603087.SH': { price: 56.70, change_pct: 1.58, total_mv: 339, turnover_rate: 0.95, pe_ttm: 32.95, pb: 2.85 },
  '002335.SZ': { price: 39.38, change_pct: 10.01, total_mv: 294, turnover_rate: 6.39, pe_ttm: 68.65, pb: 4.52 },
  '603338.SH': { price: 46.68, change_pct: 0.39, total_mv: 236, turnover_rate: 0.84, pe_ttm: 13.04, pb: 2.12 },
  '688169.SH': { price: 97.27, change_pct: 0.60, total_mv: 252, turnover_rate: 3.06, pe_ttm: 18.75, pb: 1.86 },
  '603296.SH': { price: 80.40, change_pct: 0, total_mv: 0, turnover_rate: 0, pe_ttm: 0, pb: 0 },
};

/**
 * 获取指定代码的价格覆盖。
 * 返回 null 表示使用 Tushare 原始数据。
 */
export function getOverridePrice(tsCode: string): PriceOverride | null {
  return PRICE_OVERRIDE_JUN18[tsCode] ?? null;
}
