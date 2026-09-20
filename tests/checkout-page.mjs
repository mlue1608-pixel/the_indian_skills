import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/dev-server.mjs';
const source=await fs.readFile(new URL('../assets/checkout-page.js',import.meta.url),'utf8');
async function setup(overrides={}){
 const nodes=new Map(),calls=[],intervals=[];let options,closed=0,fail=false;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:true});return nodes.get(id);};
 const data={id:'session',course:'Marketing Management',originalPaise:99900,amountPaise:29970,status:'created',expiresAt:new Date(Date.now()+360000).toISOString(),serverNow:Date.now(),...overrides};
 const context=vm.createContext({document:{getElementById:node},location:{hash:'#id=session&token=secret'},URLSearchParams,Date,AbortSignal,
  window:{TIS_CONFIG:{supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public'},addEventListener(){}},
  setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},
  fetch:async(url,request)=>{const body=JSON.parse(request.body);calls.push(body);if(fail)throw Error('Connection lost');return Response.json({...data,...body.action==='open'?{key:'rzp_test_demo',orderId:'order_test'}:{}});},
  Razorpay:class {constructor(value){options=value;}on(){}open(){}close(){closed++;options.modal.ondismiss();}}
 });
 await vm.runInContext(source,context);
 return {node,calls,data,intervals,get options(){return options;},get closed(){return closed;},setFail(value){fail=value;}};
}
let ui=await setup();assert.equal(ui.node('amount').textContent,'₹299.70');assert.match(ui.node('discount').textContent,/70%/);assert.equal(ui.node('pay').disabled,false);
await ui.node('pay').onclick();assert.equal(ui.options.order_id,'order_test');assert.equal(ui.options.amount,29970);assert.ok(ui.options.timeout<=360);
assert.equal(ui.calls.at(-1).amount,undefined,'Browser cannot choose price');
ui.data.status='completed';await ui.options.handler({razorpay_order_id:'order_test',razorpay_payment_id:'pay_test',razorpay_signature:'signature'});
assert.equal(ui.calls.at(-1).action,'verify');assert.match(ui.node('status').textContent,/Payment successful/);assert.equal(ui.node('pay').disabled,true);
ui=await setup({method:'Payment Link',expiresAt:new Date(Date.now()+86400000).toISOString()});await ui.node('pay').onclick();assert.equal(ui.options.timeout,undefined);assert.match(ui.node('countdown').textContent,/Payment link/);
ui=await setup({expiresAt:new Date(Date.now()-1000).toISOString(),status:'expired'});assert.equal(ui.node('pay').disabled,true);assert.match(ui.node('countdown').textContent,/expired/);
ui=await setup();await ui.node('pay').onclick();ui.data.expiresAt=new Date(Date.now()-1000).toISOString();ui.options.modal.ondismiss();await ui.node('check').onclick();assert.equal(ui.node('pay').disabled,true);
ui=await setup();ui.setFail(true);await ui.node('check').onclick();assert.match(ui.node('status').textContent,/Connection lost/);assert.equal(ui.node('check').disabled,false);
ui=await setup({status:'paid'});assert.match(ui.node('status').textContent,/do not pay again/);assert.equal(ui.node('pay').disabled,true);
ui=await setup({status:'refund_required'});assert.match(ui.node('status').textContent,/support review/);assert.equal(ui.node('pay').disabled,true);
const qrContext=vm.createContext({});vm.runInContext(await fs.readFile(new URL('../assets/vendor/qrcode-1.4.4.js',import.meta.url),'utf8'),qrContext);
const svg=vm.runInContext(`(()=>{const qr=qrcode(0,'M');qr.addData('https://www.theindianskills.com/checkout.html#id=11111111-1111-4111-8111-111111111111&token=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaabbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');qr.make();return qr.createSvgTag({cellSize:4,margin:16,scalable:true});})()`,qrContext);
assert.match(svg,/<svg/);assert.match(svg,/<path/);
const server=await startServer(0);
try{
 for(const path of ['checkout.html','assets/checkout-page.js','assets/payment-client.js','assets/vendor/qrcode-1.4.4.js']){
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/'+path);
  assert.equal(response.status,200,path+' must be served');
 }
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/.env');assert.equal(response.status,404);
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('Checkout UI checks passed: fixed referral amount, server order, signed verification handoff, expiry, cancellation, retry, paid/refund states and local QR rendering. Browser/device end-to-end testing remains required.');
