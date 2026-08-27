/**
 * A+H 两地上市公司比价服务（仅限中国税务居民通过港股通交易的税务口径）。
 *
 * 数据来源：
 *  - AH 股对映射：内置静态映射表（约 140 对，覆盖沪深港主要 A+H 公司，2026-08 更新；
 *    新增 A+H 上市需手工补充 AH_PAIRS）
 *  - A 股实时行情：新浪实时行情（realtime.ts）
 *  - H 股实时行情：腾讯港股行情（hkQuotes.ts，含股息率）
 *  - 港元兑人民币汇率：腾讯外汇 whHKDCNY，备用新浪 fx_shkdcny，缓存 10 分钟
 *
 * 税务口径（中国税务居民，港股通）：
 *  - 股息红利税：H 股分红按 20% 代扣；A 股差别化：持股>1 年免税 / 1 个月~1 年 10% / <1 个月 20%
 *  - 印花税：港股买卖双边各 0.1%；A 股仅卖出单边 0.05%（2023-08-28 起）
 *  - 其他成本：港股通另有交易征费/交易费/结算费约 0.01%，以及汇兑买卖价差（往返约 0.1%~0.3%）；A 股规费极低
 *  - 转让差价（资本利得）：港股通与 A 股目前均暂免个人所得税
 */
import axios from 'axios';
import iconv from 'iconv-lite';

import { getSinaRealtimeQuotes, isHK } from './realtime.js';
import { getHKQuotes } from './hkQuotes.js';
import { getDailyBasic, getToday } from './tushare.js';
import * as cache from './cache.js';

const CACHE_TTL_FX = 10 * 60 * 1000; // 汇率缓存10分钟
const CACHE_TTL_AH = 60 * 1000; // AH比价缓存60秒

