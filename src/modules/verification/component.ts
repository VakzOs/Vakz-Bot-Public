import {
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, getVerificationConfig } from './config.js';
import { clearPending, generateCode, getPending, renderCaptcha, setPending } from './captcha.js';
import { buildOpenRow, grantVerifiedRole, logVerification, roleAssignable } from './service.js';

/** customId du modal de saisie du code captcha. */
const ANSWER_CUSTOM_ID = 'verif|answer';

function answerModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ANSWER_CUSTOM_ID)
    .setTitle(t('modules.verification.feedback.answerModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('code')
          .setLabel(t('modules.verification.feedback.answerField'))
          .setStyle(TextInputStyle.Short)
          .setMinLength(4)
          .setMaxLength(8)
          .setRequired(true),
      ),
    );
}

/**
 * Gère le parcours public de vérification (préfixe `verif`, hors `/config`) :
 * - `verif|start`  : clic sur « Se vérifier » → attribution directe (méthode
 *   bouton) ou génération d'un captcha image (méthode captcha) ;
 * - `verif|open`   : ouvre le modal de saisie du code ;
 * - `verif|answer` : valide le code saisi et attribue le rôle vérifié.
 */
export const verificationComponent: ComponentHandler = {
  prefix: 'verif',
  async handle(interaction, ctx) {
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const action = interaction.customId.split('|')[1] ?? '';

    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await reply(interaction, t('modules.verification.feedback.disabled'));
      return;
    }

    const config = await getVerificationConfig(ctx, guildId);
    const guild = interaction.guild;
    const member = interaction.member;

    if (!config.roleId) {
      await reply(interaction, t('modules.verification.feedback.notConfigured'));
      return;
    }
    const hasRole = member.roles.cache.has(config.roleId);

    // --- Démarrage ---------------------------------------------------------
    if (action === 'start' && interaction.isButton()) {
      if (hasRole) {
        await reply(interaction, t('modules.verification.feedback.alreadyVerified'));
        return;
      }
      if (!roleAssignable(guild, config.roleId)) {
        await reply(interaction, t('modules.verification.feedback.cannotAssign'));
        return;
      }

      if (config.method === 'button') {
        const ok = await grantVerifiedRole(member, config.roleId);
        await reply(
          interaction,
          ok
            ? t('modules.verification.feedback.success')
            : t('modules.verification.feedback.cannotAssign'),
        );
        if (ok) await logVerification(ctx, guild, config, member.id);
        return;
      }

      // Méthode captcha : génère un code, l'affiche déformé, propose la saisie.
      const code = generateCode();
      setPending(guildId, member.id, code);
      await interaction.reply({
        content: t('modules.verification.feedback.captchaInstructions'),
        files: [new AttachmentBuilder(renderCaptcha(code), { name: 'captcha.png' })],
        components: [buildOpenRow()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // --- Ouverture du modal de saisie -------------------------------------
    if (action === 'open' && interaction.isButton()) {
      if (!getPending(guildId, member.id)) {
        await reply(interaction, t('modules.verification.feedback.captchaExpired'));
        return;
      }
      await interaction.showModal(answerModal());
      return;
    }

    // --- Validation du code ------------------------------------------------
    if (action === 'answer' && interaction.isModalSubmit()) {
      const code = getPending(guildId, member.id);
      if (!code) {
        await reply(interaction, t('modules.verification.feedback.captchaExpired'));
        return;
      }

      const answer = interaction.fields.getTextInputValue('code').trim().toUpperCase();
      if (answer !== code) {
        // Mauvais code : on garde le captcha en attente et on propose un nouvel essai.
        await interaction.reply({
          content: t('modules.verification.feedback.captchaWrong'),
          components: [buildOpenRow()],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      clearPending(guildId, member.id);
      if (hasRole) {
        await reply(interaction, t('modules.verification.feedback.alreadyVerified'));
        return;
      }
      if (!roleAssignable(guild, config.roleId)) {
        await reply(interaction, t('modules.verification.feedback.cannotAssign'));
        return;
      }
      const ok = await grantVerifiedRole(member, config.roleId);
      await reply(
        interaction,
        ok
          ? t('modules.verification.feedback.success')
          : t('modules.verification.feedback.cannotAssign'),
      );
      if (ok) await logVerification(ctx, guild, config, member.id);
    }
  },
};

/** Réponse éphémère générique (bouton ou modal). */
async function reply(
  interaction: Parameters<ComponentHandler['handle']>[0],
  content: string,
): Promise<void> {
  if (interaction.isButton() || interaction.isModalSubmit()) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
