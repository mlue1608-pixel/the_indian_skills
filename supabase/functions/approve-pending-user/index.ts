import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-app-name','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json = (body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async request => {
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({error:'POST required.'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!;
  const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}}});
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)return json({error:'Authentication required.'},401);
  const {error:accessError}=await client.rpc('tis_admin_dashboard');
  if(accessError)return json({error:'Administrator access required.'},403);
  const {pendingId}=await request.json();if(typeof pendingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pendingId))return json({error:'Valid pendingId required.'},400);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:pending,error}=await admin.from('pending_users').select('*').eq('id',pendingId).single();
  if(error||!pending)return json({error:'Signup not found.'},404);
  const finish=async(userId:string)=>{
   const {error}=await client.rpc('tis_finish_admin_signup',{p_id:String(pendingId),p_user:userId});if(error)throw error;
  };
  if(pending.status==='approved'){
   if(!pending.approved_user_id)throw Error('Approved signup has no linked account. Contact the administrator.');
   await finish(pending.approved_user_id);return json({success:true});
  }
  if(pending.status!=='pending')return json({error:'Signup is not pending.'},409);
  const {data:capability,error:beginError}=await client.rpc('tis_begin_signup_approval',{p_id:pendingId});
  if(beginError)throw beginError;
  if(!capability)return json({success:true});
  const account=async()=>{
   const {data,error}=await admin.rpc('tis_signup_account',{p_id:pendingId});if(error)throw error;return data;
  };
  let userId=await account();
  const {data:passwordHash,error:passwordError}=await admin.rpc('tis_signup_password',{p_kind:'pending',p_id:pendingId});
  if(passwordError)throw passwordError;
  if(!userId){
   if(!passwordHash)throw Error('This older request has no saved signup password. An administrator must arrange a password for this account before approval.');
   const metadata={full_name:pending.full_name,phone:pending.phone,approved_signup_id:pendingId,approval_token:capability};
   const {data,error:inviteError}=await admin.auth.admin.createUser({email:pending.email,password_hash:passwordHash,email_confirm:false,user_metadata:metadata});
   if(inviteError){userId=await account();if(!userId)throw Error('Account creation failed. Retry Approve; no course or cashback has been granted.');}
   else userId=data.user?.id;
  }
  if(!userId)throw Error('Unable to locate student Auth account.');
  await finish(userId);
  return json({success:true,userId});
 }catch(error){return json({error:error instanceof Error?error.message:(error as {message?:string})?.message||'Approval failed.'},400);}
});
