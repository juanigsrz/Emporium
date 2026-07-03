# Affordances + Overview Username Links (#3, #10) — Design

## Summary

- **#3 Affordances (frontend):** make destructive/navigation actions look like the
  site's standard buttons and gate the destructive/navigation ones with a modal
  confirm; add a back button to the matching section; make the organizer
  manage-event back a text link; restyle the grid "Auto-tick by rating" as a real
  button.
- **#10 Overview links (frontend):** make usernames in the shipping and payments
  overview tabs link to the user's profile. (Both overview tables already
  paginate — pagination is **not** in scope.)

**Repo:** Emporium, frontend only. No backend changes. One plan.

## Background

- Canonical site button styles: a **primary** button
  `rounded-2xl border-2 border-ink bg-butter px-5 py-2 text-sm font-bold text-ink shadow-pop`
  (e.g. Join, `EventDetailPage`) and a **secondary** button
  `rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5 text-xs font-semibold text-moss hover:bg-sage/30`
  (e.g. Edit in `MyCopiesPage`; `BackButton`). Destructive variants use a red
  border/text (e.g. Withdraw: `border-2 border-red-200 ... text-red-600`).
- Existing confirm patterns: **modal** dialogs (`WithdrawConfirm` in
  `MyCopiesPage`, `TransitionConfirmDialog` in `EventDetailPage`) and **inline
  confirm-swap** (Leave in `EventDetailPage`, combo-remove). There is **no**
  shared confirm-dialog component yet.
