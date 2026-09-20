import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {normalizeReferral,sha256} from '../_shared/payment-rules.ts';

Deno.serve(async request=>{
 const origin=Deno.env.get('SITE_URL');
 let allowed='';try{allowed=origin?new URL(origin).origin:'';}catch{}
 const incoming=request.headers.get('Origin');
 const allowedOrigins=new Set([allowed,...(Deno.env.get('ALLOWED_ORIGINS')||'').split(',').map(value=>value.trim()).filter(Boolean)]);
 const headers={'Access-Control-Allow-Origin':incoming&&allowedOrigins.has(incoming)?incoming:allowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return json({error:'POST required'},405);
 if(!allowed)return json({error:'Signup setup is incomplete.'},503);
 if(incoming&&!allowedOrigins.has(incoming))return json({error:'Origin not allowed'},403);
 try{
  const raw=await request.text();if(raw.length>8192)return json({error:'Request too large'},413);
  const input=JSON.parse(raw);
  if(typeof input.password!=='string'||input.password.length<6||new TextEncoder().encode(input.password).length>72)throw Error('Password must be at least 6 characters and at most 72 UTF-8 bytes.');
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const {error}=await client.rpc('tis_request_signup_with_password',{p_email:String(input.email||'').trim().toLowerCase(),p_name:String(input.name||'').trim(),
   p_phone:String(input.phone||'').trim(),p_course:String(input.course||''),p_referral:normalizeReferral(input.referral),p_ip:await sha256(ip),p_password:input.password});
  if(error)throw error;
  return json({success:true,message:'Request submitted for administrator approval. You can sign in only after approval, using the same password you chose at signup. No verification email is required for admin approval.'});
 }catch(error){return json({error:error instanceof Error?error.message:(error as {message?:string})?.message||'Unable to submit signup request.'},400);}
});
