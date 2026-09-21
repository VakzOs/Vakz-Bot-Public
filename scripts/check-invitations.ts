/**
 * Vérification du suivi des invitations (`npm run check:invitations`).
 *
 * Discord ne dit JAMAIS par quelle invitation un membre est entré : le module
 * « logs » le déduit en comparant les compteurs d'utilisation d'avant et
 * d'après (`diffInvites`). C'est une déduction, et une déduction fausse ne
 * casse rien — elle attribue simplement chaque arrivée au mauvais membre, dans
 * un journal que personne ne relira pour la contredire. D'où ce script, qui
 * rejoue les situations que le bot rencontre vraiment :
 *
 *   - le cas ordinaire (un compteur monte) ;
 *   - l'invitation créée puis empruntée dans la foulée ;
 *   - l'invitation à usage unique, que Discord SUPPRIME au moment même où elle
 *     sert — elle disparaît du relevé au lieu de voir son compteur monter ;
 *   - et surtout les cas où il faut se taire plutôt que deviner.
 *
 * Puis le comptage, sur une base JETABLE (jamais celle du bot) : c'est lui qui
 * répond à `/invitations`, et un classement qui se trompe de rang ne lève
 * aucune erreur non plus.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import type { BotContext } from '../src/core/module.js';
import {
  closeJoin,
  countTrackedJoins,
  diffInvites,
  inviterStats,
  lastJoinOf,
  recentlyInvitedBy,
  topInviters,
  type InviteState,
  type JoinOrigin,
} from '../src/modules/logs/invites.js';

let failures = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}`);
}

function check(label: string, got: JoinOrigin, expected: JoinOrigin): void {
  if (JSON.stringify(got) === JSON.stringify(expected)) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}`);
  console.error(`    attendu : ${JSON.stringify(expected)}`);
  console.error(`    obtenu  : ${JSON.stringify(got)}`);
}

/** Une invitation telle que le relevé la garde. `maxUses` à 0 = sans limite. */
function invite(
  uses: number,
  maxUses = 0,
  inviterId: string | null = 'AUTEUR',
  vanity = false,
): InviteState {
  return { uses, maxUses, inviterId, vanity };
}

function releve(entries: [string, InviteState][]): Map<string, InviteState> {
  return new Map(entries);
}

const inconnue: JoinOrigin = { source: 'unknown', code: null, inviterId: null, uses: null };

check(
  'un compteur qui monte désigne son invitation',
  diffInvites(
    releve([
      ['abc', invite(3)],
      ['xyz', invite(7, 0, 'LEA')],
    ]),
    releve([
      ['abc', invite(3)],
      ['xyz', invite(8, 0, 'LEA')],
    ]),
  ),
  { source: 'invite', code: 'xyz', inviterId: 'LEA', uses: 8 },
);

check(
  'une invitation créée puis empruntée aussitôt est rattachée',
  diffInvites(releve([['neuve', invite(0)]]), releve([['neuve', invite(1)]])),
  { source: 'invite', code: 'neuve', inviterId: 'AUTEUR', uses: 1 },
);

check(
  'un usage unique consommé (donc supprimé par Discord) est rattaché',
  diffInvites(
    releve([
      ['unique', invite(0, 1, 'SAM')],
      ['autre', invite(4)],
    ]),
    releve([['autre', invite(4)]]),
  ),
  { source: 'invite', code: 'unique', inviterId: 'SAM', uses: 1 },
);

check(
  'deux usages uniques disparus en même temps : on ne tranche pas',
  diffInvites(
    releve([
      ['a', invite(0, 1)],
      ['b', invite(0, 1)],
    ]),
    releve([]),
  ),
  inconnue,
);

check(
  'une invitation supprimée à la main, loin de son plafond, ne conclut rien',
  diffInvites(releve([['manuelle', invite(2, 50)]]), releve([])),
  inconnue,
);