/** A股代码 -> H股代码（ts_code 格式）。同时用于反向查找。 */
const AH_PAIRS: [string, string, string][] = [
  // ===== 金融 =====
  ['601398.SH', '01398.HK', '工商银行'],
  ['601939.SH', '00939.HK', '建设银行'],
  ['601988.SH', '03988.HK', '中国银行'],
  ['601288.SH', '01288.HK', '农业银行'],
  ['601328.SH', '03328.HK', '交通银行'],
  ['600036.SH', '03968.HK', '招商银行'],
  ['600016.SH', '01988.HK', '民生银行'],
  ['601818.SH', '06818.HK', '光大银行'],
  ['601998.SH', '00998.HK', '中信银行'],
  ['002936.SZ', '06196.HK', '郑州银行'],
  ['601318.SH', '02318.HK', '中国平安'],
  ['601628.SH', '02628.HK', '中国人寿'],
  ['601601.SH', '02601.HK', '中国太保'],
  ['601336.SH', '01336.HK', '新华保险'],
  ['601319.SH', '01339.HK', '中国人保'],
  ['600030.SH', '06030.HK', '中信证券'],
  ['601688.SH', '06886.HK', '华泰证券'],
  ['601211.SH', '02611.HK', '国泰海通'],
  ['000776.SZ', '01776.HK', '广发证券'],
  ['600999.SH', '06099.HK', '招商证券'],
  ['600958.SH', '03958.HK', '东方证券'],
  ['601066.SH', '06066.HK', '中信建投'],
  ['601881.SH', '06881.HK', '中国银河'],
  ['601788.SH', '06178.HK', '光大证券'],
  ['601375.SH', '01375.HK', '中原证券'],
  // ===== 能源/资源 =====
  ['601857.SH', '00857.HK', '中国石油'],
  ['600028.SH', '00386.HK', '中国石化'],
  ['600938.SH', '00883.HK', '中国海油'],
  ['601088.SH', '01088.HK', '中国神华'],
  ['601898.SH', '01898.HK', '中煤能源'],
  ['600188.SH', '01171.HK', '兖矿能源'],
  ['601899.SH', '02899.HK', '紫金矿业'],
  ['603993.SH', '03993.HK', '洛阳钼业'],
  ['600362.SH', '00358.HK', '江西铜业'],
  ['601600.SH', '02600.HK', '中国铝业'],
  ['600547.SH', '01787.HK', '山东黄金'],
  ['002460.SZ', '01772.HK', '赣锋锂业'],
  // ===== 电力/电气 =====
  ['600011.SH', '00902.HK', '华能国际'],
  ['600027.SH', '01071.HK', '华电国际'],
  ['601991.SH', '00991.HK', '大唐发电'],
  ['601330.SH', '01330.HK', '绿色动力'],
  ['600875.SH', '01072.HK', '东方电气'],
  ['601727.SH', '02727.HK', '上海电气'],
  // ===== 基建/运输 =====
  ['601390.SH', '00390.HK', '中国中铁'],
  ['601186.SH', '01186.HK', '中国铁建'],
  ['601800.SH', '01800.HK', '中国交建'],
  ['601618.SH', '01618.HK', '中国中冶'],
  ['601766.SH', '01766.HK', '中国中车'],
  ['600548.SH', '00548.HK', '深高速'],
  ['600377.SH', '00177.HK', '宁沪高速'],
  ['600012.SH', '00995.HK', '皖通高速'],
  ['601107.SH', '00107.HK', '四川成渝'],
  ['601333.SH', '00525.HK', '广深铁路'],
  ['601588.SH', '00588.HK', '北辰实业'],
  ['601880.SH', '02880.HK', '辽港股份'],
  ['601326.SH', '03369.HK', '秦港股份'],
  ['601598.SH', '00598.HK', '中国外运'],
  ['601919.SH', '01919.HK', '中远海控'],
  ['600026.SH', '01138.HK', '中远海能'],
  ['601866.SH', '02866.HK', '中远海发'],
  ['600029.SH', '01055.HK', '南方航空'],
  ['601111.SH', '00753.HK', '中国国航'],
  ['600115.SH', '00670.HK', '中国东航'],
  // ===== 工业/材料 =====
  ['600585.SH', '00914.HK', '海螺水泥'],
  ['000157.SZ', '01157.HK', '中联重科'],
  ['002202.SZ', '02208.HK', '金风科技'],
  ['000039.SZ', '02039.HK', '中集集团'],
  ['601717.SH', '00564.HK', '中创智领'],
  ['601038.SH', '00038.HK', '一拖股份'],
  ['601992.SH', '02009.HK', '金隅集团'],
  ['601068.SH', '02068.HK', '中铝国际'],
  ['600685.SH', '00317.HK', '中船防务'],
  ['601005.SH', '01053.HK', '重庆钢铁'],
  ['600688.SH', '00338.HK', '上海石化'],
  ['600871.SH', '01033.HK', '石化油服'],
  ['601808.SH', '02883.HK', '中海油服'],
  ['000898.SZ', '00347.HK', '鞍钢股份'],
  ['600808.SH', '00323.HK', '马钢股份'],
  ['600876.SH', '01108.HK', '凯盛新能'],
  ['601869.SH', '06869.HK', '长飞光纤'],
  ['002490.SZ', '00568.HK', '山东墨龙'],
  ['002703.SZ', '01057.HK', '浙江世宝'],
  ['600874.SH', '01065.HK', '创业环保'],
  ['002672.SZ', '00895.HK', '东江环保'],
  ['600635.SH', '01635.HK', '大众公用'],
  ['600860.SH', '00187.HK', '京城股份'],
  ['600775.SH', '00553.HK', '南京熊猫'],
  ['601828.SH', '01528.HK', '美凯龙'],
  ['000488.SZ', '01812.HK', '晨鸣纸业'],
  // ===== 制造/消费/医药 =====
  ['002594.SZ', '01211.HK', '比亚迪'],
  ['000338.SZ', '02338.HK', '潍柴动力'],
  ['600660.SH', '03606.HK', '福耀玻璃'],
  ['601633.SH', '02333.HK', '长城汽车'],
  ['601238.SH', '02238.HK', '广汽集团'],
  ['600600.SH', '00168.HK', '青岛啤酒'],
  ['000921.SZ', '00921.HK', '海信家电'],
  ['603259.SH', '02359.HK', '药明康德'],
  ['600196.SH', '02196.HK', '复星医药'],
  ['000513.SZ', '01513.HK', '丽珠集团'],
  ['600332.SH', '00874.HK', '白云山'],
  ['601607.SH', '02607.HK', '上海医药'],
  ['000756.SZ', '00719.HK', '新华制药'],
  ['601811.SH', '00811.HK', '新华文轩'],
  ['000002.SZ', '02202.HK', '万科A'],
  // ===== 科技/新经济（含 2024-2026 新上市）=====
  ['688981.SH', '00981.HK', '中芯国际'],
  ['600941.SH', '00941.HK', '中国移动'],
  ['000063.SZ', '00763.HK', '中兴通讯'],
  ['300750.SZ', '03750.HK', '宁德时代'],
  ['600276.SH', '01276.HK', '恒瑞医药'],
  ['000333.SZ', '00300.HK', '美的集团'],
  ['605499.SH', '09980.HK', '东鹏饮料'],
  ['300450.SZ', '00470.HK', '先导智能'],
  ['603501.SH', '00501.HK', '豪威集团'],
  ['688337.SH', '00537.HK', '普源精电'],
  ['300638.SZ', '00638.HK', '广和通'],
  ['300866.SZ', '00668.HK', '安克创新'],
  ['300433.SZ', '06613.HK', '蓝思科技'],
  ['002050.SZ', '02050.HK', '三花智控'],
  ['688008.SH', '02520.HK', '澜起科技'],
  ['003021.SZ', '02538.HK', '兆威机电'],
];

