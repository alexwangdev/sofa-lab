# Sofa Lab

Daily moving-sofa game for Reddit (Devvit Web, React 19 + Tailwind 4 + Canvas 2D, Hono server). Spec: [moving-sofa-spec.md](moving-sofa-spec.md).

## Commands

| | |
|---|---|
| `npm run acceptance` | §5.4 acceptance tests + ceiling check + §12.3 seed check (prints numbers, exits non-zero on failure) |
| `npm run build` | `tsc --build` (strict) + `vite build` → `dist/client`, `dist/server` |
| `npm run lint` | ESLint |
| `npm run local` | **Local mode**, no Reddit needed: http://localhost:5199 runs the real client and the real server routes on an in-memory Redis (saved in `.local-data/`) and a fake Reddit. See below. |
| `npm run login` / `npm run dev` | `devvit login`, then `devvit playtest` in your private test subreddit |

App is private / playtest only. Do **not** run `devvit publish`.

## Layout

```
src/shared/sofa.ts     shape rules + corner test + Hammersley + daily max (pure, no `any`; used by client preview and server)
src/shared/daily.ts    UTC date, mulberry32 seed, width pick
src/shared/types.ts    CellId, TestResult, SubmitResult, API payloads
src/server/app.ts      Hono routes §8, Redis §7, scheduler, menu, install trigger, flair, share, subscribe
src/server/index.ts    production entry: app.ts bound to Devvit redis/reddit/context
src/server/local.ts    local mode: app.ts bound to in-memory Redis + fake Reddit, plus /api/__local dev routes
src/server/ports.ts    the redis/reddit/context interface both entries satisfy
src/server/daily.ts    puzzle:{date} cache, target compute
src/client/*.tsx       App shell + result card, SofaCanvas (render/paint/animation), Hammersley tutorial
src/client/api.ts      fetch wrappers
src/client/DevToolbar.tsx, localMode.ts   local-mode toolbar (dev builds only, stripped from the Reddit build)
tests/acceptance.ts    §5.4 tests
```

## Local mode (`npm run local`)

This uses the same client and the same server routes as on Reddit. Only Devvit's Redis, Reddit API and request context are swapped out:
- **Redis** is in memory and is saved to `.local-data/redis.json`, so your data survives restarts.
- **Reddit actions** (flair, share comment, subscribe, daily post) are recorded instead of sent, and listed in the toolbar.
- **Server edits** take effect on the next request, without a restart.

The amber **LOCAL** pill in the bottom-right opens the toolbar:
- **Player**: switch between u/you, alice, bob, carol and dave to test one-submit-per-day, ranks and ties.
- **Hallway w**: force a width, or leave it on auto to use the date seed.
- **Day**: move between days to test streaks and daily rollover.
- **Seed 5 bot players**: real shapes submitted through the real `/api/submit` (Hammersley 2.20, 2.10, semicircle 1.54, a 0.9 block, and a 3×1 that jams and scores 0).
- **Reset this day**, **Wipe everything**, **Run daily-post job**.

None of this is in the Reddit build: the toolbar is removed by `import.meta.env.DEV`, and `src/server/local.ts` isn't imported by `src/server/index.ts`.

Caveat: if you submit a later day before an earlier one, the streak can look odd. Real days only move forward.

## Playing loop (carve, hint, reveal, share)

- **Carve**: **Start from…** gives you a Hammersley template with a bite-size slider, or your most recent sofa from the last 7 days. Templates skip torn cells. **Brush** cycles 1×1 / 2×2 / 3×3, and **Mirror** paints both sides of the box centre. If carving splits the sofa, the error comes with a **Remove loose bits** button.
- **Hints after Test** (`hintsFor` in `src/shared/sofa.ts`). They only ever mark your own cells and their direct neighbours, never the whole safe region:
  - **On a jam**: red = jams in the first half of the trip, orange = jams later. Colours come from the motion that needs the fewest cells trimmed, so they point at the smallest fix.
  - **On a pass**: green outlines are empty neighbour cells that still fit. Adding them all still passes (tested).
- **Next-day reveal**: **Yesterday's best sofas** shows the previous day's course with tabs for the par shape, the #1 player's sofa, and yours (`GET /api/reveal`). The server refuses today's date, so answers only come out once the day is over.
- **Share card**: spoiler-free, with no shape data. It shows day, difficulty, medal, score / par (or Gerver on Gerver day), streak, a 10-square bar and the twists. **Copy** puts it on the clipboard; **Comment** posts it to the thread.

## Where this deviates from the spec, and why

The spec's literal geometry can't pass its own §5.4 tests, so §5.4's "adjust c(θ) first" rule applied. Every change below is the smallest one that gets all five tests to pass without hard-coding anything.

1. **Test motion: a fixed family of motions instead of one c(θ).**
   * The literal c(θ) = (0.5(1−cosθ), 0.5(1−sinθ)) gives c(0) = (0, 0.5), not (0, 0) as stated.
   * No single rotating motion can pass a 1×1 square (its diagonal is √2, so it can never be at 45° in a width-1 hallway) and also pass Hammersley.
   * The square only clears the corner by sliding, with no rotation.

   A shape now passes if it survives **any** motion from one fixed, finite family. The family is the same for every user and every day:
   * **slide**: pure translation. It works only if the shape is no wider than the vertical arm.
   * **rotate(r, bu)**: Hammersley's motion. In the sofa's frame the hallway turns t = 0→90° in 60 equal steps, and its inner corner runs along q(t) = (bu + r·cos2t, r·sin2t). Here r ∈ {0, 0.01, …, 1}, and bu is any cell edge or cell centre.

   The jam angle and red cells come from the motion that got furthest. The server returns that motion, and the client animates it.