check(
  'un compteur qui monte l’emporte sur une suppression simultanée',
  diffInvites(
    releve([
      ['unique', invite(0, 1, 'SAM')],
      ['vraie', invite(4, 0, 'NOA')],
    ]),
    releve([['vraie', invite(5, 0, 'NOA')]]),
  ),
  { source: 'invite', code: 'vraie', inviterId: 'NOA', uses: 5 },
);

check(
  'l’URL personnalisée du serveur est une origine, sans auteur',
  diffInvites(
    releve([['mon-serveur', invite(10, 0, null, true)]]),
    releve([['mon-serveur', invite(11, 0, null, true)]]),
  ),
  { source: 'vanity', code: 'mon-serveur', inviterId: null, uses: 11 },
);

check(
  'rien n’a bougé : on ne devine pas une invitation',
  diffInvites(releve([['abc', invite(3)]]), releve([['abc', invite(3)]])),
  inconnue,
);

// ── Le comptage, sur une base jetable ────────────────────────────────────────
// Montée par `migrate deploy` et non par `db push` : Prisma 7 refuse ce dernier
// à un agent sans consentement explicite, ce qui rendrait cette porte
// inlançable par celui-là même à qui on demande de la passer (cf. check-acces).
const dir = mkdtempSync(join(tmpdir(), 'vakz-invitations-check-'));
const url = `file:${join(dir, 'check.db')}`;
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
const ctx = { db } as unknown as BotContext;
const GUILD = 'guilde-de-test';

await db.logInviteJoin.createMany({
  data: [
    { guildId: GUILD, userId: 'u1', inviterId: 'lea', code: 'abc', source: 'invite' },
    { guildId: GUILD, userId: 'u2', inviterId: 'lea', code: 'abc', source: 'invite' },
    { guildId: GUILD, userId: 'u3', inviterId: 'lea', code: 'abc', source: 'invite' },
    { guildId: GUILD, userId: 'u4', inviterId: 'sam', code: 'xyz', source: 'invite' },
    { guildId: GUILD, userId: 'u5', inviterId: null, code: '', source: 'unknown' },
    { guildId: 'ailleurs', userId: 'u6', inviterId: 'lea', code: 'zzz', source: 'invite' },
  ],
});

const ferme = await closeJoin(ctx, GUILD, 'u2');
ok('un départ referme la bonne arrivée', ferme?.inviterId === 'lea');
ok('un départ ne se referme pas deux fois', (await closeJoin(ctx, GUILD, 'u2')) === null);

const lea = await inviterStats(ctx, GUILD, 'lea');
ok(
  'un membre parti reste compté, mais plus parmi les présents',
  lea.total === 3 && lea.present === 2 && lea.left === 1,
);

const classement = await topInviters(ctx, GUILD, 10);
ok(
  'le classement ordonne par total et n’emporte pas les autres serveurs',
  JSON.stringify(classement) ===
    JSON.stringify([
      { inviterId: 'lea', total: 3, present: 2 },
      { inviterId: 'sam', total: 1, present: 1 },
    ]),
);

ok('les arrivées sans origine sont comptées aussi', (await countTrackedJoins(ctx, GUILD)) === 5);
ok(
  'les derniers invités d’un membre remontent, départs compris',
  (await recentlyInvitedBy(ctx, GUILD, 'lea', 5)).filter((entry) => entry.leftAt !== null)
    .length === 1,
);

// Un membre qui revient par quelqu'un d'autre : deux lignes, la dernière fait foi.
await db.logInviteJoin.create({
  data: { guildId: GUILD, userId: 'u2', inviterId: 'sam', code: 'xyz', source: 'invite' },
});
ok(
  'un retour est rattaché à son nouvel inviteur',
  (await lastJoinOf(ctx, GUILD, 'u2'))?.inviterId === 'sam',
);
const leaApres = await inviterStats(ctx, GUILD, 'lea');
ok('et ne réécrit pas l’historique du premier', leaApres.total === 3 && leaApres.present === 2);

await db.$disconnect();
rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${String(failures)} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\n✔ Suivi des invitations : la déduction dit ce qu’elle doit dire.');
