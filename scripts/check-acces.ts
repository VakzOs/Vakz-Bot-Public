/**
 * Vérification de l'accès délégué au dashboard (`npm run check:acces`).
 *
 * Le bot n'a pas de suite de tests : ce script en tient lieu pour la partie la
 * plus délicate des grades — celle qu'aucun écran ne montre. Deux questions :
 *
 *   1. **Qui obtient quoi** : un grade se confère par rôle OU par membre nommé,
 *      plusieurs grades se cumulent, et l'absence de grade ne doit ouvrir à
 *      personne. Une erreur ici ouvre un dashboard à qui n'y a rien à faire.
 *   2. **Ce qu'un gradé partiel peut écrire** : le dashboard renvoie la config
 *      ENTIÈRE du module, et seuls les blocs délégués — et, dans un bloc, les
 *      seuls gestes permis sur ses lignes — doivent être retenus. Une erreur
 *      ici fait de « ajouter un message épinglé » le droit de supprimer ceux
 *      des autres.
 *
 * Il ne touche JAMAIS la base du bot : il travaille dans un dossier temporaire.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import {
  LIST_VERBS,
  configPartId,
  keepAllowedGroups,
  keepAllowedRows,
  verbsFor,
} from '../src/core/config-parts.js';
import type { PartialGrant } from '../src/core/guild-access.js';
import type { ConfigGroup } from '../src/core/module.js';

const dir = mkdtempSync(join(tmpdir(), 'vakz-acces-check-'));
const url = `file:${join(dir, 'check.db')}`;
// La base jetable est montée par `migrate deploy`, et non par un `db push` :
// depuis Prisma 7, `db push` est refusé à un agent IA sans consentement
// explicite de l'utilisateur — cette porte deviendrait inlançable par un agent,
// alors que CLAUDE.md l'exige avant toute livraison. Le détour n'en est pas un :
// appliquer les vraies migrations éprouve en prime le chemin qu'emprunte la
// production, là où `db push` fabriquait le schéma en court-circuitant.
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});
process.env.DATABASE_URL = url;

// Importé APRÈS avoir posé DATABASE_URL : `src/core/db.ts` ouvre la base à
// l'import, et pointerait sinon sur celle du dépôt.
const {
  accessFor,
  grants,
  grantsAction,
  grantsModule,
  listGrades,
  moduleGrant,
  partVerbs,
  saveGrades,
} = await import('../src/core/guild-access.js');

// Prisma 7 : plus d'`url` dans le schéma ni de `datasources` au constructeur —
// la connexion passe par un adaptateur, ici sur la base jetable du test.
const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

let failures = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    console.log(`  ✔ ${label}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${label}`);
}

const GUILD = '100000000000000001';
const OWNER = '200000000000000001';
const ADMIN = '200000000000000002';
const MODO = '200000000000000003';
const NOMME = '200000000000000004';
const PASSANT = '200000000000000005';
const ROLE_MODO = '300000000000000001';

/**
 * Un faux serveur Discord : juste ce que `accessFor` regarde — le propriétaire,
 * les permissions d'un membre et ses rôles. Aller chercher discord.js ici
 * reviendrait à tester discord.js.
 */
function fakeCtx(members: Record<string, { admin?: boolean; roles: string[] }>): {
  client: { guilds: { cache: Map<string, unknown> } };
} {
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    members: {
      fetch: (id: string) => {
        const member = members[id];
        if (!member) return Promise.reject(new Error('unknown_member'));
        return Promise.resolve({
          permissions: { has: () => member.admin === true },
          roles: { cache: new Set(member.roles) },
        });
      },
    },
  };
  return { client: { guilds: { cache: new Map([[GUILD, guild]]) } } };
}

