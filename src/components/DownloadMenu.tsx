import { useEffect, useState } from 'react';
import { ChevronDown, Download } from 'lucide-react';

const releases = 'https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest';
const windows = `${releases}/download/cute-fish-stock-picker-windows.zip`;
const macos = `${releases}/download/cute-fish-stock-picker-macos.zip`;

export default function DownloadMenu() {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((health) => setLocal(health.application === 'cute-fish-stock-picker'))
      .catch(() => { /* Hosted builds do not expose local settings. */ });
    return () => controller.abort();
  }, []);
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const platform = mobile ? '' : /Windows/.test(ua) ? 'Windows 10 / 11' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : '';
  const href = platform === 'macOS' ? macos : platform ? windows : '/download.html';
  return (
    <div className="flex shrink-0 items-center rounded-lg bg-blue-500/10 text-[#007AFF]">
      <a href={href} className="flex items-center gap-1 px-2 py-1.5" title={platform ? `下载 ${platform} 版` : '选择下载版本'}>
        <Download size={17} /><span className="hidden sm:inline">下载</span>
      </a>
      <details className="relative">
        <summary className="cursor-pointer list-none border-l border-blue-500/20 px-1 py-2" aria-label="其他版本与设置" title="其他版本与设置">
          <ChevronDown size={15} />
        </summary>
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 shadow-xl">
          <a className="block rounded-lg bg-blue-50 p-2 font-semibold text-blue-600" href={href}>{platform ? `下载 ${platform} 版` : '选择下载版本'}</a>
          <a className="block p-2 hover:text-blue-600" href={windows}>Windows 10 / 11（64 位）</a>
          <a className="block p-2 hover:text-blue-600" href={macos}>macOS（Apple 芯片 / Intel）</a>
          <a className="block p-2 hover:text-blue-600" href="/download.html">下载与使用说明</a>
          {local && <a className="block border-t p-2 hover:text-blue-600" href="/setup">修改 Tushare Token</a>}
        </div>
      </details>
    </div>
  );
}
