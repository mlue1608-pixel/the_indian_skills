# Admin signup deployment

Changes are local; the live Supabase deployment must be updated below.

## Latest fix: approve without verification email

Students choose their password at signup. An unpaid request cannot log in before administrator approval. Approval activates the course, credits a valid referrer once, links My Team, and confirms the account in one database transaction. The chosen password remains unchanged. No email is sent by this approval flow.

1. In Supabase SQL Editor, run the entire `supabase/migrations/202609200001_admin_confirmation.sql` once. Earlier migrations through `202609190003_signup_passwords.sql` must already be installed. Do not rerun installed migrations.
2. Replace the entire `approve-pending-user` Edge Function `index.ts` with `.local/deploy/approve-pending-user-dashboard.ts` and Deploy.
3. Replace `request-signup` function `index.ts` with `.local/deploy/request-signup-dashboard.ts` and Deploy to update its response message.
4. Publish the updated `THE_INDIAN_SKILLS.html`, or hard-refresh it for local testing. Refresh the admin page as well.
5. Retry Approve on the existing pending request. Do not delete it or submit another signup. Accounts created during a previous email failure are recovered without changing their password.

No Razorpay redeployment or global Auth email setting change is needed for this fix. Paid checkout retains its email verification flow.

## First installation

Apply the migrations in the order listed in `RAZORPAY_SETUP.md`, ending with `202609200001_admin_confirmation.sql`. Deploy the three standalone copies for request-signup, approve-pending-user and razorpay-checkout. The repository config disables gateway JWT verification; approval verifies the caller and administrator permission inside the function. Keep the service-role key on the server only.

Set SITE_URL to the full website URL. For local signup testing set ALLOWED_ORIGINS to `http://127.0.0.1:5501,http://localhost:5501`. Publish THE_INDIAN_SKILLS.html, assets/payment-client.js, assets/checkout-page.js and admin.js. SMTP is still needed for paid-flow verification and password-reset emails, but not manual approval.

Passwords are staged only as private bcrypt hashes, imported through the Auth admin API, and removed from staging after completion. Repeated public submissions cannot replace an earlier password. A legacy request submitted without any saved password and without an existing Auth account needs an administrator-assisted password arrangement; approval reports that condition instead of sending an invitation or inventing a password.

## Verify after deployment

- Submit an unpaid signup with a chosen password and valid referral. Before approval it remains pending, with no login, course or reward.
- Approve, then sign in using that password without an email step. Open the selected course PDF.
- Check the referrer's My Team and exactly one INR 125 wallet/earnings credit. Retry approval and verify no duplicate credit.
- Retry a request that previously failed while sending verification email.

Local verification passed: database permissions, atomic rollback on confirmation failure, password preservation, course/referral consistency, 19 function checks and 35 frontend regression checks. Actual live sign-in remains to be checked after deployment.