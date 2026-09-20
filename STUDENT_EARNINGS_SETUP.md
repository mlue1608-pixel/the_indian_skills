# Referrer dashboard earnings

Apply `202609200002_student_savings.sql` first if not already installed, then run the entire `202609200003_referrer_earnings.sql` in Supabase SQL Editor. If the savings migration is already installed, run only the new follow-up. Publish THE_INDIAN_SKILLS.html and refresh. No Edge Function redeployment is needed.

Earnings belong to the account whose referral link was used. Each approved/active referred course contributes 70% of its original price to that referrer's dashboard. The buyer's own discount is not added to their own earnings. Pending/rejected courses and self-referrals are excluded. Totals are display-only and cannot be withdrawn. Rewards cashback, wallet/withdrawal ledgers and My Team are unchanged.

For the leaderboard, also run `202609200004_leaderboard_earnings.sql` after the above migrations. Its four period rankings use the same referral earnings and approval dates as the dashboard. Publish the updated HTML to display paise without rounding to whole rupees. Database tests cover ranking, period totals, excluded pending/self-referrals, missing profiles, repeated deployment and denied anonymous access.

Example: Branding 2499 x 70% = 1749.30; Marketing 999 x 70% = 699.30; Finance 15000 x 70% = 10500. Total referrer earnings = INR 12948.60. Approval dates determine today/week/month totals.

The prior migration stores each course's discount once. Paid checkout uses recorded original/payable prices; admin approval uses original price metadata or the catalog fallback for historical records without metadata. Text and JSON metadata formats are supported. The follow-up assigns these existing snapshots to the referrer, without creating credits or altering prices.

Local tests verify both metadata formats, three-course totals, referrer vs buyer attribution, dates, rejection/reapproval, self-referral exclusion and repeat migration execution. Live results require applying the follow-up SQL.
