export interface StockInfo {
  ts_code: string;
  name: string;
  industry: string; // 行业分类，用于分散约束
}

export type StockItem = StockInfo;

// 可变股池，支持运行时增删
export const STOCK_POOL: StockInfo[] = [
  { ts_code: '688256.SH', name: '寒武纪', industry: '半导体' },
  { ts_code: '688825.SH', name: '长鑫科技', industry: '半导体' }, // 新加入：存储芯片龙头
  { ts_code: '300308.SZ', name: '中际旭创', industry: '通信' },
  { ts_code: '002475.SZ', name: '立讯精密', industry: '消费电子' },
  { ts_code: '600111.SH', name: '北方稀土', industry: '有色' },
  { ts_code: '300274.SZ', name: '阳光电源', industry: '光伏' },
  { ts_code: '002371.SZ', name: '北方华创', industry: '半导体' },
  { ts_code: '600309.SH', name: '万华化学', industry: '化工' },
  { ts_code: '600406.SH', name: '国电南瑞', industry: '电力设备' },
  { ts_code: '688012.SH', name: '中微公司', industry: '半导体' },
  { ts_code: '601985.SH', name: '中国核电', industry: '电力' },
  { ts_code: '300124.SZ', name: '汇川技术', industry: '工控' },
  { ts_code: '601012.SH', name: '隆基绿能', industry: '光伏' },
  { ts_code: '603501.SH', name: '豪威集团', industry: '半导体' },
  { ts_code: '601689.SH', name: '拓普集团', industry: '汽车零部件' },
  { ts_code: '002600.SZ', name: '领益智造', industry: '消费电子' },
  { ts_code: '000988.SZ', name: '华工科技', industry: '激光' },
  { ts_code: '002837.SZ', name: '英维克', industry: '制冷设备' },
  { ts_code: '002648.SZ', name: '卫星化学', industry: '化工' },
  { ts_code: '301269.SZ', name: '华大九天', industry: '软件' },
  { ts_code: '603296.SH', name: '华勤技术', industry: '消费电子' },
  { ts_code: '002738.SZ', name: '中矿资源', industry: '有色' },
  { ts_code: '688169.SH', name: '石头科技', industry: '家电' },
  { ts_code: '603087.SH', name: '甘李药业', industry: '医药' },
  { ts_code: '002335.SZ', name: '科华数据', industry: '数据中心' },
  { ts_code: '603338.SH', name: '浙江鼎力', industry: '工程机械' },
  { ts_code: '300502.SZ', name: '新易盛', industry: '通信' },
  { ts_code: '300394.SZ', name: '天孚通信', industry: '通信' },
  { ts_code: '300476.SZ', name: '胜宏科技', industry: '电子' },
  { ts_code: '603986.SH', name: '兆易创新', industry: '半导体' },
  { ts_code: '603993.SH', name: '洛阳钼业', industry: '有色' },
  { ts_code: '600489.SH', name: '中金黄金', industry: '有色' },
  // 医药板块
  { ts_code: '600276.SH', name: '恒瑞医药', industry: '医药' },
  { ts_code: '603259.SH', name: '药明康德', industry: '医药' },
  { ts_code: '300760.SZ', name: '迈瑞医疗', industry: '医药' },
  { ts_code: '600436.SH', name: '片仔癀', industry: '医药' },
  { ts_code: '000538.SZ', name: '云南白药', industry: '医药' },
  // 电力板块
  { ts_code: '600900.SH', name: '长江电力', industry: '电力' },
  { ts_code: '600011.SH', name: '华能国际', industry: '电力' },
  { ts_code: '600886.SH', name: '国投电力', industry: '电力' },
  { ts_code: '600674.SH', name: '川投能源', industry: '电力' },
  { ts_code: '600027.SH', name: '华电国际', industry: '电力' },
  // 煤炭板块（高股息防御）
  { ts_code: '601088.SH', name: '中国神华', industry: '煤炭' },
  // 港股板块（港股通标的，T+0交易，注意20%红利税）
  { ts_code: '02096.HK', name: '先声药业', industry: '港股医药' },
  { ts_code: '01088.HK', name: '中国神华H', industry: '港股煤炭' },
  { ts_code: '00941.HK', name: '中国移动', industry: '港股电信' },
  { ts_code: '00700.HK', name: '腾讯控股', industry: '港股互联网' },
  { ts_code: '03968.HK', name: '招商银行H', industry: '港股银行' },
  { ts_code: '01800.HK', name: '中国交通建设', industry: '港股基建' },
];

// 将代码转换为 Tushare 格式
// 支持 A股(6位) 和 港股(4-5位数字+.HK)
export function normalizeCode(code: string): string | null {
  const clean = code.trim().replace(/\s/g, '').toUpperCase();

  // 港股：支持 02096.HK / 2096.HK / 02096HK / HK02096 等格式
  if (clean.endsWith('.HK') || clean.endsWith('HK')) {
    const numPart = clean.replace(/\.?HK$/, '').replace(/^HK/, '').replace(/^0+/, '');
    if (/^\d{1,5}$/.test(numPart)) {
      return `${numPart.padStart(5, '0')}.HK`;
    }
    return null;
  }

  // A股：去除小数点后判断
  const noDot = clean.replace(/\./g, '');
  if (/^\d{6}(SH|SZ|BJ)$/.test(noDot)) {
    return `${noDot.slice(0, 6)}.${noDot.slice(6)}`;
  }
  if (/^\d{6}$/.test(noDot)) {
    // 沪市：6开头、688开头、9开头；深市：0/3开头；北证：8/4开头
    if (noDot.startsWith('6') || noDot.startsWith('9')) return `${noDot}.SH`;
    if (noDot.startsWith('0') || noDot.startsWith('3')) return `${noDot}.SZ`;
    if (noDot.startsWith('8') || noDot.startsWith('4')) return `${noDot}.BJ`;
    return `${noDot}.SZ`;
  }
  return null;
}

// 添加股票到股池
export function addStock(tsCode: string, name: string, industry: string = '其他'): boolean {
  if (STOCK_POOL.find(s => s.ts_code === tsCode)) return false;
  STOCK_POOL.push({ ts_code: tsCode, name, industry });
  return true;
}

// 从股池移除股票
export function removeStock(tsCode: string): boolean {
  const idx = STOCK_POOL.findIndex(s => s.ts_code === tsCode);
  if (idx === -1) return false;
  STOCK_POOL.splice(idx, 1);
  return true;
}

// 获取股票的行业分类
export function getIndustry(tsCode: string): string {
  return STOCK_POOL.find(s => s.ts_code === tsCode)?.industry ?? '其他';
}
