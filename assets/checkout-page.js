(async function(){
 'use strict';
 const node=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
 const credentials={id:params.get('id'),token:params.get('token')};
 const money=paise=>'₹'+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 let session,checkout,busy=false,timer,poll,offset=0;
 async function api(action,extra={}){
  const response=await fetch(window.TIS_CONFIG.supabaseUrl+'/functions/v1/razorpay-checkout',{method:'POST',headers:{'Content-Type':'application/json',apikey:window.TIS_CONFIG.supabasePublishableKey},body:JSON.stringify({action,...credentials,...extra}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to check payment.');return data;
 }
 function render(data){
  session=data;offset=data.serverNow-Date.now();node('course').textContent=data.course;node('amount').textContent=money(data.amountPaise);
  node('discount').textContent=data.amountPaise<data.originalPaise?'70% referral discount · Original '+money(data.originalPaise):'Full course price';
  node('check').disabled=false;
  node('status').textContent=data.status==='completed'?'Payment successful! Your course is active. Sign in with your signup email and chosen password. No email verification is needed.':data.status==='paid'?'Payment received. Account setup is processing; do not pay again.':data.status==='refund_required'?'Payment needs support review. Do not pay again. Email support@theindianskills.com with reference '+data.id:data.status==='expired'?'This payment link has expired. Check payment status if you already paid.':'Ready to pay. Select Continue to payment to choose your payment app.';
  tick();
 }
 function tick(){if(!session)return;const seconds=Math.max(0,Math.ceil((Date.parse(session.expiresAt)-Date.now()-offset)/1000));
  node('countdown').textContent=session.status==='completed'?'Payment verified':seconds?(session.method==='QR Code'?'QR expires in ':'Payment link expires in ')+(seconds>=3600?Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m':Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')):'Session expired';
  node('pay').disabled=busy||!seconds||session.status!=='created';
  if(!seconds&&checkout){checkout.close();checkout=null;}
 }
 async function check(){if(busy)return;busy=true;try{render(await api('status'));}catch(error){node('status').textContent=error.message+' If money was deducted, check again; do not pay again.';}finally{busy=false;node('check').disabled=false;tick();}}
 node('check').onclick=check;
 node('pay').onclick=async()=>{
  if(busy)return;busy=true;tick();
  try{
   const data=await api('open');render(data);
   if(typeof Razorpay!=='function')throw Error('Razorpay could not load. Check your connection and try again.');
   checkout=new Razorpay({key:data.key,order_id:data.orderId,amount:data.amountPaise,currency:'INR',name:'The Indian Skills',description:data.course,
    ...(data.method==='Payment Link'?{}:{timeout:Math.max(1,Math.floor((Date.parse(data.expiresAt)-data.serverNow)/1000))}),theme:{color:'#126bce'},
    handler:async result=>{checkout=null;node('status').textContent='Verifying payment…';
     try{render(await api('verify',{orderId:result.razorpay_order_id,paymentId:result.razorpay_payment_id,signature:result.razorpay_signature}));}
     catch(error){node('status').textContent=error.message+' Check payment status; do not pay again.';}
     finally{busy=false;tick();}},
    modal:{ondismiss:()=>{checkout=null;busy=false;node('status').textContent='Checkout closed. Check status if payment was started.';tick();}}
   });
   checkout.on('payment.failed',()=>{node('status').textContent='Payment did not complete. You can retry while this session is valid.';});
   checkout.open();
  }catch(error){busy=false;node('status').textContent=error.message;tick();}
 };
 if(!credentials.id||!credentials.token){node('status').textContent='Invalid payment link. Start a payment from the website.';return;}
 await check();timer=setInterval(tick,1000);
 poll=setInterval(()=>{if(!busy&&session&&!['completed','refund_required'].includes(session.status)&&Date.now()+offset<Date.parse(session.expiresAt)+120000)check();},10000);
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(poll);});
})();
