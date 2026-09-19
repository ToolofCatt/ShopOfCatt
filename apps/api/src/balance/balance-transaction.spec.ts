import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BalanceService } from './balance.service';
import { WalletCreditService } from './wallet-credit.service';
import { K } from '../i18n/messages';

function fixture() {
  const events: string[] = [];
  const forbidden = new Proxy({}, { get() { throw new Error('outside transaction'); } });
  const user = { balance: new Prisma.Decimal('10'), lockedAt: null as Date | null };
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => { events.push(sql.join('')); return []; }),
    order: {
      findFirst: vi.fn(async () => ({ id: 'order', code: 'ORD-TEST', totalAmount: new Prisma.Decimal('2.3'), subtotalAmount: new Prisma.Decimal('2.3'), discountAmount: new Prisma.Decimal(0), paymentDiscountAmount: new Prisma.Decimal(0) })),
      updateMany: vi.fn(async (_args: any) => ({ count: 1 })),
    },
    payment: {
      findUnique: vi.fn(async () => ({ id: 'payment', status: 'PENDING', cryptoTxId: null, sepayRef: null })),
      updateMany: vi.fn(async (_args: any) => ({ count: 1 })),
      findMany: vi.fn(async () => []),
    },
    user: { findUniqueOrThrow: vi.fn(async () => user), update: vi.fn(async (_args: any) => ({})) },
    balanceEntry: { create: vi.fn(async (_args: any) => ({})) },
    deposit: {
      count: vi.fn(async () => 0), findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }) => ({ id: 'deposit', ...data })),
    },
  };
  const settings = {
    getPublicRates: vi.fn(async () => ({ vndPerUsdt: 26_000 })),
    getEnabledMethods: vi.fn(async () => [{ method: 'sepay' }, { method: 'crypto_bep20' }]),
    getSepayConfig: vi.fn(async () => ({ ready: true, vndPerUsdt: 26_000, accountNumber: '007', bank: 'MB', accountHolder: 'Original' })),
    getCryptoAddress: vi.fn(async () => '0xOriginal'),
  };
  const service = new BalanceService(forbidden as any, settings as any, forbidden as any,
    new WalletCreditService(forbidden as any));
  return { service, tx, user, settings, events };
}

