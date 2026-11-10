import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { customers as seeds } from '../../../lib/data/initial';
import { MAIL_ACCOUNT, mailMatcher, mailSchema, partiesSchema, type Mail, type MailInquiry } from '../../../lib/mail-archive';
import type { RecordData } from '../../../lib/model';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const listPageSize = 30;
const messagePageSize = 50;
const preview = z.object({ action: z.literal('preview'), account: z.literal(MAIL_ACCOUNT), parties: z.array(partiesSchema).max(3000) });
const batch = z.object({ action: z.literal('import'), account: z.literal(MAIL_ACCOUNT), messages: z.array(mailSchema).min(1).max(25) });

async function matcher(db: D1Database) {
  const [saved, inquiries] = await Promise.all([
    db.prepare("SELECT data, version FROM records WHERE kind='customer'").all<{ data: string; version: number }>(),
    db.prepare(`SELECT DISTINCT json_extract(data,'$.email') AS email, shop,
      json_extract(data,'$.buyerId') AS buyerId, json_extract(data,'$.name') AS name,
      json_extract(data,'$.company') AS company FROM inquiries WHERE coalesce(json_extract(data,'$.email'),'')<>''`).all<MailInquiry>(),
  ]);
  const customers = new Map<string, RecordData>(seeds.map(row => [row.id, row]));
  for (const row of saved.results) {
    const item = JSON.parse(row.data);
    customers.set(item.id, { ...item, version: row.version });
  }
  return mailMatcher([...customers.values()], inquiries.results);
}

async function mailCustomerId(email: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return 'email-' + Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

function requestedPage(params: URLSearchParams) {
  const page = Number(params.get('page'));
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return json({ error: '请先登录' }, 401);
  const db = env.DB;
  if (!db) return json({ error: '数据库暂不可用' }, 503);
  const params = new URL(request.url).searchParams;
  const customer = params.get('customer');
  const party = params.get('party');
  if (customer || party) {
    const where = customer ? 'customer_id=?' : 'party=?';
    const key = customer || party || '';
    const total = (await db.prepare(`SELECT COUNT(*) AS total FROM mail_messages WHERE ${where}`).bind(key).first<{ total: number }>())?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / messagePageSize));
    const page = Math.min(requestedPage(params), pages);
    const rows = await db.prepare(`SELECT data, evidence FROM mail_messages WHERE ${where} ORDER BY happened_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(key, messagePageSize, (page - 1) * messagePageSize).all<{ data: string; evidence: string }>();
    return json({ messages: rows.results.map(row => ({ ...JSON.parse(row.data) as Mail, evidence: row.evidence })).reverse(), total, page, pages });
  }

  const q = (params.get('q') || '').trim().toLowerCase().slice(0, 120);
  const channel = (params.get('channel') || '').slice(0, 30);
  const where = `WHERE (?='' OR instr(lower(party||' '||label),?)>0)
    AND (?='' OR channel=? OR (?='展会 / 待分配' AND channel IN ('展会','广交会')))`;
  const filters = [q, q, channel, channel, channel];
  const [totals, categories] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT party) AS contacts FROM mail_messages ${where}`).bind(...filters).first<{ contacts: number }>(),
    db.prepare('SELECT channel, COUNT(*) AS messages FROM mail_messages GROUP BY channel ORDER BY channel').all<{ channel: string; messages: number }>(),
  ]);
  const total = totals?.contacts ?? 0;
  const pages = Math.max(1, Math.ceil(total / listPageSize));
  const page = Math.min(requestedPage(params), pages);
  const items = await db.prepare(`SELECT party, max(label) AS label,
      CASE WHEN count(DISTINCT channel)>1 THEN '渠道待确认' ELSE max(channel) END AS channel,
      CASE WHEN count(DISTINCT evidence)>1 THEN '逐封查看匹配依据' ELSE max(evidence) END AS evidence,
      count(*) AS count, max(happened_at) AS last,
      CASE WHEN count(DISTINCT customer_id)=1 AND count(customer_id)=count(*) THEN max(customer_id) END AS customerId
      FROM mail_messages ${where} GROUP BY party ORDER BY last DESC, party LIMIT ? OFFSET ?`)
    .bind(...filters, listPageSize, (page - 1) * listPageSize).all();
  return json({ items: items.results, total, page, pages, categories: categories.results });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: '请先登录' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '请求来源不匹配' }, 403);
  const db = env.DB;
  if (!db) return json({ error: '数据库暂不可用' }, 503);
  const input = await request.text();
  if (input.length > 4_000_000) return json({ error: '单次请求内容太多' }, 413);
  let body: unknown;
  try { body = JSON.parse(input); } catch { return json({ error: '导入包格式无效' }, 400); }
  const checked = z.discriminatedUnion('action', [preview, batch]).safeParse(body);
  if (!checked.success) return json({ error: '邮箱账号或导入包格式无效' }, 400);
  try {
    const match = await matcher(db);
    if (checked.data.action === 'preview') return json({ matches: checked.data.parties.map(match) });

    const ids = checked.data.messages.map(row => row.id);
    const known = await db.prepare(`SELECT id FROM mail_messages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
    const seen = new Set(known.results.map(row => row.id));
    const statements = [];
    const mailStatements: number[] = [];
    const newCustomers = new Set<string>();
    const at = new Date().toISOString();
    for (const message of checked.data.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      const result = match(message.contacts);
      const customerId = result.disposition === 'new' ? await mailCustomerId(result.party) : result.customerId;
      if (result.disposition === 'new' && !newCustomers.has(customerId)) {
        newCustomers.add(customerId);
        const customer: RecordData = {
          id: customerId, kind: 'customer', version: 1, contact: result.name, company: result.company, email: result.party,
          shop: result.shop, source: result.channel === '渠道待确认' ? '企业邮箱 · 渠道待确认' : result.channel,
          channel: '企业邮箱', stage: '待核实', verification: '待核实', owner: '待分配',
          grade: '未分级', trade: '待核实', sourceRef: `腾讯企业邮箱 Export · ${result.evidence}`, createdAt: at, updatedAt: at,
        };
        statements.push(db.prepare(`INSERT INTO records(id,kind,data,version,updated_at) VALUES(?,'customer',?,1,?) ON CONFLICT(id) DO NOTHING`)
          .bind(customerId, JSON.stringify(customer), at));
        statements.push(db.prepare(`INSERT INTO audit(record_id,action,actor,at,detail) SELECT ?,'邮件导入',?,?,? WHERE changes()>0`)
          .bind(customerId, user.displayName, at, JSON.stringify({ kind: 'customer', title: result.name })));
      }
      mailStatements.push(statements.length);
      statements.push(db.prepare(`INSERT INTO mail_messages(id,party,customer_id,label,channel,evidence,happened_at,data)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(message.id, result.party, customerId || null, result.name, result.channel, result.evidence, message.at, JSON.stringify(message)));
    }
    const results = statements.length ? await db.batch(statements) : [];
    return json({ processed: checked.data.messages.length, inserted: mailStatements.reduce((count, index) => count + results[index].meta.changes, 0) });
  } catch {
    return json({ error: '邮箱记录处理失败，请重试当前批次' }, 500);
  }
}
