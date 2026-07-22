import { type Interaction, MessageFlags } from 'discord.js';
import { logger } from './logger.js';
import { t } from './i18n.js';

/** Contexte de log attaché à une exécution protégée. */
export type RunContext = Record<string, unknown>;

/**
 * Exécute une fonction en capturant toute erreur : on log proprement via pino
 * et on ne laisse jamais l'exception remonter (le process ne crashe pas).
 */
export async function safeRun(fn: () => Promise<void> | void, context: RunContext): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.error({ err: error, ...context }, 'Erreur capturée');
  }
}

/**
 * Gère une erreur survenue pendant le traitement d'une interaction : on log,
 * puis on tente de prévenir l'utilisateur avec un message éphémère générique.
 */
export async function handleInteractionError(
  interaction: Interaction,
  error: unknown,
): Promise<void> {
  logger.error(
    {
      err: error,
      interactionType: interaction.type,
      guildId: interaction.guildId,
      userId: interaction.user.id,
    },
    'Erreur lors du traitement d’une interaction',
  );

  if (!interaction.isRepliable()) return;

  const locale = interaction.guild?.preferredLocale ?? undefined;
  const message = t('errors.generic', undefined, locale?.startsWith('fr') ? 'fr' : undefined);

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch (replyError) {
    logger.error({ err: replyError }, 'Impossible de notifier l’utilisateur de l’erreur');
  }
}

/**
 * Installe les garde-fous au niveau du process : on log les erreurs non
 * capturées au lieu de laisser Node terminer brutalement.
 */
export function installProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Promesse rejetée non gérée');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Exception non capturée');
  });
}