/** 查找 A+H 配对：传入任一侧代码，返回 [A股代码, H股代码, 名称]；无配对返回 null */
export function findAHPair(tsCode: string): [string, string, string] | null {
  for (const [a, h, name] of AH_PAIRS) {
    if (tsCode === a || tsCode === h) return [a, h, name];
  }
  return null;
}

export interface AHComparison {
  is_a_side: boolean; // 当前查看的是否 A 股
  a_code: string;
  h_code: string;
  name: string;
  a_price: number; // A股现价（人民币）
  a_pct_chg: number; // A股涨跌幅%
  h_price: number; // H股现价（港元）
  h_pct_chg: number; // H股涨跌幅%
  h_price_cny: number; // H股折算人民币
  fx_rate: number; // 港元兑人民币汇率
  fx_source: string; // 汇率来源（实时/备用/近似）
  h_a_ratio: number; // 比价 H/A = h_price_cny / a_price（百分比）
  a_premium: number; // A股溢价率 = a_price / h_price_cny - 1（百分比，正=A股贵）
  dividend_yield: number; // 股息率%（可得值，0表示未知）
  verdict: 'A' | 'H' | 'neutral'; // 当前买入优先选择的市场
  long_verdict: 'A' | 'H'; // 长期持有视角优先的市场
  advice: string; // 主建议（一句话结论）
  short_term_note: string; // 短线交易视角说明
  long_term_note: string; // 长期持有/吃息视角说明
  tax_notes: string[]; // 税务要点（中国税务居民，港股通）
}

/**
 * 获取港元兑人民币汇率（HKD -> CNY）。
 * 优先腾讯外汇接口，备用新浪；都失败时回退 0.92 近似值。
 */
export async function getHKDCNYRate(): Promise<{ rate: number; source: string }> {
  const cached = cache.get<{ rate: number; source: string }>('fx_hkdcny');
  if (cached) return cached;

  // 1) 腾讯外汇：v_whHKDCNY="310~港元人民币~HKDCNY~0.8570~..."，f[3]=现价
  try {
    const resp = await axios.get('https://qt.gtimg.cn/q=whHKDCNY', {
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
      responseType: 'arraybuffer',
    });
    const text = iconv.decode(Buffer.from(resp.data), 'gbk');
    const m = text.match(/v_whHKDCNY="([^"]+)"/);
    const rate = m ? parseFloat(m[1].split('~')[3]) : NaN;
    if (Number.isFinite(rate) && rate > 0.5 && rate < 1.5) {
      const result = { rate, source: '实时汇率' };
      cache.set('fx_hkdcny', result, CACHE_TTL_FX);
      return result;
    }
  } catch {
    // ignore，尝试备用
  }

  // 2) 新浪外汇：hq_str_fx_shkdcny="时间,买价,卖价,..."，f[1]=买价
  try {
    const resp = await axios.get('https://hq.sinajs.cn/list=fx_shkdcny', {
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000,
      responseType: 'arraybuffer',
    });
    const text = iconv.decode(Buffer.from(resp.data), 'gbk');
    const m = text.match(/hq_str_fx_shkdcny="([^"]+)"/);
    const rate = m ? parseFloat(m[1].split(',')[1]) : NaN;
    if (Number.isFinite(rate) && rate > 0.5 && rate < 1.5) {
      const result = { rate, source: '实时汇率' };
      cache.set('fx_hkdcny', result, CACHE_TTL_FX);
      return result;
    }
  } catch {
    // ignore
  }

  return { rate: 0.92, source: '近似汇率' };
}

