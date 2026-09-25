import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../security/rate-limit.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailCatalogService } from './mail-catalog.service';
import { MailPurchaseService } from './mail-purchase.service';
import { MailInboxService } from './mail-inbox.service';
import { MailOfferInput, MailSettingsInput, RentMailInput, RefundMailInput } from './mail.dto';

class PollMailInput {
  @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @MaxLength(60, { each: true }) ids!: string[];
}
@Controller('mail')
export class MailController {
  constructor(private readonly catalog: MailCatalogService, private readonly purchases: MailPurchaseService, private readonly inbox: MailInboxService) {}
  @Get('catalog') @Header('Cache-Control', 'no-store') @RateLimit({ limit: 100, windowMs: 60_000 })
  list() { return this.catalog.catalog(); }
  @Get('workspace') @UseGuards(JwtAuthGuard) @Header('Cache-Control', 'no-store')
  workspace(@CurrentUser() user: User, @Query('cursor') cursor?: string) { return this.inbox.list(user.id, cursor?.slice(0, 60)); }
  @Post('rent') @UseGuards(JwtAuthGuard) @RateLimit({ limit: 10, windowMs: 60_000 })
  rent(@CurrentUser() user: User, @Body() body: RentMailInput) { return this.purchases.rent(user.id, body); }
  @Post('poll') @UseGuards(JwtAuthGuard) @RateLimit({ limit: 25, windowMs: 60_000 })
  poll(@CurrentUser() user: User, @Body() body: PollMailInput) { return this.inbox.poll(user.id, body.ids); }
  @Get('export') @UseGuards(JwtAuthGuard) @Header('Cache-Control', 'no-store')
  async export(@CurrentUser() user: User, @Res() response: Response) { response.set({ 'Content-Type': 'text/plain;charset=utf-8', 'Content-Disposition': 'attachment; filename="mail.txt"' }).send(await this.inbox.export(user.id)); }
  @Post(':id/close') @UseGuards(JwtAuthGuard)
  close(@CurrentUser() user: User, @Param('id') id: string) { return this.inbox.close(user.id, id); }
}

@Controller('admin/mail')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminMailController {
  constructor(private readonly catalog: MailCatalogService, private readonly purchases: MailPurchaseService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly inbox: MailInboxService) {}
  @Get('settings') settings() { return this.catalog.getSettings(); }
  @Patch('settings') @UseGuards(SuperAdminGuard)
  async saveSettings(@CurrentUser() actor: User, @Body() body: MailSettingsInput) {
    const result = await this.catalog.updateSettings(body);
    await this.audit.log(actor, 'settings.update', { type: 'mail.settings', id: '1' }, { fields: Object.keys(body), tokenChanged: body.token !== undefined });
    return result;
  }
  @Get('offers') offers() { return this.catalog.catalog(true); }
  @Post('sync') @UseGuards(SuperAdminGuard) @RateLimit({ limit: 6, windowMs: 60_000 })
  async sync() { await this.catalog.refresh(true); return this.catalog.catalog(true); }
  @Patch('offers/:code')
  async saveOffer(@CurrentUser() actor: User, @Param('code') code: string, @Body() body: MailOfferInput) {
    await this.catalog.updateOffer(code, body); await this.audit.log(actor, 'settings.update', { type: 'mail.offer', id: code }, { ...body }); return { saved: true };
  }
  @Get('purchases')
  async orders() {
    await this.inbox.markStalePurchases();
    const rows = await this.prisma.mailPurchase.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { code: true } } } });
    return rows.map(p => ({ id: p.id, offerCode: p.offerCode, serviceName: p.serviceName, quantity: p.quantity, total: p.total.toString(), status: p.status, createdAt: p.createdAt.toISOString(), userCode: p.user.code, expectedCost: p.expectedCost.toString(), actualCost: p.actualCost?.toString() ?? null, providerOrderNo: p.providerOrderNo }));
  }
  @Post('purchases/:id/refund') @UseGuards(SuperAdminGuard)
  refund(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: RefundMailInput) { return this.purchases.refund(actor, id, body.confirmedNoDelivery, body.reason); }
}