const ctx = fakeCtx({
  [ADMIN]: { admin: true, roles: [] },
  [MODO]: { roles: [ROLE_MODO] },
  [NOMME]: { roles: [] },
  [PASSANT]: { roles: [] },
  // Le propriétaire n'a même pas besoin d'être trouvé : il passe avant.
}) as unknown as Parameters<typeof accessFor>[0];

const KNOWN = new Set([
  'module:automod',
  'module:automod/spam',
  'module:automod/badWords',
  'module:moderation',
  'module:stickymessages/@0:creer',
  'module:stickymessages/@0:modifier',
  'module:stickymessages/@0:basculer',
  'module:stickymessages@repost',
  'serveur.langue',
  'serveur.sauvegarde',
]);

console.log('Grades — qui obtient quoi');

await db.guild.create({ data: { id: GUILD } });

// 1. Aucun grade : le dashboard reste fermé à tous sauf aux administrateurs.
check(
  'sans grade, le propriétaire garde tout',
  (await accessFor(ctx, GUILD, OWNER)).level === 'manager',
);
check('sans grade, un admin garde tout', (await accessFor(ctx, GUILD, ADMIN)).level === 'manager');
check('sans grade, un membre n’a rien', (await accessFor(ctx, GUILD, MODO)).level === 'none');
check('sans acteur, rien du tout', (await accessFor(ctx, GUILD, undefined)).level === 'none');

await saveGrades(
  GUILD,
  [
    {
      name: 'Modération',
      roleIds: [ROLE_MODO],
      memberIds: [],
      permissions: [
        'module:moderation',
        'module:automod/spam',
        'module:stickymessages/@0:creer',
        'module:stickymessages@repost',
        'permission:inventee',
      ],
      position: 0,
    },
    {
      name: 'Traduction',
      roleIds: [],
      memberIds: [NOMME, MODO],
      permissions: ['serveur.langue'],
      position: 1,
    },
    { name: '   ', roleIds: [], memberIds: [], permissions: ['module:automod'], position: 2 },
  ],
  KNOWN,
);

const stored = await listGrades(GUILD);
check('un grade sans nom n’est pas enregistré', stored.length === 2);
check(
  'une permission inconnue de cette instance est écartée',
  !stored[0]?.permissions.includes('permission:inventee'),
);

const modo = await accessFor(ctx, GUILD, MODO);
check('un grade par rôle s’applique', modo.level === 'staff');
check(
  'plusieurs grades se cumulent',
  grants(modo, 'module:moderation') && grants(modo, 'serveur.langue'),
);
check('ce qui n’est pas donné reste fermé', !grants(modo, 'serveur.sauvegarde'));
check('le module entier n’est pas déduit d’un bloc', !grantsModule(modo, 'automod'));
check('les grades portés sont nommés', modo.grades.join(',') === 'Modération,Traduction');

const nomme = await accessFor(ctx, GUILD, NOMME);
check('un grade par membre nommé s’applique sans rôle', grants(nomme, 'serveur.langue'));
check('et n’ouvre que lui', !grants(nomme, 'module:moderation'));

check('un membre sans grade reste dehors', (await accessFor(ctx, GUILD, PASSANT)).level === 'none');
check(
  'un serveur que le bot ne voit pas ne délègue rien',
  (await accessFor(ctx, '999999999999999999', MODO)).level === 'none',
);

// Suppression : le panneau envoie la liste entière, ce qui manque est supprimé.
await saveGrades(GUILD, [{ ...stored[1]!, permissions: ['serveur.langue'] }], KNOWN);
check('un grade retiré de la liste disparaît', (await listGrades(GUILD)).length === 1);
const apres = await accessFor(ctx, GUILD, MODO);
check('ce que ce grade ouvrait se referme', !grants(apres, 'module:moderation'));
check('ce que l’autre grade ouvre reste ouvert', grants(apres, 'serveur.langue'));

console.log('\nBlocs — ce qu’un gradé partiel peut écrire');

