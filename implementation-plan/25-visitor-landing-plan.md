# Plan 25: Visitor landing dashboard

Spec: PRD section "Visitor landing dashboard" (F7e) and its acceptance criteria.

## Decisions
- Public page at `/` for signed-out visitors. Sample data only, no new API endpoint.
- Signed-in people at `/` get their existing role dashboard (inside the app shell), unchanged.
- Palette scoped to the landing page: deep forest green, warm sand, brass accent. No purple, no gradients-for-effect.
- Motion in CSS only (keyframes, IntersectionObserver reveal). No animation library (not in tech-stack.md).

## Steps
1. PRD: F7e row, "Visitor landing dashboard" section, "Visitor landing" acceptance criteria. (Done.)
2. `AppShell` accepts optional `children`, so `/` can wrap `HomePage` for signed-in people.
3. `client/src/features/landing/`: `LandingPage`, `HeroStatus`, `WeekPreview`, `FeatureStrip`, `sampleData.js`, `useReveal.js`.
4. `client/src/App.jsx`: index route becomes a public `RootEntry` outside `AuthGate`. Signed-out → landing; signed-in with `next === 'dashboard'` → `AppShell` + `HomePage`; other states → their path from `pathForNext`.
5. `client/src/index.css`: scoped `.landing` tokens and keyframes, plus a reduced-motion override.
6. `client/src/i18n/en.json`: `landing.*` keys.
7. Tests: landing unit tests; update the AuthGate test that expected `/` to send a signed-out visitor to sign-in (it now shows the landing page; the sign-in redirect is tested at `/account/password`).
8. Playwright smoke: `/` signed out shows the landing page, and Sign in opens `/login`.

## Verification
- `npm test -w @crm/client`, `npm run lint`, `npm run build`, `npm run format:check`.
- Manual: `/` at 360 px and desktop, light and dark, reduced motion on.
- Signed-in student/teacher/admin still land on their dashboard.
