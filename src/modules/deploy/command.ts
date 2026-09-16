import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ComponentHandler, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, withEmoji } from '../../lib/embeds.js';
import { listDeployBranches } from './branches.js';
import {
  DEFAULT_DEPLOY_MODE,
  type DeployMode,
  type DeployResult,
  type DeployStatus,
  deployEnabled,
  isOwner,
  readResult,
  readStatus,
  requestDeploy,
  toDeployMode,
  watchDeployProgress,
} from './service.js';

function resultLine(result: DeployResult | null): string {
  if (!result) return t('modules.deploy.noResult');
  const when = result.finishedAt
    ? `<t:${Math.floor(new Date(result.finishedAt).getTime() / 1000)}:R>`
    : '';
  const icon = result.status === 'success' ? '✅' : result.status === 'failure' ? '❌' : 'ℹ️';
  const commit = result.commit ? ` \`${result.commit.slice(0, 8)}\`` : '';
  return t('modules.deploy.lastResult', { icon, status: result.status, when, commit });
}

function deployStatusLine(status: DeployStatus | null): string {
  if (!status) return t('modules.deploy.statusUnknown');
  const phase = status.phase ?? status.state ?? 'unknown';
  const message = status.message ? ` - ${status.message}` : '';
  const branch = status.branch ? `\nBranche : \`${status.branch}\`` : '';
  const when = status.updatedAt
    ? `\nMAJ : <t:${Math.floor(new Date(status.updatedAt).getTime() / 1000)}:R>`
    : '';
  return `\`${phase}\`${message}${branch}${when}`;
}

/** Ce que le mode choisi va reellement faire tourner sur l'hote. */
function modeLine(mode: DeployMode): string {
  return mode === 'cache' ? t('modules.deploy.modeCache') : t('modules.deploy.modeFull');
}

async function buildEmbed(branch: string, mode: DeployMode): Promise<EmbedBuilder> {
  const [result, status] = await Promise.all([readResult(), readStatus()]);
  const embed = new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(withEmoji(t('modules.deploy.title'), Emojis.zap))
    .setDescription(t('modules.deploy.intro'))
    .addFields(
      { name: t('modules.deploy.branchField'), value: `\`${branch}\``, inline: true },
      { name: t('modules.deploy.modeField'), value: modeLine(mode) },
      { name: t('modules.deploy.statusField'), value: resultLine(result) },
      { name: t('modules.deploy.currentStatusField'), value: deployStatusLine(status) },
    );
  if (result?.log) {
    embed.addFields({
      name: t('modules.deploy.logField'),
      value: `\`\`\`\n${result.log.slice(-900)}\n\`\`\``,
    });
  }
  return embed;
}

/** Sélecteur de branche + bascule de mode + boutons confirmer/annuler (l'index
 * choisi et le mode sont encodés dans les customId : un composant Discord ne
 * garde aucun état entre deux clics). */
function buildComponents(
  branches: string[],
  selectedIndex: number,
  mode: DeployMode,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (branches.length > 1) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          // Le mode voyage dans le customId du selecteur : sans lui, choisir
          // une branche reviendrait au mode par defaut sans le dire.
          .setCustomId(`deploy|branch|${mode}`)
          .setPlaceholder(t('modules.deploy.branchPlaceholder'))
          .addOptions(
            branches.slice(0, 25).map((branch, index) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(branch.slice(0, 100))
                .setValue(String(index))
                .setDefault(index === selectedIndex),
            ),
          ),
      ),
    );
  }

  // Le mode est un reglage, comme la branche : sa propre rangee, au-dessus des
  // boutons qui engagent. Le bouton PORTE le mode courant et propose l'autre.
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deploy|mode|${selectedIndex}|${mode}`)
        .setLabel(
          mode === 'cache'
            ? t('modules.deploy.modeSwitchToFull')
            : t('modules.deploy.modeSwitchToCache'),
        )
        .setEmoji(mode === 'cache' ? '🐢' : '⚡')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deploy|confirm|${selectedIndex}|${mode}`)
        .setLabel(t('modules.deploy.confirm'))
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('deploy|cancel')
        .setLabel(t('modules.deploy.cancel'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

/** `/maj` - met a jour le bot via l'updater hote. */
export const maj: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('maj')
    .setDescription(t('modules.deploy.description'))
    .setDMPermission(true),
  async execute(interaction) {
    if (!deployEnabled()) {
      await interaction.reply({
        content: t('modules.deploy.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: t('modules.deploy.notOwner'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const branches = await listDeployBranches();
    await interaction.reply({
      embeds: [await buildEmbed(branches[0] ?? 'main', DEFAULT_DEPLOY_MODE)],
      components: buildComponents(branches, 0, DEFAULT_DEPLOY_MODE),
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Gere le selecteur de branche et les boutons de `/maj` (prefixe `deploy`). */
export const deployComponent: ComponentHandler = {
  prefix: 'deploy',
  async handle(interaction, ctx) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    if (!isOwner(interaction.user.id)) {
      await interaction
        .reply({ content: t('modules.deploy.notOwner'), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }

    const parts = interaction.customId.split('|');
    const action = parts[1];
    const branches = await listDeployBranches();

    // Choix de la branche dans le sélecteur → on ré-affiche avec la sélection.
    if (interaction.isStringSelectMenu() && action === 'branch') {
      const index = Number(interaction.values[0]) || 0;
      const mode = toDeployMode(parts[2]);
      await interaction.update({
        embeds: [await buildEmbed(branches[index] ?? branches[0] ?? 'main', mode)],
        components: buildComponents(branches, index, mode),
      });
      return;
    }
    if (!interaction.isButton()) return;

    // Bascule du mode : le customId porte le mode COURANT, on affiche l'autre.
    if (action === 'mode') {
      const index = Number(parts[2]) || 0;
      const mode: DeployMode = toDeployMode(parts[3]) === 'cache' ? 'full' : 'cache';
      await interaction.update({
        embeds: [await buildEmbed(branches[index] ?? branches[0] ?? 'main', mode)],
        components: buildComponents(branches, index, mode),
      });
      return;
    }

    if (action === 'cancel') {
      await interaction.update({
        content: t('modules.deploy.cancelled'),
        embeds: [],
        components: [],
      });
      return;
    }
    if (action === 'confirm') {
      const index = Number(parts[2]) || 0;
      const mode = toDeployMode(parts[3]);
      const branch = branches[index] ?? branches[0] ?? 'main';
      const notification = {
        applicationId: interaction.applicationId,
        token: interaction.token,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      };
      try {
        const requestedAt = await requestDeploy(interaction.user.id, notification, branch, mode);
        watchDeployProgress(ctx, {
          ...notification,
          requestedBy: interaction.user.id,
          requestedAt,
          mode,
        });
        ctx.logger.warn(
          { userId: interaction.user.id, branch, mode },
          'Mise a jour demandee via /maj',
        );
        await interaction.update({
          content:
            mode === 'cache'
              ? t('modules.deploy.requestedCache', { branch })
              : t('modules.deploy.requested', { branch }),
          embeds: [],
          components: [],
        });
      } catch (error) {
        ctx.logger.error({ err: error }, 'Echec de la demande de mise a jour');
        await interaction.update({
          content: t('modules.deploy.requestFailed'),
          embeds: [],
          components: [],
        });
      }
    }
  },
};