- `/u/:username` profile route already exists (used throughout `MatchRunPage`).
- Current state of each #3 spot:
  - Remove-listing (`EventDetailPage` `MyListingCard`, ~L783): red **text**, fires
    `onRemove` immediately (no confirm).
  - Leave (`EventDetailPage` `JoinLeaveButton`, ~L182): **text**, already has an
    inline confirm-swap.
  - Advanced (X-to-Y) builder (`MyWantsPage`, ~L1611): underlined **text** `Link`,
    no confirm.
  - Auto-tick by rating (`MyWantsPage`, ~L1265): ad-hoc
    `rounded-xl border px-2 py-1 text-xs` button (doesn't match site buttons).
  - Withdraw (`MyCopiesPage`, ~L316): already a proper red button **with** a modal
    confirm — no change.
  - Matching (`MatchRunPage` main view, header ~L1388): breadcrumb only, no back
    button.
  - Organizer manage (`ManageEventPage`): the organizer-managing view already uses
    a **text** back link (`← {event.name}`, L53). The only button-pill
    `<BackButton>` (L32) is in the *non-organizer* error guard — out of scope.
    **Part C is already satisfied; no change.**
- Current state of #10: both `ShippingOverviewTab` and `PaymentsOverviewTab`
  already paginate the "All shipments"/"All payments" tables. Usernames in the
  per-user rollup and in the table rows are plain text (not links).

## Part 3 — Affordances

### Shared component: `ConfirmDialog`

Create `frontend/src/components/ConfirmDialog.tsx`: a small modal (fixed overlay +
backdrop + centered card) with a `title`, `body` (ReactNode/string), a confirm
button (label + optional destructive styling + `pending` state) and a Cancel
button. Props:

```ts
type ConfirmDialogProps = {
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean   // red confirm button when true
  pending?: boolean       // disables + shows busy label
}
```

Styling mirrors the existing `WithdrawConfirm`/`TransitionConfirmDialog` modals
(same overlay `bg-ink/40`, card, button chrome). Used by the two **new** confirms
(remove-listing, advanced-builder). Backdrop click and Cancel call `onCancel`.

### A. Buttons + confirms

- **Remove-listing** (`EventDetailPage` `MyListingCard`): restyle the red **text**
  to the secondary **red button** style (`rounded-xl border-2 border-red-200
  px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50`, keep
  `disabled:opacity-50`, keep `aria-label="Remove listing"`). Gate it with a
  `ConfirmDialog` (`destructive`, title e.g. "Remove listing?", body names the
  game/listing_code) — only call `onRemove(listing.id)` on confirm. Local
  `confirmRemove` boolean state in `MyListingCard`.
- **Advanced (X-to-Y) builder** (`MyWantsPage`): restyle the underlined text
  `Link` to the secondary **button** style; change it from a `Link` to a `button`
  that opens a `ConfirmDialog` (not destructive; title e.g. "Open advanced
  builder?", body warns it's the manual X-to-Y editor), and on confirm
  `navigate(`/events/${slug}/builder`)` (`useNavigate`, already available or
  imported). Local `confirmAdvanced` state.
- **Auto-tick by rating** (`MyWantsPage`): restyle the ad-hoc button to the
  secondary button style (`rounded-xl border-2 border-ink/15 bg-cream px-3 py-1.5
  text-xs font-semibold text-moss hover:bg-sage/30`). Behavior unchanged; **no
  confirm** (reversible bulk toggle).
- **Leave** (`EventDetailPage` `JoinLeaveButton`): restyle the **text** trigger
  (the one that calls `setConfirmLeave(true)`) to the secondary **red button**
  style. **Keep** the existing inline confirm-swap (no modal). The
  inside-confirm "Confirm leave"/"Cancel" controls are unchanged.
- **Withdraw** (`MyCopiesPage`): no change (already a proper red button + modal
  confirm).

### B. Back button in matching

In `MatchRunPage`'s main return (the success view, after the breadcrumb / in the
page header block), add `<BackButton to={`/events/${slug}`}>Back to event</BackButton>`
(`BackButton` is already imported). Place it so it reads as a proper back button
in the header (consistent with the error-state back buttons already present).

### C. Organizer manage back = text — already satisfied

The organizer-managing view in `ManageEventPage` already renders a **text** back
link (`← {event.name}`, L53). The only button-pill `<BackButton>` there (L32) is
in the non-organizer error guard, which is out of scope. **No change.** (Matching
gets the button per Part B; the manage page is already text — the deliberate
contrast the spec wanted.)

## Part 10 — Overview username links

Wrap each username in a `Link to={`/u/${username}`}` (styled like the existing
profile links: `text-indigo-500 hover:underline font-medium`, or the page's
existing username link style):

- `PaymentsOverviewTab`: rollup `u.username` (L52) and row `p.from_username` /
  `p.to_username` (L89).
- `ShippingOverviewTab`: rollup `t.username` (L53) and row `s.giver_username` /
  `s.receiver_username` (L92).

Import `Link` from `react-router-dom` in both files. Keep `truncate`/layout
classes intact (apply link styling without breaking the existing flex/truncate).

## Testing

Frontend has no test runner. For every changed file:

- `cd frontend && npm run build` → no TypeScript errors.
- `npx eslint <file> --ext ts,tsx` → exit 0 (ignore the pre-existing
  `CopyForm.tsx:15` baseline).

Manual checklist:
- Remove-listing now a red **button**; clicking opens a modal; Cancel aborts;
  Confirm removes the listing.
- Advanced-builder is a **button**; clicking opens a confirm modal; Confirm
  navigates to `/events/:slug/builder`; Cancel stays.
- Auto-tick looks like a standard button; still bulk-toggles.
- Leave is a red **button**; the inline "Leave this event?" confirm still works.
- Matching page shows a "Back to event" button that navigates to the event.
- Organizer manage page back is a **text** link (no button pill).
- Shipping & payments overview: every username is a link to `/u/<username>`;
  layout/truncation unaffected; pagination still works.

## Files

- Create: `frontend/src/components/ConfirmDialog.tsx`.
- Modify: `frontend/src/features/events/EventDetailPage.tsx` (remove-listing
  button + modal; Leave button restyle), `frontend/src/features/trades/MyWantsPage.tsx`
  (advanced-builder button + modal; auto-tick restyle),
  `frontend/src/features/matching/MatchRunPage.tsx` (back button),
  `frontend/src/features/matching/PaymentsOverviewTab.tsx` (username links),
  `frontend/src/features/matching/ShippingOverviewTab.tsx` (username links).

## Out of scope

- Backend changes (none).
- Pagination of the overview tables (already exists) or of the per-user rollup.
- Converting the Leave inline confirm to a modal (kept as-is).
- Any change to the Withdraw button (already correct).
