export interface StockQuote {
  ts_code: string;
  name: string;
  market?: 'A' | 'HK'; // 市场：A=A股, HK=港股
  currency?: 'CNY' | 'HKD'; // 币种
  price: number;
  change_pct: number;
  pe_ttm: number;
  pb: number;
  volume_ratio: number;
  total_mv: number;
  turnover_rate: number;
}

export interface DailyBar {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  amount: number;
}

export interface Holder {
  ts_code: string;
  ann_date: string;
  end_date: string;
  holder_name: string;
  hold_amount: number;
  hold_ratio: number;
  hold_change: number;
  share_type: string;
}

export interface StockDetail {
  ts_code: string;
  name: string;
  pe_ttm: number;
  pe_static: number;
  pb: number;
  roe: number;
  total_mv: number;
  circ_mv: number;
  inst_ratio: number;
  retail_ratio: number;
  main_net_inflow: number;
  inst_inflow_ratio: number;
  inst_outflow_ratio: number;
  retail_inflow_ratio: number;
  retail_outflow_ratio: number;
  volume_ratio: number;
  turnover_rate: number;
  volume: number;
  meetings?: Meeting[];
  events?: MajorEvent[];
  dividends?: Dividend[];
  holders?: Holder[];
  holder_count?: number;
  holder_incomplete?: boolean;
}

export interface Meeting {
  ts_code: string;
  ann_date: string;
  ann_time: string;
  ann_type: string;
  title: string;
  content: string;
  url: string;
}

export interface MajorEvent {
  ts_code: string;
  ann_date: string;
  ann_time: string;
  ann_type: string;
  title: string;
  content: string;
  url: string;
}

export interface Dividend {
  ts_code: string;
  end_date: string;
  div_proc: string;
  stk_div: number;
  stk_bo_rate: number;
  stk_co_rate: number;
  cash_div: number;
  cash_div_tax: number;
  record_date: string;
  ex_date: string;
  pay_date: string;
  div_listdate: string;
  imp_date: string;
  base_date: string;
  base_share: number;
}

export interface NewsItem {
  title: string;
  src: string;
  time: string;
  url: string;
  content: string;
}

export interface Recommendation {
  ts_code: string;
  name: string;
  score: number;
  tech_score: number;
  fund_score: number;
  capital_score: number;
  next_day_adjust: number;
  risk_level: 'low' | 'medium' | 'high';
  reasons: string[];
}
