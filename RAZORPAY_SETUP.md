# Razorpay setup — follow this order

The implementation is local. No keys were installed, no migration was applied to the live Supabase project, and no real payment has been taken. Start with **Test Mode**, then switch to Live after the checks below pass.

## 1. Choose the website URL

Publish the website to a public HTTPS address. `SITE_URL` must be the full main-page URL, `https://www.theindianskills.com/THE_INDIAN_SKILLS.html`. `checkout.html` must be in the same directory. A phone scanning a QR cannot open your computer's `127.0.0.1` URL. For testing use a separate public staging site and preferably a separate Supabase project.

## 2. Apply the database update

In Supabase → SQL Editor, apply the migrations in order if not already applied:

1. `202609130001_tis_repair.sql` (existing base migration; do not rerun if already installed).
2. `202609170001_referral_discount_70.sql`.
3. **`202609170002_razorpay_checkout.sql`**.
4. **`202609190001_admin_signup_requests.sql`**.
5. **`202609190002_referral_auth_foreign_keys.sql`** (align legacy referral foreign keys with Auth user IDs).
6. **`202609190003_signup_passwords.sql`** (private bcrypt staging for passwords chosen at signup).
7. **`202609200001_admin_confirmation.sql`** (atomic account confirmation on administrator approval).

The third migration adds private payment sessions, fixed server pricing, automatic course approval and idempotent referral cashback. The fourth also permits account creation after an authenticated administrator approves a pending signup. Public requests create only a `pending_users` row. A private, administrator-issued capability permits the backend invitation; it is removed before Auth metadata is saved. Approval creates the course enrollment, links My Team, and credits a valid referrer once through the existing approval ledger. Unpaid approval records zero collected revenue. Existing users, course access and recorded prices are preserved. Do not reapply the old root SQL files or base-only deploy script afterward.

## 3. Configure Supabase Auth

- Disable **Allow new users to sign up** in Auth configuration. Existing users can still sign in; the backend creates new users after captured payment or administrator approval. The public signup-request function does not call Auth signup. The database blocks account creation without either authorization.
- Keep email/password login enabled, anonymous sign-ins disabled, and email confirmation enabled.
- Paid password signups are confirmed by the backend after captured payment. No verification/invitation email or SMTP is needed for this flow. SMTP is still needed for email-based forgotten-password recovery.
- Set Auth Site URL and allowed redirect URL to the exact `SITE_URL`. Test paid signup and password login before going live.

New students choose a password in the signup form. Only its bcrypt hash is stored in a private table until verified payment or admin approval permits account creation. Paid checkout creates the account with email_confirm:true and sends no verification email. The email address is a login identifier; ownership of that mailbox is not verified. Manual approval confirms the account without email and preserves the signup password; see ADMIN_SIGNUP_SETUP.md for legacy password-less requests. An existing student's purchase attaches to the authenticated account without changing their password.

## 4. Add Edge Function secrets

For local browser testing, optionally set `ALLOWED_ORIGINS` to `http://127.0.0.1:5501,http://localhost:5501`. Deploy the current `razorpay-checkout` and `request-signup` code first. Each configured origin is matched exactly; other origins remain rejected. Keep `SITE_URL` as the intended invitation/checkout destination. Without this setting, a local browser is blocked when `SITE_URL` points at production.

In Supabase → Edge Functions → Secrets, add:

| Name | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay **Test Mode** Key ID initially |
| `RAZORPAY_KEY_SECRET` | Matching Test Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | A new long random secret; use the identical value in Razorpay webhook settings |
| `SITE_URL` | `https://www.theindianskills.com/THE_INDIAN_SKILLS.html` |

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the deployed function. Never put any secret in HTML, frontend config, chat or Git. The browser receives only Razorpay's public Key ID when opening a valid session.

## 5. Deploy the function

From a Supabase CLI linked to the intended project:

```sh
supabase functions deploy razorpay-checkout --project-ref rhcddqqoajcejtuzaquc --no-verify-jwt
supabase functions deploy request-signup --project-ref rhcddqqoajcejtuzaquc --no-verify-jwt
supabase functions deploy approve-pending-user --project-ref rhcddqqoajcejtuzaquc --no-verify-jwt
```

For a staging project, replace the project reference and point `assets/supabase-config.js` at that project. Deploy from the repository so `supabase/functions/_shared/payment-rules.ts` is included. JWT verification is disabled at the gateway because new buyers have no account; this function verifies authenticated upgrade tokens, unguessable checkout tokens and signed Razorpay webhooks itself.

Publish `THE_INDIAN_SKILLS.html`, `assets/payment-client.js`, and `admin.js` only after the migration and both signup/approval functions are deployed. The signup form now offers **Sign up without payment — Request admin approval** alongside payment link and QR checkout. Requests appear in the existing admin panel's pending-signup list. Manual approval requires neither Razorpay secrets nor verification email delivery. Deploy the latest admin-confirmation migration and approval function together.

Test an unpaid request before approval (no Auth account, course, or cashback), approve it, sign in with the password chosen at signup, then confirm Marketing Management opens its PDF and the referrer sees the student in My Team and exactly ₹125 in wallet/earnings. Retry approval and verify no duplicate credit. Also request approval, then pay before approval: completed payment removes the matching request from the pending list and grants the course/reward once. If approval has started, checkout is blocked until provisioning completes; if an older payment settles after manual approval already granted the course, it is flagged `refund_required` for operator review.

## 6. Configure Razorpay

In the same Test Mode as your keys:

