# Sofa Lab — Reddit Daily Game SPEC v1.0

Daily moving-sofa game on Devvit Web. TypeScript + React. No native app, no 3D engine, no physics engine.

## 1. The game in one line

Every day, everyone gets the same L-shaped hallway. Build a sofa on a grid, press Test, watch it turn the corner. If it clears, your score is its area. The ceiling is a proven theorem, not a guess.

## 2. The theorem (the hook, keep it visible in-game)

- 1966 Moser: largest flat shape that can move around a right-angled corner in a hallway of width 1?
- 1968 Hammersley: two quarter-discs + a block with a semicircular bite. Area = π/2 + 2r − πr²/2, best at r = 2/π ≈ 0.637, area ≈ 2.2074.
- 1992 Gerver: 18 curved pieces, area ≈ 2.2195, only ~0.5% bigger than Hammersley.
- 2024 Baek: proved Gerver is optimal. No sofa can be larger than ≈ 2.2195 for width 1.
- In-game target line is always shown: `Gerver 2.2195`. A score of 2.14 reads as "0.08 short of proven optimal", not as an arbitrary number.

## 3. Core loop (P0 — build / carve, this is the game)

1. Daily hallway loads. Same for everyone, seeded by UTC date (see §7).
2. Build: tap / drag-paint cells on a grid to form a sofa. Tap again to erase. Undo, Clear.
3. Test (unlimited, free, in practice): animation turns the sofa 0° → 90° through the corner in ~60 steps. If a cell leaves the hallway, it flashes red at the jam angle, test stops, score 0 for that attempt.
4. Submit (once per user per UTC day): the submitted shape is re-validated server-side. Pass = score is its area. Fail = 0.
5. Result card: area, % of Gerver target, daily rank, streak, share-to-comments button, subscribe prompt. One result card only, no extra end screens.

Steer mode (drag a fixed sofa around the corner) is NOT a mode. Do not build it. The only steering is the Hammersley tutorial in §4.

## 4. Tutorial (P0, one screen, must ship)

Hammersley slider. One slider, r in [0, 1], step 0.01, default 0.30.

- Live area: `π/2 + 2r − πr²/2`, shown to 3 decimals.
- Live shape preview: two quarter-discs + block + bite of radius r.
- "Test this sofa" runs the same test as §3. It must pass for r ≤ ~0.64.
- Caption under the slider: "Bigger bite = longer block, but the bite eats area. Best r = 2/π ≈ 0.637, area 2.2074."
- This screen is the onboarding. No wall of text, no separate how-to page. First-time users see it once, then "Start building".

## 5. Geometry — exact, implement this, do not invent a new motion

### 5.1 World

- Hallway width = 1 unit. L-shape in world coords:
  - Horizontal arm: `y in [0,1], x in [-4,1]`
  - Vertical arm: `x in [0,1], y in [-4,1]`
  - Union. Inner corner at (0,0), outer corner at (1,1). The quadrant `x<0, y<0` is outside.
- Build box (sofa local coords): `x in [0,3], y in [0,1]`, cell size 0.1. Grid is 30 × 10 = 300 cells max.
- Sofa local origin: the sofa as built sits in the horizontal arm at world `x in [-3,0], y in [0,1]` at angle 0. Map local (lx, ly) to start world (lx − 3, ly).

### 5.2 Shape rules (enforced client + server)

- Cells are 0.1 × 0.1, area per cell = 0.01. Score area = cells × 0.01, 3 decimals.
- Shape must be 4-connected (up/down/left/right). Disconnected shapes are rejected with "sofa must be one piece".
- Shape must fit inside the build box. Empty shape rejected.
- No other restriction. Holes allowed.

### 5.3 Test motion (fixed, documented, same for everyone)

Do NOT try to implement Gerver's 18-curve motion. Use one fixed test motion and compute the daily target under that same motion.

