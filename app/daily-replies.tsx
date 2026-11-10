'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Copy, Search } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import type { ReplySuggestion } from '../lib/daily-replies';

type Item = {
  id: string; customerId?: string; buyerId?: string; name: string; shop: string;
  owner: string; count: number; suggestion: ReplySuggestion;
};
type Day = {date: string; latest: string; items: Item[]};
const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Shanghai'});

export default function DailyReplies({
  shop, openCustomer, openSession, notify,
}: {shop: string; openCustomer: (id: string) => void; openSession: (id: string) => void; notify: (message: string) => void}) {
  const [date, setDate] = useState(today);
  const [input, setInput] = useState(''), [query, setQuery] = useState('');
  const [result, setResult] = useState<Day | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const eligible = ['全部业务', '美利雅国际站', '美欣国际站'].includes(shop);
  useEffect(() => {
    if (!date || !eligible) return;
    const controller = new AbortController();
    const args = new URLSearchParams({date, q: query});
    if (shop !== '全部业务') args.set('shop', shop);
    setLoading(true);
    setError('');
    fetch('/api/daily-replies?' + args, {signal: controller.signal}).then(async response => {
      const data = await response.json() as Day & {error?: string};
      if (!response.ok) throw new Error(data.error || '无法读取当天的沟通记录');
      if (!controller.signal.aborted) setResult(data);
    }).catch(error => {
      if (!controller.signal.aborted) {setResult(null); setError(error.message);}
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [date, query, shop, eligible]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedDate = String(form.get('date') || '');
    if (selectedDate) setDate(selectedDate);
    setQuery(String(form.get('customer') || '').trim());
  }
  async function copy(value: string) {
    try { await copyText(value); notify('话术已复制'); }
    catch (error) { notify((error as Error).message); }
  }
  const recent = result?.latest && result.latest !== date ? result.latest : '';
  return <section className="panel daily-replies">
    <div className="panel-head">
      <div><h2>每日话术建议</h2><p>根据所选日期的历史会话和询盘导出，按客户归纳需求，给出中英文回复草稿。</p></div>
      <CalendarDays size={20}/>
    </div>
    <form className="table-toolbar daily-reply-filter" onSubmit={search}>
      <label>日期 <input type="date" name="date" aria-label="话术日期" value={date} onChange={event => event.target.value && setDate(event.target.value)}/></label>
      <div className="search-input"><Search size={16}/><input name="customer" aria-label="客户 ID 或名称" placeholder="输入客户 ID 或名称" value={input} onChange={event => setInput(event.target.value)}/></div>
      <button className="btn primary" type="submit">搜索客户话术</button>
      <button className="btn" type="button" onClick={() => {setInput(''); setQuery(''); setDate(today());}}>回到今天</button>
    </form>
    {!eligible ? <p className="daily-reply-note">请选择「全部业务」或国际站店铺。</p>
      : loading ? <p className="daily-reply-note" role="status">正在读取当天沟通…</p>
      : error ? <p className="daily-reply-note" role="alert">{error}</p>
      : <>
        <div className="daily-reply-note">
          <strong>{date} · {result?.items.length || 0} 位客户</strong>
          {recent && <button className="text-btn" onClick={() => setDate(recent)}>查看最近有记录的一天（{recent}）</button>}
          <p>{result?.items.length ? '根据原文按规则生成。发送前请业务员确认款号、价格、库存和交期。'
            : query ? '所选日期没有匹配到这位客户的沟通记录。'
              : '所选日期没有已导入的沟通记录。阿里实时对话还未接入，可先回看已导入日期。'}</p>
        </div>
        <div className="daily-reply-grid">{result?.items.map(item => {
          const {suggestion} = item;
          const evidence = suggestion.evidence;
          return <article className="daily-reply-card" key={item.id}>
            <div className="daily-reply-card-title"><strong>{item.name}</strong><span className="badge teal">{suggestion.category}</span></div>
            <p className="muted">{item.shop} · {item.owner}{item.buyerId ? ' · ' + item.buyerId : ''} · {item.count} 条记录</p>
            <p><strong>{suggestion.status}</strong> · {suggestion.next}</p>
            <details>
              <summary>查看依据和话术</summary>
              <div className="daily-reply-evidence">
                <small>{evidence.source} · {evidence.time}</small>
                <p>{evidence.text || '原表未提供文字内容'}</p>
                {evidence.inquiryId
                  ? <a className="text-btn" href={'?view=inquiries&inquiry=' + evidence.inquiryId}>查看原询盘</a>
                  : <button className="text-btn" onClick={() => openSession(evidence.thread)}>查看原会话</button>}
                {item.customerId && <button className="text-btn" onClick={() => openCustomer(item.customerId!)}>打开客户档案</button>}
              </div>
              {suggestion.zh && <div className="daily-reply-draft">
                <p>{suggestion.zh}</p>
                <button className="btn" type="button" onClick={() => void copy(suggestion.zh)}><Copy size={14}/>复制中文</button>
                <p>{suggestion.en}</p>
                <button className="btn" type="button" onClick={() => void copy(suggestion.en)}><Copy size={14}/>复制英文</button>
              </div>}
            </details>
          </article>;
        })}</div>
      </>}
  </section>;
}
