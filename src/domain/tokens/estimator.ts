/**
 * Pluggable token estimation (spec §3). M1 ships the heuristic; M2 wires
 * tiktoken lazily and provider-reported usage becomes authoritative after
 * each generation. Estimates are always presented as estimates in the UI.
 */
export interface TokenEstimator {
  readonly name: string;
  estimate(text: string): number;
}

export const heuristicEstimator: TokenEstimator = {
  name: 'heuristic',
  estimate(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.7);
  },
};

export const estimator = heuristicEstimator;

export function estimateMessages(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimator.estimate(t) + 4, 0); // +4 per-message overhead
}
