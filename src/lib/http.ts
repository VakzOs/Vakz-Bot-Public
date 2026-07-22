/**
 * Utilitaires réseau partagés.
 *
 * Node n'applique **aucun** timeout par défaut à `fetch` : un upstream lent ou
 * pendu bloquerait indéfiniment la tâche cron qui l'appelle (annonces de
 * streams, jeux gratuits…). On centralise donc un `fetch` avec délai maximal.
 */

/** Délai maximal par défaut (ms) d'un appel réseau sortant. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * `fetch` borné dans le temps. Au-delà de `timeoutMs`, la requête est abandonnée
 * (l'`AbortSignal` déclenche un `TimeoutError`, à traiter comme une erreur réseau
 * classique — `try/catch` ou `.catch(() => null)` côté appelant).
 *
 * Si l'appelant fournit déjà un `signal`, on le respecte tel quel (on ne
 * l'écrase pas) ; les autres options (headers, method, body…) sont conservées.
 */
export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal });
}
