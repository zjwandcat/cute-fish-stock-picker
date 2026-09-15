import { useEffect, useState } from 'react';
import { BookOpen, Ellipsis, Github, KeyRound } from 'lucide-react';

const repositoryUrl = 'https://github.com/zjwandcat/cute-fish-stock-picker';
const guideUrl = 'https://zjwandcat.github.io/cute-fish-stock-picker/';

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

  return (
    <details className="relative shrink-0">
      <summary
        className="flex cursor-pointer list-none items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1.5 text-[#007AFF]"
        aria-label="更多"
        title="更多"
      >
        <Ellipsis size={18} /><span className="hidden sm:inline">更多</span>
      </summary>
      <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 shadow-xl">
        <a className="flex items-center gap-2 rounded-lg p-2 hover:bg-blue-50 hover:text-blue-600" href={repositoryUrl} target="_blank" rel="noreferrer">
          <Github size={16} />GitHub 项目
        </a>
        <a className="flex items-center gap-2 rounded-lg p-2 hover:bg-blue-50 hover:text-blue-600" href={guideUrl} target="_blank" rel="noreferrer">
          <BookOpen size={16} />使用说明
        </a>
        {local && (
          <a className="flex items-center gap-2 border-t p-2 hover:bg-blue-50 hover:text-blue-600" href="/setup">
            <KeyRound size={16} />修改 Tushare Token
          </a>
        )}
      </div>
    </details>
  );
}
