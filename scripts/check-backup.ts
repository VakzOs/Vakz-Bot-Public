/**
 * Vérification de bout en bout de la sauvegarde des données (`npm run check:backup`).
 *
 * Le bot n'a pas de suite de tests : ce script en tient lieu pour la partie la
 * plus délicate du module « Sauvegarde » — le dump générique du schéma. Il
 * fabrique une base SQLite jetable, y sème des données représentatives (argent,
 * objets et inventaires, Route de l'Infini, votes, concours, bingo…), puis
 * vérifie l'aller-retour export → purge → restauration, sur le même serveur
 * comme vers un autre.
 *
 * Il ne touche JAMAIS la base du bot : il travaille dans un dossier temporaire.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  countRows,
  discoverTables,
  exportData,
  parseDataDump,
  restoreData,
} from '../src/modules/configbackup/dump.js';
import type { BotContext } from '../src/core/module.js';

const dir = mkdtempSync(join(tmpdir(), 'vakz-backup-check-'));
const url = `file:${join(dir, 'check.db')}`;
execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});

const db = new PrismaClient({ datasources: { db: { url } } });
const ctx = { db } as unknown as BotContext;

/**
 * Deux tables hors schéma Prisma, qui reproduisent la forme d'un **catalogue
 * partagé** : des entrées communes à tous les serveurs (`guildId` nul), des
 * entrées maison propres à un serveur, et des collections qui pointent vers les
 * deux. C'est exactement la forme du gacha — et le seul cas que le reste du
 * schéma ne sait pas produire. Le dump ne connaissant que ce qu'il découvre à
 * l'exécution, ces tables sont pour lui des tables comme les autres.
 */
