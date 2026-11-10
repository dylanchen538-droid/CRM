import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { customers, sessions, messages } from '../../../lib/data/initial';
import { INQUIRY_SHOPS, type Inquiry } from '../../../lib/inquiry';
import { suggestReply, type ReplyEvidence } from '../../../lib/daily-replies';
import type { RecordData } from '../../../lib/model';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: {'Cache-Control': 'private, no-store'},
});
type Group = {id: string; name: string; shop: string; owner: string; customerId?: string; buyerId?: string; events: ReplyEvidence[]};
type Stored = {id: string; data: string};
const messageIndex = messages as Record<string, {sender: string; time: string; text: string}[]>;
const normalize = (value: string) => value.trim().toLowerCase();
const direction = (sender: string) => /^(买家|buyer)$/i.test(sender) ? 'buyer' : /^(卖家|seller)$/i.test(sender) ? 'seller' : 'unknown';

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return json({error: '请先登录'}, 401);
  if (!env.DB) return json({error: '数据库暂不可用'}, 503);
  const params = new URL(request.url).searchParams;
  const date = params.get('date') || '';
  const shop = params.get('shop') || '';
  const q = normalize(params.get('q') || '').slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    (shop && !INQUIRY_SHOPS.some(value => value === shop))) return json({error: '日期或店铺无效'}, 400);

  const saved = await env.DB.prepare("SELECT id,data FROM records WHERE kind='customer'").all<Stored>();
  const customerMap = new Map<string, RecordData>(customers.map(c => [c.id, c]));
  for (const row of saved.results) customerMap.set(row.id, JSON.parse(row.data));
  const identities = new Map<string, RecordData | null>();
  const aliases = new Set<string>();
  const key = (s: string, id: string) => JSON.stringify([s, normalize(id)]);
  const matches = (...values: (string | undefined)[]) => !q || values.some(value => value && normalize(value).includes(q));
  for (const c of customerMap.values()) {
    if (shop && c.shop !== shop) continue;
    for (const value of new Set<string>([c.buyerId, c.loginId].filter(Boolean))) {
      const lookup = key(c.shop, value);
      const old = identities.get(lookup);
      identities.set(lookup, old === undefined || old?.id === c.id ? c : null);
      if (q && matches(c.id, c.company, c.contact, c.buyerId, c.loginId)) aliases.add(normalize(value));
    }
  }
  const events = new Map<string, Group>();
  function add(group: Omit<Group, 'events'>, evidence: ReplyEvidence) {
    const item = events.get(group.id) ?? {...group, events: []};
    item.events.push(evidence);
    events.set(group.id, item);
  }

  let lastHistory = '';
  for (const session of sessions) {
    const c = customerMap.get(session.customerId);
    if (!c || c.archived || (shop && session.shop !== shop)) continue;
    if (!matches(c.id, c.company, c.contact, c.buyerId, c.loginId, session.buyer)) continue;
    const end = session.last.slice(0, 10);
    if (end > lastHistory) lastHistory = end;
    if (session.first.slice(0, 10) > date || end < date) continue;
    for (const message of messageIndex[session.id] || []) {
      if (message.time.slice(0, 10) !== date || !message.text.trim()) continue;
      add({id: c.id, customerId: c.id, buyerId: c.buyerId || c.loginId, name: c.company || session.buyer,
        shop: session.shop, owner: c.owner || session.owner}, {
        time: message.time, direction: direction(message.sender), text: message.text,
        source: '历史会话', thread: session.id,
      });
    }
  }
  const shopSql = shop ? ' AND shop=?' : '';
  const shopValues = shop ? [shop] : [];
  const qSql = q ? " AND (instr(lower(json_extract(data,'$.name') || ' ' || json_extract(data,'$.company') || ' ' || json_extract(data,'$.buyerId') || ' ' || json_extract(data,'$.companyId')),?)>0 OR lower(json_extract(data,'$.buyerId')) IN (SELECT value FROM json_each(?)))" : '';
  const qValues = q ? [q, JSON.stringify([...aliases])] : [];
  const [latest, exported] = await Promise.all([
    env.DB.prepare('SELECT MAX(created_at) AS last FROM inquiries WHERE 1=1' + shopSql + qSql)
      .bind(...shopValues, ...qValues).first<{last: string | null}>(),
    env.DB.prepare('SELECT id,data FROM inquiries WHERE created_at BETWEEN ? AND ?' + shopSql + qSql)
      .bind(date + ' 00:00:00', date + ' 23:59:59', ...shopValues, ...qValues).all<Stored>(),
  ]);
  for (const stored of exported.results) {
    const inquiry: Inquiry = JSON.parse(stored.data);
    const c = inquiry.buyerId ? identities.get(key(inquiry.shop, inquiry.buyerId)) : null;
    if (c?.archived) continue;
    const fallbackId = inquiry.buyerId || inquiry.email || stored.id;
    add({id: c?.id || key(inquiry.shop, fallbackId), customerId: c?.id, buyerId: inquiry.buyerId || inquiry.companyId,
      name: c?.company || inquiry.name || inquiry.company || '买家待核对', shop: inquiry.shop, owner: c?.owner || '待分配'}, {
      time: inquiry.createdAt, direction: 'buyer', text: inquiry.body,
      source: '询盘导出', thread: stored.id, inquiryId: stored.id,
    });
  }
  const items = [...events.values()].map(({events: evidence, ...group}) => {
    const suggestion = suggestReply(evidence);
    return {...group, count: evidence.length, suggestion: {
      ...suggestion, evidence: {...suggestion.evidence, text: suggestion.evidence.text.slice(0, 800)},
    }};
  }).sort((a, b) => b.suggestion.evidence.time.localeCompare(a.suggestion.evidence.time));
  return json({date, items, latest: [lastHistory, latest?.last?.slice(0, 10) || ''].sort().at(-1) || ''});
}
