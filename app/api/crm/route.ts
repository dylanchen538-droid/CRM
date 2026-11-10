import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { customers, sessions, messages } from '../../../lib/data/initial';
import { chatArchiveSource } from '../../../lib/chat-archive-source';
import { scriptSeeds, type RecordData, SHOPS, STAGES } from '../../../lib/model';
export const dynamic='force-dynamic';
const seeds:RecordData[]=[...customers,...scriptSeeds];
const base=new Map(seeds.map(x=>[x.id,x]));
const source=chatArchiveSource(sessions,customers.length);
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){
 if(!await getChatGPTUser())return json({error:'请先登录'},401);
 if(!env.DB)return json({error:'数据库暂不可用'},503);
 const url=new URL(req.url), action=url.searchParams.get('action');
 if(action==='messages'){const id=url.searchParams.get('id')||'';return json({messages:(messages as Record<string,unknown>)[id]||[]});}
 if(action==='searchMessages'){const q=(url.searchParams.get('q')||'').trim().toLowerCase();if(q.length<2)return json({sessions:[]});const ids=new Set(Object.entries(messages).filter(([,v])=>v.some(x=>x.text.toLowerCase().includes(q))).map(([k])=>k));return json({sessions:sessions.filter(x=>ids.has(x.id))});}
 if(action==='audit'){const a=await env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all();return json({audit:a.results});}
 const saved=await env.DB.prepare('SELECT data,version FROM records').all<{data:string;version:number}>();
 const all=new Map(base);for(const r of saved.results){const d=JSON.parse(r.data);all.set(d.id,{...d,version:r.version});}
 return json({records:[...all.values()].filter(x=>!x.archived),archived:[...all.values()].filter(x=>x.archived),sessions,source});
}
const allowed=new Set(['customer','task','activity','sample','quote','order','script']);
const fields=new Set(['id','kind','version','company','contact','phone','email','shop','trade','country','owner','source','type','products','material','texture','style','notes','research','other','address','website','brand','channel','stage','grade','platformGrade','verification','sourceRef','buyerId','loginId','lastContact','createdAt','originalOwners','customerId','title','due','status','priority','content','happenedAt','outcome','nextAction','article','color','thickness','quantity','tracking','sentAt','feedback','price','currency','validUntil','amount','orderDate','category','cn','en','favorite','archived','unit','tradeTerms','updatedAt']);
export async function POST(req:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'请先登录'},401);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'请求来源不匹配'},403);
 if(!env.DB)return json({error:'数据库暂不可用'},503);
 try{
 const body:any=await req.json();const raw=body?.record;
 if(!raw||typeof raw!=='object'||!allowed.has(raw.kind)||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{3,100}$/.test(raw.id))return json({error:'记录格式有误'},400);
 for(const [key,value]of Object.entries(raw)){if(!fields.has(key))continue;const ok=['quantity','price','amount','version'].includes(key)?typeof value==='number'&&Number.isFinite(value):['archived','favorite'].includes(key)?typeof value==='boolean':key==='originalOwners'?Array.isArray(value)&&value.every(x=>typeof x==='string'):typeof value==='string';if(!ok)return json({error:'字段格式有误：'+key},400);}
 const expected=Number(body.expectedVersion);if(!Number.isInteger(expected)||expected<0)return json({error:'缺少记录版本'},400);
 const r:RecordData={id:raw.id,kind:raw.kind,version:expected+1};
 for(const [k,v]of Object.entries(raw)){if(!fields.has(k)||['version','updatedAt','id','kind'].includes(k))continue;if(typeof v==='string'){if(v.length>20000)return json({error:'文本超出长度限制'},400);r[k]=v.trim();}else if(typeof v==='number'){if(!Number.isFinite(v)||v<0)return json({error:'数量或金额有误'},400);r[k]=v;}else if(typeof v==='boolean')r[k]=v;else if(k==='originalOwners'&&Array.isArray(v))r[k]=v.slice(0,30).map(String);}
 if(base.has(r.id)&&base.get(r.id)?.kind!==r.kind)return json({error:'记录类型不匹配'},400);
 const prev=await env.DB.prepare('SELECT kind,data,version FROM records WHERE id=?').bind(r.id).first<{kind:string;data:string;version:number}>();
 if(prev&&prev.kind!==r.kind)return json({error:'记录类型不匹配'},400);
 if(r.kind==='customer'&&!r.company&&!r.contact)return json({error:'请填写公司或联系人'},400);
 if(r.kind==='customer'&&(!SHOPS.includes(r.shop)||!STAGES.includes(r.stage)))return json({error:'请选择有效店铺和阶段'},400);
 if(['task','script'].includes(r.kind)&&!r.title)return json({error:'请填写标题'},400);
 if(r.kind==='activity'&&!r.content)return json({error:'请填写跟进内容'},400);
 if(['task','activity','sample','quote','order'].includes(r.kind)&&!r.customerId)return json({error:'请选择客户'},400);
 if(r.customerId){const related=base.get(r.customerId)||await env.DB.prepare("SELECT id FROM records WHERE id=? AND kind='customer'").bind(r.customerId).first();if(!related)return json({error:'客户不存在'},400);}
 if(['quote','order'].includes(r.kind)&&!['USD','CNY','EUR','GBP'].includes(r.currency))return json({error:'请选择币种'},400);
 if(r.kind==='quote')r.amount=Math.round(Number(r.quantity||0)*Number(r.price||0)*100)/100;
 const at=new Date().toISOString();r.updatedAt=at;
 const statement=expected===0?env.DB.prepare('INSERT INTO records(id,kind,data,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(r.id,r.kind,JSON.stringify(r),1,at):env.DB.prepare('UPDATE records SET data=?,version=?,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(r),expected+1,at,r.id,expected);
 const audit=env.DB.prepare('INSERT INTO audit(record_id,action,actor,at,detail) SELECT ?,?,?,?,? WHERE changes()>0').bind(r.id,r.archived?'归档':prev&&JSON.parse(prev.data).archived?'恢复':expected===0&&!base.has(r.id)?'新建':'更新',user.displayName,at,JSON.stringify({kind:r.kind,title:r.company||r.title||r.article||r.content?.slice(0,80),before:prev?JSON.parse(prev.data):base.get(r.id)||null,after:r}));
 const result=await env.DB.batch([statement,audit]);if(!result[0].meta.changes)return json({error:'记录已被更新，请刷新后重新编辑'},409);
 return json({record:r});
 }catch(e){console.error('CRM write failed',e instanceof Error?e.message:'unknown');return json({error:'保存失败，请检查内容后重试'},500);}
}
