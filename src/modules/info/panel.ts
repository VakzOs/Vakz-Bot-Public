import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getInfoConfig, updateInfoConfig } from './config.js';

/** Champs booléens (activables/désactivables par bouton). */
type BoolKey =
  | 'watchEnabled'
  | 'watchUsername'
  | 'watchGlobalName'
  | 'watchAvatar'
  | 'watchNickname';

/** Cases à cocher « quoi surveiller ». */
const WATCH_TOGGLES: ReadonlyArray<{ key: BoolKey; label: string }> = [
  { key: 'watchUsername', label: "Nom d'utilisateur" },
  { key: 'watchGlobalName', label: 'Nom affiché' },
  { key: 'watchAvatar', label: 'Photo de profil' },
  { key: 'watchNickname', label: 'Pseudo serveur' },
];

const TOGGLE_KEYS = new Set<BoolKey>([
  'watchEnabled',
  ...WATCH_TOGGLES.map((toggle) => toggle.key),
]);

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function toggleButton(key: string, label: string, enabled: boolean): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'toggle', key))
    .setLabel(label)
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getInfoConfig(ctx, guildId);

  const embed = infoEmbed({
    title: `🪪 ${t('modules.info.label')} — Journal des profils`,
    description:
      'Note dans un salon les changements d’identité des membres (nom, photo de profil, pseudo serveur). Les commandes `/userinfo`, `/serverinfo`… restent toujours disponibles.',
  }).addFields(
    {
      name: 'Salon du journal',
      value: config.watchChannelId ? `<#${config.watchChannelId}>` : '*(non défini)*',
      inline: true,
    },
    {
      name: 'Rôles suivis',
      value: config.watchRoleIds.length
        ? config.watchRoleIds.map((id) => `<@&${id}>`).join(' ')
        : '*Tous les membres*',
      inline: true,
    },
    {
      name: 'Suivi',
      value: WATCH_TOGGLES.map(
        (toggle) => `${config[toggle.key] ? '✅' : '❌'} ${toggle.label}`,
      ).join('\n'),
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder('Salon du journal des profils')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'roles'))
        .setPlaceholder('Limiter à certains rôles (vide = tous)')
        .setMinValues(0)
        .setMaxValues(25),
    ),
    row().addComponents(
      toggleButton(
        'watchEnabled',
        config.watchEnabled ? '🟢 Journal activé' : '🔴 Journal désactivé',
        config.watchEnabled,
      ),
    ),
    row().addComponents(
      ...WATCH_TOGGLES.map((toggle) => toggleButton(toggle.key, toggle.label, config[toggle.key])),
    ),
  ];

  return { embed, components };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  if (action === 'chan') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateInfoConfig(ctx, guildId, { watchChannelId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'roles') {
    if (!interaction.isRoleSelectMenu()) return;
    await updateInfoConfig(ctx, guildId, { watchRoleIds: [...interaction.values] });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'toggle') {
    if (!interaction.isButton()) return;
    const key = params[0] as BoolKey | undefined;
    if (!key || !TOGGLE_KEYS.has(key)) return;
    const config = await getInfoConfig(ctx, guildId);
    const next = !config[key];
    await updateInfoConfig(ctx, guildId, { [key]: next });
    // À l'activation, précharge les membres pour capter dès le 1er changement.
    if (key === 'watchEnabled' && next) {
      const guild = ctx.client.guilds.cache.get(guildId);
      if (guild && guild.memberCount <= 5000) void guild.members.fetch().catch(() => undefined);
    }
    await interaction.update(await renderPage());
  }
}

export const infoPanel: ConfigPanel = { render, handle };
