import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { TranslationService } from './translation.service';

describe('AI credential destination', () => {
  it('does not forward an environment key to a changed provider endpoint', async () => {
    const settings = { getAiConfig: async () => ({ apiKey: '', provider: 'openai', baseUrl: 'https://custom.example.test/v1', model: 'test' }) } as SettingsService;
    const service = new TranslationService({} as PrismaService, settings, new ConfigService({ ANTHROPIC_API_KEY: 'fixture-env-secret' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      expect((await service.getStatus()).configured).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it('rejects an oversized provider response before reading it all', async () => {
    const settings = { getAiConfig: async () => ({ apiKey: 'fixture-key', provider: 'openai', baseUrl: 'https://provider.example.test/v1', model: 'test' }) } as SettingsService;
    const service = new TranslationService({} as PrismaService, settings, new ConfigService({}));
    let cancelled = false;
    let produced = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { if (produced === 6) { controller.close(); return; } produced++; controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }), { status: 200 }));
    try {
      await expect(service.probeConnection()).resolves.toMatchObject({ configured: true });
      await expect((service as never as { ask(system: string, payload: unknown, schema: Record<string, unknown>): Promise<unknown> }).ask('fixture', {}, {})).rejects.toThrow();
      expect(cancelled).toBe(true);
      expect(produced).toBeLessThan(6);
    } finally { fetchSpy.mockRestore(); }
  });
});
