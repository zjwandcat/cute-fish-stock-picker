import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { aiRequest } from '@/services/ai';
import type { AiMemory } from '@/types/ai';

const labels = { preference: '研究偏好', watchlist: '关注标的', research: '研究记录' };

export default function AiMemoryPanel({ enabled, refreshKey }: { enabled: boolean; refreshKey: number }) {
  const [items, setItems] = useState<AiMemory[]>([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'preference' | 'watchlist'>('preference');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setItems(await aiRequest<AiMemory[]>('/memory'));
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      await aiRequest('/memory', { method: 'POST', body: JSON.stringify({ kind, text: text.trim() }) });
      setText('');
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setPending(true);
    try {
      await aiRequest(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ai-memory">
      <div className="ai-section-heading"><h3>长期记忆</h3><span className="ai-muted">{enabled ? '已启用' : '已暂停使用'} · {items.length} 条</span></div>
      <form onSubmit={save} className="ai-memory-form">
        <label>类别<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="preference">研究偏好</option><option value="watchlist">关注标的</option></select></label>
        <label>记忆内容<textarea value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="例如：主要关注高分红港股，研究周期为一年" rows={3} /></label>
        <button className="ai-primary" disabled={pending || !text.trim()}>{pending ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}保存记忆</button>
      </form>
      {error && <p role="alert" className="ai-error">{error}</p>}
      {!items.length && <p className="ai-muted ai-empty">暂无已保存记忆</p>}
      {items.map((item) => (
        <article key={item.id} className="ai-memory-row">
          <div className="ai-section-heading"><span>{labels[item.kind]}{item.code ? ` · ${item.code}` : ''}</span><button className="ai-icon" title="删除记忆" aria-label="删除记忆" disabled={pending} onClick={() => void remove(item.id)}><Trash2 size={15} /></button></div>
          <p>{item.text}</p>
          <div className="ai-muted">保存于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}{item.expiresAt ? ` · ${new Date(item.expiresAt).toLocaleDateString('zh-CN')} 到期` : ' · 长期保留'}</div>
          {!!item.sourceEvidenceIds?.length && <div className="ai-muted">关联证据：{item.sourceEvidenceIds.join('、')}</div>}
        </article>
      ))}
    </div>
  );
}
