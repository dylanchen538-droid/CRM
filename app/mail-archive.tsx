'use client';

import { useEffect, useState } from 'react';
import { Mail as MailIcon, Upload } from 'lucide-react';
import ChatHistory from './chat-history';
import { MAIL_ACCOUNT, MAIL_FORMAT, mailSchema, partyKey, type Mail, type Match } from '../lib/mail-archive';
import { MAIL_PENDING_SHOP } from '../lib/model';

export type MailTarget = { party?: string; customer?: string; label: string; shop: string; owner?: string };
type ListItem = { party: string; label: string; channel: string; evidence: string; count: number; last: string; customerId: string | null };
type MailList = { items: ListItem[]; total: number; page: number; pages: number; categories: { channel: string; messages: number }[] };
type PreviewRow = Match & { count: number };
type Preview = { messages: Mail[]; groups: PreviewRow[]; rejected: number; fileName: string };

async function mailApi<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch('/api/mail' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error || '邮箱档案暂时无法读取');
  return data;
}

const localTime = (value: string) => value
  ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  : '日期待核对';
const dispositionLabels = { existing: '关联已有客户', new: '新增客户', review: '待核对归属' };

export default function MailArchive({ business, open, openCustomer, onImported }: {
  business: string; open: (target: MailTarget) => void; openCustomer: (id: string) => void; onImported: () => void;
}) {
  const [list, setList] = useState<MailList | null>(null);
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const businessChannel = business === '全部业务' ? '' : business === MAIL_PENDING_SHOP ? '渠道待确认' : business;
  const activeChannel = businessChannel || channel;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, channel: activeChannel, page: String(page) });
      mailApi<MailList>('?' + params).then(data => { if (!cancelled) setList(data); })
        .catch(() => { if (!cancelled) setError('邮箱档案加载失败，请刷新重试。'); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, activeChannel, page, revision]);

  async function previewFile(file: File) {
    setBusy(true); setError(''); setStatus('正在识别邮件与客户来源…'); setPreview(null); setPreviewPage(1);
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('导入包超过 80 MB，请分批处理。');
      const bundle = JSON.parse(await file.text());
      if (bundle.format !== MAIL_FORMAT || bundle.account !== MAIL_ACCOUNT || !Array.isArray(bundle.messages)) {
        throw new Error('请选择本机工具生成的 Export 邮件导入包。');
      }
      const messages = new Map<string, Mail>();
      const parties = new Map<string, { contacts: Mail['contacts']; count: number }>();
      let rejected = 0;
      for (const raw of bundle.messages) {
        const parsed = mailSchema.safeParse(raw);
        if (!parsed.success) { rejected++; continue; }
        const row = parsed.data;
        if (messages.has(row.id)) continue;
        messages.set(row.id, row);
        const key = partyKey(row.contacts);
        const group = parties.get(key);
        if (group) group.count++;
        else parties.set(key, { contacts: row.contacts, count: 1 });
      }
      if (!messages.size) throw new Error('没有可处理的邮件记录。');
      const entries = [...parties.values()];
      const groups: PreviewRow[] = [];
      for (let index = 0; index < entries.length; index += 600) {
        const result = await mailApi<{ matches: Match[] }>('', {
          action: 'preview', account: MAIL_ACCOUNT, parties: entries.slice(index, index + 600).map(entry => entry.contacts),
        });
        groups.push(...result.matches.map(match => ({ ...match, count: parties.get(match.party)?.count || 0 })));
      }
      groups.sort((a, b) => (a.disposition === 'review' ? -1 : 0) - (b.disposition === 'review' ? -1 : 0) || b.count - a.count);
      setPreview({ groups, messages: [...messages.values()], rejected, fileName: file.name });
      setStatus('导入预览已就绪');
    } catch (cause) { setError((cause as Error).message); setStatus(''); }
    finally { setBusy(false); }
  }

  async function commit() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    let processed = 0, inserted = 0;
    try {
      for (let index = 0; index < preview.messages.length; index += 25) {
        const result = await mailApi<{ processed: number; inserted: number }>('', {
          action: 'import', account: MAIL_ACCOUNT, messages: preview.messages.slice(index, index + 25),
        });
        processed += result.processed;
        inserted += result.inserted;
        setStatus(`已处理 ${processed} / ${preview.messages.length} 封`);
      }
      setPreview(null); setPage(1); setRevision(value => value + 1);
      setStatus(`导入完成。新增 ${inserted} 封，已有 ${processed - inserted} 封。`);
      onImported();
    } catch (cause) {
      setError(`已处理 ${processed} 封。${(cause as Error).message}。再次导入时会跳过已保存的邮件。`);
    } finally { setBusy(false); }
  }

  const matchesByChannel = preview ? Object.entries(preview.groups.reduce<Record<string, number>>((counts, row) => {
    counts[row.channel] = (counts[row.channel] || 0) + row.count;
    return counts;
  }, {})) : [];
  return <section className="panel">
    <div className="panel-head"><div><h2>企业邮箱往来</h2><p>Export · 按客户邮箱归档，显示邮件方向、原文及渠道依据。</p></div>
      <label className="btn file-label"><Upload size={15}/>选择邮件导入包<input aria-label="选择邮件导入包" type="file" accept=".json,application/json" disabled={busy} onChange={event => { if (event.target.files?.[0]) void previewFile(event.target.files[0]); event.target.value = ''; }}/></label>
    </div>
    {status && <p className="table-toolbar" role="status">{status}</p>}
    {error && <p className="table-toolbar" role="alert">{error}</p>}
    {preview && <div className="form-body">
      <h3>导入预览</h3><p>{preview.fileName} · {preview.messages.length} 封邮件 · {preview.groups.length} 组联系方</p>
      <p>{Object.entries(dispositionLabels).map(([key, label]) => `${label} ${preview.groups.filter(row => row.disposition === key).length} 组`).join(' · ')}</p>
      <p>{matchesByChannel.map(([name, count]) => `${name} ${count} 封`).join(' · ')}{preview.rejected ? ` · 格式有误 ${preview.rejected} 封` : ''}</p>
      <div className="table-wrap"><table><thead><tr><th>联系方</th><th>渠道</th><th>匹配依据</th><th>处理方式</th><th>邮件</th></tr></thead><tbody>
        {preview.groups.slice((previewPage - 1) * 25, previewPage * 25).map(row => <tr key={row.party}><td><strong>{row.name}</strong><br/>{row.party}</td><td>{row.channel}</td><td>{row.evidence}</td><td>{dispositionLabels[row.disposition]}</td><td>{row.count}</td></tr>)}
      </tbody></table></div>
      <div className="table-toolbar"><button className="btn" disabled={previewPage <= 1} onClick={() => setPreviewPage(value => value - 1)}>上一页</button><span>{previewPage} / {Math.ceil(preview.groups.length / 25)}</span><button className="btn" disabled={previewPage * 25 >= preview.groups.length} onClick={() => setPreviewPage(value => value + 1)}>下一页</button><span className="grow"/><button className="btn" disabled={busy} onClick={() => { setPreview(null); setStatus(''); }}>取消预览</button><button className="btn primary" disabled={busy} onClick={() => void commit()}>确认导入 {preview.messages.length} 封</button></div>
    </div>}
    <div className="table-toolbar">
      <div className="search-input"><MailIcon size={16}/><input aria-label="搜索邮箱往来" placeholder="搜索客户名称或邮箱" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }}/></div>
      {businessChannel ? <span className="badge">{businessChannel === '展会 / 待分配' ? '展会客户' : businessChannel}</span> : <select aria-label="邮件客户渠道" value={channel} onChange={event => { setChannel(event.target.value); setPage(1); }}><option value="">全部渠道</option>{list?.categories.map(row => <option key={row.channel}>{row.channel}</option>)}</select>}
      <span>{list?.total ?? '…'} 组联系方</span>
    </div>
    {list?.items.length ? <div className="table-wrap"><table><thead><tr><th>联系方</th><th>渠道与依据</th><th>最后邮件</th><th>封数</th><th>操作</th></tr></thead><tbody>
      {list.items.map(row => <tr key={row.party}><td><strong>{row.label}</strong><br/>{row.party}</td><td>{row.channel}<br/><small>{row.evidence}</small></td><td>{localTime(row.last)}</td><td>{row.count}</td><td><button className="text-btn" onClick={() => open({ party: row.party, label: row.label, shop: row.channel })}>查看往来</button>{row.customerId && <button className="text-btn" onClick={() => openCustomer(row.customerId!)}>客户档案</button>}</td></tr>)}
    </tbody></table></div> : <div className="archive-empty">{list ? '当前没有符合条件的邮件往来。' : '正在读取邮件档案…'}</div>}
    {list && list.pages > 1 && <div className="table-toolbar"><button className="btn" disabled={list.page <= 1} onClick={() => setPage(list.page - 1)}>上一页</button><span>{list.page} / {list.pages}</span><button className="btn" disabled={list.page >= list.pages} onClick={() => setPage(list.page + 1)}>下一页</button></div>}
  </section>;
}

