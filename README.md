# OpenFront Coach build

A local copy of OpenFront with a coach built in. It only runs in **solo games**, never in public or private lobbies.

What you get:

- **A coach panel in the top-right of the game.** It updates twice a second and shows:
  - your rank and land % against the 80% needed to win
  - troops against your cap, with a colour zone (under 30% is rebuilding, 30–55% is peak growth, 80%+ is wasting growth)
  - your slider and how many troops it would send
  - your gold, your next city's cost, and your neighbours ranked by your send-to-theirs ratio
  - your top rivals
- **Red alerts**: nukes or boats heading for your land, attacks bigger than your home army, alliances ending (Renew or Ignore, and why — a neighbouring ally a third your size gets Ignore), an underpowered attack (turning into CANCEL after 30s), WAR mode when a bigger neighbour attacks you, BREAK the alliance when an ally in your way is 3× weaker (first 8 min) or 5× weaker (later), a full troop bar with nothing running, BUY A SAM when a neighbour with silos borders you and you can afford it, a stall (land barely moving for a minute, naming the ally in your way), "spend it now" when you are under attack with gold banked, a neighbour or top-5 rival saving for a MIRV (shown once), anyone who can afford a MIRV, your own MIRV once you have 25M and SAM cover, and too few troops left at home.
- **Yellow "do next" tips**: build a city now, your first SAM, a port, the best target, raising the slider (60–70% when your bar is full), and asking neighbours for alliances early.
- **A "log" button** that copies the whole game history. Paste it to Claude for a review after the game.
- **Data Claude can read from Chrome**: `window.__coachBrief()` (compact) and `window.__coach` (the full map and every player).

Troop numbers match the in-game display. The game stores them ×10 internally, and the coach converts them for you.

## Setup (one-off, on your Mac)

1. You need `git` and Node.js. If you don't have them, run `xcode-select --install`, then `brew install node`.
2. Clone this repo and install:

```bash
git clone https://github.com/iansyder8/openfront-coach.git ~/openfront-coach/kit
cd ~/openfront-coach/kit
bash coach.sh install
```

The install:
- clones OpenFront into `~/openfront-coach/game` at the tested version
- fetches the exact Node 24 and npm 12 that OpenFront requires into `~/openfront-coach/.toolchain` (your system Node isn't touched)
- applies the patch and installs dependencies

It takes about 5 minutes.

## Getting coach updates

```bash
cd ~/openfront-coach/kit
bash coach.sh pull
```

This pulls the latest coach from GitHub and re-applies it to your game in a few seconds, without reinstalling. If the game is running, it reloads by itself.

## Play

```bash
bash coach.sh start
```

Chrome opens `http://localhost:9000`. Click **SOLO**, choose your map and difficulty, and play as normal. The coach panel appears once you spawn.

- The terminal will show errors about lobbies, the API, cosmetics and the 8787 port. That's normal when running offline: public lobbies and accounts don't work locally, but solo games do.
- Stop the game with Ctrl+C in the terminal.

## Coaching with Claude

1. Drag the `localhost:9000` tab into the Claude tab group.
2. Tell Claude you're on the coach build.
3. Claude reads `window.__coachBrief()` instead of taking screenshots. That's faster, and it covers the whole map.

## Reviewing an online game

This works on any finished public or private game, after it has ended. It downloads the game's public record, replays it on your Mac, and writes the same kind of log the coach panel gives you in solo. Nothing runs while you're playing.

1. Copy the game's link or ID. The ID is the code at the end of the game URL (for example `cuimG9JDdL`).
2. Once the game has finished, run:

```bash
bash coach.sh review cuimG9JDdL "YourName"
```

You can paste the whole URL instead of the ID. The script remembers your name, so next time `bash coach.sh review <ID>` is enough.

- **First run:** it sets up a second copy of OpenFront in `~/openfront-coach/replay` (about 5 minutes).
- **Version changes:** each game must be replayed on the exact version it was played on. When OpenFront releases a new version, the next review reinstalls for that version, which takes a few minutes.
- **Each review after that:** 15–60 seconds.

The terminal prints a short summary:
- the result
- a timeline of rank, land, cities and SAMs
- habits: time with no attack running, time with a full troop bar, time with idle gold
- key events: nukes aimed at you, and sudden losses of cities or land with who was attacking

The full log is saved to `~/openfront-coach/reviews/<ID>-review.json` and copied to your clipboard. Paste it to Claude for a proper review.

The last line checks the replay against the real game ("N recorded checkpoints compared, all matched"). If it says DRIFTED, numbers after that point may be off.

If the name doesn't match, it lists everyone in that game so you can pick the right one. Games can take a minute or two to appear after they end.

## Updating

```bash
bash coach.sh update
```

This tries the latest OpenFront. If the patch no longer fits, it stays on the tested version.

## Files

- `coach.patch` changes two things in OpenFront:
  - adds `src/client/coach/Coach.ts`
  - registers the coach in `src/client/hud/GameRenderer.ts` (2 lines)
- `CoachReview.ts` is the post-game replay reviewer. `coach.sh review` copies it into the replay copy.
- `coach.sh` handles install, start, update and review.

OpenFront is AGPL-3.0, and so is this patch. It only reads game state. It never sends moves or plays for you.
