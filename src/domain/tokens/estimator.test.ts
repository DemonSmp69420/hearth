import { describe, expect, it } from 'vitest';
import { estimateMessages, heuristicEstimator } from './estimator';

describe('heuristicEstimator', () => {
  it('is zero on empty text', () => {
    expect(heuristicEstimator.estimate('')).toBe(0);
  });

  it('scales with length at ~3.7 chars per token', () => {
    const n = heuristicEstimator.estimate('a'.repeat(370));
    expect(n).toBe(100);
  });
});

describe('estimateMessages', () => {
  it('adds per-message overhead', () => {
    expect(estimateMessages(['abcd'])).toBeGreaterThan(heuristicEstimator.estimate('abcd'));
  });
});
