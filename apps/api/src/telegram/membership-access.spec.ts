import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkChannelMembership, inspectMembershipChannel, isChannelMember, normalizeChannelId, validJoinUrl } from './membership-access';
import { renderMembershipGate } from './membership-view';
import { encodeCallback, parseCallback } from './catalog-view';

const CONFIG = { membershipRequired: true, membershipChatId: '-1001234567890', membershipJoinUrl: 'https://t.me/shop_channel' };
const STOP = new AbortController().signal;
const TOKEN = '123456:fixture';
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
afterEach(() => vi.unstubAllGlobals());

describe('membership validation and presentation', () => {
  it('normalizes channel IDs without accepting a private user as the channel', () => {
    expect(normalizeChannelId('4495545236')).toBe('-1004495545236');
    expect(normalizeChannelId(' -1004495545236 ')).toBe('-1004495545236');
    expect(normalizeChannelId('@shop_channel')).toBe('@shop_channel');
    for (const raw of ['-12345', '1e10', '', '0', 'https://t.me/shop_channel']) expect(() => normalizeChannelId(raw)).toThrow();
  });
  it('only accepts Telegram join URLs, never arbitrary code, hosts or post links', () => {
    for (const url of ['https://t.me/shop_channel', 'https://t.me/+abcdef1234', 'https://t.me/joinchat/abcdef1234']) expect(validJoinUrl(url)).toBe(true);
    for (const url of ['javascript:alert(1)', 'https://t.me.evil/shop_channel', 'https://t.me/c/12345/1', 'https://t.me/shop_channel/10', 'https://evil.test', 'https://t.me/shop_channel?start=x', '']) expect(validJoinUrl(url)).toBe(false);
  });
  it.each(['creator', 'administrator', 'member'])('accepts status %s', status => expect(isChannelMember({ status })).toBe(true));
  it.each(['left', 'kicked', 'unknown'])('rejects status %s', status => expect(isChannelMember({ status })).toBe(false));
  it('restricted users only pass when is_member is true', () => {
    expect(isChannelMember({status:'restricted',is_member:true})).toBe(true);
    expect(isChannelMember({status:'restricted',is_member:false})).toBe(false);
    expect(isChannelMember({status:'restricted'})).toBe(false);
  });
  it.each(['vi','en','zh'] as const)('renders one channel and one check button in %s', lang => {
    const gate = renderMembershipGate(lang, CONFIG.membershipJoinUrl);
    expect(gate.text).toContain('🔒');
    expect(gate.keyboard).toEqual([[{text:expect.any(String),url:CONFIG.membershipJoinUrl}],[{text:expect.any(String),callback_data:'membership:check'}]]);
    expect(renderMembershipGate(lang, 'javascript:alert(1)').keyboard).toHaveLength(1);
  });
  it('encodes and decodes the confirmation callback', () => {
    expect(parseCallback(encodeCallback({kind:'membershipCheck'}))).toEqual({kind:'membershipCheck'});
    expect(parseCallback('membership:check:forged')).toBeNull();
  });
});

describe('membership API gate', () => {
  it('starts both independent membership checks before either responds',async()=>{
    const releases:Array<()=>void>=[];
    const fetch=vi.fn((_url,init)=>new Promise<Response>(resolve=>releases.push(()=>resolve(ok({status:JSON.parse(init.body).user_id===123456?'administrator':'member'})))));
    vi.stubGlobal('fetch',fetch);
    const pending=checkChannelMembership(TOKEN,CONFIG,77,STOP);
    await Promise.resolve();expect(fetch).toHaveBeenCalledTimes(2);
    releases.forEach(release=>release());expect(await pending).toBe('allowed');
  });
  it('disabled gate does not call Telegram', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
    expect(await checkChannelMembership(TOKEN,{...CONFIG,membershipRequired:false},77,STOP)).toBe('allowed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks the bot and the sender using the configured channel, and detects leaving', async () => {
    const payloads: unknown[] = [];
    let joined = true;
    vi.stubGlobal('fetch',vi.fn(async (_url, init) => {
      const payload=JSON.parse(init.body);payloads.push(payload);
      return ok({status:payload.user_id===123456?'administrator':joined?'member':'left'});
    }));
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('allowed');
    joined=false;
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('join');
    expect(payloads).toContainEqual({chat_id:CONFIG.membershipChatId,user_id:77});
  });
  it.each(['left','member'])('fails closed when bot status is %s', async status => {
    const fetch=vi.fn(async()=>ok({status}));vi.stubGlobal('fetch',fetch);
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('unavailable');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('fails closed on network or Telegram errors, without caching failure', async () => {
    const fetch=vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ok({status:'member'}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:false,error_code:403,description:'Forbidden'}))).mockResolvedValueOnce(ok({status:'member'}))
      .mockResolvedValueOnce(ok({status:'administrator'})).mockResolvedValueOnce(ok({status:'member'}));
    vi.stubGlobal('fetch',fetch);
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('unavailable');
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('unavailable');
    expect(await checkChannelMembership(TOKEN,CONFIG,77,STOP)).toBe('allowed');
  });
  it('validates channel type, admin access, and destination link before enabling', async () => {
    vi.stubGlobal('fetch',vi.fn(async(url)=>{
      if(String(url).endsWith('/getMe'))return ok({id:123456});
      if(String(url).endsWith('/getChat'))return ok({id:-1001234567890,type:'channel',title:'Shop',username:'shop_channel'});
      return ok({status:'administrator'});
    }));
    expect(await inspectMembershipChannel(TOKEN,'1234567890','')).toEqual({chatId:'-1001234567890',title:'Shop',joinUrl:CONFIG.membershipJoinUrl});
    await expect(inspectMembershipChannel(TOKEN,'1234567890','https://t.me/wrong_channel')).rejects.toThrow('WRONG_CHANNEL_URL');
    vi.stubGlobal('fetch',vi.fn(async url=>String(url).endsWith('/getMe')?ok({id:123456}):ok({id:77,type:'private'})));
    await expect(inspectMembershipChannel(TOKEN,'1234567890','')).rejects.toThrow('NOT_A_CHANNEL');
  });
});
