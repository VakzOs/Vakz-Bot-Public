import { randomInt } from 'node:crypto';
import { ChannelType, type Guild, type GuildMember, PermissionFlagsBits } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { addBalance, getBalance } from '../economy/service.js';
import { boostTraveler, damageTraveler, getTraveler } from '../route/service.js';
import { removeDuckling, stickDuckling } from '../route/duckling.js';
import type { BaseItemEffect, ItemEffect } from './effects-schema.js';
import { type Item, addToInventory, getItem } from './service.js';
import { applyTempNickname } from './tempnick.js';

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
  const lines: string[] = [];
  for (const effect of input.effects) {
    await applyEffect(input, effect, lines);
  }
  return lines;
}

/** Tire un element au hasard selon des poids (poids plus eleve = plus probable). */
function pickWeighted<T extends { weight: number }>(entries: readonly T[]): T | undefined {
  const total = entries.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0);
  if (total <= 0) return entries[0];
  let roll = randomInt(total);
  for (const entry of entries) {
    roll -= Math.max(1, entry.weight);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/**
 * Applique UN effet et pousse ses lignes de recapitulatif. La boite mystere
 * rappelle cette fonction pour le tirage sorti ; ses tirages ne contiennent que
 * des effets « simples » (pas de boite dans une boite), donc pas de recursion
 * infinie possible.
 */
async function applyEffect(
  input: ApplyEffectsInput,
  effect: ItemEffect,
  lines: string[],
): Promise<void> {
  const { ctx, guild, member, target, item } = input;
  const guildId = guild.id;
  const userId = member.id;

  {
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
        // Retour de baton : `backfirePercent` % de chances que l'objet se
        // retourne contre son utilisateur (les degats le frappent LUI, pas la
        // cible). Tirage non biaise (node:crypto).
        const backfired = effect.backfirePercent > 0 && randomInt(100) < effect.backfirePercent;
        const victim = backfired ? member : target;
        const key = backfired
          ? 'modules.items.use.effects.routeDamage.backfire'
          : 'modules.items.use.effects.routeDamage';

        const res = await damageTraveler(ctx, guildId, victim.id, effect.health);
        if (!res) {
          lines.push(
            t(`${key}.notTravelling`, { target: `<@${victim.id}>`, aimed: `<@${target.id}>` }),
          );
        } else if (res.fainted) {
          lines.push(
            t(`${key}.fainted`, {
              target: `<@${victim.id}>`,
              aimed: `<@${target.id}>`,
              amount: effect.health,
            }),
          );
        } else {
          lines.push(
            t(`${key}.done`, {
              target: `<@${victim.id}>`,
              aimed: `<@${target.id}>`,
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
      case 'stealCoins': {
        if (!target) {
          lines.push(t('modules.items.use.effects.stealCoins.noTarget'));
          break;
        }
        // Retour de baton : le vol echoue et c'est TOI qui paies la cible.
        const backfired = effect.backfirePercent > 0 && randomInt(100) < effect.backfirePercent;
        const fromId = backfired ? userId : target.id;
        const toId = backfired ? target.id : userId;
        const available = await getBalance(ctx, guildId, fromId);
        const moved = Math.min(effect.amount, Math.max(0, available));
        if (moved <= 0) {
          lines.push(
            t(
              backfired
                ? 'modules.items.use.effects.stealCoins.backfireBroke'
                : 'modules.items.use.effects.stealCoins.broke',
              { target: `<@${target.id}>`, aimed: `<@${target.id}>` },
            ),
          );
          break;
        }
        await addBalance(ctx, guildId, fromId, -moved);
        await addBalance(ctx, guildId, toId, moved);
        lines.push(
          t(
            backfired
              ? 'modules.items.use.effects.stealCoins.backfire'
              : 'modules.items.use.effects.stealCoins.done',
            { target: `<@${target.id}>`, aimed: `<@${target.id}>`, amount: moved },
          ),
        );
        break;
      }
      case 'timeout': {
        if (!target) {
          lines.push(t('modules.items.use.effects.timeout.noTarget'));
          break;
        }
        const backfired = effect.backfirePercent > 0 && randomInt(100) < effect.backfirePercent;
        const victim = backfired ? member : target;
        const ok = await victim
          .timeout(effect.minutes * 60_000, t('modules.items.use.reason', { name: item.name }))
          .then(() => true)
          .catch(() => false);
        if (!ok) {
          lines.push(t('modules.items.use.effects.timeout.fail', { target: `<@${victim.id}>` }));
          break;
        }
        lines.push(
          t(
            backfired
              ? 'modules.items.use.effects.timeout.backfire'
              : 'modules.items.use.effects.timeout.done',
            { target: `<@${victim.id}>`, aimed: `<@${target.id}>`, minutes: effect.minutes },
          ),
        );
        break;
      }
      case 'drainEnergy': {
        if (!target) {
          lines.push(t('modules.items.use.effects.drainEnergy.noTarget'));
          break;
        }
        const backfired = effect.backfirePercent > 0 && randomInt(100) < effect.backfirePercent;
        const victim = backfired ? member : target;
        // On n'invente pas de voyageur : seul un membre deja sur la Route subit le drain.
        const travelling = await getTraveler(ctx, guildId, victim.id);
        if (!travelling) {
          lines.push(
            t('modules.items.use.effects.drainEnergy.notTravelling', {
              target: `<@${victim.id}>`,
            }),
          );
          break;
        }
        const after = await boostTraveler(ctx, guildId, victim.id, {
          health: 0,
          energy: -effect.energy,
          distance: 0,
        });
        lines.push(
          t(
            backfired
              ? 'modules.items.use.effects.drainEnergy.backfire'
              : 'modules.items.use.effects.drainEnergy.done',
            {
              target: `<@${victim.id}>`,
              aimed: `<@${target.id}>`,
              amount: effect.energy,
              energy: after.energy,
            },
          ),
        );
        break;
      }
      case 'healTarget': {
        // Soin sur soi-meme ou sur la cible, selon la config de l'effet.
        const healed = effect.on === 'self' ? member : target;
        if (!healed) {
          lines.push(t('modules.items.use.effects.healTarget.noTarget'));
          break;
        }
        const travelling = await getTraveler(ctx, guildId, healed.id);
        if (!travelling) {
          lines.push(
            t('modules.items.use.effects.healTarget.notTravelling', {
              target: `<@${healed.id}>`,
            }),
          );
          break;
        }
        const after = await boostTraveler(ctx, guildId, healed.id, {
          health: effect.health,
          energy: effect.energy,
          distance: 0,
        });
        const parts = [
          effect.health !== 0 ? `\u2764\uFE0F +${effect.health}` : '',
          effect.energy !== 0 ? `\u26A1 +${effect.energy}` : '',
        ]
          .filter(Boolean)
          .join(' \u2022 ');
        lines.push(
          t('modules.items.use.effects.healTarget.done', {
            target: `<@${healed.id}>`,
            parts: parts || '\u2014',
            health: after.health,
            maxHealth: after.maxHealth,
          }),
        );
        break;
      }
      case 'nickname': {
        const victim = effect.on === 'self' ? member : target;
        if (!victim) {
          lines.push(t('modules.items.use.effects.nickname.noTarget'));
          break;
        }
        const outcome = await applyTempNickname(ctx, victim, effect.nickname, effect.minutes);
        lines.push(
          t(`modules.items.use.effects.nickname.${outcome === 'ok' ? 'done' : outcome}`, {
            target: `<@${victim.id}>`,
            nickname: effect.nickname,
            minutes: effect.minutes,
          }),
        );
        break;
      }
      case 'duckling': {
        if (!target) {
          lines.push(t('modules.items.use.effects.duckling.noTarget'));
          break;
        }
        // Retour de baton : le canneton te choisit TOI comme victime.
        const backfired = effect.backfirePercent > 0 && randomInt(100) < effect.backfirePercent;
        const victim = backfired ? member : target;
        const owner = backfired ? target.id : userId;
        const turns = await stickDuckling(ctx, guildId, victim.id, owner, {
          turns: effect.turns,
          stealPercent: effect.stealPercent,
          distancePercent: effect.distancePercent,
          damagePercent: effect.damagePercent,
        });
        lines.push(
          t(
            backfired
              ? 'modules.items.use.effects.duckling.backfire'
              : 'modules.items.use.effects.duckling.done',
            {
              target: `<@${victim.id}>`,
              aimed: `<@${target.id}>`,
              turns,
              steal: effect.stealPercent,
              distance: effect.distancePercent,
              damage: effect.damagePercent,
            },
          ),
        );
        break;
      }
      case 'unstickDuckling': {
        const freed = effect.on === 'self' ? member : target;
        if (!freed) {
          lines.push(t('modules.items.use.effects.unstickDuckling.noTarget'));
          break;
        }
        const removed = await removeDuckling(ctx, guildId, freed.id);
        lines.push(
          t(
            removed
              ? 'modules.items.use.effects.unstickDuckling.done'
              : 'modules.items.use.effects.unstickDuckling.none',
            { target: `<@${freed.id}>` },
          ),
        );
        break;
      }
      case 'mysteryBox': {
        const outcome = pickWeighted(effect.outcomes);
        if (!outcome) break;
        lines.push(
          outcome.label
            ? t('modules.items.use.effects.mysteryBox.labelled', { label: outcome.label })
            : t('modules.items.use.effects.mysteryBox.opened'),
        );
        for (const inner of outcome.effects as BaseItemEffect[]) {
          await applyEffect(input, inner, lines);
        }
        break;
      }
    }
  }
}
