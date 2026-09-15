import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
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
  const {pendingId}=await request.json();if(!pendingId)return json({error:'pendingId required.'},400);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:pending,error}=await admin.from('pending_users').select('*').eq('id',pendingId).single();
  if(error||!pending)return json({error:'Signup not found.'},404);
  if(pending.status==='approved')return json({success:true});
  if(pending.status!=='pending')return json({error:'Signup is not pending.'},409);
  let userId: string | undefined;
  for(let page=1;;page++){
   const {data,error:listError}=await admin.auth.admin.listUsers({page,perPage:1000});if(listError)throw listError;
   userId=data.users.find(account=>account.email?.toLowerCase()===pending.email.trim().toLowerCase())?.id;
   if(userId||data.users.length<1000)break;
  }
  if(!userId){
   const {data,error:inviteError}=await admin.auth.admin.inviteUserByEmail(pending.email,{redirectTo:Deno.env.get('SITE_URL'),data:{full_name:pending.full_name,phone:pending.phone}});
   if(inviteError)throw inviteError;userId=data.user?.id;
  }
  if(!userId)throw Error('Unable to locate student Auth account.');
  const {error:approvalError}=await client.rpc('tis_approve_legacy',{p_id:String(pendingId),p_user:userId});if(approvalError)throw approvalError;
  return json({success:true,userId});
 }catch(error){return json({error:error instanceof Error?error.message:'Approval failed.'},400);}
});
