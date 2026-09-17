import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { ReconciliationTransferDto } from '@webcatt/shared';
import { K } from '../../i18n/messages';

const SOURCES = ['CRYPTO:BEP20', 'CRYPTO:TRC20', 'BINANCE_ID', 'SEPAY', 'BINANCE_MERCHANT'] as const;
const STATUSES = ['UNRESOLVED', 'OBSERVED', 'REVIEW', 'CLAIMED', 'ALL'] as const;
export class ReconciliationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt({message:K.adminPageInvalid}) @Min(1,{message:K.adminPageInvalid}) @Max(100000,{message:K.adminPageInvalid}) page?: number;
  @IsOptional() @Type(() => Number) @IsInt({message:K.adminLimitInvalid}) @Min(1,{message:K.adminLimitInvalid}) @Max(100,{message:K.adminLimitInvalid}) limit?: number;
  @IsOptional() @IsString({message:K.adminSearchInvalid}) @MaxLength(200,{message:K.adminSearchInvalid}) q?: string;
  @IsOptional() @IsIn(SOURCES,{message:K.paymentMethodInvalid}) source?: typeof SOURCES[number];
  @IsOptional() @IsIn(STATUSES,{message:K.adminOrderStatusInvalid}) status?: typeof STATUSES[number];
  @IsOptional() @IsString({message:K.adminPriceNumber}) @Matches(/^\d{1,12}(?:\.\d{1,6})?$/,{message:K.adminPriceNumber}) amount?: string;
  @IsOptional() @IsIn(['USDT','VND'],{message:K.adminPriceCurrencyInvalid}) currency?: 'USDT'|'VND';
  @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean({message:K.adminSettingsFlagInvalid}) conflicts?: boolean;
}

export function reconciliationWhere(query: ReconciliationQueryDto): Prisma.IncomingTransferWhereInput {
  const where: Prisma.IncomingTransferWhereInput = {};
  if (!query.status || query.status === 'UNRESOLVED') where.status = { in: ['OBSERVED','REVIEW'] };
  else if (query.status !== 'ALL') where.status = query.status;
  if (query.source) where.source = query.source;
  if (query.currency) where.currency = query.currency;
  if (query.amount !== undefined) where.amount = new Prisma.Decimal(query.amount);
  if (query.conflicts) where.reviewReason = 'provider-facts-changed';
  const term = query.q?.trim();
  if (term) where.OR = [{ id: { contains: term, mode:'insensitive' } }, { reference: { contains: term, mode:'insensitive' } }];
  return where;
}

export const RECONCILIATION_SELECT = {
  id:true, source:true, reference:true, amount:true, currency:true, network:true,
  receiver:true, status:true, reviewReason:true, receivedAt:true, createdAt:true,
  payment:{select:{order:{select:{code:true}}}}, deposit:{select:{code:true}},
} satisfies Prisma.IncomingTransferSelect;

type ReconciliationRow = Prisma.IncomingTransferGetPayload<{select:typeof RECONCILIATION_SELECT}>;
export function transferToReconciliationDto(row: ReconciliationRow): ReconciliationTransferDto {
  // Không spread toàn row: payload tương lai không được vô tình đi xuống trình duyệt.
  return {
    id:row.id, source:row.source, reference:row.reference, amount:row.amount.toString(),
    currency:row.currency, network:row.network, receiver:row.receiver, status:row.status,
    reviewReason:row.reviewReason, receivedAt:row.receivedAt?.toISOString()??null,
    createdAt:row.createdAt.toISOString(), orderCode:row.payment?.order.code??null,
    depositCode:row.deposit?.code??null,
    resolvable:['OBSERVED','REVIEW'].includes(row.status)&&row.reviewReason!=='provider-facts-changed',
  };
}