describe('balance transaction boundary', () => {
  it('uses caller transaction for exact debit, ledger and conditional payment without delivery', async () => {
    const f = fixture();
    const result = await f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order', { requireUnlockedUser: true });
    expect(result.orderId).toBe('order');
    expect(result.balanceAfter.toString()).toBe('7.7');
    expect(f.tx.user.update.mock.calls[0][0].data.balance.toString()).toBe('7.7');
    const entry = f.tx.balanceEntry.create.mock.calls[0][0].data;
    expect(entry.amount.toString()).toBe('-2.3');
    expect(entry.balanceAfter.toString()).toBe('7.7');
    expect(entry.refCode).toBe('ORD-TEST');
    expect(f.events.map((sql) => sql.match(/FROM "(\w+)"/)?.[1])).toEqual(['Order', 'Payment', 'User']);
    expect(f.tx.payment.updateMany.mock.calls[0][0].where).toMatchObject({ status: 'PENDING', cryptoTxId: null, sepayRef: null });
  });

  it('rejects a user locked after the API guard before any debit or ledger append', async () => {
    const f = fixture();
    f.user.lockedAt = new Date();
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order', { requireUnlockedUser: true })).rejects.toThrow();
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.balanceEntry.create).not.toHaveBeenCalled();
  });

  it('lets insufficient funds escape so the caller rolls back the pending-order transition', async () => {
    const f = fixture();
    f.user.balance = new Prisma.Decimal(1);
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order')).rejects.toThrow(K.balanceInsufficient);
    expect(f.tx.balanceEntry.create).not.toHaveBeenCalled();
  });

  it('creates deposits from the prepared bank/rate snapshot without consulting settings in tx', async () => {
    const f = fixture();
    const prepared = await f.service.prepareDeposit('buyer', 100_000, 'sepay');
    expect(f.tx.deposit.create).not.toHaveBeenCalled();
    for (const method of Object.values(f.settings)) method.mockRejectedValue(new Error('settings called in transaction'));
    const deposit = await f.service.createDepositInTransaction(f.tx as any, 'buyer', prepared);
    expect(deposit.amountUsdt.toString()).toBe('3.846153');
    expect(deposit.vndAmount.toString()).toBe('100000');
    expect(deposit.cryptoAddress).toBe('007');
    expect(deposit.sepayBank).toBe('MB');
    expect(deposit.sepayAccountHolder).toBe('Original');
    expect(deposit.telegramCallbackId).toBeNull();
  });

  it('allocates crypto amount in tx across existing deposits and orders', async () => {
    const f = fixture();
    const prepared = await f.service.prepareDeposit('buyer', 26_000, 'crypto_bep20');
    f.tx.deposit.findMany.mockResolvedValue([{ amountUsdt: new Prisma.Decimal(1) }] as any);
    f.tx.payment.findMany.mockResolvedValue([{ cryptoAmount: new Prisma.Decimal('1.0001') }] as any);
    const deposit = await f.service.createDepositInTransaction(f.tx as any, 'buyer', prepared);
    // Matcher cần cách khoản 1.0001 ít nhất 0.0002, không chỉ khác một bước.
    expect(deposit.amountUsdt.toString()).toBe('1.0003');
    expect(deposit.cryptoAddress).toBe('0xOriginal');
  });

  it('keeps wallet-wrapper delivery after the transaction commits', async () => {
    const f = fixture();
    let committed = false;
    const prisma = { $transaction: async (run: (tx: any) => Promise<any>) => {
      const result = await run(f.tx);
      committed = true;
      return result;
    } };
    const fulfillment = { deliverOrder: vi.fn(async (orderId: string) => {
      expect(committed).toBe(true);
      expect(orderId).toBe('order');
      return true;
    }) };
    const service = new BalanceService(prisma as any, f.settings as any, fulfillment as any, {} as any);
    expect(await service.payOrderWithBalance('buyer', 'ORD-TEST')).toEqual({ delivered: true });
    expect(f.tx.balanceEntry.create).toHaveBeenCalledTimes(1);
    expect(fulfillment.deliverOrder).toHaveBeenCalledTimes(1);
  });

  it('stops a repeated payment or an already-received transfer before debit', async () => {
    const f = fixture();
    f.tx.payment.findUnique.mockResolvedValueOnce({ id: 'payment', status: 'SUCCESS', cryptoTxId: null, sepayRef: null });
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order')).rejects.toThrow(K.balanceOrderNotPending);
    f.tx.payment.findUnique.mockResolvedValueOnce({ id: 'payment', status: 'PENDING', cryptoTxId: 'received', sepayRef: null } as any);
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order')).rejects.toThrow(K.balanceOrderNotPending);
    f.tx.order.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order')).rejects.toThrow(K.balanceOrderNotPending);
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tx.balanceEntry.create).not.toHaveBeenCalled();
  });

  it('propagates a payment CAS loss instead of returning a successful debit', async () => {
    const f = fixture();
    f.tx.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.payOrderInTransaction(f.tx as any, 'buyer', 'order')).rejects.toThrow(K.balanceOrderNotPending);
  });

  it('returns stored Telegram bank details on an in-transaction replay after settings change', async () => {
    const f = fixture();
    const stored = { id: 'previous', userId: 'buyer', mode: 'SEPAY', cryptoAddress: 'old-account', sepayBank: 'old-bank', sepayAccountHolder: 'old-holder' };
    f.tx.deposit.findUnique.mockResolvedValueOnce(stored as any);
    const prisma = {
      deposit: { findUnique: async () => null },
      $transaction: async (run: (tx: any) => Promise<any>) => run(f.tx),
    };
    const service = new BalanceService(prisma as any, f.settings as any, {} as any, {} as any);
    const result = await service.createDeposit({ id: 'buyer' } as any, 100_000, 'sepay', ' callback ');
    expect(result.bank).toEqual({ accountNumber: 'old-account', bank: 'old-bank', accountHolder: 'old-holder' });
    expect(result.deposit.id).toBe('previous');
    expect(f.tx.deposit.create).not.toHaveBeenCalled();
    expect(f.tx.deposit.count).not.toHaveBeenCalled();
  });

  it('rejects pending-deposit capacity and snapshot ownership mismatch before insert', async () => {
    const f = fixture();
    const prepared = await f.service.prepareDeposit('buyer', 100_000, 'sepay');
    await expect(f.service.createDepositInTransaction(f.tx as any, 'other', prepared)).rejects.toThrow();
    f.tx.deposit.count.mockResolvedValue(3);
    await expect(f.service.createDepositInTransaction(f.tx as any, 'buyer', prepared)).rejects.toThrow(K.depositPendingLimit);
    expect(f.tx.deposit.create).not.toHaveBeenCalled();
  });
});
