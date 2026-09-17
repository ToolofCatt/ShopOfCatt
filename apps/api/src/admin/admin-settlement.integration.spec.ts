import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, type Prisma, type User } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import { SettingsService } from '../settings/settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import { lockFinancialArbitration } from '../common/financial-lock';
import { reconcileCryptoTransfers } from '../common/reconcile-transfers';
import { K } from '../i18n/messages';
import { AdminService } from './admin.service';
import { MarkPaidDto } from './dto/mark-paid.dto';

const baseUrl = process.env.DATABASE_URL;
const database = `admin_settlement_${randomUUID().replaceAll('-', '')}`;
let db: PrismaClient;
let ready = false;
let owner: User;
let admin: AdminService;
let counter = 0;

function client(name: string) {
  const url = new URL(baseUrl!);
  // Suite có CREATE/DROP: không kết nối fallback shop.env hay cluster ngoài runner.
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/review') {
    throw new Error('Run admin settlement tests with the isolated run-db-command.mjs runner');
  }
  url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

beforeAll(async () => {
  if (!baseUrl) return;
  const bootstrap = client('postgres');
  try { await bootstrap.$executeRawUnsafe(`CREATE DATABASE "${database}"`); }
  finally { await bootstrap.$disconnect(); }
  db = client(database);
  const directory = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const sql = readFileSync(join(directory, folder, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--')).join('\n')
      .split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  }
  owner = await db.user.create({ data: {
    code: 94000000, email: 'admin-settlement@test.invalid', passwordHash: 'synthetic', role: 'SUPERADMIN',
  } });
  const prisma = db as unknown as PrismaService;
  const audit = new AuditService(prisma);
  admin = new AdminService(prisma, new FulfillmentService(prisma), {} as never,
    audit, new SettingsService(prisma, new ConfigService({}), audit));
  ready = true;
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await db.$disconnect();
  const bootstrap = client('postgres');
  try { await bootstrap.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); }
  finally { await bootstrap.$disconnect(); }
}, 60_000);

function dbTest(name: string, run: () => Promise<void>) {
  it(name, async (context) => {
    if (!ready) return context.skip();
    await run();
  }, 30_000);
}

async function makeOrder(mode = 'CRYPTO', amount = 10) {
  const tag = `admin-settlement-${++counter}`;
  const product = await db.product.create({ data: { slug: tag, name: tag } });
  const variant = await db.productVariant.create({ data: {
    productId: product.id, name: tag, price: amount, priceAmount: amount,
  } });
  const order = await db.order.create({
    data: {
      code: tag, userId: owner.id, totalAmount: amount, subtotalAmount: amount,
      expiresAt: new Date(Date.now() + 600_000),
      payment: { create: {
        merchantTradeNo: tag, mode, amount, cryptoAmount: amount,
        cryptoNetwork: mode === 'CRYPTO' ? 'BEP20' : null,
        cryptoAddress: mode === 'SEPAY' ? 'SYNTHETIC-ACCOUNT' : 'SYNTHETIC-RECEIVER',
        vndAmount: mode === 'SEPAY' ? 260_000 : null,
      } },
      items: { create: {
        productId: product.id, variantId: variant.id,
        productName: tag, variantName: tag, unitPrice: amount, quantity: 1,
      } },
    },
    include: { payment: true, items: true },
  });
  const stock = await db.stockItem.create({ data: {
    variantId: variant.id, content: `SYNTHETIC-${tag}`,
    status: 'RESERVED', orderItemId: order.items[0].id,
  } });
  return { order, payment: order.payment!, stock, variant };
}

async function transfer(data: Partial<Prisma.IncomingTransferUncheckedCreateInput> = {}) {
  return db.incomingTransfer.create({ data: {
    source: 'CRYPTO:BEP20', reference: `synthetic-tx-${++counter}`, amount: 10,
    currency: 'USDT', network: 'BEP20', receiver: 'SYNTHETIC-RECEIVER',
    receivedAt: new Date(), status: 'REVIEW', reviewReason: 'ambiguous-order-or-deposit',
    ...data,
  } });
}

