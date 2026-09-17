import { Prisma, type IncomingTransfer } from '@prisma/client';
import { markOrderPaid } from './order-settlement';

export interface TransferFacts {
  source: 'CRYPTO:BEP20' | 'CRYPTO:TRC20' | 'BINANCE_ID' | 'SEPAY' | 'BINANCE_MERCHANT';
  reference: string;
  amount: Prisma.Decimal | string | number;
  currency: 'USDT' | 'VND';
  network?: string | null;
  receiver?: string | null;
  receivedAt?: Date | null;
}
export type TransferTarget = { paymentId: string } | { depositId: string };

export function normalizeTransferReference(source: string, reference: string): string {
  const trimmed = reference.trim();
  return source.startsWith('CRYPTO:') ? trimmed.toLowerCase() : trimmed;
}

/** Caller giữ financial arbitration từ đầu transaction. Dữ kiện provider không bị ghi đè bởi retry. */
export async function observeTransfer(tx: Prisma.TransactionClient, facts: TransferFacts): Promise<IncomingTransfer> {
  const reference = normalizeTransferReference(facts.source, facts.reference);
  const amount = new Prisma.Decimal(facts.amount);
  if (!reference || !amount.isFinite() || amount.lte(0)) throw new Error('invalid incoming transfer');
  const existing = await tx.incomingTransfer.findUnique({ where: { source_reference: { source: facts.source, reference } } });
  if (existing) {
    // Không dùng dữ kiện retry mới để match trong khi sổ vẫn giữ facts cũ.
    const changed = !existing.amount.equals(amount) || existing.currency !== facts.currency
      || (!!existing.receiver && !!facts.receiver && existing.receiver !== facts.receiver)
      || (!!existing.network && !!facts.network && existing.network !== facts.network)
      || (!!existing.receivedAt && !!facts.receivedAt && existing.receivedAt.getTime() !== facts.receivedAt.getTime());
    if (changed) {
      return tx.incomingTransfer.update({ where: { id: existing.id }, data: {
        ...(existing.status === 'CLAIMED' ? {} : { status: 'REVIEW' }), reviewReason: 'provider-facts-changed',
      } });
    }
    return existing;
  }
  return tx.incomingTransfer.create({ data: {
    source: facts.source, reference, amount, currency: facts.currency,
    network: facts.network ?? null, receiver: facts.receiver ?? null, receivedAt: facts.receivedAt ?? null,
  } });
}

export async function reviewTransfer(tx: Prisma.TransactionClient, transfer: IncomingTransfer, reason: string): Promise<void> {
  await tx.incomingTransfer.updateMany({ where: { id: transfer.id, status: 'OBSERVED' }, data: { status: 'REVIEW', reviewReason: reason } });
}

async function claimTransfer(tx: Prisma.TransactionClient, transfer: IncomingTransfer, target: TransferTarget): Promise<'new' | 'same' | 'blocked'> {
  if (transfer.status === 'CLAIMED') {
    const same = 'paymentId' in target ? transfer.paymentId === target.paymentId : transfer.depositId === target.depositId;
    return same ? 'same' : 'blocked';
  }
  if (transfer.status === 'REVIEW') return 'blocked';
  const occupied = await tx.incomingTransfer.findUnique({ where: target });
  if (occupied) { await reviewTransfer(tx, transfer, 'target-already-paid'); return 'blocked'; }
  await tx.incomingTransfer.update({ where: { id: transfer.id }, data: { status: 'CLAIMED', reviewReason: null, ...target } });
  return 'new';
}

