import type { Prisma } from '@prisma/client';
import type { CryptoNetwork } from '@webcatt/shared';
import { binanceNetworkToLabel, matchDeposits, type BinanceDeposit } from '../binance-exchange/deposit-matcher';
import { matchPayTransfers, type BinancePayTransfer } from '../binance-exchange/pay-matcher';
import { creditDepositTransfer, observeTransfer, reviewTransfer, settleOrderTransfer } from './incoming-transfer';

type Candidate = {
  id: string;
  code: string;
  expected: number;
  createdAtMs: number;
  expiresAtMs: number;
  network: CryptoNetwork | null;
  receiver: string | null;
  paymentId?: string;
  depositId?: string;
};

/** Caller giữ financial arbitration. Giữ cả expired/cancelled để không gán tiền muộn cho người khác. */
async function candidates(tx: Prisma.TransactionClient, mode: 'CRYPTO' | 'BINANCE_ID'): Promise<Candidate[]> {
  const [instructions, payments, deposits] = await Promise.all([
    tx.paymentInstruction.findMany({ where: { mode, payment: { cryptoTxId: null, sepayRef: null, status: { not: 'SUCCESS' }, order: { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } } } }, include: { payment: { include: { order: { select: { code: true, createdAt: true, expiresAt: true } } } } } }),
    // Tương thích fixture/legacy chưa có snapshot, không bỏ mất current instruction.
    tx.payment.findMany({ where: { mode, cryptoAmount: { not: null }, cryptoTxId: null, sepayRef: null, status: { not: 'SUCCESS' }, order: { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } } }, include: { order: { select: { code: true, createdAt: true, expiresAt: true } } } }),
    tx.deposit.findMany({ where: { mode, cryptoTxId: null, sepayRef: null, status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } } }),
  ]);
  const rows: Candidate[] = [
    ...instructions.map((i) => ({ id: `order:${i.paymentId}`, paymentId: i.paymentId, code: i.payment.order.code, expected: Number(i.amount), createdAtMs: i.createdAt.getTime(), expiresAtMs: i.payment.order.expiresAt?.getTime() ?? i.createdAt.getTime() + 1800000, network: i.network as CryptoNetwork | null, receiver: i.receiver })),
    ...payments.filter((p) => !instructions.some((i) => i.paymentId === p.id && i.mode === p.mode && i.network === p.cryptoNetwork && i.receiver === p.cryptoAddress && i.amount.equals(p.cryptoAmount!)))
      .map((p) => ({ id: `order:${p.id}`, paymentId: p.id, code: p.order.code, expected: Number(p.cryptoAmount), createdAtMs: p.order.createdAt.getTime(), expiresAtMs: p.order.expiresAt?.getTime() ?? p.order.createdAt.getTime() + 1800000, network: p.cryptoNetwork as CryptoNetwork | null, receiver: p.cryptoAddress })),
    ...deposits.map((d) => ({ id: `deposit:${d.id}`, depositId: d.id, code: d.code, expected: Number(d.amountUsdt), createdAtMs: d.createdAt.getTime(), expiresAtMs: d.expiresAt.getTime(), network: d.cryptoNetwork as CryptoNetwork | null, receiver: d.cryptoAddress })),
  ];
  // Snapshot lặp không được làm mất thời điểm đã phát hành sớm nhất.
  const unique = new Map<string, Candidate>();
  for (const row of rows) {
    const key = `${row.id}|${row.network}|${row.receiver}|${row.expected}`;
    const previous = unique.get(key);
    if (!previous || row.createdAtMs < previous.createdAtMs) unique.set(key, row);
  }
  return [...unique.values()];
}

function withinReconcileWindow(row: Candidate, receivedAtMs: number): boolean {
  // Cùng cửa sổ 24 giờ của mã nạp/worker. Ngoài hạn cần đối soát, không giữ số tiền vô hạn.
  return receivedAtMs >= row.createdAtMs - 600000 && receivedAtMs <= row.createdAtMs + 24 * 3_600_000;
}

function distinctTargets(rows: Candidate[]): Candidate[] {
  const unique = new Map<string, Candidate>();
  for (const row of rows) {
    const key = `${row.id}|${row.expected}`;
    if (!unique.has(key) || row.createdAtMs < unique.get(key)!.createdAtMs) unique.set(key, row);
  }
  return [...unique.values()];
}

