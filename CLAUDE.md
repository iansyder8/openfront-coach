# OpenFront coach — notes for Claude

Ian (UK TV producer) plays OpenFront.io solo on a locally patched "coach build" and pastes the
panel's **log** JSON (`{final, history, alerts}`) after each game. Your job: review the game
candidly (direct, specific numbers, no hedging), then improve the coach rules when a game shows
a gap or a bug, commit, and push so he can run `bash coach.sh pull`.

**Fair play:** the coach only runs in singleplayer (`GameType.Singleplayer`). Never build anything
that reads game state in live/multiplayer games (OpenFront ToS 6.5 bans modified clients and
third-party advantage tools). Post-game replay review of finished games (`coach.sh review`) is fine.

## Repo layout
- `coach.patch` — `git diff` of the coach against OpenFront commit `4d8608d7e3516bcae5152c75d54f7dd70e23bbb3`
  (adds `src/client/coach/Coach.ts`, registers it in `src/client/hud/GameRenderer.ts`).
- `coach.sh` — install / start / pull / update / review.
- `CoachReview.ts` — headless replay of an archived online game (copied into `tests/replay/` of an
  OpenFront checkout at the record's `gitCommit`).

## Editing the coach
```bash
git clone https://github.com/openfrontio/OpenFrontIO.git /tmp/of && cd /tmp/of
git checkout 4d8608d7e3516bcae5152c75d54f7dd70e23bbb3 && git apply <repo>/coach.patch
# needs Node 24 / npm 12 (engine-strict): npm install --prefix /tmp/n24 node@24 npm@12; PATH=/tmp/n24/node_modules/.bin:$PATH
npm run inst
# edit src/client/coach/Coach.ts (rules live in advise()), then:
npx prettier --write src/client/coach/Coach.ts && npx tsc --noEmit -p . | grep -i coach
git diff 4d8608d7e3516bcae5152c75d54f7dd70e23bbb3 -- src > <repo>/coach.patch
```
Test rules without a browser: write `tests/x.mts` that sets `globalThis.window = globalThis`,
imports `CoachController`, does `Object.create(CoachController.prototype)`, initialises
`weakSince`, `mirvSoonFirst`, `history`, and calls `advise({t, winPct, inSpawnPhase, gameOver, me, players})`
with a snapshot rebuilt from the pasted log at the moment in question. Run with `npx tsx`. Delete it after.

## Units and prices
- Troops are stored ×10 internally; everything in the coach/log is HUD units (÷10).
- City +25K cap each. City 125K→250K→500K→1M; Port/Factory share that counter; Defence post
  50K steps to 250K; SAM 1.5M then 3M; Silo 1M; Atom 750K; Hydrogen 5M; MIRV 25M (+15M per MIRV launched).
- Win = 80% land. Breaking an alliance: −50% defence, −20% speed for 30s.

## Rules in advise() (keys)
nuke alerts · boats · landattack · slider-danger · weak / weak-cancel (CANCEL after 30s cumulative
feeding one target, persists across relaunches) · war:<name> (bigger neighbour attacking) ·
siege (under attack with gold banked → posts, SAM, cities) · ally:<name> renew/ignore
(neighbouring ally ≤⅓ your size → IGNORE; any pending RENEW suppresses breaknow and stall's "break now"; nukeRisk = ally has silos and you have
< 1 SAM per 3 cities → always RENEW, no breaknow, stall says "get N more SAMs first") · mirv:<name> (can afford NOW) · mirvsoon (neighbours/top-5
only, once per nation for 60s) · empty · idle (≥80% cap, no attack) · stall (land barely moving for 60s;
names ally in the way; "break now" at ≥3× before 8:00, ≥5× after) · idlegold · city · sam-now (red:
no SAM, affordable, silo neighbour) / sam / sam-more (below 1 SAM per 3 cities, affordable) · port · ask:<nation> (before 3:00) · target (never a bigger
nation attacking you) · slider-full · slider (only if ≤60% really sends 1.6× and target < your troops) ·
wild · breaknow / boxed · slider-low · bigally · mirvme (25M + SAM cover → MIRV the rival with most cities) · hbomb (only when ≥30% troops and nothing incoming).
idlegold fires at max(3M, 3× city cost).
`tiny()` hides leftovers (<0.3% land or <3% of your tiles after 3:00).

## Ian's recurring mistakes (check every log)
1. Boxed in by allies and waiting out timers instead of breaking the weak one.
2. Troop bar full with nothing attacking; slider parked at 35–40% all game.
3. Gold banked instead of cities/SAMs; no SAM despite silo neighbours; idle 10M+ late.
4. Feeding small attacks into a bigger army (e.g. 400 vs 166K) — especially counter-attacking whoever attacked him.
5. Crowded spawns among nations (Africa middle, Iberia). Good: coasts with only tribe dots nearby
   (Europe: White Sea/Finland; Africa: far south or west bulge tip).
6. Underpowered early tribe attacks at 31–35% slider; first city built late.

## Game history (short)
Wins: Europe 20:43 (White Sea), 42-min win (125M idle gold), 18:47, 13:42 (boxed 2:30–3:30),
World 23:46 (29 SAMs, only ~5 cities lost to ~40 nukes; stalled 3:00–11:30 behind allies; 65M unspent),
Oceania 17:15 (Queensland war 7–12 min, 5 cities at 10:00, stalls at 35% and 72%).
Losses/abandons: Africa 23:35 eliminated (crowded spawn, 9.6M idle while three nations attacked),
Africa 5:13 (coach bug told him to hit Botswana at 2×; fixed), Africa 7:23 (ignored BREAK Greece,
no SAM → Italy nuke, 1:1 fight with Sudan).
Africa 6:41 (log mid-game): idle at 95% cap 2:50–5:30, fed Egypt through four CANCELs, let Libya's
alliance lapse while break advice was showing → Libya/Israel/Somalia pile-on, 6→4 cities, 1.3M unspent.
Africa 13:40 (log mid-game): stalled 3:00–5:30 (ignored BREAK Egypt), fed Syria 70s and Yemen 80s through
CANCELs, reached #1 at 11:30 with 556K troops, then coach said IGNORE Sudan (2 silos) with 1 SAM over 7 cities
→ three atom bombs, slider 62% into Sudan, 478K→4K troops in 70s, 9→7 cities, SAM lost, 5.3M unspent.
Coach fixed: nukeRisk guard.