- Angle θ goes 0° → 90° in 60 equal steps.
- At each step, transform every sofa cell (sample its 4 corners + centre) by rotation −θ about the sofa pivot plus translation c(θ).
- Pivot: sofa local point (3, 0) — the inner-corner end of the build box.
- Inner-corner path in sofa frame: `c(θ) = (0.5·(1 − cosθ), 0.5·(1 − sinθ))`, θ in radians. At θ=0, c=(0,0); at θ=90°, c=(0.5,0.5).
- A sample point is inside the hallway iff, after the transform, it lies in the L union in §5.1.
- If any sample is outside at step k, test fails at angle θk. Return `jamAngle`, and the list of offending cell ids for the red flash.
- If all 60 steps pass, test passes.

### 5.4 Acceptance tests (must pass before shipping, do not ship if any fails)

Run these on the grid, cell 0.1, 60 steps, same code path as the game test:

- 1×1 square, area 1.000 — must PASS.
- Semicircle radius 1 (approximated on grid, area ≈ 1.571) — must PASS.
- Hammersley r = 2/π ≈ 0.637, area ≈ 2.2074 — must PASS, computed area within ±0.03 of 2.2074.
- A 3×1 solid block (area 3.000) — must FAIL, jam angle < 90°.
- A shape with a disconnected cell — must be REJECTED by shape rules, not by the test.

If Hammersley fails, adjust c(θ) or step count first, re-run all five. Do not hard-code a pass for Hammersley. Do not change the motion per day or per user.

### 5.5 Daily target

- For width w = 1, target = 2.2195 (Gerver). Show it as the ceiling.
- For w ≠ 1 (see §7), target is the max area under the §5.3 motion, computed server-side once per day by the intersection method (fix sofa, move hallway, intersect all hallway positions over θ), cached in Redis. If that computation is not ready, fall back to showing "target: —" and rank by raw area only. Never invent a target number.

## 6. Daily content

- One hallway per UTC day. Same seed, same hallway, same target for everyone.
- Seed = UTC date `YYYY-MM-DD`, mulberry32.
- Corridor variation (only this changes day to day, keep 90° corner fixed in v1):
  - Second-arm width w, picked deterministically from seed: `w in [0.85, 0.9, 1.0, 1.0, 1.1, 1.15]`, weighted toward 1.0.
  - w is the width of the vertical arm only; horizontal arm stays 1.0. When w ≠ 1, the build box height stays 1.0, the vertical arm width is w, and §5.5 target applies.
  - Do NOT vary corner angle in v1. 45°/60°/120° are explicitly out of scope.
- Streak: consecutive UTC days with a passing submission. Any passing area counts, no minimum.
- Leaderboard: daily, sorted by area desc, tie-break by earlier submission time. Show top 10 + the user's own rank. Weekly / all-time boards are out of scope.

## 7. Reddit / Devvit integration

- Stack: Devvit Web only. `@devvit/web`, `devvit.json` (not yaml). Blocks / `@devvit/public-api` is dead, do not use.
- Client: React 19 + Tailwind 4, Canvas 2D for the hallway + sofa. No Phaser, no three.js, no physics lib.
- Server: Hono on Devvit Web, TypeScript, Node 22+.
- Redis is per-installation (per subreddit). Keys:
  - `puzzle:{date}` — `{ w, target }`
  - `lb:{date}` — sorted set, member userId, score area (store area×1000 as int to avoid float sort issues)
  - `user:{userId}:{date}` — `{ area, cells, submittedAt }`, one per day
  - `streak:{userId}` — int, updated on passing submit
- Scheduler: daily post at 00:00 UTC, one post per day, title `Sofa Lab — {date}: hallway width {w}`. Post body is the game embed, no extra text.
- Flair (server-assigned on submit, best-effort, never block submit on flair failure):
  - Pass: `Sofa {area}`
  - Top 10 that day: `Top 10 · {area}`
  - Streak ≥ 7: `7-day mover`
