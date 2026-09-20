import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {normalizeReferral,matchesPayment,beganBeforeExpiry,canOpen,sha256,validSignature} from '../_shared/payment-rules.ts';

const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw Error('Payment setup is incomplete.');return value;};
const db=()=>createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
async function razor(path:string,body?:unknown){
 const response=await fetch('https://api.razorpay.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(required('RAZORPAY_KEY_ID')+':'+required('RAZORPAY_KEY_SECRET')),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Payment provider request failed. Please retry checking payment status.');
 return response.json();
}
async function rpc(client:any,name:string,args:any){const {data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data;}
async function update(client:any,id:string,values:any,status?:string){
 let query=client.from('tis_payment_sessions').update(values).eq('id',id);if(status)query=query.eq('status',status);
 const {error}=await query;if(error)throw error;
}
async function row(client:any,id:string){const {data,error}=await client.from('tis_payment_sessions').select('*').eq('id',id).single();if(error||!data)throw Error('Payment session unavailable.');return data;}
async function provision(client:any,s:any){
 if(s.status!=='paid')return;
 let userId=await rpc(client,'tis_checkout_account',{p_session:s.id});
 const passwordHash=await rpc(client,'tis_signup_password',{p_kind:'checkout',p_id:s.id});
 if(!userId){
  if(!passwordHash)throw Error('Payment received. Contact support to finish password setup; do not pay again.');
  const metadata={full_name:s.full_name,phone:s.phone,paid_checkout_id:s.id};
  const {data,error}=await client.auth.admin.createUser({email:s.email,password_hash:passwordHash,email_confirm:true,user_metadata:metadata});
  if(error){userId=await rpc(client,'tis_checkout_account',{p_session:s.id});if(!userId)throw Error('Payment received. Account setup will retry; do not pay again.');}
  else userId=data.user.id;
 }
 if(passwordHash&&!s.user_id){
  // Also recover accounts created by the previous version before SMTP failed.
  // The service-only lookup above restricts this ID to this paid checkout.
  const {error}=await client.auth.admin.updateUserById(userId,{email_confirm:true});
  if(error)throw Error('Payment received. Account activation will retry; do not pay again.');
 }
 await rpc(client,'tis_checkout_finish',{p_session:s.id,p_user:userId});
}
async function reconcile(client:any,s:any,paymentId?:string){
 if(s.status==='completed'||s.status==='refund_required')return s;
 if(s.status==='paid'){await provision(client,s);return row(client,s.id);}
 if(!s.order_id)return s;
 const payments=paymentId?[await razor('payments/'+encodeURIComponent(paymentId))]:(await razor('orders/'+s.order_id+'/payments')).items||[];
 for(let payment of payments){
  if(!matchesPayment(s,payment))throw Error('Payment does not match this order.');
  // Orders have no six-minute cancellation API. Only capture payments initiated within the session.
  if(payment.status==='authorized'&&beganBeforeExpiry(s,payment)){
   try {payment=await razor('payments/'+payment.id+'/capture',{amount:s.amount_paise,currency:'INR'});}
   catch {payment=await razor('payments/'+payment.id);}
  }
  if(payment.status!=='captured'||payment.amount_refunded>0)continue;
  if(!beganBeforeExpiry(s,payment)){
   await update(client,s.id,{status:'refund_required',payment_id:payment.id,paid_at:new Date().toISOString()},'created');
   return row(client,s.id);
  }
  await update(client,s.id,{status:'paid',payment_id:payment.id,paid_at:new Date().toISOString()},'created');
  s=await row(client,s.id);await provision(client,s);return row(client,s.id);
 }
 return row(client,s.id);
}
function publicSession(s:any){return {id:s.id,course:s.course,originalPaise:s.original_paise,amountPaise:s.amount_paise,
 method:s.checkout_method,expiresAt:s.expires_at,status:s.status==='created'&&!canOpen(s)?'expired':s.status,serverNow:Date.now(),newAccount:!s.user_id};}

Deno.serve(async request=>{
 let origin='';try {origin=new URL(required('SITE_URL')).origin;}catch{}
 const incoming=request.headers.get('Origin');
 const allowedOrigins=new Set([origin,...(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(value=>value.trim()).filter(Boolean)]);
 const headers={'Access-Control-Allow-Origin':incoming&&allowedOrigins.has(incoming)?incoming:origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return json({error:'POST required'},405);
 if(incoming&&!allowedOrigins.has(incoming))return json({error:'Origin not allowed'},403);
 try {
  if(Number(request.headers.get('content-length')||0)>16384)return json({error:'Request too large'},413);
  const raw=await request.text();if(raw.length>16384)return json({error:'Request too large'},413);
  const client=db();
  if(new URL(request.url).searchParams.get('webhook')==='1'){
   if(!await validSignature(raw,request.headers.get('x-razorpay-signature')||'',required('RAZORPAY_WEBHOOK_SECRET')))return json({error:'Invalid signature'},401);
   const event=JSON.parse(raw);
   if(!['payment.authorized','payment.captured','order.paid'].includes(event.event))return json({ok:true});
   const payment=event.payload?.payment?.entity;if(!payment?.order_id)return json({ok:true});
   const {data,error}=await client.from('tis_payment_sessions').select('*').eq('order_id',payment.order_id).maybeSingle();if(error)throw error;
   if(data)await reconcile(client,data,payment.id);
   return json({ok:true});
  }
  const input=JSON.parse(raw);
  if(input.action==='create'){
   required('RAZORPAY_KEY_ID');required('RAZORPAY_KEY_SECRET');required('RAZORPAY_WEBHOOK_SECRET');
   let user:any=null;
   if(input.accessToken){const {data,error}=await client.auth.getUser(input.accessToken);if(error||!data.user?.email_confirmed_at)return json({error:'Please sign in again.'},401);user=data.user;}
   const email=String(user?.email||input.email||'').trim().toLowerCase(),name=String(input.name||'').trim(),phone=String(input.phone||'').trim();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>120||!/^\+?[0-9 ()-]{8,20}$/.test(phone))throw Error('Enter a valid name, email and phone number.');
   const token=crypto.randomUUID()+crypto.randomUUID();
   const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
   if(!user&&(typeof input.password!=='string'||input.password.length<6||new TextEncoder().encode(input.password).length>72))throw Error('Password must be at least 6 characters and at most 72 UTF-8 bytes.');
   const session=await rpc(client,'tis_checkout_create_for_method',{p_email:email,p_name:name,p_phone:phone,p_course:String(input.course||''),p_referral:normalizeReferral(input.referral),p_user:user?.id||null,p_hash:await sha256(token),p_ip:await sha256(ip),p_password:user?null:input.password,p_method:input.method||'Payment Link'});
   const order=await razor('orders',{amount:session.amount_paise,currency:'INR',receipt:session.id,notes:{checkout_id:session.id}});
   await update(client,session.id,{order_id:order.id});
   const checkoutUrl=new URL('checkout.html',required('SITE_URL'));checkoutUrl.hash=new URLSearchParams({id:session.id,token}).toString();
   return json({...publicSession(session),token,checkoutUrl:checkoutUrl.href});
  }
  if(!/^[0-9a-f-]{36}$/i.test(input.id||'')||typeof input.token!=='string'||input.token.length>100)throw Error('Invalid payment link.');
  let session=await row(client,input.id);
  if(await sha256(input.token)!==session.token_hash)return json({error:'Invalid payment link.'},403);
  if(input.action==='status'){
   session=await reconcile(client,session);return json(publicSession(session));
  }
  if(input.action==='open'){
   if(!canOpen(session))throw Error('Payment session expired or already paid. Check payment status.');
   if(!session.order_id)throw Error('Order is not ready. Please try again.');
   return json({...publicSession(session),key:required('RAZORPAY_KEY_ID'),orderId:session.order_id});
  }
  if(input.action==='verify'){
   if(input.orderId!==session.order_id||!/^pay_[A-Za-z0-9]+$/.test(input.paymentId||'')||
    !await validSignature(session.order_id+'|'+input.paymentId,String(input.signature||''),required('RAZORPAY_KEY_SECRET')))return json({error:'Invalid payment signature.'},403);
   session=await reconcile(client,session,input.paymentId);return json(publicSession(session));
  }
  return json({error:'Unknown action'},400);
 }catch(error){
  // Do not log request bodies, bearer tokens or checkout link secrets.
  console.error('Razorpay checkout failed:',error instanceof Error?error.message:'unknown');
  return json({error:error instanceof Error?error.message:'Unable to process payment.'},new URL(request.url).searchParams.has('webhook')?500:400);
 }
});