export function MailConversation({ target, close }: { target: MailTarget; close: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ messages: (Mail & { evidence: string })[]; total: number; pages: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), ...(target.customer ? { customer: target.customer } : { party: target.party || '' }) });
    mailApi<NonNullable<typeof data>>('?' + params).then(result => { if (!cancelled) setData(result); })
      .catch(cause => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [target, page]);
  const rows = (data?.messages || []).map(row => ({
    sender: row.direction === 'sent' ? 'seller' : 'buyer', time: localTime(row.at),
    text: `${row.subject || '无主题'}\n${row.folder} · ${row.evidence}\n\n${row.body || '此邮件未获取到文字正文'}${row.truncated ? '\n\n（正文有截取，请回原邮箱核对。）' : ''}`,
  }));
  const notice = <div>{error || '企业邮箱历史往来 · 时间为北京时间'}{data && data.pages > 1 && <>　<button className="text-btn" disabled={page === 1} onClick={() => { setData(null); setPage(value => value - 1); }}>更新邮件</button>　{page} / {data.pages}　<button className="text-btn" disabled={page >= data.pages} onClick={() => { setData(null); setPage(value => value + 1); }}>更早邮件</button></>}</div>;
  return <ChatHistory key={page} session={{ buyer: target.label, shop: target.shop, owner: target.owner || 'Export', count: data?.total || 0, sourceRef: `腾讯企业邮箱 · ${MAIL_ACCOUNT}` }} rows={rows} loading={!data && !error} close={close} label="邮箱往来" notice={notice}/>;
}
