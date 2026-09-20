(function () {
 'use strict';
 const money=paise=>'₹'+(paise/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 async function request(body){
  const response=await fetch(window.TIS_CONFIG.supabaseUrl+'/functions/v1/razorpay-checkout',{method:'POST',headers:{'Content-Type':'application/json',apikey:window.TIS_CONFIG.supabasePublishableKey},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Payment service unavailable.');return data;
 }
 function remember(session){try{sessionStorage.setItem('tis_payment',JSON.stringify(session));}catch{}}
 function forget(){try{sessionStorage.removeItem('tis_payment');}catch{}}
 let pollTimer,clockTimer,viewVersion=0;
 function close(){viewVersion++;clearTimeout(pollTimer);clearInterval(clockTimer);document.getElementById('gatewaySession')?.remove();}
 function display(session,method){
  method=session.method||method;
  close();
  const version=viewVersion;
  const modal=document.createElement('div');modal.id='gatewaySession';modal.className='paymentModal open';modal.style.zIndex='600';
  modal.innerHTML='<section class="paymentDialog" role="dialog" aria-modal="true" aria-labelledby="gatewayTitle"><button type="button" class="paymentCancel" id="gatewayClose">Close</button><h2 id="gatewayTitle">Complete your payment</h2><strong id="gatewayCourse"></strong><div id="gatewayAmount"></div><div id="gatewayDiscount"></div><div id="gatewayQr" style="text-align:center"></div><p id="gatewayCountdown" role="timer"></p><a id="gatewayLink" class="editBtn" target="_blank" rel="noopener noreferrer" style="text-align:center">Open secure payment page</a><p id="gatewayStatus" role="status">Your account is created only after payment is verified. Keep this window open to see the result.</p><button type="button" id="gatewayCheck" class="paymentCancel">Check payment status</button></section>';
  document.body.appendChild(modal);
  const node=id=>document.getElementById(id);
  node('gatewayClose').onclick=close;node('gatewayCourse').textContent=session.course;
  node('gatewayAmount').textContent='Amount to pay: '+money(session.amountPaise);
  node('gatewayDiscount').textContent=session.amountPaise<session.originalPaise?'70% referral discount applied. Original price: '+money(session.originalPaise):'Full course price';
  node('gatewayLink').href=session.checkoutUrl;
  if(method==='QR Code'){
   const qr=qrcode(0,'M');qr.addData(session.checkoutUrl);qr.make();
   node('gatewayQr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
   const svg=node('gatewayQr').querySelector('svg');svg.style.maxWidth='260px';svg.style.background='white';svg.setAttribute('aria-label','Scan with your phone camera to open the payment page');
   const hint=document.createElement('p');hint.textContent='Scan with your phone camera, then choose a payment app on the payment page.';node('gatewayQr').appendChild(hint);
  }
  let finished=false,busy=false;const offset=(session.serverNow||Date.now())-Date.now();
  const tick=()=>{const seconds=Math.max(0,Math.ceil((Date.parse(session.expiresAt)-Date.now()-offset)/1000));
   node('gatewayCountdown').textContent=finished?'':seconds?(method==='QR Code'?'QR expires in ':'Payment link expires in ')+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'Link expired. Check status if you already started a payment.';
   if(!seconds){node('gatewayQr').hidden=true;node('gatewayLink').hidden=true;}
  };
  const check=async()=>{
   if(busy||finished||!node('gatewayStatus'))return;busy=true;
   try{const data=await request({action:'status',id:session.id,token:session.token});
    if(version!==viewVersion||!node('gatewayStatus'))return;
    if(data.status==='completed'){
     finished=true;forget();clearInterval(clockTimer);node('gatewayCountdown').textContent='';node('gatewayQr').hidden=true;node('gatewayLink').hidden=true;node('gatewayCheck').hidden=true;
     node('gatewayStatus').textContent='Payment successful! Your course is active. Sign in with your signup email and chosen password. No email verification is needed. Existing students: reopen your dashboard.';
    }else if(data.status==='refund_required'){
     finished=true;node('gatewayStatus').textContent='Payment needs support review. Do not pay again. Contact support@theindianskills.com with reference '+session.id;
     node('gatewayQr').hidden=true;node('gatewayLink').hidden=true;
    }else node('gatewayStatus').textContent=data.status==='paid'?'Payment received. Setting up your account; do not pay again.':data.status==='expired'?'Session expired. If payment was started, use Check payment status before trying again.':'Waiting for verified payment. Do not close this window.';
   }catch(error){if(version===viewVersion&&node('gatewayStatus'))node('gatewayStatus').textContent=error.message+' Use Check payment status; do not pay again if money was deducted.';}
   finally{busy=false;if(version===viewVersion&&!finished&&node('gatewayStatus')&&Date.now()+offset<Date.parse(session.expiresAt)+120000)pollTimer=setTimeout(check,10000);}
  };
  node('gatewayCheck').onclick=()=>{clearTimeout(pollTimer);check();};tick();clockTimer=setInterval(tick,1000);pollTimer=setTimeout(check,10000);node('gatewayClose').focus();
 }
 async function start(details,method){
  if(method==='QR Code'&&typeof qrcode!=='function')throw Error('QR generator could not load. Refresh the page and try again.');
  const session=await request({action:'create',...details,method});session.method=method;remember(session);
  if(method==='Payment Link')window.location.assign(session.checkoutUrl);
  else display(session,method);
  return session;
 }
 async function requestApproval(details){
  const response=await fetch(window.TIS_CONFIG.supabaseUrl+'/functions/v1/request-signup',{method:'POST',
   headers:{'Content-Type':'application/json',apikey:window.TIS_CONFIG.supabasePublishableKey},
   body:JSON.stringify(details),signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Unable to submit signup request.');return data;
 }
 document.addEventListener('DOMContentLoaded',()=>{
  try{const session=JSON.parse(sessionStorage.getItem('tis_payment')||'null');if(!session?.token)return;
   const resume=document.createElement('button');resume.type='button';resume.textContent='Resume / check last payment';resume.className='editBtn';resume.style.cssText='position:fixed;bottom:18px;right:18px;z-index:500';
   resume.onclick=()=>display(session,'Payment Link');document.body.appendChild(resume);
  }catch{}
 });
 window.TISPayments={start,request,requestApproval,money};
})();
