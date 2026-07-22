import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getRouteConfig, updateRouteConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function onOff(value: boolean): string {
  return value ? t('modules.route.panel.on') : t('modules.route.panel.off');
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getRouteConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.route.label'),
    description: t('modules.route.panel.intro'),
  }).addFields(
    {
      name: t('modules.route.panel.cooldownField'),
      value: t('modules.route.panel.cooldownValue', { minutes: config.cooldownMinutes }),
      inline: true,
    },
    { name: t('modules.route.panel.coinsField'), value: onOff(config.giveCoins), inline: true },
    { name: t('modules.route.panel.itemsField'), value: onOff(config.giveItems), inline: true },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'cooldown'))
        .setLabel(t('modules.route.panel.editCooldown'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'coins'))
        .setLabel(t('modules.route.panel.coinsField'))
        .setStyle(config.giveCoins ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'items'))
        .setLabel(t('modules.route.panel.itemsField'))
        .setStyle(config.giveItems ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  ];
  return { embed, components };
}

function cooldownModal(current: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'cooldownmodal'))
    .setTitle(t('modules.route.panel.editCooldown'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('minutes')
          .setLabel(t('modules.route.panel.cooldownLabel'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true)
          .setValue(String(current))
          .setPlaceholder('15'),
      ),
    );
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'cooldown': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(cooldownModal(config.cooldownMinutes));
      return;
    }
    case 'cooldownmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const parsed = Number.parseInt(interaction.fields.getTextInputValue('minutes'), 10);
      const cooldownMinutes = Number.isNaN(parsed) ? 15 : Math.min(1440, Math.max(0, parsed));
      await updateRouteConfig(ctx, guildId, { cooldownMinutes });
      await interaction.update(await renderPage());
      return;
    }
    case 'coins': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await updateRouteConfig(ctx, guildId, { giveCoins: !config.giveCoins });
      await interaction.update(await renderPage());
      return;
    }
    case 'items': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await updateRouteConfig(ctx, guildId, { giveItems: !config.giveItems });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Route de l'Infini ». */
export const routePanel: ConfigPanel = { render, handle };