- Configure **manual payment capture**. The backend captures only payments initiated within the session's validity window (QR: six minutes; Payment Link: 24 hours). Do not enable automatic capture of late payments.
- Enable the payment methods available for your merchant account. Razorpay decides which UPI apps, cards, wallets and net banking options can appear for each device. The site does not manufacture app buttons or merchant offers.
- Create an active webhook pointing to:

```text
https://rhcddqqoajcejtuzaquc.supabase.co/functions/v1/razorpay-checkout?webhook=1
```

- Use the same `RAZORPAY_WEBHOOK_SECRET`; subscribe to **`payment.authorized`**, **`payment.captured`** and **`order.paid`**. Change the project hostname if using staging.
- Check successful webhook deliveries. Webhooks finish account creation even if the browser closes; failed processing returns an error so Razorpay can retry.

## 7. Publish and test

Publish the updated main HTML, `checkout.html`, `assets/payment-client.js`, `assets/checkout-page.js`, `assets/vendor/qrcode-1.4.4.js`, the existing assets and config. Backend functions/SQL stay in Supabase. Do not publish `.env` or local administrative files.

Test all of these in Test Mode:

1. New email → choose a course → Payment Link → Razorpay successful test payment → Auth account created → approved enrollment → invitation email → password setup → login/course access, with no admin action.
2. Before payment, and after failure/cancellation, verify no new Auth account exists.
3. Valid referral: ₹999 → ₹299.70; ₹2,499 → ₹749.70; ₹5,000 → ₹1,500; ₹10,000 → ₹3,000; ₹15,000 → ₹4,500. Invalid/self referrals must fail; no referral means full price.
4. QR → scan with a **phone camera** → same checkout session/course/amount → payment → original browser detects success. This is a website-link QR, not a UPI-app scan QR.
5. Wait six minutes. The QR disappears and the backend rejects new checkout opens. Start a fresh session only after checking that the previous one was not paid.
6. Close the original browser during payment, then verify webhook completion. Repeated webhook delivery must not duplicate accounts, enrollments or ₹125 referral cashback.
7. Test an existing student's new course, a declined payment, SMTP failure/recovery and an expired session.

### Expiry and delayed payments

The QR points to an expiring checkout session; it is not the Razorpay Payment Links API. A six-minute session stops new opens on the server and closes the browser checkout. Razorpay Orders themselves cannot be cancelled by this countdown. A payment **initiated before expiry** can settle afterward and is still honored. A new authorization initiated after expiry is not captured by this backend. If a late payment is nevertheless captured (for example due to incorrect automatic-capture settings), the session is marked `refund_required`, no access is granted, and the operator must reconcile/refund it in Razorpay. Do not interpret hiding a QR image as cancellation of a banking transaction already in progress.

### Operational recovery

- `created`: unpaid/pending; expiry applies.
- `paid`: captured payment recorded; account creation or enrollment finalization may need retry. The signed webhook retry or **Check payment status** resumes it. Never request another payment.
- `completed`: account/enrollment activated; repeat verification has no effect.
- `refund_required`: late capture or duplicate-course conflict; investigate/refund in Razorpay and contact the student. This is a payment exception, not normal account approval.

Use Supabase's private `tis_payment_sessions` table and function logs to investigate. Never expose the table to the browser. Check Auth/function logs for incomplete account activation. Legacy paid checkouts without a staged password need support-assisted password setup; never pay again. Avoid deleting paid sessions. Guest checkout creation is limited per email and observed IP; monitor public endpoint abuse before scaling traffic.

## 8. Go live

After the end-to-end checks pass and Razorpay account activation is complete, replace both Razorpay keys with the matching **Live Mode** keys. Configure the webhook and manual capture settings separately in Live Mode. Verify a real small purchase and its account/password-login/access flow. Keys alone do not deploy the integration.

## Local verification

```sh
node tests/regression.mjs
node tests/payment-gateway.mjs
node tests/payment-database.mjs
node tests/checkout-page.mjs
```

Node 24+ is used for the TypeScript payment-rule tests. The database runner imports the existing local `@electric-sql/pglite` 0.5.8 package at `.local/pglite-test/package/dist/index.js`; supply that package at this path on a new checkout before running it. These are local/mocked checks, not verification of live Razorpay, Supabase SMTP or mobile UPI behavior.

References: [Razorpay checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook verification](https://razorpay.com/docs/webhooks/validate-test/), [Supabase invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

## Payment login without verification email (20 September 2026)

Redeploy `razorpay-checkout` using `.local/deploy/razorpay-checkout-dashboard.ts` or the CLI above, then publish `assets/payment-client.js` and `assets/checkout-page.js`. No additional migration is required if the listed password-staging migrations are installed. Keep public signups disabled. Keep the global Confirm Email setting enabled: only the authorized backend confirms paid accounts. Already completed accounts from older deployments are not changed. A paid session still waiting on SMTP can retry Check payment status to activate its matching account without sending email.

## Separate Payment Link / QR validity

Apply `supabase/migrations/202609200006_checkout_method_expiry.sql` after the existing password migration, then redeploy the regenerated `razorpay-checkout` function. Publish `THE_INDIAN_SKILLS.html`, `checkout.html`, `assets/payment-client.js`, `assets/checkout-page.js`, `assets/supabase-config.js`, and `assets/vendor/qrcode-1.4.4.js`. Verify the public `/checkout.html` URL loads (without a session it should show Invalid payment link, never Vercel 404) before testing. Payment Link navigates straight to the checkout page; QR stays in the modal and encodes that page URL. Existing sessions keep their old expiry; use a fresh session to test. Admin approval is unchanged.
