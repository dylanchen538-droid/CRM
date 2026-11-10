import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {normalizeCustomer} from '../lib/alibaba/protocol.ts';
const key=Buffer.from(readFileSync('.dev.vars','utf8').match(/ALIBABA_VAULT_KEY=([a-f0-9]{64})/)[1],'hex');
const ck=await crypto.subtle.importKey('raw',key,{name:'AES-GCM'},false,['encrypt']);
async function seal(x,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const b=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},ck,new TextEncoder().encode(JSON.stringify(x)));return 'v1.'+Buffer.from(iv).toString('base64')+'.'+Buffer.from(b).toString('base64')}
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const sqlFile='.sites-runtime/alibaba-binding-test.sql';
function sql(s){writeFileSync(sqlFile,s);const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file',sqlFile],{encoding:'utf8'});if(r.status)throw Error('Local D1 test setup failed');unlinkSync(sqlFile)}
const host='http://localhost:5173';const signin=await fetch(host+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});const cookie=signin.headers.get('set-cookie').split(';')[0];
async function post(slot,action,extra={}){const r=await fetch(host+'/api/integrations/alibaba',{method:'POST',headers:{cookie,origin:host,'content-type':'application/json'},body:JSON.stringify({slot,action,...extra})});return {status:r.status,body:await r.json()}}
const info={id:'local-binding-test-account',nick:'本地绑定验证',expiresAt:Date.now()+3600000,refreshUntil:0};const tokens={access_token:'local-binding-test-token',taobao_user_id:info.id,expires_in:3600};
const customer=normalizeCustomer({customer_id:'900001',company_name:'本地导入验证客户',contact_info_allowable:'y',basic_info_allowable:'y'},'meliya',info.id);
try{
 for(const slot of ['meliya','meixin']){const secret=await seal('local-binding-test-secret',slot+':secret'),pending=await seal({tokens,info,createdAt:Date.now(),configVersion:1},slot+':pending');sql(`INSERT INTO alibaba_connections(slot,app_key,secret,pending,version,updated_at,expected_account) VALUES(${q(slot)},'local-test-app',${q(secret)},${q(pending)},1,${q(new Date().toISOString())},'shop-short-name');`)}
 assert.equal((await post('meliya','confirm')).body.code,'account_mismatch');assert.equal((await post('meliya','confirm',{confirmAccount:info.id})).status,200);assert.equal((await post('meixin','confirm',{confirmAccount:info.id})).body.code,'binding_conflict');
 const status=await fetch(host+'/api/integrations/alibaba',{headers:{cookie}}).then(r=>r.json());assert.equal(status.shops[0].connected,true);assert.equal(JSON.stringify(status).includes('local-binding-test-token'),false);
 const payload={customers:[customer],total:1,nextCursor:'900001',syncEnd:'2026-11-07 12:00:00',hasMore:false};sql(`INSERT INTO alibaba_previews(id,slot,actor,config_version,account_id,data,expires_at) VALUES('local-binding-test-preview','meliya','local_seedy',1,${q(info.id)},${q(JSON.stringify(payload))},${Date.now()+600000});`);
 const first=await post('meliya','import',{previewId:'local-binding-test-preview'});assert.equal(first.status,200);assert.equal(first.body.imported,1);assert.equal((await post('meliya','import',{previewId:'local-binding-test-preview'})).body.imported,0);
 let row=(await fetch(host+'/api/crm',{headers:{cookie}}).then(r=>r.json())).records.find(x=>x.id===customer.id);assert.ok(row);const revised=await fetch(host+'/api/crm',{method:'POST',headers:{cookie,origin:host,'content-type':'application/json'},body:JSON.stringify({record:{...row,stage:'复购',archived:true},expectedVersion:row.version})});assert.equal(revised.status,200);
 assert.equal((await post('meliya','import',{previewId:'local-binding-test-preview'})).body.skipped,1);const after=await fetch(host+'/api/crm',{headers:{cookie}}).then(r=>r.json());assert.equal(after.records.some(x=>x.id===customer.id),false);assert.equal(after.archived.find(x=>x.id===customer.id).stage,'复购');
 console.log('PASS: account confirmation, same-account cross-shop binding rejection, token not disclosed, preview import, repeat import idempotency, archived/manual record preserved. Offline local fixtures only; no Alibaba network requests.');
}finally{sql(`DELETE FROM records WHERE id=${q(customer.id)}; DELETE FROM alibaba_previews WHERE id='local-binding-test-preview'; DELETE FROM alibaba_connections WHERE slot IN ('meliya','meixin');`)}
