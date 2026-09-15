import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';
import type { AdminActor } from '../audit/admin-actor';

const TEST_DB = 'webcatt_telegram_membership_test';
const base = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/webcatt';
function client(name: string) {
  const url=new URL(base);url.pathname='/'+name;
  return new PrismaClient({datasources:{db:{url:url.toString()}}});
}
const db=client(TEST_DB);
let ready=false;
const audit={log:vi.fn()};
let settings: SettingsService;
const actor={id:'fixture',email:'owner@example.test',code:1,role:'SUPERADMIN'} as AdminActor;

beforeAll(async()=>{
  const admin=client('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
    ready=true;
  } catch(error) {
    // Không nuốt lỗi migration; chỉ bỏ qua khi thật sự không có PostgreSQL.
    if(String(error).includes('already exists'))throw error;
    return;
  } finally {await admin.$disconnect();}
  const dir=resolve(__dirname,'../../prisma/migrations');
  for(const folder of readdirSync(dir).sort()) {
    if(folder==='migration_lock.toml')continue;
    if(folder==='20260915140000_telegram_membership') {
      // Giả lập nâng cấp một shop đã tồn tại, không chỉ schema rỗng.
      await db.$executeRawUnsafe(`INSERT INTO "StoreSetting" (id, "updatedAt") VALUES ('main', NOW())`);
    }
    const sql=readFileSync(join(dir,folder,'migration.sql'),'utf8');
    for(const statement of sql.split(/\r?\n/).filter(line=>!line.trim().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  }
  const deps=[db,{},audit] as unknown as ConstructorParameters<typeof SettingsService>;
  settings=new SettingsService(...deps);
},120_000);
afterEach(()=>vi.unstubAllGlobals());
afterAll(async()=>{
  await db.$disconnect();
  if(!ready)return;
  const admin=client('postgres');
  try {await admin.$executeRawUnsafe(`DROP DATABASE "${TEST_DB}" WITH (FORCE)`);}finally{await admin.$disconnect();}
});
function telegram(botAdmin=true) {
  vi.stubGlobal('fetch',vi.fn(async url=>new Response(JSON.stringify({ok:true,result:
    String(url).endsWith('/getMe')?{id:123456}:
    String(url).endsWith('/getChat')?{id:-1001234567890,type:'channel',title:'Fixture',username:'shop_channel'}:
    {status:botAdmin?'administrator':'member'},
  }))));
}
describe('Telegram membership settings on PostgreSQL',()=>{
  it('migration defaults off for both existing and new installations',async ctx=>{
    if(!ready)return ctx.skip();
    expect((await settings.getAdmin()).telegramMembershipRequired).toBe(false);
    const fresh=await db.storeSetting.create({data:{id:'fresh-install'}});
    expect(fresh.telegramMembershipRequired).toBe(false);
    expect(fresh.telegramMembershipChatId).toBe('');
    await db.storeSetting.delete({where:{id:'fresh-install'}});
  });
  it('enable normalizes the channel and public link, persists and audits without touching business tables',async ctx=>{
    if(!ready)return ctx.skip();
    telegram();
    const counts=()=>Promise.all([db.order.count(),db.stockItem.count(),db.product.count()]);
    const before=await counts();
    const saved=await settings.updateTelegram(actor,{telegramBotToken:'123456:fixture',telegramMembershipRequired:true,telegramMembershipChatId:'1234567890'});
    expect(saved.telegramMembershipRequired).toBe(true);
    expect(saved.telegramMembershipChatId).toBe('-1001234567890');
    expect(saved.telegramMembershipJoinUrl).toBe('https://t.me/shop_channel');
    expect((await settings.getTelegramConfig()).membershipRequired).toBe(true);
    expect(audit.log).toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });
  it('unverifiable enable fails without writing; disabling still works during a Telegram outage',async ctx=>{
    if(!ready)return ctx.skip();
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('timeout')));
    await settings.updateTelegram(actor,{telegramMembershipRequired:false});
    expect(fetch).not.toHaveBeenCalled();
    await expect(settings.updateTelegram(actor,{telegramMembershipRequired:true})).rejects.toThrow('admin.telegram_membership_unavailable');
    expect((await settings.getTelegramConfig()).membershipRequired).toBe(false);
    await expect(settings.updateTelegram(actor,{telegramMembershipJoinUrl:'javascript:alert(1)'})).rejects.toThrow('admin.telegram_membership_invalid');
  });
});