/**
 * 计算 A/H 比价与买入建议。
 * @param tsCode 当前查看的股票代码（A股或H股）
 * @returns AHComparison；非 A+H 股或数据不足返回 null
 */
export async function getAHComparison(tsCode: string): Promise<AHComparison | null> {
  const pair = findAHPair(tsCode);
  if (!pair) return null;

  const cacheKey = `ah_compare_${pair[0]}`;
  const cached = cache.get<AHComparison>(cacheKey);
  if (cached) return cached;

  const [aCode, hCode, name] = pair;

  // 并行获取：A股实时、H股实时（含股息率）、汇率、A股股息率
  const [aQuotes, hQuoteMap, fx] = await Promise.all([
    getSinaRealtimeQuotes([aCode]),
    getHKQuotes([hCode]),
    getHKDCNYRate(),
  ]);

  const aQuote = aQuotes.find((q) => q.ts_code === aCode);
  const hQuote = hQuoteMap.get(hCode);
  if (!aQuote || aQuote.price <= 0 || !hQuote || hQuote.price <= 0) return null;

  let dividendYield = hQuote.dividend_yield ?? 0;
  if (!(dividendYield > 0)) {
    try {
      const basic = await getDailyBasic(aCode, getToday());
      if (basic && basic.dv_ratio > 0) dividendYield = basic.dv_ratio;
    } catch {
      // ignore
    }
  }

  const hPriceCny = hQuote.price * fx.rate;
  const aPremium = (aQuote.price / hPriceCny - 1) * 100; // 正 = A股溢价（A股贵）
  const hARatio = (hPriceCny / aQuote.price) * 100; // 比价 H/A（新浪口径）

  const { advice, verdict, long_verdict: longVerdict, shortTermNote, longTermNote } = buildAdvice(
    aPremium,
    dividendYield,
  );

  const result: AHComparison = {
    is_a_side: !isHK(tsCode),
    a_code: aCode,
    h_code: hCode,
    name,
    a_price: aQuote.price,
    a_pct_chg: aQuote.pct_chg,
    h_price: hQuote.price,
    h_pct_chg: hQuote.change_pct,
    h_price_cny: +hPriceCny.toFixed(3),
    fx_rate: fx.rate,
    fx_source: fx.source,
    h_a_ratio: +hARatio.toFixed(2),
    a_premium: +aPremium.toFixed(2),
    dividend_yield: +dividendYield.toFixed(2),
    verdict,
    long_verdict: longVerdict,
    advice,
    short_term_note: shortTermNote,
    long_term_note: longTermNote,
    tax_notes: [
      '红利税：港股通持有 H 股分红按 20% 代扣；A 股持股超 1 年免征、1 个月~1 年 10%、不足 1 个月 20%',
      '印花税：港股买卖双边各 0.1%；A 股仅卖出单边 0.05%',
      '其他成本：港股通另有交易征费/结算费约 0.01% 与汇兑价差（往返约 0.1%~0.3%）；A 股规费极低',
      '资本利得：A 股与港股通转让差价目前均暂免个人所得税',
      '汇率：港股通以港币报价、人民币结算，持有期间承担港币汇率波动',
    ],
  };

  cache.set(cacheKey, result, CACHE_TTL_AH);
  return result;
}

/**
 * 买入建议核心逻辑。
 * @param aPremium A股溢价率%（正=A股贵，负=A股便宜）
 * @param dy 股息率%
 */
