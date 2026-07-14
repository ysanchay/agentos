import { describe, it, expect, beforeEach } from 'vitest';
import { LocalModelRegistry } from './local-model-registry.js';
import type { HostProfile, LocalModel } from './types.js';

function model(overrides: Partial<LocalModel> & Pick<LocalModel, 'id'>): LocalModel {
  return {
    name: overrides.id,
    version: '1.0.0',
    modality: 'text',
    servesTaskTypes: ['reasoning'],
    location: `/models/${overrides.id}`,
    readiness: 'available',
    ruPer1kTokens: 1,
    concurrencySlots: 1,
    ...overrides,
  } as LocalModel;
}

describe('LocalModelRegistry', () => {
  let reg: LocalModelRegistry;
  beforeEach(() => {
    reg = new LocalModelRegistry();
  });

  it('registers, validates defaults, and retrieves models', () => {
    const m = reg.register({
      id: 'qwen-coder',
      name: 'Qwen2.5 Coder',
      version: '2.5.0',
      modality: 'code',
      servesTaskTypes: ['coding'],
      location: '/models/qwen',
      readiness: 'available',
      ruPer1kTokens: 0.5,
    });
    // Zod default applied
    expect(m.concurrencySlots).toBe(1);
    expect(reg.get('qwen-coder')?.name).toBe('Qwen2.5 Coder');
    expect(reg.list()).toHaveLength(1);
  });

  it('rejects malformed model definitions', () => {
    expect(() => reg.register({ id: 'bad' })).toThrow();
  });

  it('resolve returns the cheapest available model serving a task-type', () => {
    reg.register(model({ id: 'cheap', servesTaskTypes: ['reasoning'], ruPer1kTokens: 1 }));
    reg.register(model({ id: 'pricey', servesTaskTypes: ['reasoning'], ruPer1kTokens: 5 }));
    expect(reg.resolve('reasoning')?.id).toBe('cheap');
  });

  it('resolve returns undefined when no model serves the task-type (→ router OFF-0001)', () => {
    reg.register(model({ id: 'a', servesTaskTypes: ['coding'] }));
    expect(reg.resolve('vision')).toBeUndefined();
  });

  it('resolve skips unavailable models', () => {
    reg.register(model({ id: 'loading', readiness: 'loading' }));
    expect(reg.resolve('reasoning')).toBeUndefined();
    reg.setReadiness('loading', 'available');
    expect(reg.resolve('reasoning')?.id).toBe('loading');
  });

  it('resolve follows the fallback chain when the preferred model is unavailable', () => {
    reg.register(model({ id: 'primary', readiness: 'unavailable', fallbackModelId: 'backup', ruPer1kTokens: 1 }));
    reg.register(model({ id: 'backup', readiness: 'available', ruPer1kTokens: 9 }));
    // primary is cheapest but unavailable → walk fallback to backup
    expect(reg.resolve('reasoning')?.id).toBe('backup');
  });

  it('getFallbackChain is cycle-safe', () => {
    reg.register(model({ id: 'a', fallbackModelId: 'b' }));
    reg.register(model({ id: 'b', fallbackModelId: 'a' }));
    const chain = reg.getFallbackChain('a').map((m) => m.id);
    expect(chain).toEqual(['a', 'b']);
  });

  it('respects hardware requirements against a host profile', () => {
    reg.register(
      model({
        id: 'big',
        hardwareRequirements: { minRamMb: 16000, requiresGpu: true, minVramMb: 8000 },
      }),
    );
    const weak: HostProfile = { ramMb: 8000, hasGpu: false };
    const strong: HostProfile = { ramMb: 32000, hasGpu: true, vramMb: 12000 };
    expect(reg.resolve('reasoning', weak)).toBeUndefined();
    expect(reg.resolve('reasoning', strong)?.id).toBe('big');
  });

  it('totalInferenceSlots sums available models (offline swarm sizing, R5)', () => {
    reg.register(model({ id: 'a', concurrencySlots: 2 }));
    reg.register(model({ id: 'b', concurrencySlots: 3 }));
    reg.register(model({ id: 'c', concurrencySlots: 10, readiness: 'loading' }));
    expect(reg.totalInferenceSlots()).toBe(5); // c excluded (not available)
  });

  it('unregister removes a model', () => {
    reg.register(model({ id: 'x' }));
    expect(reg.unregister('x')).toBe(true);
    expect(reg.get('x')).toBeUndefined();
  });
});
