import { readFileSync } from 'node:fs';
import { AttachmentBuilder, ButtonStyle, type Client, SlashCommandBuilder } from 'discord.js';
import type { ComponentHandler, SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { button, row } from '../../../lib/ui.js';
import { renderPingCard } from '../ping-card.js';

/**
 * Horodatage du build, écrit dans l'image Docker (fichier `build-info`).
 * Absent en développement local (tsx) : on affiche « dev ».
 */
const buildInfo = ((): string => {
  try {
    return readFileSync('build-info', 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
})();

// « 2026-07-21 07:12 UTC » → date en valeur (grande), heure dans le label (petit) ;
// autre format (« dev », un SHA…) → affiché tel quel sans heure.
const buildMatch = buildInfo.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
const buildValue = buildMatch?.[1] ?? buildInfo;
const buildTime = buildMatch?.[2] ?? '';

/** Nettoie une chaîne pour le canvas (DejaVu ne rend pas les emoji couleur). */
function plain(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s!?.,'·:/()-]/gu, '').trim();
}

/** Retire les parenthèses d'un libellé (ex. « Passerelle (WebSocket) » → « Passerelle »). */
function short(text: string): string {
  return plain(text.replace(/\s*\([^)]*\)/g, ''));
}

/**
 * Construit la réponse de `/ping` : carte image (latences) + bouton « Actualiser »
 * dessous. Partagée par la commande et le gestionnaire de rafraîchissement, pour
 * recalculer la latence à chaque appel.
 */
async function buildPingReply(
  client: Client,
  createdTimestamp: number,
): Promise<{ files: AttachmentBuilder[]; components: ReturnType<typeof row>[] }> {
  const wsMs = Math.max(Math.round(client.ws.ping), 0);
  const rtMs = Math.max(Date.now() - createdTimestamp, 0);
  const botName = client.user?.username ?? 'Bot';
  const initials = ((botName.match(/\b\w/g) ?? []).join('').slice(0, 2) || 'B').toUpperCase();

  const card = await renderPingCard({
    title: plain(t('modules.core.ping.title')) || 'Pong',
    subtitle: botName,
    avatarUrl: client.user?.displayAvatarURL({ extension: 'png', size: 128 }),
    initials,
    chips: [
      { label: short(t('modules.core.ping.websocket')), value: `${wsMs} ms`, ms: wsMs },
      { label: short(t('modules.core.ping.roundtrip')), value: `${rtMs} ms`, ms: rtMs },
      {
        label: short(
          buildTime
            ? `${t('modules.core.ping.build')} · ${buildTime}`
            : t('modules.core.ping.build'),
        ),
        value: buildValue,
      },
    ],
  });

  const file = new AttachmentBuilder(card, { name: 'ping.png' });
  const controls = row(
    button({
      id: 'ping|refresh',
      label: t('modules.core.ping.refresh'),
      emoji: '🔄',
      style: ButtonStyle.Secondary,
    }),
  );
  return { files: [file], components: [controls] };
}

/** `/ping` — latence du bot (passerelle + aller-retour) et build, en carte image. */
export const ping: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription(t('modules.core.ping.description')),
  async execute(interaction) {
    await interaction.deferReply();
    const reply = await buildPingReply(interaction.client, interaction.createdTimestamp);
    await interaction.editReply(reply);
  },
};

/** Bouton « Actualiser » sous la carte : recalcule et met à jour la carte en place. */
export const pingComponent: ComponentHandler = {
  prefix: 'ping',
  async handle(interaction) {
    if (!interaction.isButton()) return;
    const [, action] = interaction.customId.split('|');
    if (action !== 'refresh') return;
    const reply = await buildPingReply(interaction.client, interaction.createdTimestamp);
    // `attachments: []` retire l'ancienne image avant d'attacher la nouvelle.
    await interaction.update({ ...reply, attachments: [] });
  },
};