function buildAdvice(
  aPremium: number,
  dy: number,
): { verdict: 'A' | 'H' | 'neutral'; long_verdict: 'A' | 'H'; advice: string; shortTermNote: string; longTermNote: string } {
  // 港股通往返交易成本劣势约 0.3%（印花税差额 0.15% + 征费结算 + 汇兑价差）
  const SHORT_COST_GAP = 0.3;
  // 高息股长期持有：H股每年红利税损失 = dy × 20%，5年累计约 dy × 1（单利近似）
  const isHighDiv = dy >= 3;

  // ---- 短线视角（T+1 内进出，红利税影响小，主要看价差与交易成本）----
  let shortVerdict: 'A' | 'H';
  let shortTermNote: string;
  if (aPremium >= 15) {
    shortVerdict = 'H';
    shortTermNote = `H股折价 ${aPremium.toFixed(1)}%，远超港股通约 ${SHORT_COST_GAP}% 的往返成本劣势，短线买入 H 股性价比明显更高`;
  } else if (aPremium >= SHORT_COST_GAP + 2) {
    shortVerdict = 'H';
    shortTermNote = `H股折价 ${aPremium.toFixed(1)}%，可覆盖港股通约 ${SHORT_COST_GAP}% 的额外往返成本，短线略偏 H 股`;
  } else if (aPremium > -2) {
    shortVerdict = 'A';
    shortTermNote = `A/H 价差仅 ${aPremium.toFixed(1)}%，不足以覆盖港股通额外成本（印花税双边 0.1% vs A股单边 0.05%、征费、汇兑价差），短线买 A 股更划算`;
  } else {
    shortVerdict = 'A';
    shortTermNote = `A 股反而较 H 股便宜 ${Math.abs(aPremium).toFixed(1)}%，且交易成本更低，短线直接买 A 股`;
  }

  // ---- 长期视角（持有吃息，红利税是关键）----
  let longVerdict: 'A' | 'H';
  let longTermNote: string;
  if (isHighDiv) {
    const breakEven = dy * 0.2 * 5; // 约5年红利税损失（单利近似）对应的所需折价
    if (aPremium > breakEven + 5) {
      longVerdict = 'H';
      longTermNote = `股息率约 ${dy.toFixed(1)}%，H 股每年被扣 20% 红利税（约损失股息 ${(dy * 0.2).toFixed(2)}%/年），但当前 H 股折价 ${aPremium.toFixed(1)}% 足以覆盖多年税损，长期持有 H 股仍占优`;
    } else if (aPremium >= 0) {
      longVerdict = 'A';
      longTermNote = `股息率约 ${dy.toFixed(1)}%，H 股每年被扣 20% 红利税（约损失股息 ${(dy * 0.2).toFixed(2)}%/年），而 A 股持股超 1 年分红免税；当前 ${aPremium.toFixed(1)}% 的折价不足以覆盖长期税损，吃息持有选 A 股`;
    } else {
      longVerdict = 'A';
      longTermNote = `股息率约 ${dy.toFixed(1)}%，H 股每年被扣 20% 红利税（约损失股息 ${(dy * 0.2).toFixed(2)}%/年），而 A 股持股超 1 年分红免税；且 H 股反而较 A 股贵 ${Math.abs(aPremium).toFixed(1)}%，双重不利，吃息持有选 A 股`;
    }
  } else {
    if (aPremium >= 10) {
      longVerdict = 'H';
      longTermNote = `股息率低（${dy > 0 ? dy.toFixed(1) + '%' : '未知'}），红利税影响有限，H 股折价 ${aPremium.toFixed(1)}% 即为安全垫，长期持有 H 股更优`;
    } else if (aPremium >= 0) {
      longVerdict = 'A';
      longTermNote = `H 股折价仅 ${aPremium.toFixed(1)}%，股息率低红利税影响有限，但 A 股流动性通常更好、无汇率风险，长期持有选 A 股`;
    } else {
      longVerdict = 'A';
      longTermNote = `H 股反而较 A 股贵 ${Math.abs(aPremium).toFixed(1)}%，股息率低红利税影响有限，且 A 股流动性通常更好、无汇率风险，长期持有选 A 股`;
    }
  }

  // ---- 综合：以短线视角为主（本系统以短中线交易为主）；算法已计入红利税、印花税与汇兑成本 ----
  const verdict = shortVerdict;
  const advice =
    verdict === 'H'
      ? `H 股较 A 股折价 ${Math.abs(aPremium).toFixed(1)}%，当前买 H 股更划算`
      : `A 股较 H 股便宜 ${Math.abs(aPremium).toFixed(1)}%，当前买 A 股更划算`;

  return { verdict, long_verdict: longVerdict, advice, shortTermNote, longTermNote };
}
