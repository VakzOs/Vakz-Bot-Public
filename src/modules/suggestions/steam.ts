/**
 * Récupération d'informations de jeu depuis l'API publique du Steam Store
 * (`appdetails`, sans clé). Utilisé pour enrichir une suggestion de jeu avec
 * son nom, son prix, sa description et son image.
 */

const STEAM_APP_URL = /store\.steampowered\.com\/app\/(\d+)/i;
const REQUEST_TIMEOUT_MS = 6000;

export interface SteamGame {
  appId: string;
  name: string;
  description: string;
  image: string;
  url: string;
  isFree: boolean;
  price: string | null;
}

interface SteamAppData {
  type?: string;
  name?: string;
  short_description?: string;
  header_image?: string;
  is_free?: boolean;
  price_overview?: { final_formatted?: string };
}

/** Extrait l'appid d'un lien Steam Store (`/app/<appid>/...`). */
export function extractAppId(input: string): string | null {
  const match = STEAM_APP_URL.exec(input.trim());
  return match?.[1] ?? null;
}

/** Interroge l'API Steam et renvoie les infos du jeu, ou `null` en cas d'échec. */
export async function fetchSteamGame(appId: string): Promise<SteamGame | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=french&cc=fr`,
      { signal: controller.signal, headers: { 'User-Agent': 'Vakz-Bot' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<
      string,
      { success?: boolean; data?: SteamAppData } | undefined
    >;
    const entry = json[appId];
    if (!entry?.success || !entry.data?.name) return null;
    const data = entry.data;
    return {
      appId,
      name: data.name ?? '',
      description: data.short_description ?? '',
      image: data.header_image ?? '',
      url: `https://store.steampowered.com/app/${appId}`,
      isFree: Boolean(data.is_free),
      price: data.price_overview?.final_formatted ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sérialise un jeu pour stockage dans `Suggestion.metadata`. */
export function gameToMetadata(game: SteamGame): string {
  return JSON.stringify(game);
}

/** Désérialise les métadonnées d'une suggestion en jeu Steam (ou `null`). */
export function parseGameMetadata(metadata: string | null): SteamGame | null {
  if (!metadata) return null;
  try {
    const obj = JSON.parse(metadata) as Partial<SteamGame>;
    if (!obj.appId || !obj.name) return null;
    return {
      appId: obj.appId,
      name: obj.name,
      description: obj.description ?? '',
      image: obj.image ?? '',
      url: obj.url ?? `https://store.steampowered.com/app/${obj.appId}`,
      isFree: Boolean(obj.isFree),
      price: obj.price ?? null,
    };
  } catch {
    return null;
  }
}
