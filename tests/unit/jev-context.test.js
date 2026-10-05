import { describe, it, expect } from 'vitest';
import { fitsJevContext } from '../../src/sse/services/jevContext.js';

describe('Jev dynamic context eligibility', () => {
  it('keeps both sizes for small requests, excludes small windows as context grows', () => {
    const pool = [128000, 200000, 1000000].map(contextWindow => ({ contextWindow, maxOutput: 8192 }));
    const eligible = input => pool.filter(caps => fitsJevContext(caps, input)).map(caps => caps.contextWindow);
    expect(eligible(10000)).toEqual([128000, 200000, 1000000]);
    expect(eligible(200001)).toEqual([1000000]);
    expect(eligible(990808)).toEqual([1000000]);
    expect(eligible(990809)).toEqual([]);
  });
  it('reserves explicit output and excludes unknown or invalid budgets', () => {
    expect(fitsJevContext({ contextWindow: 200000 }, 190000, { max_tokens: 9000 })).toBe(true);
    expect(fitsJevContext({ contextWindow: 200000 }, 190001, { max_tokens: 9000 })).toBe(false);
    expect(fitsJevContext({}, 100)).toBe(false);
    expect(fitsJevContext({ contextWindow: Infinity }, 100)).toBe(false);
    expect(fitsJevContext({ contextWindow: 200000 }, 100, { max_tokens: 'bad' })).toBe(false);
  });
});