describe('admin resolution dùng canonical incoming transfer', () => {
  dbTest('note-only trước observe không giao đơn A rồi để tiền A thanh toán thêm đơn B', async () => {
    const a = await makeOrder('CRYPTO', 17), b = await makeOrder('CRYPTO', 17);
    const manual = await admin.markOrderPaid(owner, a.order.code, 'Đã thấy tiền').catch((error: unknown) => error);
    await db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      await reconcileCryptoTransfers(tx, [{
        txId: 'synthetic-before-observe', amount: 17, network: 'BSC',
        insertTimeMs: Date.now(), status: 1,
      }]);
    });
    expect(await db.order.count({ where: {
      id: { in: [a.order.id, b.order.id] }, status: { in: ['PAID', 'DELIVERED'] },
    } })).toBe(0);
    expect(manual).toBeInstanceOf(Error);
    expect((manual as Error).message).toBe(K.paymentReviewRequired);
  });

  for (const mode of ['CRYPTO', 'BINANCE_ID', 'SEPAY', 'BINANCE', 'INITIALIZING', 'MOCK', 'BALANCE']) {
    dbTest(`admin note-only ${mode} không tạo đường paid thiếu transfer`, async () => {
      const fixture = await makeOrder(mode);
      await expect(admin.markOrderPaid(owner, fixture.order.code, 'synthetic note'))
        .rejects.toThrow(K.paymentReviewRequired);
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
    });
  }

  dbTest('resolve REVIEW đồng thời/replay cùng target chỉ claim, giao và audit đúng một lần', async () => {
    const fixture = await makeOrder();
    const incoming = await transfer();
    const results = await Promise.all([
      admin.markOrderPaid(owner, fixture.order.code, 'synthetic operator evidence', incoming.id),
      admin.markOrderPaid(owner, fixture.order.code, 'synthetic operator evidence', incoming.id),
    ]);
    expect(results.every((result) => result.status === 'DELIVERED')).toBe(true);
    expect((await db.incomingTransfer.findUniqueOrThrow({ where: { id: incoming.id } })))
      .toMatchObject({ status: 'CLAIMED', paymentId: fixture.payment.id, depositId: null });
    expect((await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } })))
      .toMatchObject({ status: 'SUCCESS', cryptoTxId: incoming.reference });
    expect(await db.stockItem.count({ where: { variantId: fixture.variant.id, status: 'SOLD' } })).toBe(1);
    const logs = await db.auditLog.findMany({ where: { action: 'order.mark_paid', entityId: fixture.order.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toMatchObject({ incomingTransferId: incoming.id, note: 'synthetic operator evidence' });
  });

  dbTest('transfer CLAIMED của target khác không giao thêm dù admin chọn lại', async () => {
    const a = await makeOrder(), b = await makeOrder();
    const incoming = await transfer();
    await admin.markOrderPaid(owner, a.order.code, undefined, incoming.id);
    await expect(admin.markOrderPaid(owner, b.order.code, undefined, incoming.id))
      .rejects.toThrow(K.paymentReviewRequired);
    expect((await db.order.findUniqueOrThrow({ where: { id: b.order.id } })).status).toBe('PENDING');
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: b.stock.id } })).status).toBe('RESERVED');
    expect((await db.incomingTransfer.findUniqueOrThrow({ where: { id: incoming.id } })).paymentId).toBe(a.payment.id);
  });

  dbTest('audit lỗi rollback claim và PAID, không giao trước commit', async () => {
    const fixture = await makeOrder();
    const incoming = await transfer();
    await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "test_admin_audit_failure"
      CHECK ("action" <> 'order.mark_paid') NOT VALID`);
    try {
      await expect(admin.markOrderPaid(owner, fixture.order.code, 'synthetic', incoming.id)).rejects.toThrow();
      expect((await db.incomingTransfer.findUniqueOrThrow({ where: { id: incoming.id } })))
        .toMatchObject({ status: 'REVIEW', paymentId: null });
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DROP CONSTRAINT "test_admin_audit_failure"');
    }
  });

  const invalidFacts: Array<{ name: string; change: Partial<Prisma.IncomingTransferUncheckedCreateInput> }> = [
    { name: 'sai amount', change: { amount: 9 } },
    { name: 'sai currency', change: { currency: 'VND' } },
    { name: 'sai receiver', change: { receiver: 'OTHER-RECEIVER' } },
    { name: 'sai network', change: { source: 'CRYPTO:TRC20', network: 'TRC20' } },
    { name: 'provider facts changed', change: { reviewReason: 'provider-facts-changed' } },
  ];
  for (const { name, change } of invalidFacts) {
    dbTest(`operator không vượt xác minh ${name}`, async () => {
      const fixture = await makeOrder();
      const incoming = await transfer(change);
      await expect(admin.markOrderPaid(owner, fixture.order.code, 'synthetic', incoming.id))
        .rejects.toThrow(K.paymentReviewRequired);
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.incomingTransfer.findUniqueOrThrow({ where: { id: incoming.id } })).status).toBe('REVIEW');
    });
  }

  dbTest('transfer thiếu không bị coi là xác nhận tiền ngoài hệ thống', async () => {
    const fixture = await makeOrder();
    await expect(admin.markOrderPaid(owner, fixture.order.code, undefined, 'synthetic-missing-transfer'))
      .rejects.toThrow(K.paymentReviewRequired);
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
  });

  dbTest('merchant transfer của session khác không được operator gán sang đơn hiện tại', async () => {
    const fixture = await makeOrder('BINANCE');
    const incoming = await transfer({
      source: 'BINANCE_MERCHANT', reference: 'synthetic-other-merchant-session', network: null,
    });
    await expect(admin.markOrderPaid(owner, fixture.order.code, undefined, incoming.id))
      .rejects.toThrow(K.paymentReviewRequired);
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
  });

  dbTest('danh sách unresolved giới hạn 100, amount exact và chỉ trả fields công bố', async () => {
    for (let i = 0; i < 103; i += 1) {
      await transfer({ reference: `list-transfer-${i}`, amount: '0.123456', status: 'OBSERVED' });
    }
    const result = await admin.listIncomingTransfers();
    expect(result).toHaveLength(100);
    expect(result.every((row) => row.status === 'OBSERVED' || row.status === 'REVIEW')).toBe(true);
    expect(result.some((row) => row.amount === '0.123456')).toBe(true);
    expect(Object.keys(result[0]).sort()).toEqual([
      'id', 'source', 'reference', 'amount', 'currency', 'receiver', 'status', 'reviewReason', 'createdAt',
    ].sort());
    expect(Number.isNaN(Date.parse(result[0].createdAt))).toBe(false);
  });

  dbTest('phân trang đối soát vượt 100 rows, lọc và summary dùng cùng dữ liệu thật', async () => {
    const rows = Array.from({length:125},(_,index)=>({source:'SEPAY',reference:`pagination-fixture-${index.toString().padStart(3,'0')}`,amount:'321.123456',currency:'VND',status:'OBSERVED'}));
    await db.incomingTransfer.createMany({data:rows});
    const page=await admin.listReconciliation({q:'pagination-fixture-',page:6,limit:20,amount:'321.123456',currency:'VND'});
    expect(page.total).toBe(125);
    expect(page.items).toHaveLength(20);
    expect(page.items.every(row=>row.amount==='321.123456'&&row.reference.startsWith('pagination-fixture-'))).toBe(true);
    const last=await admin.listReconciliation({q:'pagination-fixture-',page:7,limit:20});
    expect(last.items).toHaveLength(5);
    expect(new Set([...page.items,...last.items].map(row=>row.id)).size).toBe(25);
    expect(await admin.reconciliationSummary()).toEqual({
      unresolved:await db.incomingTransfer.count({where:{status:{in:['OBSERVED','REVIEW']}}}),
      conflicts:await db.incomingTransfer.count({where:{reviewReason:'provider-facts-changed'}}),
    });
    const conflicts=await admin.listReconciliation({status:'ALL',conflicts:true});
    expect(conflicts.items.every(row=>!row.resolvable&&row.reviewReason==='provider-facts-changed')).toBe(true);
  });

  it('DTO giữ incomingTransferId hợp lệ và từ chối giá trị không phải string/quá dài', async () => {
    const valid = Object.assign(new MarkPaidDto(), { incomingTransferId: 'synthetic-transfer', note: 'evidence' });
    expect(await validate(valid, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    for (const incomingTransferId of [42, '', 'x'.repeat(201)]) {
      const invalid = Object.assign(new MarkPaidDto(), { incomingTransferId });
      expect((await validate(invalid)).length).toBeGreaterThan(0);
    }
  });
});
