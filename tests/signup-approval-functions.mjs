import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {normalizeReferral,sha256} from '../supabase/functions/_shared/payment-rules.ts';
const id='11111111-1111-4111-8111-111111111111';
let handler,registered,authorized,account,invites,finished,beginCalls,inviteError,finishError,pendingStatus,rpcError,lookupError,requested,passwordHash,created,resends,emailError;
function reset(){registered=true;authorized=true;account=null;invites=finished=beginCalls=created=resends=0;inviteError=finishError=lookupError=emailError=false;pendingStatus='pending';rpcError=null;requested=null;passwordHash='$2a$12$fixture';}
const pending={id,email:'student@example.test',full_name:'Student',phone:'9999999999'};
const admin={auth:{resend:async()=>{resends++;return {error:emailError===true?Error('SMTP unavailable'):emailError||null};},admin:{createUser:async options=>{
 assert.equal(beginCalls,1);assert.equal(options.password_hash,passwordHash);assert.equal(options.email_confirm,false);assert.equal(options.password,undefined);
 if(inviteError)return {error:Error('Auth unavailable')};
 assert.equal(options.user_metadata.approved_signup_id,id);created++;account='new-user';return {data:{user:{id:account}},error:null};
},inviteUserByEmail:async(email,options)=>{
 invites++;assert.equal(beginCalls,1,'Authorization must happen before Auth creation');
 assert.equal(options.data.approved_signup_id,id);assert.equal(options.data.approval_token,'private-capability');
 if(inviteError)return {error:Error('SMTP failed')};
 account='new-user';return {data:{user:{id:account}},error:null};
}}},from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{...pending,status:pendingStatus,approved_user_id:pendingStatus==='approved'?account:null},error:null})}),
 rpc:async(name,args)=>{
  if(name==='tis_signup_account')return lookupError?{error:Error('Lookup unavailable')}:{data:account,error:null};
  if(name==='tis_signup_password')return {data:passwordHash,error:null};
  if(name==='tis_request_signup_with_password'){requested=args;return {error:rpcError};}
  throw Error(name);
 }};
const client={auth:{getUser:async()=>({data:{user:registered?{id:'admin'}:null},error:null})},rpc:async name=>{
 if(name==='tis_admin_dashboard')return {error:authorized?null:Error('Denied')};
 if(name==='tis_begin_signup_approval'){beginCalls++;return {data:'private-capability',error:rpcError};}
 if(name==='tis_finish_admin_signup'){if(finishError)return {error:Error('Temporary DB failure')};if(pendingStatus!=='approved')finished++;pendingStatus='approved';return {error:null};}
 throw Error(name);
}};
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon',SITE_URL:'https://example.test/THE_INDIAN_SKILLS.html'};
async function load(file){
 const source=(await fs.readFile(new URL('../supabase/functions/'+file+'/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{createClient:(_,key)=>key==='service'?admin:client,normalizeReferral,sha256,Request,Response,URL,JSON,TextEncoder,
 Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}}});
}
const call=async(body,origin='https://example.test')=>{const r=await handler(new Request('https://test.supabase.co/functions/v1/test',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test'},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
let passed=0;
async function check(fn){reset();await fn();passed++;}
await load('approve-pending-user');
await check(async()=>{
 const r=await handler(new Request('https://test.supabase.co/functions/v1/approve-pending-user',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5501','Access-Control-Request-Headers':'authorization,apikey,content-type,x-client-info,x-app-name'}}));
 const allowed=r.headers.get('Access-Control-Allow-Headers').split(',').map(h=>h.trim());
 for(const header of ['authorization','apikey','content-type','x-client-info','x-app-name'])assert.ok(allowed.includes(header),header+' must pass browser preflight');
});
await check(async()=>{registered=false;assert.equal((await call({pendingId:id})).status,401);assert.equal(invites,0);});
await check(async()=>{authorized=false;assert.equal((await call({pendingId:id})).status,403);assert.equal(invites,0);});
await check(async()=>{assert.equal((await call({pendingId:'invalid'})).status,400);assert.equal(invites,0);});
await check(async()=>{rpcError=Error('Payment is in progress');assert.equal((await call({pendingId:id})).status,400);assert.equal(invites,0);});
await check(async()=>{assert.equal((await call({pendingId:id})).data.success,true);assert.equal(created,1);assert.equal(finished,1);await call({pendingId:id});assert.equal(created,1);assert.equal(finished,1);assert.equal(invites+resends,0);});
await check(async()=>{inviteError=true;assert.equal((await call({pendingId:id})).status,400);assert.equal(finished,0);assert.equal(account,null);inviteError=false;beginCalls=0;assert.equal((await call({pendingId:id})).data.success,true);});
await check(async()=>{finishError=true;assert.equal((await call({pendingId:id})).status,400);assert.equal(created,1);finishError=false;assert.equal((await call({pendingId:id})).data.success,true);assert.equal(created,1,'Retry recovers the account without changing its password');});
await check(async()=>{account='existing-user';assert.equal((await call({pendingId:id})).data.success,true);assert.equal(invites,0);assert.equal(finished,1);});
await check(async()=>{lookupError=true;assert.equal((await call({pendingId:id})).status,400);assert.equal(invites,0);assert.equal(finished,0);});
await check(async()=>{emailError=true;assert.equal((await call({pendingId:id})).data.success,true);assert.equal(created,1);assert.equal(invites+resends,0);assert.equal(finished,1);});
await check(async()=>{account='account-created-before-email-failure';emailError=true;assert.equal((await call({pendingId:id})).data.success,true);assert.equal(created,0);assert.equal(finished,1);assert.equal(invites+resends,0);});
await check(async()=>{passwordHash=null;const result=await call({pendingId:id});assert.equal(result.status,400);assert.match(result.data.error,/no saved signup password/);assert.equal(created+invites+resends,0);});
await load('request-signup');
await check(async()=>{const result=await call({email:' Student@Example.Test ',name:' Student ',phone:'9999999999',course:'Marketing Management',referral:'https://example.test/?ref=referrer',password:'must-not-be-stored',amount:999});
 assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(requested.p_email,'student@example.test');assert.equal(requested.p_referral,'referrer');
 assert.equal(requested.p_password,'must-not-be-stored');assert.equal(requested.amount,undefined);assert.equal(invites,0);assert.equal(finished,0);
});
await check(async()=>{rpcError={message:'Invalid referral link'};const result=await call({password:'test-password'});assert.equal(result.status,400);assert.match(result.data.error,/Invalid referral/);});
await check(async()=>{for(const password of ['', 'short','x'.repeat(73),'🙂'.repeat(19)]){assert.equal((await call({password})).status,400);assert.equal(requested,null);}});
await check(async()=>{assert.equal((await call({},'https://attacker.test')).status,403);assert.equal(requested,null);});
await check(async()=>{assert.equal((await call({name:'x'.repeat(9000)})).status,413);assert.equal(requested,null);});
await check(async()=>{
 assert.equal((await call({},'http://127.0.0.1:5501')).status,403,'Local origins require explicit configuration');
 env.ALLOWED_ORIGINS='http://127.0.0.1:5501,http://localhost:5501';
 const response=await handler(new Request('https://test.supabase.co/functions/v1/request-signup',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5501'}}));
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5501');
 assert.equal((await call({email:'local@example.test',password:'test-password'},'http://127.0.0.1:5501')).status,200);
 assert.equal((await call({},'https://attacker.test')).status,403);
 delete env.ALLOWED_ORIGINS;
});
console.log(`${passed} signup/approval Edge Function checks passed (mocked Auth and database; no email sent).`);
