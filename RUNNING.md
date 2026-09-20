## Admin approval without email (September 20)

This supersedes the older email/invitation instructions below for manual approval. Apply `202609200001_admin_confirmation.sql`, deploy the current approve-pending-user and request-signup standalone files, and refresh the frontend. Signup passwords remain unchanged; account confirmation, course approval and referral credit commit together. Login is blocked before approval, and manual approval sends no email. Existing requests stalled by email failure can be retried. Paid checkout retains email verification. See [ADMIN_SIGNUP_SETUP.md](ADMIN_SIGNUP_SETUP.md). Local database, 19 function and 35 frontend checks passed; live deployment/sign-in remain unverified.

## Signup password and admin connection follow-up

The signup form now accepts a password. Apply `202609190003_signup_passwords.sql` after the referral foreign-key repair, redeploy the three current Edge Functions, then publish the frontend. New requests stage only a private bcrypt hash; after payment or approval the Auth admin API imports it and sends an email-verification link. Older pending requests without a password continue using invitation/password setup. Approval CORS now allows the `x-app-name` header sent by the admin client's shared fetch configuration. See [ADMIN_SIGNUP_SETUP.md](ADMIN_SIGNUP_SETUP.md) for the exact deployment order. Local database checks, 18 signup/approval function checks, 20 payment checks and 35 frontend regressions pass; live deployment/email/sign-in remain unverified.

## Paid signup and admin approval (September 19)

See [ADMIN_SIGNUP_SETUP.md](ADMIN_SIGNUP_SETUP.md) for deployment steps. Captured payment still creates the account automatically. The signup form also accepts an unpaid administrator-approval request; only approval permits account creation, course activation and the existing ₹125 referral reward/My Team link. Requests do not store passwords. Invitations let students set a password after payment or approval. Apply `202609190001_admin_signup_requests.sql` after the existing Razorpay migration, deploy `request-signup` and the updated `approve-pending-user`, then publish the changed frontend.

Validation passed locally: disposable PostgreSQL signup/referral/payment-conflict checks, the existing payment database suite with the new migration, 13 signup/approval Edge Function checks, 17 payment gateway checks and 35 frontend regressions. No live database migration, Auth account creation or email delivery was performed. This section supersedes the payment-only signup restriction described in the historical notes below.

## Razorpay payment integration (September 17)

See [RAZORPAY_SETUP.md](RAZORPAY_SETUP.md) for the required database migration, Edge Function, keys, SMTP, webhook and publishing steps. The new flow replaces manual QR/UPI/UTR collection with Payment Link and expiring checkout QR sessions. New Auth accounts are created only after verified captured payment. The historical approval/deployment notes below describe the older flow and do not apply to new Razorpay purchases. No live deployment was performed for this change.

## September 17 referral discount update

Apply `supabase/migrations/202609170001_referral_discount_70.sql` in the Supabase SQL editor after the base repair migration and before publishing the updated frontend. New referral enrollments pay 30% of the catalog price (70% off); existing enrollment amounts remain unchanged. This migration has not been applied to the live database in this session. The legacy deploy-supabase.ps1 script only applies the base repair; apply this new migration afterward.

# Run and deploy The Indian Skills

Serve this directory using VS Code Live Server, opening index.html or THE_INDIAN_SKILLS.html. Keep the same host and port for student/admin sessions. Publish both entry HTML files, admin.html, admin.js, connection-check.html, the complete assets directory, the existing images, and all five root-level course PDFs. Use HTTPS in production.

## All-account photo-token repair and prevention

The single-account repair reduced the first account's metadata to 242 bytes, but a second account then reported a 132095-byte login header. The next repair covers every affected account, including administrators, without changing IDs, passwords, roles, approvals or enrollment records.

