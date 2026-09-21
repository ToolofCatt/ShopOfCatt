import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramFetch } from './telegram-network';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Telegram-only network routing',()=>{
  it('keeps direct mode unchanged without relay configuration',async()=>{
    vi.stubEnv('TELEGRAM_PROXY_URL','');const fetch=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
    await telegramFetch('https://api.telegram.org/botfixture/getMe',{method:'POST'});
    expect(fetch).toHaveBeenCalledWith('https://api.telegram.org/botfixture/getMe',{method:'POST'});
  });
  it('uses CONNECT dispatcher only for Telegram and does not retry sends',async()=>{
    vi.stubEnv('TELEGRAM_PROXY_URL','http://127.0.0.1:18443');const fetch=vi.fn().mockRejectedValue(new Error('network'));vi.stubGlobal('fetch',fetch);
    await expect(telegramFetch('https://api.telegram.org/botfixture/sendMessage',{method:'POST'})).rejects.toThrow('network');
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
    expect(()=>telegramFetch('https://example.test/',{})).toThrow('Unexpected Telegram host');
  });
});
