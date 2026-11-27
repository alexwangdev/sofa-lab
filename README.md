# Grid Expedition (Ski Grid v2)

A daily grid-runner built to SPEC v1.0. Everyone gets the same 450-row track each UTC day, and one run crosses three biomes drawn from a pool of 8. Pickups swap your vehicle for a few rows, and planning which ones to grab is the game. It uses the same grid engine and pseudo-3D projection as Ski Grid: Canvas 2D, voxel boxes, a single perspective divide, no 3D engine and no physics engine.

**Two builds from one codebase.**

- **On Reddit (Devvit Web)**: `npm run build` → `dist/client` + `dist/server/index.cjs`. The routes in `src/server/app.ts` run on Devvit's server (`src/server/index.ts`) with Devvit's Redis, Reddit API and request context.
- **Standalone web build for local testing**: `npm run web` / `npm run build:web` → `dist/web`. The same routes run inside the page (`src/client/backend.ts`) on an in-memory Redis saved to localStorage.
- The only switch is `src/client/platform.ts`. On Reddit it uses plain `fetch` and has no TEST toolbar. The web config swaps in `platform.local.ts`, so no server code ever reaches the Reddit client bundle (Devvit's Vite plugin also refuses it).

```
npm install
npm run web       # local test build with the TEST toolbar: http://localhost:5177
npm test          # spec §17 acceptance tests 1–9 + scoring, replay, endless and autopilot checks (node:test)
npm run dev       # devvit playtest: private upload + install to the dev subreddit, rebuilds on save
npm run build     # Devvit build (what playtest / upload ship)
npm run build:web # static web build → dist/web
```

### On Reddit (private playtest)

- **Upload**: the game is its own Devvit app, `grid-expedition` (registered with `devvit init`, `devvit.json` → `name`). It is uploaded as private versions and installed in the private test subreddit **r/gridexpedition_dev** (`dev.subreddit`).
- **Open it**: `https://www.reddit.com/r/gridexpedition_dev/?playtest=grid-expedition`. Create today's post from the subreddit menu: "Grid Expedition: create today's post". The daily-post scheduler also runs at 00:00 UTC.
- **Redis keys** are prefixed `ge:` (`ge:lb:`, `ge:user:`, `ge:streak:`, `ge:post:`, `ge:puzzle:`). This was added while the game briefly ran inside the old Sofa Lab app; it stays, so the keys are unambiguous.
- **Private only**: keep the app playtest-only; do not run `devvit publish` (spec). Spec §17 test 10 (the manual playtest checklist) is run here.

**Local test build only** (`npm run web`): the dashed **TEST** bar under the controls, the model gallery, auto mode and the `window.__*` dev hooks. Neither the Reddit build nor `npm run build:web` contains any of them; checked by searching an unminified build. The TEST bar lets you switch players (you / alice / bob / carol) to fill the leaderboard, set the UTC date to try other routes or test streaks, reset the day or all data, and fire the daily-post job. Reddit actions (flair, comment, daily post) are only logged to the browser console. "Share my run" copies the comment text to the clipboard.

## Scoring: time counts, but only if you finish

Without a time component, riding the brakes to a safe finish was the best strategy. Now:

- **Time score = 3000 × par ÷ your total time**, awarded **only for reaching the finish** (`timeScore` in `sim.ts`). Par is the cruise time from the same speed model (≈49.3 s for 450 rows), so finishing at par is worth 3000. There is no time limit and no cap: shorter is always better.
- A crash gets no time score, only the points collected on the way: +1 per row, gates (+30/60/90 combo), collect +10, air +20/40, smash +5. These replaced the old finish +200 and +25 per second under par.
- On an empty track: braking all the way takes 149.5 s for 990 time points (1439 total); cruising takes 49.3 s for 3000 (3449); holding Tuck takes 27.2 s for 5438 (5887). Fast and risky beats slow and safe; slow and safe still beats crashing.
- The HUD shows the elapsed time as `time/par`, amber once slower than par. The result card shows "Time 41.5 s (par 49.3 s) → 3566", or after a crash "Time score: finish to earn it".
- The server does not take the client's word for any of this. It replays the run from its inputs and scores the replay (see "Score check" below).

## Autopilot: can every run be finished?

`src/shared/autopilot.ts` drives a run with the real rules. Before each row it tries every lane request 6 rows deep on cloned states (the same `enterRow` a player runs, so pickups, ramps, smashing and hops all count), rejects lines that crash, prefers lines that stay survivable 16 rows further on, then the best score (slow cells and poles count against a line). Speed never changes which rows are safe, so it holds Tuck the whole way.

- `npm run autotest` plays 60 daily tracks start to finish with the game's fixed 1/120 s ticks. It also replays every run from its input log, the same check the server makes, and reports any mismatch. It prints per day: route, finished or FAIL, time, score, time points, gates and pickups, plus the exact cell and vehicle of any crash. It exits with code 1 if any run fails. Options: `-- --days 200 --from 2026-01-01`, `--cruise` (no Tuck).
- Results so far: **200/200** days of 2026 finished holding Tuck (avg 27.2 s, avg score 7118, every gate passed) and **60/60** finished cruising (avg 48.8 s, avg score 4703). About 0.9 s per run.
- `--all-routes` plays every ordered biome route (8 × 7 × 6 = 336), and `--grab` makes the autopilot go out of its way for pickups. Both print coverage: finished/runs for each biome in each segment position, and for each timed vehicle how often it was offered, picked up, rows driven, and runs that crashed while driving it.
- Results: **336/336** routes finished (every biome 42/42 in each position). With `--grab` also 336/336, and all 15 timed vehicles were driven (Subway 88×, Zipline 131×, Balloon 120×, Rocket 252×, …) with no crash while driving any of them.
- `npm test` includes a 5-day autopilot run.
- Dev hooks for visual checks (dev server only): `window.__advance(row)` plays the current run with the autopilot up to a row synchronously (no animation frames needed), and `window.__snap(name)` saves a full-resolution frame to `.shots/name.jpg` through the dev server.
- **In game:** tick **auto** in the TEST bar. The autopilot starts the run, steers, holds Tuck, and starts the next run 3 s after each result.

## Look: voxel models + one visual language

Models are built from basic shapes (box, cylinder, ellipsoid, cone, line, mirror) in a voxel grid of 12 voxels per track cell (`src/client/voxel.ts`; all models are in `src/client/models.ts`). Each model is baked once per view angle into a lit sprite and drawn as a billboard scaled by the same F / dz as the grid. This is the classic pseudo-3D racer technique, and the world underneath is still the grid. Baking is limited to about 6 ms a frame; until a new angle is ready, the nearest baked view is reused.

Performance:
- **Track length** is one constant, `ROWS` in `src/shared/grid.ts` (now 450 rows ≈ 900 m, three segments of 150). Segments, walls, gate widths, par, and the UI all derive from it. Stored puzzles record the length, so changing it recomputes par.
- **Streaming**: the track data is ~4 KB and stays whole (the preview, minimap and server score check need it). What streams is the expensive part, the baked sprites. Models are tagged by biome. While the preview is open, the first two biomes bake in idle time (`prewarmCourse`). Entering a segment evicts the passed biome (views and fog tints freed) and queues the next one, so about two biomes of sprites exist at a time (about 3–5 megapixels). Row colour caches behind the runner are pruned. Shared and vehicle sprites unused for 20 s are dropped.
- **Build-time atlases** (`npm run atlas`, also run by `dev` and `build`): `tools/bake-atlas.ts` builds every model in the catalog (`src/client/catalog.ts`) and rasterises every view it can be seen from. It uses the same pure-JS rasteriser as the game (`rasterize` in `voxel.ts`, no DOM, no canvas library), shelf-packs the views into ≤2048 px pages, and writes `atlas/<biome>.json` + `<biome>-<n>.webp`. The pages are encoded with sharp, a build-time dev dependency, as lossy WebP at quality 85 with lossless alpha. Result: 8 biomes, ~5,800 views, **5.0 MB** total in ~8 s. The old PNGs were 9.3 MB, and side by side at 3× zoom the two look the same. At run time the game downloads only the day's biomes, each just before its segment (≈0.4–0.8 MB each), and **never bakes** (0 runtime bakes measured). A missing angle uses the nearest atlas view. If an atlas is missing, the same catalog is baked in idle time instead. Trade-off: decoded atlas pages take ~12–26 MB per biome, with at most two biomes held at once. The generated files are git-ignored. Every atlas URL carries ?v=<hash of the baked files> (`__ATLAS_VERSION__`, set in vite.config.ts), so after a redeploy a browser never pairs a cached old page with a new index.
- **Bake size follows distance**: far views (small pitch) bake at 1–2 px per voxel, near ones at up to 4. Views off-screen for a given depth are never preloaded.
- **Per frame**: sparse off-track scenery (the column next to the track stays empty), one plain strip per side per row, lane grid lines as one stroke per row, cached colours and fill strings, a cached sky. At most ~6 ms of on-demand baking a frame; otherwise the nearest baked angle is shown and the right one bakes in idle time.
- **Ground in one pass:** side strips and the lane base are long polygons (one per colour run). All special and checker cells are batched by colour, the grid and track edges are one stroke per colour, and boost arrows, slow ripples and hazard brackets are batched too. This cut ~500 fills and strokes per frame to a few dozen; per-row ground drawing had been most of the frame. The checker is only drawn within 22 rows.
- **Fog is one gradient overlay** over the band beyond 14 rows, drawn right after the far rows. Before, every sprite angle had its own fog-tinted copy, which created and uploaded new canvases all the time and caused stutter.
- **Runner lean:** the runner keeps one straight-ahead view and leans in 2D while changing lanes, so nothing pops between 10° angle steps and no two angles are blended (see "Models stay inside their cell").
- **Atlas pages are decoded and uploaded to the GPU in idle time** right after download, instead of on the first frame that uses them. The canvas component is memoised, so the 10 Hz HUD updates do not re-render it.
- Dev profiler: `window.__profile()` plays a fresh run frame by frame and reports sim and draw times (p95, p99, worst frames). `window.__layers` switches ground, cells, grid, marks, objects, fog and sky on or off to measure each one. All dev hooks live in `src/client/devHooks.ts` and are not in the production bundle.
- **Adaptive quality**: if drawing stays above 11 ms, the pixel ratio and draw distance step down (2×/46 rows → 1.5×/40 → 1×/32), and step back up after it stays under 4 ms.
- Steady state is about 2 ms a frame at 360 px (desktop browser). Dev builds expose `window.__bench(frames, warmup)` and `window.__cache()`.

The same reading applies in every biome:

| Cell | On the track |
|---|---|
| Crash | a tall or solid obstacle on a **red-tinted cell with red corner brackets** (also marks low hazards: lava, crevasse, crater) |
| Slow | low rough stuff (moguls, dunes, waves, mud, crowd) on a muddy cell with **ripple lines** |
| Fast | a **bright cyan pad with white forward arrows** that scroll |
| Collect | a small spinning collectible (snowflake, drop, shard, shell, fruit, crystal, coin, sample) |
| Pickup | a **gold ring + light beam** with the vehicle itself spinning above it |

The preview shows this legend for each of the day's three biomes. The TEST bar has a **models** button that opens a gallery of all 23 vehicles (two angles each) and every biome's legend.

## Sound: synthesised, no audio files

`src/client/sfx.ts` builds every sound at run time with the Web Audio API, so there is nothing to download or license.

- **One-shots** are short oscillator or filtered-noise envelopes:
  - **gate**: a chime that climbs a semitone per gate in a row
  - **missed**: a low blip
  - **pole**: a thud
  - **collect**: a two-note coin
  - **air**: a rising whoosh, with a thump on landing
  - **smash**: a crunch
  - **slow**: a falling drone
  - **boost**: a rising sweep
  - **pickup**: an arpeggio
  - **expire**: two falling notes
  - **new biome**: a chime
  - **crash**: a noise burst with a low drop
  - **finish**: a fanfare
  - **start**: two beeps
  - **lane change**: a short swish
  - The same sound is played at most once per 45 ms.
- **No continuous ride sound.** There is no sliding hiss and no engine drone: they ran for the whole run and covered the music. Moving is heard only as short sounds: the lane-change swish, the landing thump, and steps for vehicles with feet or wheels on joints (`STEPS`). The ox cart and elephant get heavy hoof thuds; dog sleds, the dog team, the bicycle and the subway get light ticks.
- The audio starts on the first key or tap, because browsers require a gesture. Audio is suspended while the tab is hidden.
- The run header has a button that cycles **Sound** (music and effects) → **No music** → **Muted**. The choice is remembered in localStorage.

### Background music (`src/client/music.ts`)

The music is composed at run time as a 4-bar loop for each biome. Each biome has its own style:

| Biome | Mode | Tempo (BPM) | Character |
|---|---|---|---|
| Snow | major pentatonic | 112 | bells, bright |
| Desert | phrygian dominant | 100 | plucky square lead |
| Volcano | phrygian | 92 | low saw bass, heavy drums |
| Ocean | mixolydian | 96 | sine pads, rolling arpeggios |
| Jungle | dorian | 120 | marimba, full percussion |
| Icefield | lydian | 84 | sparse bells, no drums |
| City | natural minor | 124 | chiptune, driving beat |
| Space | whole-tone | 72 | floating bells, no drums |

- **Melody**: generated from the day's seed, so each biome has its own tune that day, and every player hears the same one. Chord tones fall on the strong beats, with small steps in between.
- **Layers**: a pad holding the chord, bass, lead, arpeggio and chip drums (sine kick, noise hat and snare).
- **Speed**:
  - The tempo goes from −15 % to +25 % of the biome's base tempo.
  - Past half speed, arpeggios start.
  - Near top speed, the drums go up one level, so the ambient biomes get a beat too.
- **Phases**:
  - Before the start, only the pad and a soft lead play.
  - A new biome restarts the loop in its own style.
  - On a crash or finish, the music fades out.
- **Scheduling**: notes are queued about 0.3 s ahead on the audio clock. A 50 ms timer tops the queue up as well as the render loop, so slow or throttled frames cause no gaps.
- **Levels**: master 0.9, then a compressor; music bus 0.9. Measured during a run, music averages about −29 dB RMS against about −25 dB for the whole mix. Before this it was about −41 dB under a −32 dB mix, which is why it could not be heard.

## First 15 seconds and sharing

- **How to play** (`Intro.tsx`): three cards that advance by themselves every 5 s, so about 15 s in all; a tap moves on sooner.
  1. **Switch lanes**: a small animated runner hops lanes.
  2. **Read the ground**: the first biome's real sprites, with what each one does.
  3. **Go fast, finish**: Tuck / Brake and par.
  - It opens on the first visit; after that, from **How to play (15 s)** on the start card.
- **Share image** (`shareCard.ts`, 1200 × 630, shown on the result card and saved with **Save image**):
  - the whole day's track as a strip, with the exact path you took (the sim records the lane of every row) and 🏁 or 💥 where it ended;
  - the three biome names, the score, time vs par or the crash distance, gates, and your rank of N.
  - The score breakdown table is folded under **Score breakdown**.
- **Share my run** posts a Wordle-style comment, built on the server from its replay of your best run:

  ```
  Grid Expedition 2026-11-22 · **6870**
  🏙️✅ → 🏜️✅ → 🏔️✅
  ⏱️ 27.3 s (par 49.3 s)
  🚩 5 gates · ⭐ 62 · 🚁 1 ride
  #1 of 1 today
  ```

  Each biome gets ✅ if you crossed it, 💥 if you crashed there, ⬜ if you never reached it. A streak of 2+ days adds 🔥.

## Models stay inside their cell

- Every model gets a fit scale (`Entry.fit` in `voxel.ts`), measured from its voxels at bake time and stored in the atlas next to `lift`. Nothing is drawn wider than one cell, so no obstacle seems to block the next lane.
- Track objects are also at most one cell long. Vehicles may be up to 2.5 cells long.
- Examples: the helicopter is drawn at 0.4× (its rotor was 2.5 cells wide), the hot-air balloon at 0.5×, the elephant at 0.55×, and most crash obstacles at 0.86–0.92×.
- The runner always uses its single straight-ahead view, so it never looks turned in the outer lanes. A lane change shows as a 2D lean of that one sprite around its ground point, up to about 14°. The old way blended two pre-rendered angles and left a visible double image. The runner now needs only a few views (straight ahead at a few heights, plus side-on for the crash pose), so the atlas is 4.91 MB.

## Endless mode

Open it with **Play endless** under the track preview. There is no finish line; one crash ends the run.

- **Track** (`src/shared/endless.ts`): normal generated 450-row legs joined end to end. Each leg has three fresh biomes, never the same biome twice in a row, and its finish row turned into plain ground. A leg starts with 16 empty rows, so the runner can cross over from wherever the last safe line ended.
- **Difficulty**: every leg adds 2 % obstacle density, up to +25 % from leg 13 on.
- **Same for everyone**: the endless track is fixed per date.
- **Generated on demand**: the track is kept 200 rows ahead of the runner (`keepAhead`). Smashed and collected cells far behind are forgotten, because the autopilot copies them for every line it tries and long runs got slower and slower.
- **Daily endless leaderboard**: ranked by distance, with its own Redis keys (`ge:elb:{date}`, `ge:euser:{user}:{date}`).
  - `POST /api/endless { rows, inputs }` works like the daily score check. The server rebuilds the date's endless track and replays the inputs (`replayEndless`), up to 2 h of play.
  - It stores the distance the replay reached. A claim that differs from the replay, a malformed log, or autopilot inputs get a 400.
  - Replaying a 13-minute run takes about 35 ms.
  - `GET /api/endless-leaderboard` returns the top 10 and your rank; `/api/today` also returns `myEndlessBest`.
- **HUD and result card**: the HUD shows distance in metres and no par. The result card shows distance, time, today's best, your rank and the top 10.
- **How far the autopilot gets**: `npm run autotest -- --endless --days 5 --max-legs 200`. Every leg keeps a guaranteed open lane and the autopilot looks 22 rows ahead, so it almost never crashes. Over 5 days with a 200-leg cap, 4 runs reached the cap: 90,000 rows, 180 km, about 88.5 min of play. One crashed in leg 155 (139 km, 68:44) on a Jungle crash cell with the ox cart, at the maximum +25 % density. Simulating a 200-leg run takes about 80 s.

## Timed vehicles last longer

- Every timed vehicle lasts 3× its listed length (`TIMED_LENGTH` in `src/shared/vehicles.ts`):
  - most vehicles: 30 rows
  - Helicopter, Balloon and Subway: 24 rows
  - Zipline and Rocket: 18 rows
- 30 rows is about 2 s at cruise speed. Before, it was 6–10 rows, well under a second.
- The generator plans each segment's two pickup windows together. A wall that would fall inside a window is skipped, so both longer windows always fit.
- The tests read each length from the data instead of hard-coding it.

## Layout (spec §16)

```
src/shared/types.ts     Cell, BiomeId, VehicleDef, API types
src/shared/biomes.ts    §6 the 8 biomes: palette, cell names, base vehicle (data only)
src/shared/vehicles.ts  §7–§8 VehicleDef rows: 8 base + 15 timed (data only)
src/shared/grid.ts      rows/lanes, segments 0–149 / 150–299 / 300–449, cell lookup
src/shared/course.ts    seed → biome shuffle; track generation, safe line, pickup planning
src/shared/sim.ts       movement, cell resolution, scoring, par time, fixed ticks + input log + replay; no rendering
src/shared/rng.ts       FNV-1a + mulberry32, dates
src/server/app.ts       §13 routes, Redis keys, flair, journeys log, daily post / menu / install
src/server/daily.ts     puzzle:{date} = { biomes, parSeconds }, server-side course
src/server/memory.ts    in-memory Redis + fake Reddit (browser-safe; used by the web build and the tests)
src/client/backend.ts   runs the routes in the page (localStorage); api.ts calls it instead of fetch
src/client/sfx.ts       Web Audio sound effects · music.ts: per-biome generated music (no files)
src/client/voxel.ts     voxel modelling kit + sprite baker/cache · models.ts: every model
src/client/Gallery.tsx  legend + model gallery
src/client/…            App (HUD, result card, leaderboard), ExpeditionCanvas (loop + input),
                        render.ts (projection, ground marks, billboards), TrackPreview (preview + minimap)
tests/acceptance.ts     §17 tests 1–9
src/server/index.ts     Devvit server entry · devvit.json: app config · src/client/platform*.ts: Reddit vs local switch
```

`sim.ts` is imported by both the client (the live run) and the server, which replays submitted runs with it. Vehicles have no code of their own; the sim only reads the flags in each row.

## Decisions where the spec was open or conflicting

- **Pickup window (§9).** "At least 12 rows before the dense section" and "the dense section is inside the duration" can't both hold for a 6–10-row vehicle. As built: there is a clear approach corridor from the safe line starting 12 rows before the pickup, and the dense patch starts 2 rows after the pickup and ends inside the vehicle's duration. To make this possible, pickup windows are planned first: the safe line stays fixed inside each window, and gates, ramps, and walls are kept out of it.
- **Elephant "cannot use Ramp".** This needed a data flag, so I added `noRamp` to `VehicleDef`. It is still a data row, not a separate code path.
- **Rocket backpack.** Every row where it lands is a "landing row", and landing rows allow 0 lane change. So while the rocket is active you hop straight ahead, 2 rows at a time.
- **Missed gate.** Passing a gate row outside the opening counts as missed and resets the combo, the same as hitting a pole. While a `noGate` vehicle is active, gate rows do nothing and the combo is untouched.
- **Ramp air** is a fixed 5 rows, so it can be planned from the preview.
- **Leaderboard.** `lb:{date}` stores the plain best score. Ties are broken by when each player set that best (`submittedAt` in `user:{id}:{date}`).
- **Score check: the server replays every run.**
  - The live run advances in fixed ticks of 1/120 s, and records each input as a `[tick, code]` pair in `s.log`. Inputs are lane left/right, Tuck on/off and Brake on/off. In auto mode, the autopilot's lane requests are recorded too.
  - `POST /api/run` sends only `{ score, seedCheck, inputs }`. The server rebuilds the day's track, reruns the whole run from the inputs with the same `sim.ts` (`replay`), and stores the replay's score.
  - The server rejects the run with a 400, and writes nothing, if the log is malformed (bad pairs, ticks out of order, unknown codes, over 40,000 numbers), if the run never ends within 10 minutes, or if the claimed score differs from the replay. A `seedCheck` mismatch gets a 409.
  - The sim uses only + − × ÷ and min/max, so the replay comes out bit-identical in every JS engine. `npm run autotest -- --all-routes --grab` replays all 336 runs and they match exactly.
  - **Autopilot runs are refused.** Codes 6–10 are the autopilot's lane requests, which no player control produces, so a log containing them gets a 400 and nothing is stored. In dev, auto runs are not submitted at all.
  - What it does not stop: a script that turns the autopilot's choices into ordinary left/right presses. That gives exactly the same run (the acceptance test does this conversion), and the server cannot tell it from a very good player. Catching it would take input-timing analysis, which is out of scope here.
  - The canvas draws between the last two ticks, so motion stays smooth at 60, 90, 120 or 144 Hz.
- **Pause.**
  - Open it with the ❚❚ button on the track, or the P or Esc key. Leaving the page also pauses: switching tabs or apps, opening devtools, or a phone call.
  - While paused, the sim stops, the sound fades, and the track is hidden behind a 90 % overlay, so a pause is not free time to study the road ahead.
  - Resume with the button, P, Esc or Space.
  - **View track** during a run pauses it and keeps it: the run screen stays mounted but hidden, ignores keys and draws nothing. The preview button reads "Back to the run (paused)".
- **Sound on phones.** Audio unlocks on pointerup, touchend and click as well as pointerdown and keydown. On a touch screen a finger going down is not a user gesture, so without this the first tap was silent.
- **Loading hint.** Atlas pages are fetched with byte-level progress.
  - Before the first biome is in, the Start button reads "Loading Space 45%".
  - After 10 s the run can start anyway: missing sprites are baked on the fly.
  - During a run, a small "Loading Jungle · 60%" badge appears if the next biome is still downloading within 60 rows of it.
- **Journeys.** One `[journey] finish bucket=…` log line per finished run, as in Sofa Lab. Nothing is sent for crashes.
- **Canvas** is up to 480 px wide with a height:width ratio of about 3:2, capped by the viewport.

## Status

- `npm test` passes all 12 tests: §17 1–9, par time, time score, and the autopilot finishing 5 days. `npm run build` passes.
- `npm run autotest -- --all-routes --grab` finishes 336 of 336 runs, covering every biome in every segment position.
- Sound effects and per-biome music are synthesised at run time (no audio files).
- Played in the browser at 360 px and at desktop size: preview → run → crash → result card → retry → finish (3314) → leaderboard → share (copied) → reload keeps best and streak → switching players and the next UTC day work. There are no `/api` network requests, and the built `dist/` runs on a static server.
- Still to do:
  - Try it on a real phone (touch, frame rate, iOS audio).
  - Run §17 test 10 in r/gridexpedition_dev. The game is on Devvit now; see "On Reddit (private playtest)".
- This repository previously held Sofa Lab. Its code is in the history at commit `827999c`.

## Win rate by player skill (`npm run winrate`)

Simulated players are the autopilot with a shorter look-ahead plus a random slip rate per row (any allowed lane instead of the planned one). They are models of skill, not real players. Over 40 days × 3 tries, from 2026-11-26:

| Player | Daily: finish | Daily: beat par | Avg score | Endless: median (best) |
|---|---|---|---|---|
| Expert: 6 rows ahead, no slips, Tuck | 100 % | 100 % | 6871 | ≥ 9 km (all hit the 10-leg cap) |
| Good: 4 rows, 1 % slips, Tuck | 63 % | 63 % | 4531 | 1.59 km (5.24 km) |
| Casual: 3 rows, 3 % slips, no Tuck | 28 % | 19 % | 1635 | 0.53 km (2.01 km) |
| Beginner: 2 rows, 6 % slips, no Tuck | 3 % | 3 % | 528 | 0.22 km (1.54 km) |

Casual players crash around row 170, early in the second biome, where obstacle density passes about 10 %.