const configUI: ConfigGroup[] = [
  { label: 'Général', fields: [{ key: 'logChannelId', label: 'Salon', type: 'channel' }] },
  {
    key: 'spam',
    label: 'Anti-spam',
    fields: [
      { key: 'enabled', label: 'Activer', type: 'boolean' },
      { key: 'action', label: 'Sanction', type: 'text' },
    ],
  },
  {
    key: 'badWords',
    label: 'Mots interdits',
    fields: [{ key: 'words', label: 'Mots', type: 'tags' }],
  },
];

const before = {
  logChannelId: 'salon-origine',
  spam: { enabled: false, action: 'delete' },
  badWords: { words: ['interdit'] },
};
// Ce qu'enverrait un gradé malintentionné : il touche à TOUT.
const submitted = {
  logChannelId: 'salon-pirate',
  spam: { enabled: true, action: 'ban' },
  badWords: { words: [] },
};

/** Un grade qui ouvre ces blocs entiers, et aucun bouton. */
function blocs(...ids: string[]): PartialGrant {
  return { parts: new Map(ids.map((id) => [id, '*' as const])), actions: new Set<string>() };
}

check('un bloc nommé se désigne par sa clé', configPartId(configUI[1]!, 1) === 'spam');
check('un bloc sans clé se désigne par son rang', configPartId(configUI[0]!, 0) === '@0');

const merged = keepAllowedGroups(before, submitted, configUI, blocs('spam'));
check('le bloc délégué est écrit', JSON.stringify(merged.spam) === JSON.stringify(submitted.spam));
check(
  'un bloc non délégué reste intact',
  JSON.stringify(merged.badWords) === '{"words":["interdit"]}',
);
check('un champ racine non délégué reste intact', merged.logChannelId === 'salon-origine');
// Un champ absent du `configUI` n'est pas réglable : il n'est donc pas écrit,
// même dans un bloc ouvert. C'est ce qui protège ce que le module a persisté
// lui-même — le `messageId` d'un panneau publié, par exemple.
const horsUI = keepAllowedGroups(
  { spam: { enabled: false, messageId: 'garde-moi' } },
  { spam: { enabled: true, messageId: 'efface-moi' } },
  configUI,
  blocs('spam'),
);
check(
  'un champ non déclaré par le bloc n’est pas écrasé',
  (horsUI.spam as { messageId: string }).messageId === 'garde-moi',
);

// Le groupe sans clé écrit à la racine : le déléguer ouvre SES champs, pas le reste.
const racine = keepAllowedGroups(before, submitted, configUI, blocs('@0'));
check('un groupe sans clé se délègue par son rang', racine.logChannelId === 'salon-pirate');
check(
  'et n’emporte pas les blocs voisins',
  JSON.stringify(racine.spam) === JSON.stringify(before.spam),
);

// La même fonction, base vide, sert à ne SERVIR que les blocs ouverts.
const servi = keepAllowedGroups({}, before, configUI, blocs('badWords'));
check(
  'ce qui n’est pas délégué n’est pas non plus servi',
  Object.keys(servi).join(',') === 'badWords',
);

// « lire » : un bloc ouvert en lecture seule se SERT entier, et ne s'écrit pas.
const lectureSeule: PartialGrant = {
  parts: new Map([['spam', new Set(['lire'] as const)]]),
  actions: new Set<string>(),
};
check(
  'un bloc en lecture seule ne s’écrit pas',
  JSON.stringify(keepAllowedGroups(before, submitted, configUI, lectureSeule).spam) ===
    JSON.stringify(before.spam),
);
check(
  'mais il se sert entier',
  JSON.stringify(keepAllowedGroups({}, before, configUI, lectureSeule, { readOnly: true }).spam) ===
    JSON.stringify(before.spam),
);

