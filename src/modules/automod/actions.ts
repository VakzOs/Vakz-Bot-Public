import type { ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getAutomodConfig } from './config.js';
import { createHoneypotChannel, syncHoneypotMessage } from './service.js';

/**
 * Crée le salon piège (« honeypot ») ouvert à tous : tout membre qui y écrit
 * est sanctionné. Le salon créé devient le salon piège du module.
 */
const setupHoneypot = (): ModuleAction => ({
  id: 'setupHoneypot',
  label: t('modules.automod.actions.setupHoneypot.label'),
  help: t('modules.automod.actions.setupHoneypot.help'),
  style: 'primary',
  confirm: t('modules.automod.actions.setupHoneypot.confirm'),
  async run({ ctx, guildId }) {
    const guild = ctx.client.guilds.cache.get(guildId);
    const msg = (key: string, vars?: Record<string, string | number>) =>
      t(`modules.automod.actions.setupHoneypot.msg.${key}`, vars);
    if (!guild) return { ok: false, message: msg('noGuild') };

    const channel = await createHoneypotChannel(guild);
    if (!channel) {
      return {
        ok: false,
        message: msg('noPermission'),
      };
    }

    const config = await getAutomodConfig(ctx, guildId);
    const honeypot = { ...config.honeypot, channelId: channel.id, messageId: null };
    const messageId = await syncHoneypotMessage(ctx, guild, { ...config, honeypot });
    return {
      ok: true,
      message: msg('done', { salon: channel.name }),
      configPatch: { honeypot: { ...honeypot, messageId } },
    };
  },
});

export const automodActions = (): ModuleAction[] => [setupHoneypot()];
