import { type Interaction, MessageFlags } from 'discord.js';
import { logger, loggerFor } from './logger.js';
import { t } from './i18n.js';

/** Contexte de log attaché à une exécution protégée. */
export type RunContext = Record<string, unknown>;

/** Le logger du module nommé par le contexte, ou le logger racine à défaut. */
function moduleLogger(context: RunContext): ReturnType<typeof loggerFor> {
  return loggerFor(typeof context.module === 'string' ? context.module : undefined);
}

/**
 * Exécute une fonction en capturant toute erreur : on log proprement via pino
 * et on ne laisse jamais l'exception remonter (le process ne crashe pas).
 */
export async function safeRun(fn: () => Promise<void> | void, context: RunContext): Promise<void> {
  try {
    await fn();
  } catch (error) {
    // La ligne part sur le logger du module quand le contexte le nomme : un
    // module qui ne vit que par ses évènements n'apparaissait sinon nulle part
    // dans la colonne « module » du dashboard, pas même quand il échouait.
    moduleLogger(context).error({ err: error, ...context }, 'Erreur capturée');
  }
}

/**
 * Gère une erreur survenue pendant le traitement d'une interaction : on log,
 * puis on tente de prévenir l'utilisateur avec un message éphémère générique.
 */
export async function handleInteractionError(
  interaction: Interaction,
  error: unknown,
  /**
   * Contexte de l'appel (module, commande, durée). Sans lui, la ligne dit
   * qu'« une interaction » a échoué — ce qui n'aide personne à savoir laquelle.
   */
  context: RunContext = {},
): Promise<void> {
  moduleLogger(context).error(
    {
      err: error,
      interactionType: interaction.type,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      ...context,
    },
    'Erreur lors du traitement d’une interaction',
  );

  if (!interaction.isRepliable()) return;

  // Pas de langue passée : le routeur d'interactions a déjà posé celle du
  // serveur autour de tout le traitement, celle-ci comprise. La déduire ici de
  // `preferredLocale` contredirait le choix fait dans le dashboard — un serveur
  // réglé en anglais recevait ses erreurs en français.
  const message = t('errors.generic');

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
