import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramService } from './telegram.service';
import type { TgCallbackQuery, TgMessage } from './telegram-api';
import { encodeCallback } from './catalog-view';
import { membershipText } from './membership-view';

const TOKEN = '123456:fixture';
const STOP = new AbortController().signal;
type Routes = {
  handleMessage(token: string, message: TgMessage, stop: AbortSignal): Promise<void>;
  handleCallback(token: string, cb: TgCallbackQuery, stop: AbortSignal): Promise<void>;
};

function fixture(joined = false, chosen = true, required = true) {
  const calls: { method: string; payload: Record<string, any> }[] = [];
  let member = joined;
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const method = String(url).split('/').pop()!;
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });
    const result = method === 'getChatMember'
      ? {status:payload.user_id===123456?'administrator':member?'member':'left'}
      : {message_id:1};
    return new Response(JSON.stringify({ok:true,result}));
  }));
  const config = { membershipRequired:required,membershipChatId:'-1001234567890',membershipJoinUrl:'https://t.me/shop_channel',sendAnnouncement:false,greeting:'' };
  const products={list:vi.fn(async()=>[])};
  const orders={create:vi.fn()};
  const users={findByChat:vi.fn(async()=>chosen?{telegramLangChosen:true,telegramLang:'vi',balance:0,telegramName:'Fixture'}:null),setLanguage:vi.fn(),findOrCreate:vi.fn()};
  const balance={createDeposit:vi.fn(),payOrderWithBalance:vi.fn()};
  const deps = [
    {getTelegramConfig:vi.fn(async()=>config),getPublicRates:vi.fn(async()=>null)},
    products, {}, orders, {}, users, balance, {}, {getPublic:vi.fn(async()=>({document:{brand:{name:'Shop'}}}))},
  ] as unknown as ConstructorParameters<typeof TelegramService>;
  const service=new TelegramService(...deps) as unknown as Routes;
  const message=(text:string,id=79,language='vi'):TgMessage=>({message_id:3,chat:{id,type:'private'},from:{id,language_code:language,first_name:'Fixture'},text});
  const callback=(data:string,id=79):TgCallbackQuery=>({id:'cb-'+id,from:{id,language_code:'vi'},message:message('old',id),data});
  return {service,calls,products,orders,users,balance,message,callback,setMember:(value:boolean)=>{member=value;}};
}
afterEach(()=>vi.unstubAllGlobals());

describe('membership gate at customer entry points',()=>{
  it.each(['/start','🛒 Mua hàng','Grok','100000','/orders'])('blocks %s before shop or deposit processing',async text=>{
    const f=fixture();
    await f.service.handleMessage(TOKEN,f.message(text),STOP);
    const sent=f.calls.filter(c=>c.method==='sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.text).toContain('YÊU CẦU THAM GIA');
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].url).toBe('https://t.me/shop_channel');
    expect(f.products.list).not.toHaveBeenCalled();
    expect(f.orders.create).not.toHaveBeenCalled();
    expect(f.balance.createDeposit).not.toHaveBeenCalled();
    expect(f.users.findOrCreate).not.toHaveBeenCalled();
  });
  it.each(['vi','en','zh'] as const)('uses Telegram language before customer selection: %s',async lang=>{
    const f=fixture(false,false);
    await f.service.handleMessage(TOKEN,f.message('/start',79,lang),STOP);
    expect(f.calls.find(c=>c.method==='sendMessage')?.payload.text.replace(/<[^>]+>/g,'')).toContain(membershipText(lang).title);
  });
  it.each([
    encodeCallback({kind:'qty',variantId:'fixture',qty:1}),
    encodeCallback({kind:'payBalance',orderCode:'DH-FIXTURE'}),
    encodeCallback({kind:'setLang',lang:'en'}),
    'membership:check',
  ])('blocks stale/forged callback %s and answers its spinner',async data=>{
    const f=fixture();
    await f.service.handleCallback(TOKEN,f.callback(data),STOP);
    expect(f.calls.filter(c=>c.method==='answerCallbackQuery')).toHaveLength(1);
    expect(f.calls.find(c=>c.method==='editMessageText')?.payload.text).toContain('YÊU CẦU THAM GIA');
    expect(f.orders.create).not.toHaveBeenCalled();
    expect(f.balance.payOrderWithBalance).not.toHaveBeenCalled();
    expect(f.users.setLanguage).not.toHaveBeenCalled();
  });
  it('confirmation queries Telegram again and opens language selection only after joining',async()=>{
    const f=fixture(false,false);
    await f.service.handleMessage(TOKEN,f.message('/start'),STOP);
    f.setMember(true);
    await f.service.handleCallback(TOKEN,f.callback('membership:check'),STOP);
    const edit=f.calls.find(c=>c.method==='editMessageText')!;
    expect(edit.payload.reply_markup.inline_keyboard.flat().map((b:any)=>b.callback_data)).toEqual(['lg:vi','lg:en','lg:zh','h']);
    expect(f.calls.filter(c=>c.method==='getChatMember'&&c.payload.user_id===79)).toHaveLength(2);
  });
  it('existing members return to the welcome and fixed menu',async()=>{
    const f=fixture(true,true);
    await f.service.handleCallback(TOKEN,f.callback('membership:check'),STOP);
    expect(f.calls.find(c=>c.method==='editMessageText')?.payload.text.replace(/<[^>]+>/g,'')).toBe(membershipText('vi').success);
    expect(f.calls.find(c=>c.method==='sendMessage')?.payload.reply_markup.keyboard).toHaveLength(2);
  });
  it('disabling the feature restores normal /start without a membership API call',async()=>{
    const f=fixture(false,false,false);
    await f.service.handleMessage(TOKEN,f.message('/start'),STOP);
    expect(f.calls.filter(c=>c.method==='getChatMember')).toHaveLength(0);
    expect(f.calls.filter(c=>c.method==='sendMessage')).toHaveLength(2);
  });
});
