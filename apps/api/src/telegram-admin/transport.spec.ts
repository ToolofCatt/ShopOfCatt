import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAdminDocument, sendAdminDocument } from './transport';

afterEach(() => vi.unstubAllGlobals());
describe('Telegram admin file transport', () => {
  it('rejects unsupported names and oversize documents before contacting Telegram', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const stop = new AbortController().signal;
    await expect(readAdminDocument('test', {file_id:'a',file_name:'a.exe',file_size:100},stop)).rejects.toThrow();
    await expect(readAdminDocument('test', {file_id:'a',file_name:'a.json',file_size:1000001},stop)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects path traversal returned from getFile', async () => {
    const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,result:{file_path:'../private'}})));
    vi.stubGlobal('fetch',fetch);
    await expect(readAdminDocument('test',{file_id:'a',file_name:'a.json',file_size:50},new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('reads UTF-8 JSON and enforces the byte limit while streaming', async () => {
    const makeFetch=(content:string)=>vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,result:{file_path:'documents/file.json'}}))).mockResolvedValueOnce(new Response(content));
    vi.stubGlobal('fetch',makeFetch('[{"key":"x"}]'));
    expect(await readAdminDocument('test',{file_id:'a',file_name:'a.json',file_size:12},new AbortController().signal)).toBe('[{"key":"x"}]');
    vi.stubGlobal('fetch',makeFetch('x'.repeat(1000001)));
    await expect(readAdminDocument('test',{file_id:'a',file_name:'a.txt',file_size:12},new AbortController().signal)).rejects.toThrow();
  });
  it('sends an export as document and reports failures without exposing its contents', async () => {
    const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:false})));
    vi.stubGlobal('fetch',fetch);
    await expect(sendAdminDocument('test',123,{name:'stock.txt',text:'PRIVATE-FIXTURE'},new AbortController().signal)).rejects.toThrow('Telegram document delivery failed');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