async function createSharedCatalogue(): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE "Catalogue" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "guildId" TEXT,
      "source" TEXT NOT NULL,
      "sourceId" TEXT,
      "name" TEXT NOT NULL
    )`);
  await db.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "Catalogue_source_sourceId_key" ON "Catalogue"("source", "sourceId")',
  );
  await db.$executeRawUnsafe(`
    CREATE TABLE "Collection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "guildId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "entryId" TEXT NOT NULL,
      CONSTRAINT "Collection_entryId_fkey" FOREIGN KEY ("entryId")
        REFERENCES "Catalogue"("id") ON DELETE CASCADE
    )`);
}

/** Serveur d'origine, puis serveur cible d'une migration. */
const SOURCE = '100000000000000001';
const TARGET = '100000000000000002';

const failures: string[] = [];
function expect(label: string, condition: boolean): void {
  if (!condition) failures.push(label);
  console.log(`${condition ? '✅' : '❌'} ${label}`);
}

async function seed(guildId: string): Promise<void> {
  await db.guild.create({ data: { id: guildId, staffRoleIds: '["555"]' } });
  await db.moduleConfig.create({
    data: { guildId, module: 'economy', enabled: true, config: '{"a":1}' },
  });
  await db.memberEconomy.create({
    data: { guildId, userId: 'u1', balance: 1234, lastDailyAt: new Date('2026-01-02T03:04:05Z') },
  });
  const item = await db.item.create({
    data: { guildId, name: 'Épée', price: 99, buyable: false, effects: '[{"type":"heal"}]' },
  });
  await db.inventoryItem.create({ data: { guildId, userId: 'u1', itemId: item.id, quantity: 7 } });
  await db.marketListing.create({
    data: { guildId, sellerId: 'u1', itemId: item.id, quantity: 2, unitPrice: 50 },
  });
  await db.traveler.create({
    data: { guildId, userId: 'u1', distance: 4242, coins: 77, health: 33 },
  });
  await db.duckling.create({ data: { guildId, userId: 'u1', ownerId: 'u2', turnsLeft: 3 } });
  await db.memberLevel.create({ data: { guildId, userId: 'u1', xp: 5000, level: 12 } });
  const suggestion = await db.suggestion.create({
    data: { guildId, channelId: 'c1', authorId: 'u1', content: 'plus de chats' },
  });
  await db.suggestionVote.create({
    data: { suggestionId: suggestion.id, userId: 'u2', value: 'up' },
  });
  const giveaway = await db.giveaway.create({
    data: {
      guildId,
      channelId: 'c1',
      messageId: 'm1',
      prize: 'Nitro',
      hostId: 'u1',
      winnerCount: 1,
      endsAt: new Date('2026-05-05T00:00:00Z'),
    },
  });
  await db.giveawayEntry.create({ data: { giveawayId: giveaway.id, userId: 'u3' } });
  const game = await db.bingoGame.create({ data: { guildId } });
  await db.bingoCard.create({
    data: { guildId, gameId: game.id, userId: 'u1', numbers: '[1,2,3]' },
  });
  // Cache du module Logs : volontairement hors sauvegarde.
  await db.logMessageSnapshot.create({
    data: { id: 'msg1', guildId, channelId: 'c1', authorName: 'x' },
  });

  // Catalogue partagé : une entrée commune, une entrée maison, et une
  // collection qui pointe vers les deux.
  await db.$executeRawUnsafe(
    'INSERT INTO "Catalogue" ("id","guildId","source","sourceId","name") VALUES (?,?,?,?,?)',
    'cat-partage',
    null,
    'anilist',
    'A1',
    'Personnage du catalogue',
  );
  await db.$executeRawUnsafe(
    'INSERT INTO "Catalogue" ("id","guildId","source","sourceId","name") VALUES (?,?,?,?,?)',
    `maison-${guildId}`,
    guildId,
    'custom',
    null,
    'Personnage maison',
  );
  await db.$executeRawUnsafe(
    'INSERT INTO "Collection" ("id","guildId","userId","entryId") VALUES (?,?,?,?)',
    `col-partage-${guildId}`,
    guildId,
    'u1',
    'cat-partage',
  );
  await db.$executeRawUnsafe(
    'INSERT INTO "Collection" ("id","guildId","userId","entryId") VALUES (?,?,?,?)',
    `col-maison-${guildId}`,
    guildId,
    'u1',
    `maison-${guildId}`,
  );
}

/** Lignes d'une des tables hors schéma Prisma. */
async function rawRows(table: string, where = '1=1', ...params: unknown[]) {
  return db.$queryRawUnsafe<Array<Record<string, string | null>>>(
    `SELECT * FROM "${table}" WHERE ${where} ORDER BY "id"`,
    ...params,
  );
}

/** Photographie de tout ce qui doit survivre à un aller-retour. */
async function snapshot(guildId: string) {
  return {
    economy: await db.memberEconomy.findMany({ where: { guildId } }),
    items: await db.item.findMany({ where: { guildId } }),
    inventory: await db.inventoryItem.findMany({ where: { guildId } }),
    listings: await db.marketListing.findMany({ where: { guildId } }),
    travelers: await db.traveler.findMany({ where: { guildId } }),
    ducklings: await db.duckling.findMany({ where: { guildId } }),
    levels: await db.memberLevel.findMany({ where: { guildId } }),
    suggestions: await db.suggestion.findMany({ where: { guildId } }),
    votes: await db.suggestionVote.findMany({ where: { suggestion: { guildId } } }),
    giveaways: await db.giveaway.findMany({ where: { guildId } }),
    entries: await db.giveawayEntry.findMany({ where: { giveaway: { guildId } } }),
    bingo: await db.bingoGame.findMany({ where: { guildId } }),
    cards: await db.bingoCard.findMany({ where: { guildId } }),
    catalogue: await rawRows('Catalogue', '"guildId" = ?', guildId),
    collection: await rawRows('Collection', '"guildId" = ?', guildId),
  };
}

try {
  await createSharedCatalogue();
  await seed(SOURCE);

  // --- Découverte du schéma -------------------------------------------------
  const tables = (await discoverTables(ctx)).filter((table) => table.kept);
  console.log(
    'Tables retenues :',
    tables.map((t) => `${t.name}(${t.depth}${t.scoped ? '' : '*'})`).join(' '),
  );
  expect(
    'les tables filles sans guildId sont découvertes',
    ['SuggestionVote', 'GiveawayEntry'].every((name) => tables.some((t) => t.name === name)),
  );
  expect('le cache du module Logs est exclu', !tables.some((t) => t.name === 'LogMessageSnapshot'));
  expect(
    'un parent est toujours ordonné avant son enfant',
    tables.findIndex((t) => t.name === 'Item') <
      tables.findIndex((t) => t.name === 'InventoryItem'),
  );

  // --- Export ---------------------------------------------------------------
  const before = await snapshot(SOURCE);
  const dump = await exportData(ctx, SOURCE);
  const { data, shared } = dump;
  console.log(
    `Export : ${countRows(data)} lignes sur ${Object.keys(data).length} tables, ` +
      `+ ${countRows(shared)} ligne(s) partagée(s).`,
  );
  expect('le cache du module Logs n’est pas exporté', data.LogMessageSnapshot === undefined);
  expect(
    'ModuleConfig n’est pas exporté (déjà porté par `modules`)',
    data.ModuleConfig === undefined,
  );
  expect('les votes de suggestions sont exportés', data.SuggestionVote?.length === 1);
  expect('les participations aux concours sont exportées', data.GiveawayEntry?.length === 1);

  // Catalogue partagé : l'entrée maison du serveur est une donnée à lui ;
  // l'entrée commune n'entre qu'en dépendance, jamais comme sa propriété.
  expect('l’entrée maison du serveur est exportée', data.Catalogue?.length === 1);
  expect('et c’est bien la sienne', data.Catalogue?.[0]?.id === `maison-${SOURCE}`);
  expect(
    'l’entrée du catalogue commun est embarquée en dépendance partagée',
    shared.Catalogue?.length === 1 && shared.Catalogue[0]?.id === 'cat-partage',
  );
  expect('les deux collections sont exportées', data.Collection?.length === 2);

  // Le dump passe par un fichier JSON : on restaure ce qui aurait été écrit.
  const copy = JSON.parse(JSON.stringify(dump)) as typeof dump;
  const file = parseDataDump(copy.data);
  const fileShared = parseDataDump(copy.shared);
  if (!file || !fileShared) throw new Error('dump illisible');

  // --- Restauration sur le même serveur, après purge totale -----------------
  for (const table of [...tables].reverse()) {
    if (table.scoped) {
      await db.$executeRawUnsafe(`DELETE FROM "${table.name}" WHERE "guildId" = ?`, SOURCE);
    }
  }
  expect(
    'la purge a bien tout effacé',
    (await db.memberEconomy.count({ where: { guildId: SOURCE } })) === 0,
  );

  const stats = await restoreData(ctx, SOURCE, file, fileShared, new Map());
  console.log(`Restauration : ${stats.total} lignes.`);
  const after = await snapshot(SOURCE);
  expect(
    'la restauration rend le serveur à l’identique',
    JSON.stringify(after) === JSON.stringify(before),
  );
  expect('l’argent est revenu', after.economy[0]?.balance === 1234);
  expect(
    'les dates sont intactes',
    after.economy[0]?.lastDailyAt?.toISOString() === '2026-01-02T03:04:05.000Z',
  );
  expect('les booléens sont intacts', after.items[0]?.buyable === false);
  expect(
    'l’inventaire pointe toujours vers son objet',
    after.inventory[0]?.itemId === after.items[0]?.id,
  );
  expect('la Route de l’Infini est revenue', after.travelers[0]?.distance === 4242);

  // --- Migration vers un autre serveur --------------------------------------
  await db.guild.create({ data: { id: TARGET } });
  const remap = new Map([['u2', 'REMAPPÉ']]);
  await restoreData(ctx, TARGET, file, fileShared, remap, { regenerateIds: true });
  const migrated = await snapshot(TARGET);
  expect('les données sont recréées sur le serveur cible', migrated.economy[0]?.balance === 1234);
  expect(
    'le guildId est réécrit',
    migrated.items.every((item) => item.guildId === TARGET),
  );
  expect('les identifiants connus sont remappés', migrated.ducklings[0]?.ownerId === 'REMAPPÉ');
  expect(
    'les liens parent/enfant tiennent',
    migrated.inventory[0]?.itemId === migrated.items[0]?.id,
  );
  expect(
    'le serveur d’origine est intact',
    (await db.memberEconomy.count({ where: { guildId: SOURCE } })) === 1 &&
      (await db.item.findFirst({ where: { guildId: SOURCE } }))?.id === after.items[0]?.id,
  );

  // Le catalogue partagé n'appartient à personne : il ne doit ni être dupliqué,
  // ni changer d'identifiant parce qu'un serveur s'est fait restaurer.
  expect(
    'le catalogue commun n’est pas dupliqué',
    (await rawRows('Catalogue', '"guildId" IS NULL')).length === 1,
  );
  expect(
    'la collection du serveur cible pointe toujours vers le catalogue commun',
    migrated.collection.some((row) => row.entryId === 'cat-partage'),
  );
  expect(
    'et son entrée maison a bien été recopiée',
    migrated.catalogue.length === 1 && migrated.catalogue[0]?.id !== `maison-${SOURCE}`,
  );

  await restoreData(ctx, TARGET, file, fileShared, remap, { regenerateIds: true });
  expect(
    'restaurer deux fois ne duplique rien',
    (await db.inventoryItem.count({ where: { guildId: TARGET } })) === 1,
  );

  // --- Restauration sur une AUTRE instance du bot ---------------------------
  // Là est tout l'intérêt des dépendances partagées : ailleurs, le catalogue
  // commun n'a pas les mêmes identifiants — ou n'existe pas du tout.

  // a) L'instance a son propre catalogue, importé de son côté : mêmes
  //    personnages, autres identifiants. On doit les reconnaître, pas les
  //    dupliquer.
  await db.$executeRawUnsafe('DELETE FROM "Collection" WHERE "guildId" = ?', TARGET);
  await db.$executeRawUnsafe('DELETE FROM "Catalogue" WHERE "id" = ?', 'cat-partage');
  await db.$executeRawUnsafe(
    'INSERT INTO "Catalogue" ("id","guildId","source","sourceId","name") VALUES (?,?,?,?,?)',
    'autre-id-local',
    null,
    'anilist',
    'A1',
    'Personnage du catalogue',
  );
  const localStats = await restoreData(ctx, TARGET, file, fileShared, remap, {
    regenerateIds: true,
  });
  expect('le catalogue local est reconnu, pas réinséré', localStats.sharedMatched === 1);
  expect('rien de partagé n’a été ajouté', localStats.sharedInserted === 0);
  expect(
    'le catalogue commun reste unique',
    (await rawRows('Catalogue', '"guildId" IS NULL')).length === 1,
  );
  expect(
    'et la collection pointe vers l’identifiant local',
    (await rawRows('Collection', '"guildId" = ?', TARGET)).some(
      (row) => row.entryId === 'autre-id-local',
    ),
  );

  // b) L'instance est vierge : le catalogue référencé n'existe pas. Sans les
  //    dépendances, SQLite rejetterait la restauration entière.
  await db.$executeRawUnsafe('DELETE FROM "Collection"');
  await db.$executeRawUnsafe('DELETE FROM "Catalogue"');
  const freshStats = await restoreData(ctx, TARGET, file, fileShared, remap, {
    regenerateIds: true,
  });
  expect('le catalogue référencé est réinstallé', freshStats.sharedInserted === 1);
  expect(
    'et la collection retrouve ses deux entrées',
    (await rawRows('Collection', '"guildId" = ?', TARGET)).length === 2,
  );

  // --- Fichiers hostiles ou périmés -----------------------------------------
  const unknown = parseDataDump({
    TableInconnue: [{ a: 1 }],
    MemberEconomy: [
      {
        id: 'z',
        guildId: 'autre',
        userId: 'u9',
        balance: 5,
        colonneInconnue: 'zzz',
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  if (!unknown) throw new Error('dump illisible');
  const unknownStats = await restoreData(ctx, TARGET, unknown, {}, new Map());
  expect(
    'les tables inconnues sont signalées, jamais appliquées',
    unknownStats.skippedTables.includes('TableInconnue'),
  );
  expect(
    'les colonnes inconnues sont ignorées',
    (await db.memberEconomy.findFirst({ where: { guildId: TARGET } }))?.balance === 5,
  );

  const inventoryBefore = await db.inventoryItem.count({ where: { guildId: TARGET } });
  const broken = parseDataDump({ MemberEconomy: [{ id: 'cassé', guildId: 'x', userId: 'u9' }] });
  if (!broken) throw new Error('dump illisible');
  const rejected = await restoreData(ctx, TARGET, broken, {}, new Map()).then(
    () => false,
    () => true,
  );
  expect('un fichier corrompu est rejeté', rejected);
  expect(
    'et la transaction est annulée — rien n’est perdu',
    (await db.inventoryItem.count({ where: { guildId: TARGET } })) === inventoryBefore,
  );
} finally {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures.length === 0 ? '\n✅ Tout passe.' : `\n❌ Échecs : ${failures.join(' · ')}`);
process.exit(failures.length === 0 ? 0 : 1);