/** Ref, Payment.SUCCESS và Order.PAID là một commit, không còn khe cho cancel ghi FAILED. */
export async function settleOrderTransfer(tx: Prisma.TransactionClient, paymentId: string, transfer: IncomingTransfer, options: { allowReview?: boolean } = {}): Promise<string | null> {
  const found = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
  if (!found) { await reviewTransfer(tx, transfer, 'missing-target'); return null; }
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
  if (transfer.status === 'CLAIMED') {
    if (transfer.paymentId !== payment.id || payment.order.status === 'CANCELLED') return null;
    // Bản cũ có khe crash Payment.SUCCESS -> Order.PAID: claim backfill phải phục hồi đúng target.
    await markOrderPaid(tx, payment.orderId);
    return payment.orderId;
  }
  if (!['PENDING', 'EXPIRED'].includes(payment.order.status) || payment.status === 'SUCCESS' || payment.cryptoTxId || payment.sepayRef) {
    await reviewTransfer(tx, transfer, 'target-not-awaiting-payment'); return null;
  }
  if (options.allowReview) {
    if (transfer.reviewReason === 'provider-facts-changed') return null;
    const mode = transfer.source.startsWith('CRYPTO:') ? 'CRYPTO' : transfer.source === 'SEPAY' ? 'SEPAY' : transfer.source === 'BINANCE_ID' ? 'BINANCE_ID' : 'BINANCE';
    const snapshots = await tx.paymentInstruction.findMany({ where: { paymentId, mode } });
    const expected = mode === 'SEPAY' ? payment.vndAmount : payment.amount;
    const merchant = mode === 'BINANCE' ? await tx.merchantPaymentSession.findUnique({ where: { merchantTradeNo: transfer.reference } }) : null;
    const acceptable = mode === 'BINANCE'
      ? merchant?.paymentId === paymentId && payment.amount.equals(transfer.amount)
      : snapshots.some((i) => i.amount.equals(transfer.amount) && (!i.receiver || !transfer.receiver || i.receiver === transfer.receiver)
        && (mode !== 'CRYPTO' || transfer.source === `CRYPTO:${i.network}`))
        || (payment.mode === mode && expected?.equals(transfer.amount)
          && (mode !== 'CRYPTO' || transfer.source === `CRYPTO:${payment.cryptoNetwork}`)
          && (!payment.cryptoAddress || !transfer.receiver || payment.cryptoAddress === transfer.receiver));
    if (!acceptable || transfer.currency !== (mode === 'SEPAY' ? 'VND' : 'USDT')) return null;
    if (transfer.status === 'REVIEW') transfer = await tx.incomingTransfer.update({ where: { id: transfer.id }, data: { status: 'OBSERVED' } });
  }
  if ((await claimTransfer(tx, transfer, { paymentId })) !== 'new') return null;
  const ref = transfer.source === 'SEPAY'
    ? { sepayRef: transfer.reference }
    : transfer.source === 'BINANCE_MERCHANT' ? {} : { cryptoTxId: transfer.reference };
  await tx.payment.update({ where: { id: paymentId }, data: { ...ref, status: 'SUCCESS' } });
  await markOrderPaid(tx, payment.orderId);
  return payment.orderId;
}

/** Caller giữ arbitration. Ghi claim và sổ ví cùng transaction, unique chung chặn claim bên đơn. */
export async function creditDepositTransfer(tx: Prisma.TransactionClient, depositId: string, transfer: IncomingTransfer): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;
  const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || !['PENDING', 'EXPIRED'].includes(deposit.status) || deposit.cryptoTxId || deposit.sepayRef) {
    await reviewTransfer(tx, transfer, 'deposit-not-awaiting-payment'); return false;
  }
  if ((await claimTransfer(tx, transfer, { depositId })) !== 'new') return false;
  await tx.deposit.update({ where: { id: depositId }, data: {
    status: 'SUCCESS', paidAt: new Date(),
    ...(transfer.source === 'SEPAY' ? { sepayRef: transfer.reference } : { cryptoTxId: transfer.reference }),
  } });
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${deposit.userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: deposit.userId }, select: { balance: true } });
  const balanceAfter = user.balance.add(deposit.amountUsdt);
  await tx.user.update({ where: { id: deposit.userId }, data: { balance: balanceAfter } });
  await tx.balanceEntry.create({ data: { userId: deposit.userId, amount: deposit.amountUsdt, balanceAfter, reason: 'deposit', refCode: deposit.code } });
  return true;
}
