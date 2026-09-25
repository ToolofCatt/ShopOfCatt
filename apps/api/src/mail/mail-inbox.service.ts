import { Injectable, NotFoundException } from '@nestjs/common';
import type { MailWorkspaceDto } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';
import { parseMailCodes } from './mail-delivery';
import { customerMailExport, publicMailName } from './mail-public';

@Injectable()
export class MailInboxService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string, cursor?: string): Promise<MailWorkspaceDto> {
    await this.markStalePurchases();
    const [user, rows, purchases] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } }),
      this.prisma.mailbox.findMany({ where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: 101, include: { purchase: true, codes: { orderBy: { receivedAt: 'desc' } } } }),
      this.prisma.mailPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { offer: { select: { publicId: true } } } }),
    ]);
    const visible = rows.slice(0, 100);
    return { balance: user.balance.toString(), nextCursor: rows.length > 100 ? visible.at(-1)!.id : null,
      purchases: purchases.map(p => ({ id: p.id, offerCode: p.offer.publicId, serviceName: publicMailName(p.serviceName), quantity: p.quantity, total: p.total.toString(), status: p.status, createdAt: p.createdAt.toISOString() })),
      mailboxes: visible.map(m => ({ id: m.id, purchaseId: m.purchaseId, email: m.account, service: publicMailName(m.purchase.serviceName), price: m.purchase.unitPrice.toString(), priceCurrency: m.purchase.priceCurrency as 'VND' | 'USDT', priceAmount: (m.purchase.priceAmount ?? m.purchase.unitPrice).toString(), closed: !!m.closedAt, canRead: !!m.readUrl, pollFailed: m.pollFailed,
        codes: m.codes.map(c => ({ id: c.id, code: c.code, receivedAt: c.receivedAt.toISOString() })) })) };
  }
  async markStalePurchases() {
    // Không retry REQUESTING sau crash; quá2phút chuyển REVIEW cho admin đối soát.
    await this.prisma.mailPurchase.updateMany({ where: { status: 'REQUESTING', createdAt: { lt: new Date(Date.now() - 120_000) } }, data: { status: 'REVIEW' } });
  }
  async poll(userId: string, ids: string[]) {
    const rows = await this.prisma.mailbox.findMany({ where: { id: { in: ids.slice(0, 30) }, userId, closedAt: null, readUrl: { not: null } }, select: { id: true } });
    // Giới hạn5request đồng thời; lease DB chống nhiều tab/process đọc cùng mailbox.
    for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(m => this.read(userId, m.id)));
    return { checked: rows.length };
  }
  private async read(userId: string, id: string) {
    const now = new Date();
    const lease = await this.prisma.mailbox.updateMany({ where: { id, userId, closedAt: null, OR: [{ pollLeaseUntil: null }, { pollLeaseUntil: { lt: now } }], AND: [{ OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now.getTime() - 2800) } }] }] }, data: { pollLeaseUntil: new Date(now.getTime() + 10_000), lastPolledAt: now } });
    if (!lease.count) return;
    try {
      const mailbox = await this.prisma.mailbox.findUniqueOrThrow({ where: { id } });
      if (!mailbox.readUrl) return;
      const url = new URL(mailbox.readUrl);
      if (url.origin !== 'https://gapi.mailsapi.com' || url.pathname !== '/api/get-code' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => k !== 'uid')) throw new Error('host');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(6500), headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } });
      if (!response.ok || !response.body) throw new Error('inbox');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 512_000) throw new Error('size'); chunks.push(part.value); } } finally { await reader.cancel(); }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      const codes = parseMailCodes(/^[0-9]{4,10}$/.test(raw) ? raw : JSON.parse(raw));
      // Lỗi mạng/định dạng không được suy ra mail chết hoặc xóa mã cũ.
      if (codes.length) await this.prisma.mailCode.createMany({ data: codes.map(code => ({ mailboxId: id, code })), skipDuplicates: true });
      await this.prisma.mailbox.updateMany({ where: { id, userId }, data: { pollFailed: false } });
    } catch { await this.prisma.mailbox.updateMany({ where: { id, userId }, data: { pollFailed: true } }); }
    finally { await this.prisma.mailbox.updateMany({ where: { id, userId }, data: { pollLeaseUntil: null } }); }
  }
  async close(userId: string, id: string) {
    const m = await this.prisma.mailbox.updateMany({ where: { id, userId }, data: { closedAt: new Date() } });
    if (!m.count) throw new NotFoundException(K.mailUnavailable);
    return { closed: true };
  }
  async export(userId: string) {
    const rows = await this.prisma.mailbox.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { codes: { orderBy: { receivedAt: 'desc' } } } });
    return customerMailExport(rows);
  }
}
