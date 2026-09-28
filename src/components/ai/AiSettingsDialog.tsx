import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Save, X } from 'lucide-react';
import { useAiStore } from '@/store/aiStore';

export default function AiSettingsDialog() {
  const { config, configError, settingsOpen, setSettingsOpen, saveConfig, loadConfig } = useAiStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-flash');
  const [protocol, setProtocol] = useState<'deepseek' | 'openai-compatible'>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<'auto' | 'low' | 'high' | 'max'>('auto');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settingsOpen) {
      dialog.current?.close();
      setApiKey('');
      return;
    }
    setBaseUrl(config?.baseUrl || 'https://api.deepseek.com');
    setModel(config?.model || 'deepseek-flash');
    setProtocol(config?.protocol || 'deepseek');
    setEnabled(config?.apiKeyConfigured ? config.enabled : true);
    setMemoryEnabled(config?.memoryEnabled ?? true);
    setThinkingEnabled(config?.thinkingEnabled ?? true);
    setReasoningEffort(config?.reasoningEffort ?? 'auto');
    setClearKey(false);
    setError('');
    dialog.current?.showModal();
  }, [settingsOpen, config]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await saveConfig({
        baseUrl, model, protocol, enabled, memoryEnabled, thinkingEnabled, reasoningEffort,
        ...(apiKey.trim() || clearKey ? { apiKey: clearKey ? '' : apiKey.trim() } : {}),
      });
      setSettingsOpen(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} className="ai-settings" aria-labelledby="ai-settings-title" onCancel={() => setSettingsOpen(false)}>
      <form onSubmit={save}>
        <header className="ai-header">
          <h2 id="ai-settings-title">AI 研究设置</h2>
          <button type="button" className="ai-icon" title="关闭设置" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={19} /></button>
        </header>
        <div className="ai-settings-fields">
          {configError && <div role="alert" className="ai-error">{configError}<button type="button" className="ai-link" onClick={loadConfig}>重新连接</button></div>}
          <label className="ai-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用 AI 助手</label>
          <label>模型服务 URL<input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" autoComplete="off" /></label>
          <label>协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as typeof protocol)}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI 兼容</option></select></label>
          <label>模型名称<input required value={model} onChange={(event) => setModel(event.target.value)} maxLength={160} autoComplete="off" /></label>
          {protocol === 'deepseek' && <>
            <label className="ai-check"><input type="checkbox" checked={thinkingEnabled} onChange={event => setThinkingEnabled(event.target.checked)} />启用 DeepSeek 深度思考</label>
            {thinkingEnabled && <label>思考强度<select value={reasoningEffort} onChange={event => setReasoningEffort(event.target.value as typeof reasoningEffort)}><option value="auto">随研究深度自动调整</option><option value="low">低 · 较快</option><option value="high">高 · 更充分</option><option value="max">最高 · 耗时更长</option></select></label>}
            <p className="ai-muted">自动模式：快速使用低强度，标准使用高强度，深度使用最高强度。思考过程可在研究中展开查看，不会保存到长期记忆。</p>
          </>}
          <label>API Key <span className="ai-muted">{config?.apiKeyConfigured ? '已配置，留空保留' : '尚未配置'}</span><input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearKey(false); }} placeholder={config?.apiKeyConfigured ? '输入新密钥以替换' : 'API Key'} autoComplete="new-password" /></label>
          {config?.apiKeyConfigured && <><label className="ai-check"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />清除已保存的模型 API Key</label><p className="ai-muted">仅在勾选并保存后删除本机保存的模型密钥；重新填写前无法咨询。Tushare Token 和研究记忆会保留。</p></>}
          <p className="ai-muted">Tushare 数据自动使用 .env 或本机设置中的 Tushare Token，无需填写 MCP URL。财务工具按账户权限读取。</p>
          <label className="ai-check"><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemoryEnabled(event.target.checked)} />启用长期记忆</label>
          {error && <p role="alert" className="ai-error">{error}</p>}
        </div>
        <footer className="ai-settings-footer"><button className="ai-primary" disabled={saving || Boolean(configError)} type="submit">{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}保存设置</button></footer>
      </form>
    </dialog>
  );
}
