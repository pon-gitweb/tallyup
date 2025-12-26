# Orders Domain

Goal: Screens/components call `orders.service.ts` only.
Firestore access lives in `orders.repo.ts`.
No direct firebase imports outside repo/firebase bootstrap.

Migration plan:
- Move suggested orders + submit flow first
- Then move drafts + linking
- Then receiving/attach pending (later slice)