2. **Sample points are inset.** Each cell is sampled at its centre plus 4 points at ±0.01. This differs from the spec, which samples the 4 true corners.
   * With true corners, the best possible grid shape is 1.94 and Hammersley rasterises to 1.88, which fails the ±0.03 test.
   * With the centre only, the grid ceiling is 2.24, so players could "beat" Gerver's proven 2.2195.
   * At ±0.01 Hammersley gets 2.200 (−0.007) and the grid ceiling is **2.20 < Gerver**, so the theorem holds in-game.
3. **Build box is 36×10 (3.6 × 1), cell ids 0–359.** The spec has 30×10. Hammersley at r = 2/π is 2 + 2r ≈ 3.27 wide, so it doesn't fit in 3.0. API validation uses the 0–359 range.
4. **Daily challenge: weekday difficulty + twists** (added on request; replaces spec §6 "only w changes"). See "Daily challenge" below.
5. **Leaderboard score** = `area×1000 · 1e8 + (1e8 − 1 − ms-of-day)`. area×1000 is still an int in the high digits, and the low digits break ties in favour of the earlier submission.
6. **Extra Redis keys:**
   * `submitted:{date}` is a hash used with HSETNX, so "one submit per day" is atomic.
   * `post:{date}` stops the scheduler, the menu and the install trigger from creating duplicate posts.
   * `user:{id}:{date}` also stores `pass` and `username`, which the leaderboard needs.
7. **A failed submit counts as the day's submit and scores 0**, as §3 says. The confirm dialog warns about this when the preview jams.
8. **Journeys:** `@devvit/web` 0.15.4 has a `journeys` permission but no Journey-event API I could find. The submit handler logs `[journey] submit bucket=…` with the area bucket only, so a real call can drop in there.
9. **Tutorial** uses a 40-column grid so Hammersley up to r = 1 isn't clipped. Every r in [0, 0.64] passes (tested). Real Hammersley sofas pass for every r.

## Daily challenge

Each UTC date picks a challenge from the date seed (mulberry32), so everyone gets the same one. The logic is in `src/shared/daily.ts`.

| UTC day | Difficulty | Hallway w | Twists |
|---|---|---|---|
| Mon | Easy | 1.1 / 1.15 | none |
| Tue | Medium | 0.9 / 1.0 / 1.1 | torn fabric |
| Wed | Medium | 0.9 / 1.0 / 1.1 | pillar |
| Thu | Hard | 0.85 / 0.9 / 1.0 | pillar + torn fabric |
| Fri | Medium | 0.9 / 1.0 / 1.1 | pillar *or* torn fabric |
| Sat | **Gerver day** | 1.0 | none — target is Gerver 2.2195 |
| Sun | Hard | 0.85 / 0.9 / 1.0 | pillar + torn fabric |

**Pillars**, one of three kinds:
- **Corner column** in the outer corner: r 0.55–0.65 on Medium days, 0.62–0.72 on Hard days.
- **Outer-wall pillar** in the vertical arm.
- **Inner-wall pillar** in the vertical arm.

No sample point may ever be inside the pillar. The test checks the slide in and the slide out exactly (each point's straight path), and the turn in 60 steps. A jam reports whether it happened on the way in, during the turn, or on the way out.

**Torn fabric**: 2–3 small tears (2–4 cells each) in the middle of the build box. You can't paint those cells, and the API rejects them.

**Par** is the best possible area that day. It's computed with the intersection method over every motion and every placement in the box, with torn cells removed, and cached at `puzzle:{date}`. The par shape always passes its own day (tested over 28 days).

**Medals**: Bronze ≥ 80%, Silver ≥ 90%, Gold ≥ 97% of par. Within a day, ranking is still by area (par is the same for everyone that day).

Typical par:
- Easy: about 2.39.
- Medium: 1.7–2.3 (about 2.05 on average).
- Hard: 1.3–1.9 (about 1.62 on average).
- Gerver day: 2.20.

The best bite radius changes from day to day (0.45–0.73), so yesterday's shape won't be today's best.

Max area in a plain hallway (no twists): w=0.85 → 1.67, 0.9 → 1.89, 1.0 → 2.20, 1.1 → 2.33, 1.15 → 2.41.

## §12 checklist status

1. Build passes: verified (`npm run build`, TS strict, no `any` in sofa.ts).
2. Acceptance tests: verified (`npm run acceptance`).
3. Daily seed: verified (`npm run acceptance`).
4. Double submit rejected: verified in local mode with the real routes (second submit → 409, leaderboard byte-identical). Not yet run against Devvit's hosted Redis.
5. Playtest flow: verified end-to-end in local mode at 360px, including streaks, ties, flair and share. Uploaded and installed in r/sofa_lab_dev (v0.0.1), but not yet played there.
6. 360px viewport: verified, no horizontal scroll, buttons ≥44px.
