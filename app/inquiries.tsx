'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import ChatHistory from './chat-history';
import { INQUIRY_SHOPS, inquiryChannel, inquiryKey, inquirySchema, type Inquiry, type InquiryListItem, type InquirySummary } from '../lib/inquiry';
import type { RecordData } from '../lib/model';

type Listing = { items: InquiryListItem[]; summary: InquirySummary[]; total: number; page: number; pageSize: number };
const empty: Listing = {items: [], summary: [], total: 0, page: 1, pageSize: 25};
const nameOf = (row: InquiryListItem) => row.name || row.company || row.buyerId || '买家待核实';
const isShop = (shop: string) => INQUIRY_SHOPS.some(value => value === shop);
const shopOwnerKey = (shop: string, buyer: string) => JSON.stringify([shop, buyer]);

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error((data as {error?: string}).error || '读取询盘失败');
  return data as T;
}

export default function Inquiries({
  shop, customers, openCustomer, notify,
}: {shop: string; customers: RecordData[]; openCustomer: (id: string) => void; notify: (message: string) => void}) {
  const [listing, setListing] = useState(empty), [page, setPage] = useState(1);
  const [input, setInput] = useState(''), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<(Inquiry & {id: string}) | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState<Inquiry[]>([]), [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false), [progress, setProgress] = useState(0);
  const eligible = shop === '全部业务' || isShop(shop);
  const links = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const record of customers) {
      for (const buyer of new Set([record.loginId, record.buyerId].filter(Boolean))) {
        const key = shopOwnerKey(record.shop, buyer);
        const previous = map.get(key);
        map.set(key, previous === undefined || previous === record.id ? record.id : null);
      }
    }
    return map;
  }, [customers]);
  const linkedCustomer = (item: {shop: string; buyerId: string}) =>
    item.buyerId ? links.get(shopOwnerKey(item.shop, item.buyerId)) : undefined;

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    const params = new URLSearchParams({page: String(page), q: query});
    if (isShop(shop)) params.set('shop', shop);
    setLoading(true);
    setError('');
    requestJson<Listing>('/api/inquiries?' + params, {signal: controller.signal})
      .then(setListing)
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shop, eligible, query, page, refresh]);
  useEffect(() => setPage(1), [shop]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('inquiry');
    if (!id || !/^[a-f0-9]{64}$/.test(id)) return;
    const controller = new AbortController();
    requestJson<{inquiry: Inquiry}>('/api/inquiries?id=' + id, {signal: controller.signal})
      .then(({inquiry}) => {if (!controller.signal.aborted) setSelected({...inquiry, id});})
      .catch(error => {if (!controller.signal.aborted) setError(error.message);});
    return () => controller.abort();
  }, []);

  async function open(item: InquiryListItem) {
    try {
      const {inquiry} = await requestJson<{inquiry: Inquiry}>('/api/inquiries?id=' + encodeURIComponent(item.id));
      setSelected({...inquiry, id: item.id});
    } catch (error) { notify((error as Error).message); }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(input.trim());
  }
  async function prepare(file: File) {
    try {
      if (file.size > 8_000_000) throw new Error('文件超过 8 MB，请拆分后再导入');
      const raw: unknown = JSON.parse(await file.text());
      if (!Array.isArray(raw) || !raw.length || raw.length > 5000) throw new Error('文件需包含 1 至 5,000 条询盘');
      const rows = raw.map((value, i) => {
        const parsed = inquirySchema.safeParse(value);
        if (!parsed.success) throw new Error(`第 ${i + 1} 条询盘格式或店铺账号有误`);
        return parsed.data;
      });
      if (new Set(rows.map(inquiryKey)).size !== rows.length) throw new Error('文件中有重复的询盘，请先核对');
      setFileName(file.name);
      setDraft(rows);
      setProgress(0);
    } catch (error) { notify((error as Error).message); }
  }
  async function commit() {
    if (importing || !draft.length) return;
    setImporting(true);
    let checked = 0, changed = 0;
    try {
      for (let i = 0; i < draft.length; i += 30) {
        const batch = draft.slice(i, i + 30);
        const result = await requestJson<{accepted: number; changed: number}>('/api/inquiries', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(batch),
        });
        checked += result.accepted;
        changed += result.changed;
        setProgress(checked);
      }
      setDraft([]);
      setPage(1);
      notify(`询盘导入完成，核对 ${checked} 条，写入或更新 ${changed} 条。`);
    } catch (error) {
      notify(`已处理 ${checked} 条。${(error as Error).message}。可重试，已保存的记录会自动去重。`);
    } finally {
      setImporting(false);
      setRefresh(value => value + 1);
    }
  }

  const related = selected ? linkedCustomer(selected) : null;
  const lastPage = Math.max(1, Math.ceil(listing.total / listing.pageSize));
  return <>
    <section className="panel">
      <div className="panel-head">
        <div><h2>阿里国际站询盘</h2><p>按导出表中的店铺和创建时间归档，历史会话在「沟通档案」查看。</p></div>
        <label className="btn file-label"><Plus size={15}/>选择询盘导入文件
          <input type="file" accept=".json,application/json" onChange={event => {
            const file = event.target.files?.[0];
            if (file) void prepare(file);
            event.target.value = '';
          }}/>
        </label>
      </div>
      <div className="inquiry-summary">
        {INQUIRY_SHOPS.map(label => {
          const stats = listing.summary.find(row => row.shop === label);
          return <div key={label}><strong>{label}</strong><b>{stats?.count.toLocaleString('zh-CN') || '0'} 条</b>
            <small>{stats ? stats.first.slice(0, 10) + ' 至 ' + stats.last.slice(0, 10) : '尚无导入数据'}</small></div>;
        })}
      </div>
      {eligible ? <>
        <form className="table-toolbar" onSubmit={search}>
          <div className="search-input"><Search size={16}/><input aria-label="搜索询盘" placeholder="买家、公司、邮箱或询盘正文" value={input} onChange={event => setInput(event.target.value)}/></div>
          <button className="btn primary">搜索询盘</button>
          <button className="btn" type="button" onClick={() => {setInput(''); setQuery(''); setPage(1);}}>重置</button>
        </form>
        {error ? <p className="inquiry-placeholder" role="alert">{error}</p>
          : loading ? <p className="inquiry-placeholder">正在读取询盘…</p>
          : listing.items.length ? <div className="table-wrap"><table><thead><tr>
            <th>买家 / 公司</th><th>所属店铺</th><th>国家 / 地区</th><th>询盘来源</th><th>创建时间</th><th>客户档案</th><th></th>
          </tr></thead><tbody>{listing.items.map(item => <tr key={item.id}>
            <td><strong>{nameOf(item)}</strong>{item.company && item.company !== item.name && <small className="inquiry-company">{item.company}</small>}</td>
            <td>{item.shop}</td><td>{item.country || '—'}</td><td>{inquiryChannel(item.subject)}</td><td>{item.createdAt}</td>
            <td>{linkedCustomer(item) ? '已关联' : '待匹配'}</td>
            <td><button className="text-btn" type="button" onClick={() => void open(item)}>查看询盘</button></td>
          </tr>)}</tbody></table></div> : <p className="inquiry-placeholder">{query ? '没有匹配的询盘' : '当前店铺尚无询盘'}</p>}
        <div className="pager"><span>共 {listing.total.toLocaleString('zh-CN')} 条</span>
          <button className="icon-btn" type="button" aria-label="上一页询盘" disabled={loading || listing.page <= 1} onClick={() => setPage(listing.page - 1)}><ChevronLeft size={16}/></button>
          <span>{listing.page} / {lastPage}</span>
          <button className="icon-btn" type="button" aria-label="下一页询盘" disabled={loading || listing.page >= lastPage} onClick={() => setPage(listing.page + 1)}><ChevronRight size={16}/></button>
        </div>
      </> : <p className="inquiry-placeholder">请选择「全部业务」或对应的国际站店铺。</p>}
    </section>
    {selected && <ChatHistory key={selected.id} label="询盘详情" loading={false}
      session={{buyer: nameOf(selected), shop: selected.shop, owner: inquiryChannel(selected.subject), count: 1, sourceRef: selected.sourceFile + ' · 第' + selected.sourceRow + '行'}}
      rows={[{sender: 'buyer', time: selected.createdAt, text: selected.body}]}
      close={() => setSelected(null)}
      notice={<div className="inquiry-detail-meta">
        <span>{selected.company || '公司待核实'}</span><span>{selected.country || '地区待核实'}</span>
        {selected.email && <span>{selected.email}</span>}<span>收件账号 {selected.receiverId}</span>
        {related && <button className="text-btn" onClick={() => {setSelected(null); openCustomer(related);}}>打开已关联客户</button>}
      </div>}
    />}
    {!!draft.length && <div className="overlay form-overlay"><div className="edit-modal" role="dialog" aria-modal="true" aria-label="询盘导入预览">
      <div className="drawer-top"><strong>询盘导入预览 · {draft.length} 条</strong>
        <button className="icon-btn" type="button" aria-label="关闭询盘导入" disabled={importing} onClick={() => setDraft([])}><X size={20}/></button>
      </div>
      <div className="form-body"><p>{fileName}</p>
        {INQUIRY_SHOPS.map(label => <p key={label}>{label} · {draft.filter(row => row.shop === label).length} 条</p>)}
        <p>按店铺和询盘原始标识匹配，重复导入会更新原记录。</p>
      </div>
      <div className="form-footer"><span role="status">{importing ? `已处理 ${progress} / ${draft.length}` : ''}</span><span className="grow"/>
        <button className="btn" type="button" disabled={importing} onClick={() => setDraft([])}>取消</button>
        <button className="btn primary" type="button" disabled={importing} onClick={() => void commit()}>确认导入询盘</button>
      </div>
    </div></div>}
  </>;
}
