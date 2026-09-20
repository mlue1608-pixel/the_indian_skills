export function normalizeReferral(value: unknown): string {
 const raw=String(value||'').trim();
 try { const url=new URL(raw); return url.searchParams.get('ref')||url.searchParams.get('referral')||raw; } catch { return raw; }
}
export function matchesPayment(session: any,payment: any): boolean {
 return payment.order_id===session.order_id && payment.currency==='INR' &&
 payment.amount===session.amount_paise && typeof payment.id==='string' && /^pay_[A-Za-z0-9]+$/.test(payment.id);
}
export function beganBeforeExpiry(session: any,payment: any): boolean {
 return Number.isFinite(payment.created_at) && payment.created_at*1000<=Date.parse(session.expires_at);
}
export function canOpen(session: any,now=Date.now()): boolean {
 return session.status==='created' && now<Date.parse(session.expires_at);
}
export async function sha256(value: string): Promise<string> {
 return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
}
function hex(value: ArrayBuffer): string {return [...new Uint8Array(value)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function validSignature(body: string,signature: string,secret: string): Promise<boolean> {
 if(!/^[a-f0-9]{64}$/i.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(signature.match(/../g)!.map(v=>parseInt(v,16)));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(body));
}
