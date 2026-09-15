import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Only POST requests are allowed.' }, 405);
  }

  try {
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: request.headers.get('Authorization') || '' } }
    });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Please sign in to submit a complaint.' }, 401);
    const { data: approval, error: approvalError } = await client.rpc('tis_approval_status');
    if (approvalError || !['approved', 'active'].includes(approval)) return json({ error: 'An approved account is required.' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 6 * 1024 * 1024) return json({ error: 'Attachment is too large.' }, 413);
    const formData = await request.formData();
    const fullName = String(formData.get('fullName') ?? '').trim();
    const phoneNumber = String(formData.get('phoneNumber') ?? '').trim();
    const issueCategory = String(formData.get('issueCategory') ?? '').trim();
    const problemDetails = String(formData.get('problemDetails') ?? '').trim();
    const screenshot = formData.get('screenshot');
    const screenshotName = String(formData.get('screenshotName') ?? 'No screenshot uploaded').trim() || 'No screenshot uploaded';

    if (!fullName || !phoneNumber || !issueCategory || !problemDetails) {
      return json({ error: 'Full name, phone number, category, and problem details are required.' }, 400);
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (fullName.length > 100 || phoneNumber.length > 30 || issueCategory.length > 100 || problemDetails.length > 10000) return json({ error: 'Complaint details exceed the allowed length.' }, 400);
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev';

    if (!apiKey) {
      return json({ error: 'Email service is not configured on the server.' }, 500);
    }

    let attachment = null;
    if (screenshot && screenshot instanceof File) {
      if (screenshot.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(screenshot.type)) return json({ error: 'Use a PNG, JPEG, or WebP screenshot up to 5 MB.' }, 400);
      const bytes = new Uint8Array(await screenshot.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const base64 = btoa(binary);
      attachment = {
        filename: screenshot.name || screenshotName,
        content: base64
      };
    }

    const html = `
      <h2>New Complaint Submitted</h2>
      <p><strong>Full Name:</strong> ${escapeHtml(fullName)}</p>
      <p><strong>Phone Number:</strong> ${escapeHtml(phoneNumber)}</p>
      <p><strong>Issue Category:</strong> ${escapeHtml(issueCategory)}</p>
      <p><strong>Problem Details:</strong></p>
      <p>${escapeHtml(problemDetails).replace(/\n/g, '<br>')}</p>
      <p><strong>Screenshot:</strong> ${escapeHtml(screenshotName)}</p>
    `;

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        reply_to: user.email,
        to: ['admin8controls@gmail.com'],
        subject: `Complaint: ${issueCategory} - ${fullName}`,
        html,
        text: [
          `Full Name: ${fullName}`,
          `Phone Number: ${phoneNumber}`,
          `Issue Category: ${issueCategory}`,
          '',
          'Problem Details:',
          problemDetails,
          '',
          `Screenshot: ${screenshotName}`
        ].join('\n'),
        ...(attachment ? { attachments: [attachment] } : {})
      })
    });

    const emailData = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) {
      console.error('[Complaint Email Error]', emailData);
      return json({ error: emailData?.message || 'Failed to send the email.' }, 500);
    }

    return json({ success: true, message: 'Complaint email sent successfully.', emailId: emailData.id || null });
  } catch (error) {
    console.error('[Complaint Function Error]', error);
    return json({ error: error instanceof Error ? error.message : 'Complaint submission failed.' }, 500);
  }
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
