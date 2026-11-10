'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import type { RecordData } from '../lib/model';

const pageSize = 12;
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const digits = (value: string) => value.replace(/\D/g, '');

export default function CustomerSearch({ customers, onSelect, loading, error }: {
  customers: RecordData[];
  onSelect: (id: string) => void;
  loading: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const needle = normalize(query);
  const matches = useMemo(() => {
    if (!needle) return [];
    const terms = needle.split(/\s+/);
    const phoneQuery = /^[+\d\s().-]+$/.test(needle) && digits(needle).length >= 4
      ? digits(needle) : '';
    return customers.flatMap(customer => {
      const identity = [customer.id, customer.buyerId, customer.loginId, customer.email].map(normalize);
      const fields = [customer.company, customer.contact, customer.brand, customer.phone, ...identity].map(normalize);
      const phone = digits(normalize(customer.phone));
      const exact = identity.includes(needle) || (phoneQuery && phone === phoneQuery);
      const byPhone = phoneQuery && phone.includes(phoneQuery);
      if (!exact && !byPhone && !terms.every(term => fields.some(field => field.includes(term)))) return [];
      const rank = exact ? 0 : fields.includes(needle) ? 1 : 2;
      return [{ customer, rank }];
    }).sort((a, b) => a.rank - b.rank).map(row => row.customer);
  }, [customers, needle]);

  function close() {
    dialog.current?.close();
  }

  return <>
    <button className="btn global-search-trigger" aria-label="全局搜索客户" onClick={() => dialog.current?.showModal()}>
      <Search size={16} /><span>全局搜索客户</span>
    </button>
    <dialog ref={dialog} className="customer-search-dialog" aria-labelledby="customer-search-title" onClose={() => { setQuery(''); setLimit(pageSize); }}>
      <div className="drawer-top">
        <h2 id="customer-search-title">全局搜索客户</h2>
        <button className="icon-btn" aria-label="关闭全局搜索" onClick={close}><X size={20} /></button>
      </div>
      <div className="customer-search-body">
        <div className="search-input">
          <Search size={17} />
          <input autoFocus aria-label="搜索全部业务的客户" placeholder="输入公司、联系人、电话、邮箱或客户 ID" value={query} onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} />
        </div>
        <p className="muted" aria-live="polite">{loading ? '正在读取客户档案…' : error ? '客户数据读取异常，请刷新后重试。' : needle ? `全部业务 · 找到 ${matches.length} 份档案` : '搜索范围为全部业务和业务员，也支持国际站买家 AliId。'}</p>
        {needle && !loading && !error && matches.length === 0 && <p className="customer-search-empty">没有找到匹配的客户档案。</p>}
        {!error && <ul className="customer-search-results">
          {matches.slice(0, limit).map(customer => <li key={customer.id}>
            <button className="customer-search-result" onClick={() => { close(); onSelect(customer.id); }}>
              <span>
                <strong>{customer.company || customer.contact}</strong>
                <small>{[customer.contact !== customer.company && customer.contact, customer.country, customer.email || customer.phone].filter(Boolean).join(' · ') || '联系资料待补充'}</small>
                <small>{customer.buyerId ? `AliId ${customer.buyerId}` : `客户 ID ${customer.id}`}</small>
              </span>
              <span className="customer-search-scope"><span className="badge teal">{customer.shop}</span><small>{customer.owner || '待分配'}</small></span>
              <ChevronRight size={16} />
            </button>
          </li>)}
        </ul>}
        {!error && matches.length > limit && <button className="btn" onClick={() => setLimit(value => value + pageSize)}>显示更多</button>}
      </div>
    </dialog>
  </>;
}
