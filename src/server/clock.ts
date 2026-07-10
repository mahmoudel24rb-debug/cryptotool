/**
 * Horloge injectable — Date.now() par défaut (mode live, comportement inchangé).
 * Le harnais de backtest la remplace par une horloge virtuelle pour rejouer
 * des mois d'historique en quelques secondes, avec les mêmes TTL, cooldowns
 * et décroissances temporelles qu'en production.
 */

let nowFn: () => number = Date.now;

export const clock = {
  now(): number {
    return nowFn();
  },
  /** Backtest uniquement — remplace la source de temps */
  set(fn: () => number): void {
    nowFn = fn;
  },
  /** Restaure l'horloge réelle */
  reset(): void {
    nowFn = Date.now;
  },
};
