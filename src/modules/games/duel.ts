import { randomUUID } from 'node:crypto';
import type { PfcChoice } from './service.js';

/**
 * Défis pierre-feuille-ciseaux en attente (joueur contre joueur). Le coup du
 * défieur est gardé en mémoire (jamais dans le customId, pour ne pas être
 * lisible par l'adversaire) jusqu'à ce que ce dernier réponde. TTL court.
 */
export interface Duel {
  challengerId: string;
  challengerMove: PfcChoice;
  opponentId: string;
  expires: number;
}

const duels = new Map<string, Duel>();
const TTL_MS = 5 * 60 * 1000;

export function createDuel(
  challengerId: string,
  challengerMove: PfcChoice,
  opponentId: string,
): string {
  const id = randomUUID().slice(0, 8);
  duels.set(id, { challengerId, challengerMove, opponentId, expires: Date.now() + TTL_MS });
  return id;
}

export function getDuel(id: string): Duel | null {
  const duel = duels.get(id);
  if (!duel) return null;
  if (duel.expires < Date.now()) {
    duels.delete(id);
    return null;
  }
  return duel;
}

export function endDuel(id: string): void {
  duels.delete(id);
}
