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
import { Colors } from '../../lib/embeds.js';
import {
  type DeployResult,
  type DeployStatus,
  deployBranches,
  deployEnabled,
  isOwner,
  readResult,
  readStatus,
  requestDeploy,
  watchDeployProgress,
} from './service.js';

function resultLine(result: DeployResult | null): string {
  if (!result) return t('modules.deploy.noResult');
  const when = result.finishedAt
    ? `<t:${Math.floor(new Date(result.finishedAt).getTime() / 1000)}:R>`
    : '';
  const icon =
    result.status === 'success'
      ? '\u2705'
      : result.status === 'failure'
        ? '\u274C'
        : '\u2139\uFE0F';
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

async function buildEmbed(branch: string): Promise<EmbedBuilder> {
  const [result, status] = await Promise.all([readResult(), readStatus()]);
  const embed = new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(t('modules.deploy.title'))
    .setDescription(t('modules.deploy.intro'))
    .addFields(
      { name: t('modules.deploy.branchField'), value: `\`${branch}\``, inline: true },
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

/** S\u00E9lecteur de branche + boutons confirmer/annuler (l'index choisi est encod\u00E9
 * dans le customId du bouton confirmer). */
function buildComponents(
  selectedIndex: number,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const branches = deployBranches();
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (branches.length > 1) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('deploy|branch')
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

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`deploy|confirm|${selectedIndex}`)
        .setLabel(t('modules.deploy.confirm'))
        .setEmoji('\uD83D\uDE80')
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
    const branches = deployBranches();
    await interaction.reply({
      embeds: [await buildEmbed(branches[0] ?? 'main')],
      components: buildComponents(0),
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
    const branches = deployBranches();

    // Choix de la branche dans le sélecteur → on ré-affiche avec la sélection.
    if (interaction.isStringSelectMenu() && action === 'branch') {
      const index = Number(interaction.values[0]) || 0;
      await interaction.update({
        embeds: [await buildEmbed(branches[index] ?? branches[0] ?? 'main')],
        components: buildComponents(index),
      });
      return;
    }
    if (!interaction.isButton()) return;

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
      const branch = branches[index] ?? branches[0] ?? 'main';
      const notification = {
        applicationId: interaction.applicationId,
        token: interaction.token,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      };
      try {
        const requestedAt = await requestDeploy(interaction.user.id, notification, branch);
        watchDeployProgress(ctx, {
          ...notification,
          requestedBy: interaction.user.id,
          requestedAt,
        });
        ctx.logger.warn({ userId: interaction.user.id, branch }, 'Mise a jour demandee via /maj');
        await interaction.update({
          content: t('modules.deploy.requested', { branch }),
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