- Comments: result card has one "Share my sofa" button that posts a comment `Sofa {area} / Gerver 2.2195 ({pct}%) — hallway w={w}`. No auto-posting, no auto-commenting.
- Devvit Journeys: one event per submit (`submit`, area bucket only, no shape data), one per test-pass in practice is NOT sent.
- App stays private / playtest only. Do NOT submit for publishing.

## 8. API (server is source of truth, never trust client area)

- `GET /api/today` → `{ date, w, target, hasSubmitted, myArea }`
- `POST /api/test` body `{ cells: [cellId...] }` → `{ pass, area, jamAngle?, jamCells? }`. Recomputes shape rules + §5.3 test server-side. No Redis write.
- `POST /api/submit` body `{ cells: [...] }` → validates via same test, rejects if already submitted that day, writes `lb:{date}` + `user:{userId}:{date}` + streak, returns `{ area, rank, streak }`.
- `GET /api/leaderboard?date=YYYY-MM-DD` → top 10 + `{ rank, area }` for caller.
- All routes validate: cells are ints in [0,299], ≤300 cells, connected, inside build box. Invalid → 400, no write.

## 9. UI (single post embed, must fit viewport)

- Layout, top to bottom: title `Sofa Lab` + date + `hallway w={w}`; target line `Gerver 2.2195 · you: {area}`; canvas (hallway + sofa, 360–480px wide, aspect ~3:2, touch + mouse); controls row: Test, Undo, Clear, Submit; result card (only after submit).
- Canvas interaction: tap toggles a cell, drag paints, two-finger / right-drag erases is NOT required — provide an Erase toggle button instead. Buttons ≥44px, contrast AA.
- Test animation: ~1.2s, sofa rotates through the corner, jam cells flash red, pass shows green check + area pop.
- Submit: confirm dialog showing area + "one submit per day, this cannot be undone". After submit, Build controls lock for that day, Test still works in practice on a copy.
- No start screen with setup, no settings page, no shop, no ads. Loading state is a skeleton of the canvas, not a spinner page.

## 10. Out of scope (do not build)

- Steer mode, 3D, physics engine, corner angles ≠ 90°, multiplayer / co-op, chat inside the game, sound, in-app purchases, weekly board, shape sharing as importable code (comments share text only).

## 11. File structure

```
src/
  client/
    App.tsx            # shell, date, target line, result card
    SofaCanvas.tsx     # canvas render + tap/drag paint + test animation
    Hammersley.tsx     # tutorial slider (§4)
    api.ts             # fetch wrappers for §8
  server/
    index.ts           # Hono routes (§8)
    sofa.ts            # shape rules + §5.3 test, shared logic, no Redis here
    daily.ts           # seed, w pick, target compute/cache
  shared/
    types.ts           # CellId, TestResult, SubmitResult
devvit.json
```

`sofa.ts` must be importable by both client (practice test preview) and server (authoritative test). If client and server diverge, server wins and the client preview is labelled "preview".

## 12. Build / verify checklist (run before calling it done)

1. `npm run build` passes, TypeScript strict, no `any` in `sofa.ts`.
2. §5.4 five acceptance tests pass, logged with numbers.
3. Daily seed: two different UTC dates give different w on at least 4 of 6 days in a test week; same date gives same w twice.
4. Submit twice same day → second is rejected, leaderboard unchanged.
5. Playtest in a private subreddit install: build → test fail (jam flash visible) → fix → test pass → submit → result card → leaderboard shows the entry → reload keeps submitted state.
6. Viewport: 360px wide phone, no horizontal scroll, buttons reachable, canvas legible.

## 13. Claude prompts (use these, in order, short)

1. "Implement shared/sofa.ts + the §5.4 acceptance tests. No UI yet."
2. "Implement server routes §8 using sofa.ts. Redis keys §7."
3. "Implement client canvas + build controls + Test animation (§9). Wire to /api/test."
4. "Implement Hammersley tutorial (§4) as first-run screen."
5. "Implement submit, result card, leaderboard, streak, daily post (§6–§7). Run checklist §12."
