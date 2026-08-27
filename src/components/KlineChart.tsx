import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { CandlestickChart, LineChart, BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useStockStore } from '@/store/stockStore';

echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

function calculateMA(data: number[][], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j][1]; // close price
    }
    result.push(+(sum / period).toFixed(2));
  }
  return result;
}

export default function KlineChart() {
  const daily = useStockStore((s) => s.detailData?.daily ?? []);

  const dates = daily.map((d) => d.trade_date);
  const ohlc = daily.map((d) => [d.open, d.close, d.low, d.high]);
  const volumes = daily.map((d) => d.vol);
  const closes = daily.map((d) => [d.open, d.close, d.low, d.high]);

  // 常规均线
  const ma5 = calculateMA(closes, 5);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const ma60 = calculateMA(closes, 60);

  // 大道七线
  const ma7 = calculateMA(closes, 7);
  const ma14 = calculateMA(closes, 14);
  const ma25 = calculateMA(closes, 25);
  const ma56 = calculateMA(closes, 56);
  const ma120 = calculateMA(closes, 120);
  const ma250 = calculateMA(closes, 250);

  const option: echarts.EChartsCoreOption = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      textStyle: { color: '#c9d1d9', fontSize: 12, fontFamily: 'JetBrains Mono' },
    },
    legend: {
      data: ['MA5', 'MA10', 'MA20', 'MA60', 'MA7', 'MA14', 'MA25', 'MA56', 'MA120', 'MA250'],
      top: 0,
      textStyle: { color: '#8b949e', fontSize: 10 },
      itemWidth: 14,
      itemHeight: 2,
      type: 'scroll',
    },
    grid: [
      { left: 60, right: 20, top: 40, height: '55%' },
      { left: 60, right: 20, top: '72%', height: '18%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { color: '#8b949e', fontSize: 10, fontFamily: 'JetBrains Mono' },
        splitLine: { show: false },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#30363d' } },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true,
        splitLine: { lineStyle: { color: '#30363d', type: 'dashed' } },
        axisLine: { show: false },
        axisLabel: { color: '#8b949e', fontSize: 10, fontFamily: 'JetBrains Mono' },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        splitLine: { lineStyle: { color: '#30363d', type: 'dashed' } },
        axisLine: { show: false },
        axisLabel: { color: '#8b949e', fontSize: 10, fontFamily: 'JetBrains Mono' },
      },
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 60,
        end: 100,
      },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        top: '93%',
        height: 16,
        borderColor: '#30363d',
        fillerColor: 'rgba(0,212,170,0.1)',
        handleStyle: { color: '#00d4aa' },
        textStyle: { color: '#8b949e', fontSize: 10 },
        dataBackground: {
          lineStyle: { color: '#30363d' },
          areaStyle: { color: '#161b22' },
        },
      },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: '#00d4aa',
          color0: '#ff4757',
          borderColor: '#00d4aa',
          borderColor0: '#ff4757',
        },
      },
      // 常规均线
      { name: 'MA5', type: 'line', data: ma5, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } },
      { name: 'MA10', type: 'line', data: ma10, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#3b82f6' } },
      { name: 'MA20', type: 'line', data: ma20, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#a855f7' } },
      { name: 'MA60', type: 'line', data: ma60, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#22c55e' } },
      // 大道七线
      { name: 'MA7', type: 'line', data: ma7, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#eab308' } },
      { name: 'MA14', type: 'line', data: ma14, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#6366f1' } },
      { name: 'MA25', type: 'line', data: ma25, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#ec4899' } },
      { name: 'MA56', type: 'line', data: ma56, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#14b8a6' } },
      { name: 'MA120', type: 'line', data: ma120, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#f97316' } },
      { name: 'MA250', type: 'line', data: ma250, smooth: true, showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#ef4444' } },
      // 成交量
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes.map((v, i) => ({
          value: v,
          itemStyle: {
            color: ohlc[i] && ohlc[i][1] >= ohlc[i][0] ? '#00d4aa' : '#ff4757',
            opacity: 0.6,
          },
        })),
      },
    ],
  };

  return (
    <div style={{ height: 400 }}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '100%', width: '100%' }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}
