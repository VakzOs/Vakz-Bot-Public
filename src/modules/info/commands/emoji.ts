import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { infoEmbed } from '../../../lib/embeds.js';

/** Un emoji personnalisé Discord : `<:nom:id>` ou `<a:nom:id>` (animé). */
const CUSTOM_EMOJI = /^<(a)?:(\w{2,32}):(\d{17,20})>$/;
/** Un raccourci `:nom:` (résolu contre les emojis du serveur). */
const SHORTCODE = /^:(\w{2,32}):$/;
/** Version épinglée de Twemoji utilisée pour les emojis unicode. */
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets';

/** Construit l'embed pour un emoji personnalisé (image CDN téléchargeable). */
function customEmbed(name: string, id: string, animated: boolean) {
  const ext = animated ? 'gif' : 'png';
  const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=1024`;
  return infoEmbed({ title: `:${name}:` })
    .setImage(url)
    .addFields(
      { name: t('modules.info.field.id'), value: `\`${id}\``, inline: true },
      {
        name: t('modules.info.field.bot'),
        value: animated ? t('modules.info.emoji.animated') : t('modules.info.emoji.static'),
        inline: true,
      },
      {
        name: t('modules.info.emoji.download'),
        value: `[${t('modules.info.avatar.link')}](${url})`,
      },
    );
}

/** `/emoji` — affiche un emoji en grand et fournit un lien de téléchargement. */
export const emoji: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription(t('modules.info.emoji.description'))
    .addStringOption((o) =>
      o
        .setName('emoji')
        .setDescription(t('modules.info.opt.emoji'))
        .setRequired(true)
        .setMaxLength(100),
    ),
  async execute(interaction) {
    const input = interaction.options.getString('emoji', true).trim();

    // 1) Emoji personnalisé collé directement (`<:nom:id>`).
    const custom = CUSTOM_EMOJI.exec(input);
    if (custom) {
      await interaction.reply({
        embeds: [customEmbed(custom[2] ?? 'emoji', custom[3] ?? '', Boolean(custom[1]))],
      });
      return;
    }

    // 2) Raccourci `:nom:` → emoji du serveur.
    const shortcode = SHORTCODE.exec(input);
    if (shortcode && interaction.inCachedGuild()) {
      const found = interaction.guild.emojis.cache.find((e) => e.name === shortcode[1]);
      if (found) {
        await interaction.reply({
          embeds: [customEmbed(found.name ?? 'emoji', found.id, found.animated ?? false)],
        });
        return;
      }
    }

    // 3) Emoji unicode → Twemoji (image PNG + téléchargement SVG vectoriel).
    const codepoints = [...input].map((char) => char.codePointAt(0)?.toString(16) ?? '');
    const filtered = codepoints.filter((cp) => cp && cp !== 'fe0f');
    const code = (filtered.length ? filtered : codepoints).join('-');
    if (input.length > 0 && /^[0-9a-f-]+$/.test(code)) {
      const png = `${TWEMOJI}/72x72/${code}.png`;
      const svg = `${TWEMOJI}/svg/${code}.svg`;
      const embed = infoEmbed({ title: input })
        .setImage(png)
        .addFields({
          name: t('modules.info.emoji.download'),
          value: `[PNG](${png}) · [SVG](${svg})`,
        });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    await interaction.reply({
      content: t('modules.info.emoji.notEmoji'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
