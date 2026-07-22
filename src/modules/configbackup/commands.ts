import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { errorEmbed, infoEmbed, successEmbed } from '../../lib/embeds.js';
import { applyBackup, buildBackup, parseBackup } from './service.js';

/** Taille maximale acceptée pour un fichier importé (1 Mo, très large). */
const MAX_FILE_SIZE = 1024 * 1024;

/** Transforme un nom de serveur en fragment de nom de fichier sûr. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'serveur'
  );
}

/** Formate une liste de noms de modules en `code` (ou un tiret si vide). */
function formatList(names: string[]): string {
  if (names.length === 0) return '—';
  return names.map((name) => `\`${name}\``).join(', ');
}

/**
 * `/sauvegarde` (admins) — exporte toute la configuration des modules du serveur
 * dans un fichier JSON, et la réimporte depuis un fichier. Pratique pour un
 * backup avant refonte ou une migration vers un autre serveur.
 */
export const sauvegarde: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('sauvegarde')
    .setDescription(t('modules.configbackup.command.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('exporter').setDescription(t('modules.configbackup.command.export')),
    )
    .addSubcommand((s) =>
      s
        .setName('importer')
        .setDescription(t('modules.configbackup.command.import'))
        .addAttachmentOption((o) =>
          o.setName('fichier').setDescription(t('modules.configbackup.opt.file')).setRequired(true),
        )
        .addBooleanOption((o) =>
          o.setName('recreer').setDescription(t('modules.configbackup.opt.recreate')),
        ),
    ),

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'exporter') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const backup = await buildBackup(ctx, interaction.guild);
      const buffer = Buffer.from(JSON.stringify(backup, null, 2), 'utf8');
      const stamp = new Date().toISOString().slice(0, 10);
      const file = new AttachmentBuilder(buffer, {
        name: `config-${slugify(interaction.guild.name)}-${stamp}.json`,
      });
      const roleCount = backup.references ? Object.keys(backup.references.roles).length : 0;
      const channelCount = backup.references ? Object.keys(backup.references.channels).length : 0;
      const description = [
        t('modules.configbackup.export.done', { count: backup.modules.length }),
        t('modules.configbackup.export.structure', { roles: roleCount, channels: channelCount }),
      ].join('\n');
      const embed = infoEmbed({
        title: t('modules.configbackup.export.title'),
        description,
      });
      await interaction.editReply({ embeds: [embed], files: [file] });
      return;
    }

    if (sub === 'importer') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const attachment = interaction.options.getAttachment('fichier', true);

      if (attachment.size > MAX_FILE_SIZE) {
        await interaction.editReply({
          embeds: [errorEmbed({ description: t('modules.configbackup.import.tooLarge') })],
        });
        return;
      }

      let raw: string;
      try {
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw = await res.text();
      } catch (error) {
        ctx.logger.warn({ err: error }, 'Téléchargement du fichier de sauvegarde échoué');
        await interaction.editReply({
          embeds: [errorEmbed({ description: t('modules.configbackup.import.downloadFailed') })],
        });
        return;
      }

      const parsed = parseBackup(raw);
      if (!parsed.ok) {
        const key =
          parsed.reason === 'json'
            ? 'modules.configbackup.import.invalidJson'
            : 'modules.configbackup.import.invalidShape';
        await interaction.editReply({ embeds: [errorEmbed({ description: t(key) })] });
        return;
      }

      const recreate = interaction.options.getBoolean('recreer') ?? true;
      const result = await applyBackup(ctx, interaction.guild, parsed.backup, { recreate });

      const lines = [
        t('modules.configbackup.import.applied', {
          count: result.applied.length,
          list: formatList(result.applied),
        }),
      ];
      if (result.hadReferences) {
        const s = result.references;
        lines.push(
          t('modules.configbackup.import.structure', {
            rolesCreated: s.rolesCreated,
            rolesReused: s.rolesReused,
            channelsCreated: s.channelsCreated,
            channelsReused: s.channelsReused,
          }),
        );
        if (s.failed > 0) {
          lines.push(t('modules.configbackup.import.structureFailed', { failed: s.failed }));
        }
      } else if (result.fromOtherGuild) {
        lines.push(t('modules.configbackup.import.structureMissing'));
      }
      if (result.skippedUnknown.length > 0) {
        lines.push(
          t('modules.configbackup.import.skippedUnknown', {
            list: formatList(result.skippedUnknown),
          }),
        );
      }
      if (result.skippedInvalid.length > 0) {
        lines.push(
          t('modules.configbackup.import.skippedInvalid', {
            list: formatList(result.skippedInvalid),
          }),
        );
      }
      if (result.fromOtherGuild) {
        lines.push(t('modules.configbackup.import.otherGuild'));
      }

      await interaction.editReply({
        embeds: [
          successEmbed({
            title: t('modules.configbackup.import.title'),
            description: lines.join('\n'),
          }),
        ],
      });
    }
  },
};