1. Run the whole `supabase/migrations/202609140001_auth_photo_tokens.sql` in the configured project's Supabase SQL Editor. There are no email placeholders. It is one atomic statement, compatible with the earlier private photo archive; `Success. No rows returned` is expected.
2. Run `scripts/verify-all-auth-photos.sql` separately. Every account should show `OK: photo metadata clean` and `future_photo_protection = true`. Rows reporting `NEEDS REVIEW` have large non-photo metadata that is deliberately preserved and needs investigation; the photo repair does not silently discard unrelated account data.
3. Reload the current website and sign in. Student and admin pages refresh oversized saved tokens once before using them, allowing cleaned metadata to take effect. If fresh sign-in is still necessary, use the account's existing password. Pending/rejected accounts remain subject to the existing approval rules.

The migration installs a narrowly scoped `BEFORE INSERT OR UPDATE OF raw_user_meta_data` trigger on `auth.users`. It moves embedded `data:image/` values in `avatar`, `profile_picture`, `avatar_url`, and `picture` into the private archive before Auth reads them into new JWTs. Ordinary photo URLs and all other metadata are preserved. Its fixed-search-path security-definer function lets the Auth service archive photos without granting browser roles access to the archive. Current frontend uploads already stay in the browser. This also protects against older clients sending embedded photos again.

Validation: 9 disposable PostgreSQL checks passed, using the actual existing application migration and signup trigger. They cover bulk cleanup, admin/student access, valid new signup and pending enrollment, legacy profile updates, private archive permissions, safe reruns, rejected-signup rollback, conflicting-trigger rollback, and review of unrelated large metadata. The existing database authorization/payment regressions passed with the new trigger installed. Application, connection, and SDK regression suites also passed. The all-account migration has **not** been applied to the live project by the assistant; administrator access is not configured. The original deployment helper applies only the base migration, so this new migration must also be applied as described here (or through normal Supabase migration tooling).

## Browser connection diagnostics (latest follow-up)

### Authenticated header-size investigation

**SQL Editor reporting fix:** The first repair reported `42P01` for its temporary results table. That error alone does not establish whether an earlier update committed. The replacement at `.local/repair-auth-photo.sql` is a single atomic `DO` statement with no temporary table or manual transaction dependency. Run the whole updated file; `Success. No rows returned` is expected. Then separately run `.local/verify-auth-photo.sql`, which reads the current account metadata and reports its size and whether embedded photos remain. Both account-specific files are ignored by Git. The reusable templates are `scripts/repair-auth-photo.sql` and `scripts/verify-auth-photo.sql`.

The corrected SQL was executed successfully against a disposable PostgreSQL engine (PGlite), not the live project. All seven tests in `tests/auth-photo-repair.mjs` passed: targeted preservation, private archive access, repeat execution, independent verification, oversized remaining metadata, trigger-induced rollback, and invalid or ambiguous targets. The temporary test package is isolated under `.local/pglite-test`; it is not a website dependency. This supersedes the earlier note that SQL could not be tested locally. No live account repair has been applied by the assistant. After verification reports that photos are absent and metadata is small, sign in again to replace the old oversized token.

The browser subsequently reported an Authorization header of **250374 bytes**, confirming that the failed account request carries an oversized token. A targeted repair template is available at `scripts/repair-auth-photo.sql`; an account-specific copy is prepared in ignored `.local/repair-auth-photo.sql`. Run that complete account-specific file in the configured project's SQL Editor. It locks exactly one matching Auth user, archives embedded `avatar` and `profile_picture` values in a private schema with browser access revoked and RLS enabled, removes only those embedded photo keys, and reports metadata sizes. It rolls back if other metadata remains above 8192 bytes or a trigger changes the expected result. If no embedded photos exist, it leaves the account unchanged and reports that fact; use `scripts/inspect-auth-metadata.sql` to inspect field sizes without exposing their contents.

After a successful repair, use password sign-in again to obtain a newly issued token; refreshing the HTML alone retains the old token. The repair does not delete users or change passwords, roles, approvals, or enrollment records. Its photo backup is retained in `tis_auth_repair_archive.profile_photos`. This repair has been prepared and reviewed, **not executed**: no management credential, connected browser, or local PostgreSQL runtime is available in this session. Verify the SQL result and a real subsequent sign-in before marking the incident resolved.

