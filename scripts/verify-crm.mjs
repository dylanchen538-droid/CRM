import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const snapshot=name=>JSON.parse(readFileSync(new URL('../lib/data/'+name+'.json',import.meta.url),'utf8'));
const customers=snapshot('customers'), sessions=snapshot('sessions');
const host=process.env.CRM_TEST_ORIGIN||'http://localhost:5173';
const anonymous=await fetch(host+'/api/crm');assert.equal(anonymous.status,401);
const signin=await fetch(host+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});const cookie=signin.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
async function get(path=''){const r=await fetch(host+'/api/crm'+path,{headers:{cookie}});assert.equal(r.status,200);return r.json()}
async function post(record,expectedVersion=record.version,origin=host){const r=await fetch(host+'/api/crm',{method:'POST',headers:{cookie,'Content-Type':'application/json',origin},body:JSON.stringify({record,expectedVersion})});const txt=await r.text();let body;try{body=JSON.parse(txt)}catch{body={error:txt}}return {status:r.status,body}}
const state=await get();assert.equal(state.records.filter(x=>x.kind==='customer').length,customers.length);assert.equal(state.sessions.length,sessions.length);assert.equal(state.source.messages,sessions.reduce((n,s)=>n+s.count,0));for(const shop of ['美利雅国际站','美欣国际站'])assert.equal(state.records.filter(x=>x.shop===shop).length,customers.filter(x=>x.shop===shop).length);
const s=state.sessions[0];
if(s){const msgs=await get('?action=messages&id='+s.id);assert.equal(msgs.messages.length,s.count);}
else assert.deepEqual((await get('?action=searchMessages&q=example')).sessions,[]);
const c={id:'qa-'+crypto.randomUUID(),kind:'customer',version:0,company:'本地验证客户',shop:'美利雅国际站',stage:'需求确认',owner:'测试负责人'};
assert.equal((await post(c,0,'https://untrusted.invalid')).status,403);
let saved=await post(c);assert.equal(saved.status,200);assert.equal(saved.body.record.version,1);
assert.equal((await post(c)).status,409);
let revised=await post({...saved.body.record,material:'头层牛皮 1.2mm'});assert.equal(revised.status,200);assert.equal(revised.body.record.version,2);
assert.equal((await get()).records.find(x=>x.id===c.id).material,'头层牛皮 1.2mm');
const t={id:'qa-'+crypto.randomUUID(),kind:'task',version:0,title:'核实样品颜色',customerId:c.id,owner:'测试负责人',status:'待完成',due:'2026-11-07'};
const task=(await post(t)).body.record;const done=(await post({...task,status:'已完成'})).body.record;assert.equal(done.status,'已完成');
const q={id:'qa-'+crypto.randomUUID(),kind:'quote',version:0,customerId:c.id,quantity:125.5,price:2.4,currency:'USD',status:'草稿'};const quote=(await post(q)).body.record;assert.equal(quote.amount,301.2);
assert.equal((await post({...quote,currency:'INVALID'})).status,400);
const sample=(await post({id:'qa-'+crypto.randomUUID(),kind:'sample',version:0,customerId:c.id,article:'QA-001',status:'已寄出',quantity:2,unit:'片'})).body.record;assert.equal(sample.article,'QA-001');
const note=(await post({id:'qa-'+crypto.randomUUID(),kind:'activity',version:0,customerId:c.id,content:'本地流程验证，不属于正式业务数据',happenedAt:'2026-11-07T10:00',channel:'国际站'})).body.record;assert.ok(note.id);
for(const r of [revised.body.record,done,quote,sample,note])assert.equal((await post({...r,archived:true})).status,200);
assert.equal((await get()).records.some(x=>x.id===c.id),false);
const audit=await get('?action=audit');assert.ok(audit.audit.some(x=>x.record_id===c.id&&x.action==='归档'));
console.log('PASS: auth, snapshot customer and store counts, sessions, message detail, CSRF, customer CRUD, optimistic conflicts, task completion, quote calculation, currency validation, sample/follow-up, archive and audit.');