// Les verbes proposés se déduisent de la FORME du bloc.
check(
  'un bloc sans liste n’offre que lire et modifier',
  verbsFor(configUI[1]!).join(',') === 'lire,modifier',
);
check(
  'une liste sans identifiant n’offre pas « reordonner »',
  !verbsFor({ fields: [{ key: 'l', label: 'L', type: 'list', item: [] }] }).includes('reordonner'),
);
check(
  'une liste identifiée à interrupteur les offre tous',
  verbsFor({
    fields: [
      {
        key: 'l',
        label: 'L',
        type: 'list',
        idKey: 'id',
        item: [{ key: 'actif', label: 'Actif', type: 'boolean' }],
      },
    ],
  }).length === LIST_VERBS.length,
);

const partiel = moduleGrant(modo, 'automod');
check(
  'les blocs ouverts se retrouvent',
  partiel !== '*' && partiel.parts.has('spam') && partiel.parts.size === 1,
);
const adminAcces = await accessFor(ctx, GUILD, ADMIN);
check('un administrateur ouvre tout le module', moduleGrant(adminAcces, 'automod') === '*');

console.log('\nVerbes et boutons — la maille la plus fine');

const sticky = moduleGrant(modo, 'stickymessages');
check('un verbe ouvre son bloc', partVerbs(sticky, '@0')?.has('creer') === true);
check('et pas les autres verbes', partVerbs(sticky, '@0')?.has('supprimer') === false);
check(
  'un bloc entier vaut tous ses verbes',
  partVerbs(partiel, 'spam')?.size === LIST_VERBS.length,
);
check(
  'un administrateur a tous les verbes',
  partVerbs('*', 'nimporte')?.size === LIST_VERBS.length,
);
check('un bouton délégué se lance', grantsAction(sticky, 'repost'));
check('un bouton non délégué non', !grantsAction(sticky, 'autre'));
check('un administrateur lance tout', grantsAction('*', 'nimporte'));
check(
  'un module non délégué n’a aucun verbe',
  partVerbs(moduleGrant(modo, 'levels'), 'xp') === undefined,
);
check('ni aucun bouton', !grantsAction(moduleGrant(modo, 'levels'), 'repost'));

// Les LIGNES d'une liste, geste par geste. Sans `idKey`, elles s'apparient par
// rang — c'est ainsi que le formulaire les édite.
/** Une liste sans identifiant de ligne : le rang est leur seule identité. */
const SANS_ID = { item: [{ key: 'content', label: 'Contenu', type: 'textarea' as const }] };
/** Une liste identifiée, avec un interrupteur par ligne. */
const AVEC_ID = {
  idKey: 'id',
  item: [
    { key: 'texte', label: 'Texte', type: 'text' as const },
    { key: 'actif', label: 'Actif', type: 'boolean' as const },
  ],
};

const lignes = [
  { channelId: '1', content: 'un' },
  { channelId: '2', content: 'deux' },
];
/** Réécriture des deux lignes en place — ni ajout ni retrait. */
const reecrites = [
  { channelId: '1', content: 'PIRATÉ' },
  { channelId: '2', content: 'PIRATÉ AUSSI' },
];
/** Une ligne de plus, les deux premières intactes. */
const ajoutee = [...lignes, { channelId: '3', content: 'trois' }];
/** Une ligne de moins. */
const retiree = [lignes[0]!];

const creerSeul = keepAllowedRows(lignes, reecrites, SANS_ID, new Set(['creer']));
check('sans « modifier », une ligne réécrite retrouve son texte', creerSeul[0] === lignes[0]);
check('et toutes les autres aussi', creerSeul[1] === lignes[1]);

check(
  'avec « creer », une ligne ajoutée passe',
  keepAllowedRows(lignes, ajoutee, SANS_ID, new Set(['creer'])).length === 3,
);
check(
  'sans « creer », elle est ignorée',
  keepAllowedRows(lignes, ajoutee, SANS_ID, new Set(['modifier'])).length === 2,
);

