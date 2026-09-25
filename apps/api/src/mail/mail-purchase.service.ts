import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { K } from '../i18n/messages';
import { FiveMailClient, type FiveMailPurchase } from './fivemail.client';
import { MailCatalogService, mailSalePrice } from './mail-catalog.service';
import { RentMailInput } from './mail.dto';
import { parseMailDelivery } from './mail-delivery';

@Injectable()
export class MailPurchaseService {
  constructor(private readonly prisma: PrismaService, private readonly catalog: MailCatalogService, private readonly client: FiveMailClient) {}

  async rent(userId: string, input: RentMailInput) {
    const previous = await this.prisma.mailPurchase.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
    if (previous) {
      if (previous.offerCode !== input.offerCode || previous.quantity !== input.quantity) throw new ConflictException(K.mailRequestConflict);
      return { id: previous.id };
    }
    const settings = await this.catalog.setting();
    if (!settings.enabled || !settings.currencyConfirmed || !settings.token) throw new ServiceUnavailableException(K.mailNotReady);
    const live = await this.client.info(settings.token, input.offerCode);
    const id = randomUUID();
    const claim = await this.prisma.$transaction(async tx => {
      await lockFinancialArbitration(tx);
      const replay = await tx.mailPurchase.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
      if (replay) {
        if (replay.offerCode !== input.offerCode || replay.quantity !== input.quantity) throw new ConflictException(K.mailRequestConflict);
        return { id: replay.id, send: false };
      }
      if (await tx.mailPurchase.findFirst({ where: { userId, status: { in: ['REQUESTING', 'REVIEW'] } }, select: { id: true } })) throw new ConflictException(K.mailRequestConflict);
      await tx.$queryRaw`SELECT id FROM "MailProviderSetting" WHERE id = 1 FOR UPDATE`;
      const s = await tx.mailProviderSetting.findUniqueOrThrow({ where: { id: 1 } });
      const setup = await tx.storeSetup.findUnique({ where: { id: 'main' } });
      if (!s.enabled || !s.currencyConfirmed || s.token !== settings.token || !setup || setup.maintenanceMode || !setup.publishedAt) throw new ServiceUnavailableException(K.mailNotReady);
      await tx.$queryRaw`SELECT code FROM "MailOffer" WHERE code = ${input.offerCode} FOR UPDATE`;
      const offer = await tx.mailOffer.findUnique({ where: { code: input.offerCode } });
      if (!offer?.active || offer.category !== 'gmail-api') throw new BadRequestException(K.mailUnavailable);
      const cost = new Prisma.Decimal(live.price);
      const price = mailSalePrice({ cost, salePrice: offer.salePrice }, s);
      if (price.lessThanOrEqualTo(0) || !price.equals(input.expectedUnitPrice) || price.lessThan(cost)) throw new ConflictException(K.mailPriceChanged);
      const total = price.mul(input.quantity), expectedCost = cost.mul(input.quantity);
      const reserved = await tx.mailPurchase.aggregate({ where: { offerCode: offer.code, status: 'REQUESTING' }, _sum: { quantity: true } });
      if (live.stock - (reserved._sum.quantity ?? 0) < input.quantity) throw new BadRequestException(K.mailUnavailable);
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      const spent = await tx.mailPurchase.aggregate({ where: { createdAt: { gte: day } }, _sum: { expectedCost: true } });
      if (expectedCost.greaterThan(s.maxOrderCost) || expectedCost.add(spent._sum.expectedCost ?? 0).greaterThan(s.maxDailyCost)) throw new ServiceUnavailableException(K.mailSpendLimit);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.lockedAt) throw new BadRequestException(K.accountLocked);
      if (user.balance.lessThan(total)) throw new BadRequestException(K.balanceInsufficient);
      const balanceAfter = user.balance.sub(total);
      await tx.mailPurchase.create({ data: { id, userId, requestId: input.requestId, offerCode: offer.code, serviceName: offer.name, quantity: input.quantity, unitPrice: price, total, expectedCost } });
      await tx.user.update({ where: { id: userId }, data: { balance: balanceAfter } });
      await tx.balanceEntry.create({ data: { userId, amount: total.neg(), balanceAfter, reason: 'mail_purchase', refCode: id } });
      return { id, send: true };
    }, FINANCIAL_TRANSACTION);
    if (!claim.send) return { id: claim.id };
    // REQUESTING đã commit trước I/O. Mất phản hồi/restart không được tạo request buy lần2.
    try {
      const receipt = await this.client.buy(settings.token, input.offerCode, input.quantity);
      await this.deliver(id, receipt);
    } catch {
      await this.prisma.mailPurchase.updateMany({ where: { id, status: 'REQUESTING' }, data: { status: 'REVIEW' } });
    }
    return { id };
  }

  async deliver(id: string, receipt: FiveMailPurchase) {
    const mailboxes = receipt.lines.map(parseMailDelivery);
    if (new Set(mailboxes.map(m => m.providerIdentity)).size !== mailboxes.length) throw new Error('duplicate delivery');
    await this.prisma.$transaction(async tx => {
      await lockFinancialArbitration(tx);
      await tx.$queryRaw`SELECT id FROM "MailPurchase" WHERE id = ${id} FOR UPDATE`;
      const purchase = await tx.mailPurchase.findUniqueOrThrow({ where: { id } });
      if (purchase.status === 'DELIVERED') return;
      if (purchase.status !== 'REQUESTING' || receipt.productCode !== purchase.offerCode || mailboxes.length !== purchase.quantity) throw new Error('invalid receipt');
      await tx.mailbox.createMany({ data: mailboxes.map(m => ({ ...m, purchaseId: id, userId: purchase.userId })) });
      const gate = await tx.mailPurchase.updateMany({ where: { id, status: 'REQUESTING' }, data: { status: 'DELIVERED', providerOrderNo: receipt.orderNo, actualCost: receipt.totalPrice } });
      if (gate.count !== 1) throw new Error('changed receipt');
    }, FINANCIAL_TRANSACTION);
  }

  async refund(actor: User, id: string, confirmedNoDelivery: boolean, reason: string) {
    if (!confirmedNoDelivery || reason.trim().length < 10) throw new BadRequestException(K.mailInvalid);
    return this.prisma.$transaction(async tx => {
      await lockFinancialArbitration(tx);
      await tx.$queryRaw`SELECT id FROM "MailPurchase" WHERE id = ${id} FOR UPDATE`;
      const purchase = await tx.mailPurchase.findUnique({ where: { id } });
      if (!purchase) throw new NotFoundException(K.mailUnavailable);
      if (purchase.status === 'REFUNDED') return { refunded: true };
      if (purchase.status !== 'REVIEW' || await tx.mailbox.count({ where: { purchaseId: id } })) throw new BadRequestException(K.mailRequestConflict);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${purchase.userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: purchase.userId } });
      const balanceAfter = user.balance.add(purchase.total);
      await tx.user.update({ where: { id: user.id }, data: { balance: balanceAfter } });
      await tx.balanceEntry.create({ data: { userId: user.id, amount: purchase.total, balanceAfter, reason: 'mail_refund', refCode: id } });
      await tx.mailPurchase.updateMany({ where: { id, status: 'REVIEW' }, data: { status: 'REFUNDED' } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email ?? '', actorCode: actor.code, action: 'settings.update', entityType: 'mail.refund', entityId: id, details: { reason, confirmedNoDelivery } } });
      return { refunded: true };
    }, FINANCIAL_TRANSACTION);
  }
}
