import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ComponentEmojiResolvable,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

/**
 * Kit UI partagé : fabriques réutilisables pour les composants Discord (lignes,
 * boutons, sélecteurs, pagination, modals). Centralise les patterns jusqu'ici
 * ré-implémentés dans chaque `panel.ts`, et applique d'office les limites Discord
 * (25 options/select, 45 car. de titre modal, 5 champs/modal).
 */

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

/** Assemble une ligne d'action (boutons, ou un unique sélecteur). */
export function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

export interface ButtonSpec {
  /** Requis pour un bouton d'action (ignoré si `url` est fourni). */
  id?: string;
  /** Fournir `url` fait un bouton lien (style Link, sans customId). */
  url?: string;
  label?: string;
  emoji?: ComponentEmojiResolvable;
  style?: ButtonStyle;
  disabled?: boolean;
}

export function button(spec: ButtonSpec): ButtonBuilder {
  const b = new ButtonBuilder();
  if (spec.url) b.setStyle(ButtonStyle.Link).setURL(spec.url);
  else b.setStyle(spec.style ?? ButtonStyle.Secondary).setCustomId(spec.id ?? 'noop');
  if (spec.label) b.setLabel(spec.label.slice(0, 80));
  if (spec.emoji) b.setEmoji(spec.emoji);
  if (spec.disabled) b.setDisabled(true);
  return b;
}

/** Raccourci bouton lien. */
export function linkButton(
  label: string,
  url: string,
  emoji?: ComponentEmojiResolvable,
): ButtonBuilder {
  return button({ url, label, emoji });
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: ComponentEmojiResolvable;
  default?: boolean;
}

export interface SelectSpec {
  id: string;
  placeholder?: string;
  options: SelectOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

/** Sélecteur à choix de chaînes (tronqué à 25 options, limite Discord). */
export function stringSelect(spec: SelectSpec): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder().setCustomId(spec.id);
  if (spec.placeholder) menu.setPlaceholder(spec.placeholder.slice(0, 150));
  if (spec.minValues !== undefined) menu.setMinValues(spec.minValues);
  if (spec.maxValues !== undefined) menu.setMaxValues(spec.maxValues);
  if (spec.disabled) menu.setDisabled(true);
  menu.addOptions(
    spec.options.slice(0, 25).map((o) => {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(o.label.slice(0, 100))
        .setValue(o.value);
      if (o.description) opt.setDescription(o.description.slice(0, 100));
      if (o.emoji) opt.setEmoji(o.emoji);
      if (o.default) opt.setDefault(true);
      return opt;
    }),
  );
  return menu;
}

export interface PaginationSpec {
  /** customId de base ; on suffixe `|prev` et `|next`. */
  prefix: string;
  /** Page courante (0-indexée). */
  page: number;
  pageCount: number;
  prevLabel?: string;
  nextLabel?: string;
}

/**
 * Ligne de pagination « ◀ | n/N | ▶ », avec boutons bornés (désactivés aux
 * extrémités). Le routeur du module lit `prefix|prev` / `prefix|next`.
 */
export function paginationRow(spec: PaginationSpec): Row {
  const total = Math.max(1, spec.pageCount);
  return row(
    button({
      id: `${spec.prefix}|prev`,
      label: spec.prevLabel ?? '◀',
      disabled: spec.page <= 0,
    }),
    button({
      id: `${spec.prefix}|indicator`,
      label: `${Math.min(spec.page + 1, total)}/${total}`,
      disabled: true,
    }),
    button({
      id: `${spec.prefix}|next`,
      label: spec.nextLabel ?? '▶',
      disabled: spec.page >= total - 1,
    }),
  );
}

export interface ModalField {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
  style?: TextInputStyle;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

/** Modal à champs texte (max 5 champs, limite Discord). */
export function modal(id: string, title: string, fields: ModalField[]): ModalBuilder {
  const m = new ModalBuilder().setCustomId(id).setTitle(title.slice(0, 45));
  for (const f of fields.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label.slice(0, 45))
      .setStyle(f.style ?? TextInputStyle.Short)
      .setRequired(f.required ?? false);
    if (f.value !== undefined) input.setValue(f.value);
    if (f.placeholder) input.setPlaceholder(f.placeholder.slice(0, 100));
    if (f.minLength !== undefined) input.setMinLength(f.minLength);
    if (f.maxLength !== undefined) input.setMaxLength(f.maxLength);
    m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return m;
}
