# Welcome cashback and Wallet

Run the entire `supabase/migrations/202609200005_welcome_cashback.sql` in Supabase SQL Editor after the existing migrations. This writes INR 125 to each existing approved student's wallet, once. Publish THE_INDIAN_SKILLS.html (or hard-refresh locally). No Edge Function redeployment is required.

Every future student receives INR 125 on first approved/active enrollment, whether approved by an administrator or completed through payment, with or without a referral. Existing students qualify through an approved/active enrollment or profile. Admin accounts and pending-only accounts do not receive the welcome credit. Existing balances are increased, never replaced.

A private user-ID ledger prevents a second welcome credit on retries, repeated migration execution, or another course purchase. The wallet and its transaction record commit with that ledger and course approval. The existing referral cashback continues separately when students refer other students. Welcome credit does not affect the 70% earnings dashboard or leaderboard.

The Rewards heading is now Wallet. Dashboard and leaderboard amounts display rounded whole rupees (12948.60 displays as 12949); stored amounts, course prices and wallet precision are preserved.

Local tests cover existing/new accounts, no-referral signup, both approval paths, retained referrer credit, duplicate prevention, transaction rollback and permission checks. Live balances change only when this migration is run.
