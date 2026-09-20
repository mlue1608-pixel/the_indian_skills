// node tests/payment-gateway.mjs (Node 24+). No network or real accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac} from 'node:crypto';
import {normalizeReferral,matchesPayment,beganBeforeExpiry,canOpen,sha256,validSignature} from '../supabase/functions/_shared/payment-rules.ts';

const signature=value=>createHmac('sha256','secret').update(value).digest('hex');
assert.equal(await validSignature('body',signature('body'),'secret'),true);
assert.equal(await validSignature('modified',signature('body'),'secret'),false);
assert.equal(await validSignature('body','not-hex','secret'),false);
assert.equal(normalizeReferral('https://example.test/?referral=abc'),'abc');
assert.equal(normalizeReferral(' abc '),'abc');
const token='test-token', id='11111111-1111-4111-8111-111111111111';
let s,payments,invites,finishes,account,inviteFailure=false,captures,passwordHash,created,resends,emailFailure;
async function reset(){s={id,token_hash:await sha256(token),email:'student@example.test',full_name:'Student',phone:'9999999999',course:'Marketing Management',original_paise:99900,amount_paise:29970,order_id:'order_test',status:'created',user_id:null,expires_at:new Date(Date.now()+360000).toISOString()};payments=[];invites=finishes=captures=created=resends=0;account=null;inviteFailure=emailFailure=false;passwordHash='$2a$12$fixture';}
function query(){let filters=[],values;
 const result=()=>({data:filters.every(([key,value])=>s[key]===value)?{...s}:null,error:null});
 const q={select(){return q;},update(v){values=v;return q;},eq(k,v){filters.push([k,v]);return q;},single:async()=>result(),maybeSingle:async()=>result(),then(resolve){if(values&&result().data)Object.assign(s,values);return Promise.resolve(result()).then(resolve);}};return q;
}
const client={from:()=>query(),rpc:async(name,args)=>{
 if(name==='tis_checkout_account')return {data:account,error:null};
 if(name==='tis_signup_password')return {data:passwordHash,error:null};
 if(name==='tis_checkout_finish'){assert.equal(s.status,'paid');if(s.status!=='completed'){finishes++;s.status='completed';s.user_id=args.p_user;}return {data:null,error:null};}
 if(name==='tis_checkout_create_for_method'){assert.equal(args.p_method,'Payment Link');assert.equal(args.p_user,null);assert.equal(args.p_password,'test-password');assert.equal(args.p_referral,'referrer');s.token_hash=args.p_hash;return {data:{...s},error:null};}
 throw Error(name);
},auth:{resend:async()=>{resends++;return {error:emailFailure?Error('SMTP failed'):null};},getUser:async()=>({data:{user:null},error:Error('invalid')}),admin:{updateUserById:async(id,options)=>{assert.equal(id,account);assert.equal(options.email_confirm,true);return {error:emailFailure?Error('Auth activation failed'):null};},createUser:async options=>{
 assert.equal(s.status,'paid');assert.equal(options.password_hash,passwordHash);assert.equal(options.email_confirm,true);assert.equal(options.password,undefined);created++;if(inviteFailure)return {data:null,error:Error('Auth unavailable')};account='student-id';return {data:{user:{id:account}},error:null};
},inviteUserByEmail:async()=>{
 assert.equal(s.status,'paid','No account before captured payment');invites++;
 if(inviteFailure)return {data:null,error:Error('Email unavailable')};account='student-id';return {data:{user:{id:account}},error:null};
}}}};
let handler,extraOrigins='';
const source=(await fs.readFile(new URL('../supabase/functions/razorpay-checkout/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const context=vm.createContext({createClient:()=>client,normalizeReferral,matchesPayment,beganBeforeExpiry,canOpen,sha256,validSignature,
 crypto,URL,URLSearchParams,Request,Response,AbortSignal,TextEncoder,Uint8Array,btoa,console:{error(){}},
 Deno:{env:{get:name=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',RAZORPAY_KEY_ID:'rzp_test_demo',RAZORPAY_KEY_SECRET:'secret',RAZORPAY_WEBHOOK_SECRET:'secret',SITE_URL:'https://example.test/THE_INDIAN_SKILLS.html',ALLOWED_ORIGINS:extraOrigins})[name]},serve:fn=>{handler=fn;}},
 fetch:async(url,options)=>{
  if(url.endsWith('/orders')){const order=JSON.parse(options.body);assert.equal(order.amount,29970);return Response.json({id:'order_test'});}
  if(url.endsWith('/capture')){captures++;const p=payments.find(p=>url.includes(p.id));p.status='captured';return Response.json(p);}
  if(url.endsWith('/payments')&&url.includes('/orders/'))return Response.json({items:payments});
  return Response.json(payments.find(p=>url.endsWith('/'+p.id)));
 }});
vm.runInContext(stripTypeScriptTypes(source),context);
const call=async(body,headers={})=>{const response=await handler(new Request('https://test.supabase.co/functions/v1/razorpay-checkout',{method:'POST',headers:{Origin:'https://example.test',...headers},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};};
const status=()=>call({action:'status',id,token});
const payment=(extra={})=>({id:'pay_test',order_id:'order_test',status:'captured',currency:'INR',amount:29970,amount_refunded:0,created_at:Math.floor(Date.now()/1000),...extra});
const passed=[];async function check(name,fn){await reset();await fn();passed.push(name);}
await check('unpaid sessions never create accounts',async()=>{assert.equal((await status()).data.status,'created');assert.equal(invites,0);assert.equal(created,0);});
await check('tampered session token is rejected',async()=>{assert.equal((await call({action:'status',id,token:'wrong'})).status,403);assert.equal(invites,0);assert.equal(created,0);});
await check('untrusted origin is rejected',async()=>{assert.equal((await call({action:'status',id,token},{Origin:'https://attacker.test'})).status,403);});
await check('configured local origins pass preflight and payment requests',async()=>{
 assert.equal((await call({action:'status',id,token},{Origin:'http://127.0.0.1:5501'})).status,403);
 extraOrigins='http://127.0.0.1:5501,http://localhost:5501';
 const preflight=await handler(new Request('https://test.supabase.co/functions/v1/razorpay-checkout',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5501'}}));
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5501');
 assert.equal((await call({action:'status',id,token},{Origin:'http://127.0.0.1:5501'})).status,200);
 assert.equal((await call({action:'status',id,token},{Origin:'https://attacker.test'})).status,403);
 extraOrigins='';
});
await check('expired sessions cannot open checkout',async()=>{s.expires_at=new Date(Date.now()-1000).toISOString();assert.equal((await call({action:'open',id,token})).status,400);assert.equal(invites,0);});
await check('failed payments never create accounts',async()=>{payments=[payment({status:'failed'})];await status();assert.equal(invites,0);assert.equal(created,0);});
await check('wrong amount or currency cannot provision',async()=>{for(const extra of [{amount:100},{currency:'USD'},{order_id:'order_other'}]){payments=[payment(extra)];assert.equal((await status()).status,400);}assert.equal(invites,0);assert.equal(created,0);});
await check('forged checkout signature cannot provision',async()=>{payments=[payment()];assert.equal((await call({action:'verify',id,token,orderId:s.order_id,paymentId:'pay_test',signature:'0'.repeat(64)})).status,403);assert.equal(invites,0);assert.equal(created,0);});
await check('captured payments create account and finish exactly once',async()=>{payments=[payment()];assert.equal((await status()).data.status,'completed');await status();assert.equal(created,1);assert.equal(finishes,1);});
await check('authorized payments must be captured before account creation',async()=>{payments=[payment({status:'authorized'})];await status();assert.equal(captures,1);assert.equal(created,1);});
await check('late authorization is not captured',async()=>{s.expires_at=new Date(Date.now()-10000).toISOString();payments=[payment({status:'authorized'})];await status();assert.equal(captures,0);assert.equal(invites,0);assert.equal(created,0);});
await check('late captured payment is flagged for refund, not access',async()=>{s.expires_at=new Date(Date.now()-10000).toISOString();payments=[payment()];assert.equal((await status()).data.status,'refund_required');assert.equal(invites,0);assert.equal(created,0);});
await check('payment begun before expiry may settle afterward',async()=>{s.expires_at=new Date(Date.now()-10000).toISOString();payments=[payment({created_at:Math.floor(Date.now()/1000)-20})];assert.equal((await status()).data.status,'completed');});
await check('refunded payment grants no account',async()=>{payments=[payment({amount_refunded:29970})];await status();assert.equal(invites,0);assert.equal(created,0);});
await check('Auth failure preserves paid status for retry',async()=>{payments=[payment()];inviteFailure=true;assert.equal((await status()).status,400);assert.equal(s.status,'paid');inviteFailure=false;assert.equal((await status()).data.status,'completed');assert.equal(finishes,1);});
await check('existing students are never invited or recreated',async()=>{s.user_id='existing';account='existing';payments=[payment()];await status();assert.equal(invites,0);assert.equal(finishes,1);});
await check('client-provided amount is ignored on order creation',async()=>{const result=await call({action:'create',email:'student@example.test',name:'Student',phone:'9999999999',password:'test-password',course:'Marketing Management',referral:'https://example.test/?ref=referrer',amount:1});assert.equal(result.status,200);assert.equal(result.data.amountPaise,29970);assert.equal(invites,0);assert.match(result.data.checkoutUrl,/checkout.html#/);assert.doesNotMatch(JSON.stringify(result.data),/test-password/);});
await check('chosen password is imported only after captured payment',async()=>{passwordHash='$2a$12$fixture';await status();assert.equal(created,0);payments=[payment()];assert.equal((await status()).data.status,'completed');assert.equal(created,1);assert.equal(invites,0);assert.equal(resends,0);});
await check('activation failure retries without creating another account or cashback',async()=>{passwordHash='$2a$12$fixture';payments=[payment()];emailFailure=true;assert.equal((await status()).status,400);assert.equal(created,1);assert.equal(finishes,0);emailFailure=false;assert.equal((await status()).data.status,'completed');assert.equal(created,1);assert.equal(finishes,1);});
await check('webhook validates HMAC and survives repeated delivery',async()=>{
 payments=[payment()];const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:payments[0]}}});
 const webhook=async(sig)=>handler(new Request('https://test.supabase.co/functions/v1/razorpay-checkout?webhook=1',{method:'POST',headers:{'x-razorpay-signature':sig},body:raw}));
 assert.equal((await webhook('bad')).status,401);assert.equal(invites,0);
 assert.equal((await webhook(signature(raw))).status,200);assert.equal((await webhook(signature(raw))).status,200);assert.equal(finishes,1);assert.equal(created,1);
});
await check('SMTP is never called for paid password signups',async()=>{emailFailure=false;client.auth.resend=async()=>{throw Error('Must not send mail');};client.auth.admin.inviteUserByEmail=async()=>{throw Error('Must not invite');};payments=[payment()];assert.equal((await status()).data.status,'completed');assert.equal(created,1);assert.equal(invites,0);assert.equal(resends,0);});
await check('legacy checkout without a password cannot silently create an unusable account',async()=>{passwordHash=null;payments=[payment()];assert.equal((await status()).status,400);assert.equal(s.status,'paid');assert.equal(created,0);});
for(const name of ['assets/payment-client.js','assets/checkout-page.js'])new vm.Script(await fs.readFile(new URL('../'+name,import.meta.url),'utf8'));
console.log(`${passed.length} payment gateway checks passed (mocked Razorpay and Supabase).`);