The affected browser now reaches the `tis_is_admin` request but reports a transport failure. Both this request and the earlier `/auth/v1/user` failure carry a real account token; the passing public diagnostics use no real token. The cause is still unconfirmed.

Code inspection found that `saveProfile` was copying full base64 profile images into Auth `user_metadata.avatar`. Supabase includes user metadata in JWTs (https://supabase.com/docs/guides/auth/jwt-fields), so this can inflate every authenticated request header. New profile saves now send only the name in Auth metadata; selected photos remain in the existing per-user browser storage and take precedence over older server photo metadata. The UI states that photos are saved in this browser. Cross-device photo storage would require a separate Storage implementation.

On a failed trusted request the client now reports only the Authorization header's character count (ASCII JWT bytes), never its contents. The real SDK preserves this diagnostic in the account-role error. Values above 8192 bytes get an advisory, not a rejection; that value is a diagnostic heuristic, not a proven limit of this project's service. Actual header size and any affected account metadata must be confirmed before an account-specific backend repair. Existing metadata was not deleted, and the user's session was not cleared.

Validation: 27 application regressions, 6 connection diagnostic checks, and 5 real SDK checks passed. Tests cover keeping photos out of future Auth updates, preserving local photos, reporting only header sizes, signature validation, and propagation through a failed SDK RPC. Live authenticated recovery remains unverified.

### Login verification fix

The reported failure was the authenticated `GET /auth/v1/user` lookup during automatic restoration and again after password sign-in. A successful `signInWithPassword` result is now used directly, followed by the existing server-side role and approval checks. It no longer needs an extra `getUser` round trip. Fresh sign-in also waits for an in-progress restoration before initializing its new identity, so it cannot inherit that restoration's failure.

Saved-session and enrollment identity checks now use `auth.getClaims()` and derive identity from its verified claims, not cached `session.user` fields. The configured project currently publishes an ES256 key at `/auth/v1/.well-known/jwks.json`. The bundled SDK verifies asymmetric signatures and expiration with Web Crypto; older symmetric tokens or environments without Web Crypto still use the SDK's server verification fallback. If an older saved token still fails that fallback, a fresh password sign-in avoids the redundant lookup. No verification error grants access. Role, approval, and enrollment permissions remain enforced by the database.

This follows https://supabase.com/docs/reference/javascript/auth-getclaims. Validation: 26 application regression checks, 5 connection diagnostics checks, and 4 tests using the real bundled SDK with synthetic signed tokens passed. Signature tests cover a valid ES256 token without a user-endpoint request, tampered claims, expiration, and an unknown key whose server fallback rejects it. Live authenticated access from the affected browser remains unverified; the change avoids an unnecessary failing request but does not establish why that connection was interrupted.

If public checks pass but sign-in fails, the website now labels the failing operation: password sign-in, saved-session restoration, user verification, role lookup, or approval lookup. Share that full on-page message to identify the failing authenticated step. Network errors in these operations no longer send users back through the same public checks. Account verification and database approval remain required, and failures do not sign users out or grant dashboard access. Validation: 23 application regression checks and 5 connection diagnostic checks passed with mocked failures at each sign-in stage. The actual authenticated browser failure has not yet been reproduced here.

If sign-in reports an interrupted connection, open `http://127.0.0.1:5501/connection-check.html` in the same browser and click **Run checks**. The error banner also links to this page. It compares a basic fetch, a fetch with the public key, an Auth request with a deliberately invalid diagnostic bearer value, and the app's fetch wrapper. The Auth probe expects 401/403; it does not read a saved session, send account credentials, or perform writes. Share the displayed results, not request headers or login tokens. Passing checks establish current connectivity only; they do not verify a real authenticated session.

The latest command-line checks returned Auth settings 200, Auth preflight 200, and Auth-header probe 403 (expected rejection of the diagnostic bearer). Referral lookup now returns 200 and the student RPC returns 401 without a session, replacing the earlier missing-endpoint results recorded below. This is not verification of the entire migration or authenticated functionality. No database changes were made during this diagnosis.

The app now distinguishes its own request timeout from a dropped connection instead of attributing both to the user's network. Validation: 21 existing regression checks plus 5 new diagnostic checks passed; the diagnostic HTML and scripts returned HTTP 200 locally. No connected browser was available, so the failing user's browser still needs to run these checks.

## September 14 connection-error follow-up

Open `http://127.0.0.1:5501/THE_INDIAN_SKILLS.html` after starting Live Server on port 5501. Double-clicking the HTML file opens a `file://` page; the app now explains how to launch the HTTP page before initializing Supabase. The link preserves referral and password-recovery URL parameters. Moving to HTTP uses a different browser storage origin, so sign in again there.

The shared client now detects an offline device before sending a request. Overlapping student session restorations share one request sequence. A failed network verification preserves the stored session, keeps protected content closed, and offers Retry; verification and database approval must succeed before the dashboard opens.

Read-only checks on September 14 returned Auth settings **200**, CORS preflight **200**, anonymous enrollment read **401** (expected), and both `tis_resolve_referral` and `tis_my_enrollments` **404** (missing functions). The public URL and key work. The prepared migration below still needs deployment; no management token was configured, so the live database was not modified. A browser `ERR_CONNECTION_RESET` indicates an interrupted connection; using HTTP locally does not guarantee that remote connection resets disappear.

Validation: all **21** mocked regression checks passed, including local-file guidance, offline recovery, concurrent session restoration, and retry without signing out. The admin test fixture now explicitly initializes its mocked client. The updated local page returned HTTP 200. No connected browser was available for visual or authenticated end-to-end verification.

## Required backend deployment

The updated frontend requires supabase/migrations/202609130001_tis_repair.sql. **Deploy the migration before the updated frontend.** The migration has been prepared but has NOT been applied to the live project in this session.

1. Back up the configured project rhcddqqoajcejtuzaquc and test the migration in staging. Inspect existing public tables and auth.users triggers first: an unknown custom trigger, column type, or constraint may need a project-specific adjustment. The script preserves existing Auth IDs and enrollment rows; it replaces policies on the named application tables. It renames lowercase enrollments only when the capitalized table is absent. If both tables exist, reconcile them explicitly; it does not merge competing sources automatically.
2. Apply the migration through the Supabase SQL editor or a linked Supabase CLI. It creates the required RPCs, missing app tables/columns, owner/admin read policies, atomic signup enrollment trigger, approval ledger, and withdrawal transaction. Do not run the older root-level supabase_pending_approval.sql or supabase_enrollment_access.sql afterward: their policies conflict with this repair.
3. Run tests/database_regression.sql on staging. The tests create temporary Auth fixtures, check permissions, approval idempotency, discounts, and withdrawal reservation, and roll everything back. They have NOT been run against PostgreSQL in this session.
4. Deploy send-complaint-email and approve-pending-user from supabase/functions using the included config.toml. Both functions validate bearer tokens themselves through auth.getUser(). Set RESEND_API_KEY, RESEND_FROM_EMAIL to a verified sender, and SITE_URL to the full production THE_INDIAN_SKILLS.html URL. Keep service-role credentials exclusively in Edge Function secrets. Complaint mail goes to admin8controls@gmail.com; legacy invitations are sent only when the admin approves an account that does not yet exist in Auth.
5. Configure Supabase Auth Site URL and allowed redirects for the production page and exact local test URLs. Keep email confirmation enabled. Confirm the admin account email; administrator roles are controlled by the database, not user metadata.
6. Publish the frontend, then test a real student and administrator session. No user passwords or service-role secrets belong in frontend code.

## Behavior and existing records

New signup creates the Auth account and pending enrollment in one database transaction through an Auth trigger. When confirmation is enabled, signup does not need an authenticated session to save the enrollment. Students confirm their email and wait for admin approval. Existing Auth accounts continue using their existing email and password; no accounts or passwords are recreated. The displayed User ID is the full Auth UUID; the existing login form remains email-based.

Enrollment access recognizes approved/active records owned by the Auth UUID and legacy records with a null owner whose email matches the verified account. A conflicting non-null owner is not overridden. Such records need ownership review in Supabase. Accounts with approved courses can still sign in while an upgrade is pending. Legacy Auth accounts with no enrollment rows can sign in but receive no PDF entitlement. Orphan legacy enrollment rows without an Auth account require an administrator invitation/account link before approval.

Catalog prices remain ₹999, ₹2,499, ₹5,000, ₹10,000, and ₹15,000. Valid referrals receive the 70% discount, calculated in the database to two decimal places. Referral links use the full Auth UUID and work in subdirectory hosting. Older unique profile referral codes are accepted. Duplicate legacy codes are rejected as ambiguous. Approval credits a fixed ₹125 referral cashback once per enrollment. Historical approvals are not retroactively credited, avoiding duplicate historical rewards. Withdrawals reserve the entire available balance atomically at a minimum of ₹1,000; an admin must still process the actual payout. Revenue counts approved/active enrollments only. Earnings periods use India time for Today and rolling 7/30-day windows.

The existing public CSS, home content, policies, footer, course cards, and sidebar structure are preserved. Explore Courses opens the first course detail; all five View Course buttons retain their respective course detail pages. Withdrawal inputs are wired inside the existing cashback card. The non-elite view and community links remain intact.

PDF access is checked when opening through the app, and all five mappings reference existing workspace PDFs. PDFs served as static public files remain accessible by direct URL. Enforcing protection against direct downloads requires moving the PDFs to private storage and granting signed URLs only for approved enrollments; static hosting cannot enforce that restriction by itself.

## Verification performed in this session

- Student and admin JavaScript parsed successfully; 18 automated regression checks passed using mocked API responses (tests/regression.mjs; run with Node.js).
- All five local PDF paths exist and have PDF headers, including Finance Management.
- A live read-only request with the public key and limit=0 returned HTTP 401 for enrollments. The endpoint responds, and anonymous access is denied; no student records were requested.
- Browser discovery returned no connected browsers, so visual checks and browser end-to-end tests were unavailable.
- Live migration execution, authenticated Supabase reads/writes, PostgreSQL regression tests, deployed Edge Functions, and actual email delivery remain unverified. The public key cannot deploy database repairs.

The database authorization approach follows Supabase's row-level security and database-function guidance: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/database/functions.

## Live connection diagnosis and local server

The follow-up live checks confirmed: Auth settings HTTP 200 (public key valid), CORS preflight HTTP 200, anonymous enrollment read HTTP 401 (expected), and both tis_resolve_referral and tis_my_enrollments HTTP 404 (migration not deployed). Email autoconfirm is currently enabled on the live project; this was observed, not changed. No administrator token, linked CLI project, local database connection, or .env.local file was available, so no live migration was attempted. Remote Edge Function secrets could not be inspected.

The site was started at http://127.0.0.1:5501 using scripts/dev-server.mjs in the current development session. For future runs with Node.js installed, run `node scripts/start-dev-server.mjs`, or use VS Code Live Server on port 5501. The current server lasts while this development session remains active. Stop the existing server before starting another on the same port. The server serves only website assets; .env files, SQL files, and workspace internals return 404. PDF byte-range requests are supported.

Browser credentials now come from assets/supabase-config.js; both pages use assets/supabase-client.js. Read-only requests receive a 12-second timeout and at most one retry. Payment, approval, withdrawal, signup, and email writes are never automatically retried. The dashboard reports a missing migration separately from a dropped connection. A frontend retry cannot guarantee that browser-level ERR_CONNECTION_CLOSED never occurs when a network or remote server closes the connection.

The deployment helper uses the official Supabase Management API: https://supabase.com/docs/reference/api/v1-run-a-query. Put a personal access token in the local SUPABASE_ACCESS_TOKEN environment variable or untracked .env.local (see .env.example); never in browser configuration. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-supabase.ps1 -Mode Inspect`, review the saved live schema, then run the same command with `-Mode Apply` and `-Mode Verify`. ExecutionPolicy Bypass applies only to that process. The helper prints no credentials and does not retry migrations automatically. For a read-only public connection check, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-supabase.ps1`.