check(
  'sans « supprimer », une ligne retirée revient',
  keepAllowedRows(lignes, retiree, SANS_ID, new Set(['creer', 'modifier'])).length === 2,
);
check(
  'avec « supprimer », elle part',
  keepAllowedRows(lignes, retiree, SANS_ID, new Set(['supprimer'])).length === 1,
);

check(
  'avec « modifier », la réécriture passe',
  keepAllowedRows(lignes, reecrites, SANS_ID, new Set(['modifier']))[0] === reecrites[0],
);

const tout = keepAllowedRows(lignes, reecrites, SANS_ID, new Set(LIST_VERBS));
check(
  'tous les verbes laissent passer la soumission telle quelle',
  JSON.stringify(tout) === JSON.stringify(reecrites),
);

// Avec `idKey`, l'appariement est exact même si l'ordre a changé.
const avecId = [
  { id: 'a', texte: 'un', actif: true },
  { id: 'b', texte: 'deux', actif: true },
];
const reordonne = [
  { id: 'b', texte: 'deux', actif: true },
  { id: 'c', texte: 'neuf', actif: true },
];
const parId = keepAllowedRows(avecId, reordonne, AVEC_ID, new Set(['creer']));
check(
  'une ligne identifiée absente revient malgré le réordonnancement',
  parId.some((row) => (row as { id: string }).id === 'a'),
);
check(
  'et la création identifiée passe',
  parId.some((row) => (row as { id: string }).id === 'c'),
);

// « reordonner » : l'ordre est un droit à part, et sans lui l'ordre d'avant
// tient bon — même si la soumission renvoie les lignes dans un autre ordre.
const permute = [avecId[1]!, avecId[0]!];
const sansOrdre = keepAllowedRows(avecId, permute, AVEC_ID, new Set(['modifier']));
check('sans « reordonner », l’ordre d’avant tient', (sansOrdre[0] as { id: string }).id === 'a');
const avecOrdre = keepAllowedRows(avecId, permute, AVEC_ID, new Set(['modifier', 'reordonner']));
check('avec « reordonner », l’ordre soumis passe', (avecOrdre[0] as { id: string }).id === 'b');

// « basculer » : l'interrupteur d'une ligne, et rien d'autre.
const bascule = [{ id: 'a', texte: 'PIRATÉ', actif: false }, avecId[1]!];
const basculee = keepAllowedRows(avecId, bascule, AVEC_ID, new Set(['basculer']));
check(
  'avec « basculer », l’interrupteur suit',
  (basculee[0] as { actif: boolean }).actif === false,
);
check('et le texte de la ligne ne bouge pas', (basculee[0] as { texte: string }).texte === 'un');
check(
  'sans « basculer » ni « modifier », rien ne bouge',
  (keepAllowedRows(avecId, bascule, AVEC_ID, new Set(['lire']))[0] as { actif: boolean }).actif ===
    true,
);

// Le tout, à travers un bloc : une liste gouvernée par ses verbes.
const stickyUI: ConfigGroup[] = [
  {
    label: '📌 Messages épinglés',
    fields: [
      {
        key: 'stickies',
        label: 'Messages',
        type: 'list',
        item: [{ key: 'content', label: 'Contenu', type: 'textarea' }],
      },
    ],
  },
];
const stickyAvant = { stickies: [{ content: 'un' }, { content: 'deux' }] };
const stickyEnvoye = { stickies: [{ content: 'PIRATÉ' }] };
const stickyRetenu = keepAllowedGroups(stickyAvant, stickyEnvoye, stickyUI, {
  parts: new Map([['@0', new Set(['creer'] as const)]]),
  actions: new Set(),
});
check(
  'un bloc de lignes n’obéit qu’à ses verbes',
  JSON.stringify(stickyRetenu.stickies) === JSON.stringify(stickyAvant.stickies),
);

await db.$disconnect();
rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${String(failures)} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\n✔ Accès délégué : tout est conforme.');
