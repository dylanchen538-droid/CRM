import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { INQUIRY_SHOPS, inquiryKey, inquirySchema, type Inquiry } from '../../../lib/inquiry';

export const dynamic = 'force-dynamic';
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});
const pageSize = 25;

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return json({error: '请先登录'}, 401);
  if (!env.DB) return json({error: '数据库暂不可用'}, 503);
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (id) {
    const row = await env.DB.prepare('SELECT data FROM inquiries WHERE id=?').bind(id).first<{data: string}>();
    return row ? json({inquiry: JSON.parse(row.data)}) : json({error: '询盘不存在'}, 404);
  }

  const shop = params.get('shop');
  const conditions: string[] = [], values: string[] = [];
  if (shop) {
    if (!INQUIRY_SHOPS.some(label => label === shop)) return json({error: '店铺无效'}, 400);
    conditions.push('shop=?');
    values.push(shop);
  }
  const q = (params.get('q') || '').trim().toLowerCase().slice(0, 160);
  if (q) {
    conditions.push("instr(lower(json_extract(data,'$.name') || ' ' || json_extract(data,'$.company') || ' ' || json_extract(data,'$.email') || ' ' || json_extract(data,'$.buyerId') || ' ' || json_extract(data,'$.body')),?)>0");
    values.push(q);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const requested = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const [count, summary] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM inquiries' + where).bind(...values).first<{total: number}>(),
    env.DB.prepare('SELECT shop, COUNT(*) AS count, MIN(created_at) AS first, MAX(created_at) AS last FROM inquiries GROUP BY shop').all(),
  ]);
  const total = count?.total ?? 0;
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await env.DB.prepare(
    'SELECT id, data FROM inquiries' + where + ' ORDER BY created_at DESC, id LIMIT ? OFFSET ?',
  ).bind(...values, pageSize, (page - 1) * pageSize).all<{id: string; data: string}>();
  const items = rows.results.map(({id: rowId, data}) => {
    const {shop, createdAt, buyerId, name, company, country, subject}: Inquiry = JSON.parse(data);
    return {id: rowId, shop, createdAt, buyerId, name, company, country, subject};
  });
  return json({items, total, page, pageSize, summary: summary.results});
}

const batchSchema = z.array(inquirySchema).min(1).max(30);
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({error: '请先登录'}, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({error: '请求来源不匹配'}, 403);
  if (!env.DB) return json({error: '数据库暂不可用'}, 503);
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error: '询盘批次格式或店铺账号有误'}, 400);
  const seen = new Set<string>();
  const statements = [];
  for (const row of parsed.data) {
    const key = inquiryKey(row);
    if (seen.has(key)) return json({error: '询盘批次含重复记录'}, 400);
    seen.add(key);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    statements.push(env.DB.prepare(
      'INSERT INTO inquiries(id,shop,created_at,data) VALUES(?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE inquiries.data<>excluded.data',
    ).bind(id, row.shop, row.createdAt, JSON.stringify(row)));
  }
  try {
    const result = await env.DB.batch(statements);
    return json({accepted: parsed.data.length, changed: result.reduce((sum, row) => sum + row.meta.changes, 0)});
  } catch {
    return json({error: '本批次保存失败，请重试'}, 500);
  }
}
