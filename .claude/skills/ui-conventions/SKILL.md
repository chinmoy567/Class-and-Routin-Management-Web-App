---
name: ui-conventions
description: Front-end conventions for the client/ React app - folder layout, API client, TanStack Query hooks and keys, React Hook Form + Zod forms, shadcn/ui and Tailwind usage, translations, account-state screens, server time and live status, Socket.IO refreshes, mobile-first and accessibility rules. Use when building or changing any page, component, form, hook or route in client/.
---

# Front-end conventions

Stack: React 19 + Vite, JavaScript (`.jsx`), Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Socket.IO client, vite-plugin-pwa. **Don't add other UI, animation, 3D or state libraries** (no GSAP, Framer Motion, Three.js, Redux or Zustand) without asking.

These rules were written before the first screen existed. Update this file when real screens settle a pattern.

## Folder layout

```
client/src/
  main.jsx, App.jsx        providers (QueryClient, Router, i18n), route tree
  routes/                  one file per page; route guards by account state and role
  features/<module>/       mirrors server modules: auth, routine, rooms, chat, …
    api.js                 fetch functions for this module
    hooks.js               useQuery/useMutation hooks
    components/            components used only by this feature
  components/ui/           shadcn/ui components (generated, then edited as needed)
  components/              shared app components (AppShell, PageHeader, EmptyState, ErrorState…)
  lib/
    api.js                 the single fetch wrapper
    socket.js              Socket.IO client
    time.js                server-time offset, Asia/Dhaka formatting
    query-keys.js          all TanStack Query keys
  i18n/en.json             every user-facing string
```

## Talking to the API

- All requests go through `lib/api.js`. It sends `credentials: 'include'` (session cookie) and the CSRF token header on every non-GET request, and turns `{ error: { code, message } }` into a thrown `ApiError` with `code` and `status`.
- Feature code never calls `fetch` directly.
- Show errors by `code`, translated (`t('errors.REQUEST_LIMIT')`). Use the server's `message` only as a fallback.
- A `401` sends the user to sign-in. A `403` with a state-related code shows the matching account-state screen (see below).

## Server data with TanStack Query

- Every query key comes from `lib/query-keys.js`, for example `qk.myRoutine(from, to)` or `qk.roomAvailability(date, from, to)`.
- Server data lives only in TanStack Query. Don't copy it into React state or context.
- Mutations invalidate the affected keys `onSuccess`. Only use optimistic updates for chat messages.
- A `409 ALREADY_DECIDED` refetches the list and shows "Already decided".

## Real-time refreshes

`lib/socket.js` connects once, after sign-in. Push events don't carry the data. They tell the client to refetch:

| Event | Invalidate |
|---|---|
| `routine.changed` | my routine, live status, free rooms |
| `booking.changed` | free rooms, my requests, admin request lists |
| `calendar.changed` | my routine, live status, calendar |
| `message.new` / `message.status` | that conversation, unread counts |

## Forms

- React Hook Form + `zodResolver`, reusing the server's Zod schema whenever the server exports one.
- Use shadcn `Form`, `FormField` and `FormMessage`. Every input has a visible label.
- The submit button is disabled while the request is pending. Server field errors (`error.fields`) are set back onto the form with `setError`.

## Account states and roles

- Route guards read the current user (`useMe()`) and send them to the right screen: `email_unverified` → verify screen, `claim_pending` → waiting screen, `unconfirmed` → update screen, teacher `pending` → waiting screen.
- Hiding a button is only for convenience. The server still checks everything. Never decide permissions in the client in a way the server doesn't also check.
- Follow the PRD's "What each state can use" table for what each state sees.

## Time and live status

- Never use the device clock for rules or status. `GET /me/routine` returns the server time. `lib/time.js` stores the offset (`serverNow = Date.now() + offset`) and every countdown uses `serverNow()`.
- Format every date and time in `Asia/Dhaka` (date-fns-tz), never in the browser's timezone.
- Live status ("In class / Free" and the countdown) is computed on the page from the routine data. It ticks once a second for the countdown and recomputes the status when a slot boundary is crossed.

## Text and language

- Every visible string comes from `i18n/en.json` through `t('…')`. No hard-coded text in components, including button labels, empty states, `aria-label`s and error messages.
- Keys are grouped by feature: `rooms.request.title`, `errors.ALREADY_DECIDED`.

## Layout and styling

- **Mobile first:** design for 360 px wide, then add `sm:`/`md:`/`lg:` for bigger screens. No horizontal scrolling at 360 px. Wide tables become stacked cards on phones.
- Use Tailwind utilities and shadcn components only. No separate CSS files beyond `index.css` (Tailwind and theme variables).
- Colours come from the shadcn theme variables (`bg-background`, `text-muted-foreground`…), never hard-coded hex values, so dark mode works.
- Every page handles four states: loading (skeleton), empty, error (with retry) and data.

## Accessibility (WCAG 2.1 AA)

- Use shadcn/Radix components for dialogs, menus and popovers so focus and keyboard handling are correct.
- Text contrast is at least 4.5:1. Never use colour alone to show a status: "In class / Free / Booked" also have a text label or icon.
- Tap targets are at least 44×44 px. Icon-only buttons have an `aria-label`.
- Live status updates use `aria-live="polite"`, but not the per-second countdown.

## Privacy on screen

Never show another user's email or phone, except in the two cases the PRD's Privacy rule allows (the CR/DCR on a join request, the admin on a teacher registration). Admin lists show only whether an email is verified or bouncing.

## Tests

- Vitest + Testing Library for components with logic (forms, guards, live status). Test the status and countdown with a fake server time.
- Playwright for the main journeys: sign-up → join request → accepted, room request → approved, My routine on a phone-sized screen.
