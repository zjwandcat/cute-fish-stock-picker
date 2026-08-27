export type AlertType = 'dip' | 'bottom' | 'rebound' | 'volume' | 'target';
export type AlertPriority = 'high' | 'medium' | 'low';

export interface AlertItem {
  id: string;
  ts_code: string;
  name: string;
  type: AlertType;
  title: string;
  message: string;
  priority: AlertPriority;
  price: number;
  change_pct: number;
  volume_ratio: number;
  pe_ttm: number;
  pb: number;
  suggestion: string;
  created_at: number;
}

export interface UserTargets {
  [tsCode: string]: { buy?: number; stop_loss?: number; alert_pct?: number };
}