export async function reconcileCryptoTransfers(tx: Prisma.TransactionClient, deposits: BinanceDeposit[]): Promise<string[]> {
  const delivered: string[] = [];
  for (const deposit of [...deposits].sort((a, b) => a.insertTimeMs - b.insertTimeMs)) {
    const network = binanceNetworkToLabel(deposit.network);
    if (!network || deposit.status !== 1 || !deposit.txId || !Number.isFinite(deposit.amount) || deposit.amount <= 0 || !Number.isFinite(deposit.insertTimeMs) || deposit.insertTimeMs <= 0) continue;
    const transfer = await observeTransfer(tx, { source: `CRYPTO:${network}`, reference: deposit.txId, amount: deposit.amount, currency: 'USDT', network, receivedAt: new Date(deposit.insertTimeMs) });
    if (transfer.status === 'CLAIMED' && transfer.paymentId) {
      const recovered = await settleOrderTransfer(tx, transfer.paymentId, transfer);
      if (recovered) delivered.push(recovered);
      continue;
    }
    if (transfer.status !== 'OBSERVED') continue;
    const all = (await candidates(tx, 'CRYPTO')).filter((c) => c.network === network);
    const stale = all.some((c) => Math.abs(c.expected - deposit.amount) <= 0.00005 && deposit.insertTimeMs > c.createdAtMs + 24 * 3_600_000);
    if (stale) {
      // Hết cửa sổ theo dõi không chứng minh người cũ chưa chuyển: không gán tiền muộn cho đơn mới.
      await reviewTransfer(tx, transfer, 'older-unresolved-instruction'); continue;
    }
    const pool = distinctTargets(all.filter((c) => withinReconcileWindow(c, deposit.insertTimeMs)));
    const matches = matchDeposits(pool.map((c) => ({ orderId: c.id, network, expected: c.expected, createdAtMs: c.createdAtMs })), [deposit], new Set());
    const match = matches[0];
    if (!match) {
      const possible = pool.filter((c) => Math.abs(c.expected - deposit.amount) <= 0.00005 && deposit.insertTimeMs >= c.createdAtMs - 600000);
      if (possible.length > 1) await reviewTransfer(tx, transfer, 'ambiguous-order-or-deposit');
      continue;
    }
    const target = pool.find((c) => c.id === match.orderId)!;
    if (target.paymentId) {
      const id = await settleOrderTransfer(tx, target.paymentId, transfer);
      if (id) delivered.push(id);
    } else if (target.depositId) await creditDepositTransfer(tx, target.depositId, transfer);
  }
  return delivered;
}

export async function reconcilePayTransfers(tx: Prisma.TransactionClient, transfers: BinancePayTransfer[], receiverBinanceId: string): Promise<string[]> {
  const delivered: string[] = [];
  for (const item of [...transfers].sort((a, b) => a.transactionTimeMs - b.transactionTimeMs)) {
    if (!item.transactionId || item.currency.toUpperCase() !== 'USDT' || !Number.isFinite(item.amount) || item.amount <= 0 || !Number.isFinite(item.transactionTimeMs) || item.transactionTimeMs <= 0) continue;
    const transfer = await observeTransfer(tx, { source: 'BINANCE_ID', reference: item.transactionId, amount: item.amount, currency: 'USDT', receiver: item.receiverBinanceId ?? null, receivedAt: new Date(item.transactionTimeMs) });
    if (transfer.status === 'CLAIMED' && transfer.paymentId) {
      const recovered = await settleOrderTransfer(tx, transfer.paymentId, transfer);
      if (recovered) delivered.push(recovered);
      continue;
    }
    if (transfer.status !== 'OBSERVED') continue;
    const history = await candidates(tx, 'BINANCE_ID');
    if (!/\b(?:DH|NAP)-[A-Z0-9-]+\b/i.test(item.note ?? '') && history.some((c) => Math.abs(c.expected - item.amount) <= 0.00005 && item.transactionTimeMs > c.createdAtMs + 24 * 3_600_000)) {
      await reviewTransfer(tx, transfer, 'older-unresolved-instruction'); continue;
    }
    const all = history.filter((c) => withinReconcileWindow(c, item.transactionTimeMs));
    const receivers = new Set(all.filter((c) => Math.abs(c.expected - item.amount) <= 0.00005).map((c) => c.receiver));
    if (!item.receiverBinanceId && (receivers.size !== 1 || !receivers.has(receiverBinanceId))) {
      await reviewTransfer(tx, transfer, 'receiver-not-provable'); continue;
    }
    const receiver = item.receiverBinanceId ?? receiverBinanceId;
    const pool = distinctTargets(all.filter((c) => c.receiver === receiver));
    const matches = matchPayTransfers(pool.map((c) => ({ orderId: c.id, code: c.code, expected: c.expected, createdAtMs: c.createdAtMs })), [item], new Set(), { receiverBinanceId: receiver });
    const match = matches[0];
    if (!match) {
      const possible = pool.filter((c) => Math.abs(c.expected - item.amount) <= 0.00005 && item.transactionTimeMs >= c.createdAtMs - 600000);
      if (possible.length > 1 || /(?:DH|NAP)[-\s]?[A-Z0-9]+/i.test(item.note ?? '')) await reviewTransfer(tx, transfer, 'ambiguous-or-unmatched-memo');
      continue;
    }
    const target = pool.find((c) => c.id === match.orderId)!;
    if (target.paymentId) {
      const id = await settleOrderTransfer(tx, target.paymentId, transfer);
      if (id) delivered.push(id);
    } else if (target.depositId) await creditDepositTransfer(tx, target.depositId, transfer);
  }
  return delivered;
}
