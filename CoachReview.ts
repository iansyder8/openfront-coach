/**
 * OpenFront Coach — post-game review of a finished (archived) game.
 *
 * Replays an archived game record through the deterministic core simulation
 * and samples one player's stats every 10 seconds, producing the same
 * {final, history, alerts} log shape as the in-game coach's "log" button,
 * plus a plain-text summary. It only reads a finished game's public record.
 *
 * Run from an OpenFront checkout at the record's gitCommit (coach.sh does this):
 *   npx tsx tests/replay/CoachReview.ts <record.json> --player <name|clientID> [--out file]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../src/core/configuration/Config";
import { Executor } from "../../src/core/execution/ExecutionManager";
import {
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { createNationsForGame } from "../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../src/core/game/TerrainMapLoader";
import { GameUpdateType, HashUpdate } from "../../src/core/game/GameUpdates";
import { GameRunner } from "../../src/core/GameRunner";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { GameRecord, GameStartInfo } from "../../src/core/Schemas";
import {
  decompressGameRecord,
  simpleHash,
  toWireGameStartInfo,
} from "../../src/core/Util";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TICKS_PER_S = 10;
const SAMPLE_TICKS = 100; // 10 s
const hud = (n: number) => Math.round(n / 10); // HUD shows troops / 10
const mm = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
  return String(Math.round(n));
};

function args() {
  const a = process.argv.slice(2);
  const o = { source: "", player: "", out: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--player") o.player = a[++i] ?? "";
    else if (a[i] === "--out") o.out = a[++i] ?? "";
    else o.source = a[i];
  }
  if (!o.source) throw new Error("usage: CoachReview.ts <record.json> --player <name>");
  return o;
}

async function main() {
  const opts = args();
  console.debug = () => {};
  const log = console.log.bind(console);
  console.log = () => {}; // silence the simulation's own chatter
  console.warn = () => {};
  const record = decompressGameRecord(
    JSON.parse(fs.readFileSync(opts.source, "utf8")) as GameRecord,
  );
  const info = record.info;
  const humansInfo = info.players;

  // Pick the player to review.
  const q = opts.player.toLowerCase();
  const match = humansInfo.filter(
    (p) =>
      p.clientID === opts.player ||
      (q !== "" && p.username.toLowerCase() === q),
  );
  const fuzzy =
    match.length > 0
      ? match
      : humansInfo.filter((p) => q !== "" && p.username.toLowerCase().includes(q));
  if (fuzzy.length !== 1) {
    log(
      fuzzy.length === 0
        ? `No player matching "${opts.player}". Players in this game:`
        : `"${opts.player}" matches several players:`,
    );
    for (const p of fuzzy.length ? fuzzy : humansInfo)
      log(`  ${p.username}  (clientID ${p.clientID})`);
    log(`Re-run with --player "<exact name>" or the clientID.`);
    process.exit(2);
  }
  const target = fuzzy[0];

  const gameStart: GameStartInfo = toWireGameStartInfo({
    gameID: info.gameID,
    lobbyCreatedAt: info.lobbyCreatedAt,
    config: info.config,
    players: humansInfo,
    tribes: info.tribes,
  });
  const config = new Config(info.config, null, false);
  const terrain = await loadTerrainMap(
    info.config.gameMap,
    info.config.gameMapSize,
    new NodeGameMapLoader(path.join(ROOT, "resources/maps")),
    false,
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.username,
        PlayerType.Human,
        p.clientID,
        random.nextID(),
        p.isLobbyCreator ?? false,
        p.clanTag,
        p.friends ?? [],
        p.teamIndex ?? null,
      ),
  );
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    humans.length,
    random,
  );
  const game = createGame(
    humans,
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );
  let fatal: string | undefined;
  const computed = new Map<number, number>();
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined, gameStart.tribes?.map((t) => t.name)),
    (gu) => {
      if ("errMsg" in gu) {
        fatal = gu.errMsg;
        return;
      }
      for (const hu of (gu.updates[GameUpdateType.Hash] ?? []) as HashUpdate[])
        computed.set(hu.tick, hu.hash);
    },
  );
  runner.init();

  const recorded = new Map<number, number>();
  for (const t of record.turns)
    if (t.hash !== null && t.hash !== undefined) recorded.set(t.turnNumber, t.hash);

  log(
    `Reviewing ${target.username} in ${info.gameID}: ${info.config.gameMap}, ` +
      `${info.config.gameMode}, ${humansInfo.length} humans, ${record.turns.length} turns`,
  );

  const history: any[] = [];
  const alerts: { t: number; text: string }[] = [];
  const seenNukes = new Set<number>();
  let me: Player | null = null;
  let prevCities = 0;
  let prevLand = 0;
  let peakRank = 999;
  let peakLand = 0;
  let diedAt: number | null = null;
  let outOfSync = false;
  let spawned = false;

  const validLand = () =>
    Math.max(1, game.numLandTiles() - game.numTilesWithFallout());
  const sec = () => Math.round(game.ticks() / TICKS_PER_S);

  for (const turn of record.turns) {
    runner.addTurn(turn);
    if (!runner.executeNextTick()) {
      console.error(`Replay stopped at turn ${turn.turnNumber}: ${fatal}`);
      break;
    }
    const recHash = recorded.get(turn.turnNumber);
    const myHash = computed.get(turn.turnNumber);
    if (!outOfSync && recHash !== undefined && myHash !== undefined && myHash !== recHash) {
      outOfSync = true;
      alerts.push({ t: sec(), text: "(replay drifted from the recorded game here)" });
    }
    me ??= game.playerByClientID(target.clientID);
    if (!me) continue;

    // incoming nukes aimed at my land (log once per missile)
    if (game.ticks() % 5 === 0) {
      for (const u of game.units(UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV)) {
        if (seenNukes.has(u.id()) || u.owner() === me) continue;
        const tt = u.targetTile();
        if (tt === undefined || game.owner(tt) !== me) continue;
        seenNukes.add(u.id());
        alerts.push({ t: sec(), text: `${u.type()} launched at you by ${u.owner().displayName()}` });
      }
    }

    if (me.numTilesOwned() > 0) spawned = true;
    if (!spawned || game.inSpawnPhase()) continue;
    if (game.ticks() % SAMPLE_TICKS !== 0 && me.isAlive()) continue;
    const t = sec();
    const alive = game.players().filter((p) => p.isAlive());
    const ranked = [...alive].sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const rank = me.isAlive() ? ranked.indexOf(me) + 1 : 0;
    const land = +((me.numTilesOwned() / validLand()) * 100).toFixed(2);
    const troops = hud(me.troops());
    const maxT = hud(config.maxTroops(me));
    const cities = me.units(UnitType.City).length;
    const out = me.outgoingAttacks().filter((a) => a.isActive() && !a.retreating());
    const inc = me.incomingAttacks().filter((a) => a.isActive() && !a.retreating());
    const top = ranked.find((p) => p !== me);
    const from = [...new Set(inc.map((a) => a.attacker().displayName()))];

    if (me.isAlive()) {
      peakRank = Math.min(peakRank, rank);
      peakLand = Math.max(peakLand, land);
    } else if (diedAt === null) {
      diedAt = t;
      const prevFrom: string[] = history[history.length - 1]?.incomingFrom ?? [];
      const killers = from.length ? from : prevFrom;
      alerts.push({ t, text: "Eliminated" + (killers.length ? ` (attacked by ${killers.join(", ")})` : "") });
    }
    if (cities < prevCities - 3)
      alerts.push({ t, text: `Lost ${prevCities - cities} cities in 10s (${prevCities} → ${cities})` });
    if (land < prevLand - 1.5)
      alerts.push({
        t,
        text: `Land fell ${prevLand}% → ${land}%` + (from.length ? ` (attacked by ${from.join(", ")})` : ""),
      });
    prevCities = cities;
    prevLand = land;


    history.push({
      t,
      rank,
      landPct: land,
      troops,
      maxTroops: maxT,
      gold: Number(me.gold()),
      cities,
      sams: me.units(UnitType.SAMLauncher).length,
      silos: me.units(UnitType.MissileSilo).length,
      defensePosts: me.units(UnitType.DefensePost).length,
      outgoing: out.length,
      outgoingTroops: hud(out.reduce((s, a) => s + a.troops(), 0)),
      incomingTroops: hud(inc.reduce((s, a) => s + a.troops(), 0)),
      incomingFrom: from,
      topRival: top ? `${top.displayName()} ${((top.numTilesOwned() / validLand()) * 100).toFixed(1)}%` : null,
    });
    if (diedAt !== null) break;
  }

  // ---------- summary ----------
  const h = history.filter((s) => s.t > 60);
  const idle = h.filter((s) => s.outgoing === 0 && s.maxTroops > 0 && s.troops >= 0.8 * s.maxTroops);
  const noAttack = h.filter((s) => s.outgoing === 0);
  const rich = h.filter((s) => s.gold >= 5_000_000);
  const last = history[history.length - 1] ?? {};
  const winnerId = Array.isArray(info.winner) ? info.winner[1] : undefined;
  const won = winnerId === target.clientID;
  const at = (sec: number) => history.reduce((b, s) => (Math.abs(s.t - sec) < Math.abs(b.t - sec) ? s : b), history[0]);
  const lines = [
    `# Review: ${target.username} — ${info.config.gameMap}, ${info.gameID}`,
    ``,
    won
      ? `Result: WON at ${mm(last.t)}`
      : diedAt !== null
        ? `Result: eliminated at ${mm(diedAt)} (peak rank ${peakRank}, peak land ${peakLand}%)`
        : `Result: finished rank ${last.rank} with ${last.landPct}% (peak rank ${peakRank}, peak land ${peakLand}%)`,
    ``,
    `Timeline (rank · land · cities · SAMs):`,
    ...[120, 300, 480, 600, 900, 1200, 1500, 1800]
      .filter((s) => s <= (last.t ?? 0) + 5)
      .map((s) => at(s))
      .concat(last.t && last.t % 60 !== 0 ? [last] : [])
      .map((s) => `  ${mm(s.t)}  ${s.rank ? "#" + s.rank : "out"} · ${s.landPct}% · ${s.cities} cities · ${s.sams} SAMs`),
    ``,
    `Habits:`,
    `  No attack running: ${Math.round((100 * noAttack.length) / Math.max(1, h.length))}% of the game`,
    `  Troops ≥80% of cap with nothing attacking: ~${idle.length * 10}s` +
      (idle.length ? ` (${idle.slice(0, 8).map((s) => mm(s.t)).join(", ")}${idle.length > 8 ? "…" : ""})` : ""),
    `  Gold ≥5M sitting idle: ~${rich.length * 10}s` +
      (rich.length ? `, peak ${fmt(Math.max(...rich.map((s) => s.gold)))}` : ""),
    ``,
    `Key events:`,
    ...(alerts.length ? alerts.slice(0, 40).map((a) => `  ${mm(a.t)}  ${a.text}`) : ["  none"]),
  ];
  let compared = 0;
  for (const [tick, h2] of recorded) if (computed.has(tick)) compared++;
  lines.push(``, `Replay check: ${compared} recorded checkpoints compared, ${outOfSync ? "DRIFTED" : "all matched"}.`);
  if (outOfSync)
    lines.push(``, `WARNING: replay drifted from the recorded game — numbers after that point may be off.`);
  const summary = lines.join("\n");
  log("\n" + summary);

  const outFile = opts.out || `review-${info.gameID}.json`;
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        final: { gameID: info.gameID, map: info.config.gameMap, player: target.username, won, diedAt, peakRank, peakLand, last },
        history,
        alerts,
        summary,
      },
      null,
      1,
    ),
  );
  fs.writeFileSync(outFile.replace(/\.json$/, ".txt"), summary + "\n");
  log(`\nSaved ${outFile} (paste it to Claude for a full review).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
