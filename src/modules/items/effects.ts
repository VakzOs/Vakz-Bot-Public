import { ChannelType, type Guild, type GuildMember, PermissionFlagsBits } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { addBalance } from '../economy/service.js';
import { boostTraveler, damageTraveler } from '../route/service.js';
import type { ItemEffect } from './effects-schema.js';
import { type Item, addToInventory, getItem } from './service.js';

export interface ApplyEffectsInput {
  ctx: BotContext;
  guild: Guild;
  /** Membre qui utilise l'objet. */
  member: GuildMember;
  /** Cible éventuelle (effets ciblés, ex. dégâts sur la Route). */
  target: GuildMember | null;
  item: Item;
  effects: ItemEffect[];
}

/** Signe explicite d'un entier (pour les récaps « +40 » / « -8 »). */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Applique la liste d'effets d'un objet et renvoie les lignes de récapitulatif
 * (déjà traduites) à afficher à l'utilisateur. Best-effort : un effet qui
 * échoue (droits manquants, cible absente…) ajoute une ligne d'échec sans
 * interrompre les autres.
 */
export async function applyItemEffects(input: ApplyEffectsInput): Promise<string[]> {
  const { ctx, guild, member, target, item, effects } = input;
  const guildId = guild.id;
  const userId = member.id;
  const lines: string[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case 'role': {
        const ok = await member.roles
          .add(effect.roleId, t('modules.items.use.reason', { name: item.name }))
          .then(() => true)
          .catch(() => false);
        lines.push(
          ok
            ? t('modules.items.use.effects.role.done', { role: `<@&${effect.roleId}>` })
            : t('modules.items.use.effects.role.fail', { role: `<@&${effect.roleId}>` }),
        );
        break;
      }
      case 'coins': {
        await addBalance(ctx, guildId, userId, effect.amount);
        lines.push(t('modules.items.use.effects.coins.done', { amount: signed(effect.amount) }));
        break;
      }
      case 'routeSelf': {
        await boostTraveler(ctx, guildId, userId, {
          health: effect.health,
          energy: effect.energy,
          distance: effect.distance,
        });
        const parts = [
          effect.health !== 0 ? `❤️ ${signed(effect.health)}` : '',
          effect.energy !== 0 ? `⚡ ${signed(effect.energy)}` : '',
          effect.distance !== 0 ? `📏 ${signed(effect.distance)}` : '',
        ]
          .filter(Boolean)
          .join(' • ');
        lines.push(t('modules.items.use.effects.routeSelf.done', { parts: parts || '—' }));
        break;
      }
      case 'routeDamage': {
        if (!target) {
          lines.push(t('modules.items.use.effects.routeDamage.noTarget'));
          break;
        }
        const res = await damageTraveler(ctx, guildId, target.id, effect.health);
        if (!res) {
          lines.push(
            t('modules.items.use.effects.routeDamage.notTravelling', { target: `<@${target.id}>` }),
          );
        } else if (res.fainted) {
          lines.push(
            t('modules.items.use.effects.routeDamage.fainted', {
              target: `<@${target.id}>`,
              amount: effect.health,
            }),
          );
        } else {
          lines.push(
            t('modules.items.use.effects.routeDamage.done', {
              target: `<@${target.id}>`,
              amount: effect.health,
              health: res.health,
              maxHealth: res.maxHealth,
            }),
          );
        }
        break;
      }
      case 'grantItem': {
        const granted = await getItem(ctx, guildId, effect.itemId);
        if (!granted) {
          lines.push(t('modules.items.use.effects.grantItem.missing'));
          break;
        }
        await addToInventory(ctx, guildId, userId, granted.id, effect.quantity);
        lines.push(
          t('modules.items.use.effects.grantItem.done', {
            qty: effect.quantity,
            emoji: granted.emoji,
            name: granted.name,
          }),
        );
        break;
      }
      case 'privateChannel': {
        const name = effect.name.replace(/\{user\}/gi, member.user.username).slice(0, 90);
        const selfId = ctx.client.user?.id;
        const channel = await guild.channels
          .create({
            name,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
              {
                id: userId,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              },
              // Le bot conserve l'accès ; les admins (permission Administrateur)
              // voient le salon d'office, sans surcharge nécessaire.
              ...(selfId ? [{ id: selfId, allow: [PermissionFlagsBits.ViewChannel] }] : []),
            ],
          })
          .catch(() => null);
        lines.push(
          channel
            ? t('modules.items.use.effects.privateChannel.done', { channel: `<#${channel.id}>` })
            : t('modules.items.use.effects.privateChannel.fail'),
        );
        break;
      }
      case 'message': {
        lines.push(effect.text);
        break;
      }
    }
  }

  return lines;
}
