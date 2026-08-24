import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Deposit, type User } from '@prisma/client';
import { floorUsdt } from '@webcatt/shared';
import { generateDepositCode } from '../common/codes';
import { K } from '../i18n/messages';
import { FulfillmentService } from '../orders/fulfillment.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Chặn dưới/trên một lần nạp (VND) — dưới 10k phí chuyển ăn hết ý nghĩa,
 *  trên 100tr thì chắc chắn là gõ nhầm. */
export const DEPOSIT_MIN_VND = 10_000;
export const DEPOSIT_MAX_VND = 100_000_000;

/** Hạn của một mã nạp — NGẮN như đơn SePay và cùng lý do: mã VietQR chốt cứng
 *  số VND theo tỉ giá lúc tạo, để lâu là khách quét mã cũ chuyển số không còn khớp. */
const DEPOSIT_EXPIRE_MINUTES = 10;

/** Chu kỳ quét mã nạp quá hạn. */
const EXPIRE_SWEEP_MS = 60_000;

/**
 * Ví số dư của khách (hiện chỉ bot Telegram dùng — web có thể nối sau).
 *
 * Hai bất biến, phá là mất tiền thật:
 * 1. MỌI thay đổi `User.balance` đi qua service này và kèm đúng một
 *    BalanceEntry — cột balance chỉ là ảnh chụp, sổ cái mới là sự thật.
 * 2. Trừ tiền mua hàng phải nằm CÙNG transaction với chốt trạng thái đơn
 *    (PENDING → PAID): tách hai bước là bấm đúp thành trừ hai lần, hoặc
 *    trừ tiền xong đơn không chốt được.
 */
@Injectable()
export class BalanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BalanceService.name);
  private expireTimer: NodeJS.Timeout | null = null;
  private expiring = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  onModuleInit(): void {
    this.expireTimer = setInterval(() => {
      void this.expireSweep();
    }, EXPIRE_SWEEP_MS);
    this.expireTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
  }

  /** Mã nạp PENDING quá hạn → EXPIRED. Tiền về muộn vẫn được cộng — xem creditDeposit. */
  private async expireSweep(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    try {
      await this.prisma.deposit.updateMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
    } catch (err) {
      this.logger.warn(
        `Quét mã nạp quá hạn trượt: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.expiring = false;
    }
  }

  /**
   * Tạo mã nạp qua chuyển khoản. Số USDT cộng vào ví chốt theo tỉ giá LÚC TẠO
   * và làm tròn XUỐNG (floorUsdt) — phần lẻ dưới một phần triệu USDT thuộc về
   * cửa hàng, không bao giờ cộng lố cho khách.
   */
  async createDeposit(user: User, vndAmount: number): Promise<{
    deposit: Deposit;
    accountNumber: string;
    bank: string;
    accountHolder: string;
  }> {
    if (
      !Number.isInteger(vndAmount) ||
      vndAmount < DEPOSIT_MIN_VND ||
      vndAmount > DEPOSIT_MAX_VND
    ) {
      throw new BadRequestException(K.depositAmountInvalid);
    }
    const cfg = await this.settings.getSepayConfig();
    // Fail-closed như thanh toán: SePay chưa sẵn sàng thì không nhận nạp,
    // tuyệt đối không tạo mã mà không có đường đối soát.
    if (!cfg.ready || cfg.vndPerUsdt <= 0) {
      throw new ServiceUnavailableException(K.paymentMethodUnavailable);
    }

    const amountUsdt = floorUsdt(vndAmount / cfg.vndPerUsdt);
    if (amountUsdt <= 0) {
      throw new BadRequestException(K.depositAmountInvalid);
    }

    // Mã trùng thì thử lại — cùng cách với mã đơn hàng.
    let code = generateDepositCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const existed = await this.prisma.deposit.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!existed) break;
      code = generateDepositCode();
    }

    const deposit = await this.prisma.deposit.create({
      data: {
        code,
        userId: user.id,
        amountUsdt: new Prisma.Decimal(amountUsdt.toFixed(6)),
        vndAmount: new Prisma.Decimal(vndAmount),
        expiresAt: new Date(Date.now() + DEPOSIT_EXPIRE_MINUTES * 60_000),
      },
    });
    return {
      deposit,
      accountNumber: cfg.accountNumber,
      bank: cfg.bank,
      accountHolder: cfg.accountHolder,
    };
  }

  /** Mã nạp đang chờ tiền — cho webhook SePay đối soát. Nhận cả EXPIRED chưa
   *  được cộng: tiền đã rời tài khoản khách thì phải cộng, muộn cũng cộng. */
  async listAwaitingDeposits(): Promise<
    { id: string; code: string; expectedVnd: number }[]
  > {
    const rows = await this.prisma.deposit.findMany({
      where: { status: { in: ['PENDING', 'EXPIRED'] }, sepayRef: null },
      select: { id: true, code: true, vndAmount: true },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      expectedVnd: Number(row.vndAmount),
    }));
  }

  /** Một giao dịch SePay đã được ghi cho mã nạp nào chưa (webhook gửi lại). */
  async findDepositBySepayRef(ref: string): Promise<Deposit | null> {
    return this.prisma.deposit.findUnique({ where: { sepayRef: ref } });
  }

  /**
   * Cộng tiền một mã nạp đã khớp giao dịch. Idempotent hai lớp: guard trạng
   * thái (updateMany điều kiện) + `sepayRef @unique` — webhook trùng hay hai
   * tiến trình đua nhau thì chỉ một bên cộng được.
   */
  async creditDeposit(depositId: string, sepayRef: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const gate = await tx.deposit.updateMany({
          where: {
            id: depositId,
            status: { in: ['PENDING', 'EXPIRED'] },
            sepayRef: null,
          },
          data: { status: 'SUCCESS', sepayRef, paidAt: new Date() },
        });
        if (gate.count === 0) return false;

        const deposit = await tx.deposit.findUniqueOrThrow({
          where: { id: depositId },
          select: { userId: true, amountUsdt: true, code: true },
        });

        /*
         * Khoá dòng User trước khi đọc-cộng: không khoá thì hai lần cộng/trừ
         * song song cùng đọc một số dư cũ và balanceAfter trong sổ cái nói dối.
         */
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${deposit.userId} FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: deposit.userId },
          select: { balance: true },
        });
        const balanceAfter = user.balance.add(deposit.amountUsdt);
        await tx.user.update({
          where: { id: deposit.userId },
          data: { balance: balanceAfter },
        });
        await tx.balanceEntry.create({
          data: {
            userId: deposit.userId,
            amount: deposit.amountUsdt,
            balanceAfter,
            reason: 'deposit',
            refCode: deposit.code,
          },
        });
        return true;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Bên kia vừa ghi cùng sepayRef — coi như đã xử lý.
        return false;
      }
      throw err;
    }
  }

  /**
   * Trả một đơn PENDING bằng số dư ví — trừ tiền và chốt đơn trong MỘT
   * transaction, giao hàng (idempotent) sau khi commit.
   *
   * Thứ tự khoá: Order (updateMany) → User (FOR UPDATE) — nhất quán trong
   * service này; các luồng khác chỉ khoá Order → StockItem nên không tạo vòng.
   */
  async payOrderWithBalance(
    userId: string,
    orderCode: string,
  ): Promise<{ delivered: boolean }> {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { code: orderCode, userId },
        select: { id: true, totalAmount: true },
      });
      if (!order) throw new NotFoundException(K.orderNotFound);

      // Chốt trạng thái TRƯỚC — bấm đúp thì lần hai trượt ngay tại đây,
      // không bao giờ trừ ví hai lần cho một đơn.
      const gate = await tx.order.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (gate.count === 0) {
        throw new BadRequestException(K.balanceOrderNotPending);
      }

      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balance: true },
      });
      if (user.balance.lessThan(order.totalAmount)) {
        // Ném lỗi để transaction LĂN NGƯỢC — gate ở trên tự hoàn tác, đơn
        // quay về PENDING cho khách chọn cách trả khác.
        throw new BadRequestException(K.balanceInsufficient);
      }
      const balanceAfter = user.balance.sub(order.totalAmount);
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter },
      });
      await tx.balanceEntry.create({
        data: {
          userId,
          amount: order.totalAmount.neg(),
          balanceAfter,
          reason: 'purchase',
          refCode: orderCode,
        },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: { status: 'SUCCESS', mode: 'BALANCE' },
      });
      return order.id;
    });

    // Giao hàng NGOÀI transaction ví — deliverOrder tự khoá Order → StockItem
    // và idempotent; thất bại giữa chừng thì DeliverySweeper cứu (đơn PAID).
    const delivered = await this.fulfillment.deliverOrder(orderId);
    return { delivered };
  }

  /** Mã nạp của CHÍNH khách đó — code lạ/của người khác đều ra null. */
  async getOwnDeposit(userId: string, code: string): Promise<Deposit | null> {
    return this.prisma.deposit.findFirst({ where: { code, userId } });
  }

  /** Huỷ mã nạp đang chờ — guard trạng thái, bấm đúp vô hại. */
  async cancelDeposit(userId: string, code: string): Promise<boolean> {
    const gate = await this.prisma.deposit.updateMany({
      where: { code, userId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return gate.count > 0;
  }

  /** Mã nạp đã cộng nhưng bot chưa báo — cho vòng đẩy của Telegram. */
  async listUnnotifiedDeposits(limit: number): Promise<
    {
      id: string;
      code: string;
      amountUsdt: number;
      userId: string;
      chatId: string;
      lang: string;
      balance: number;
    }[]
  > {
    const rows = await this.prisma.deposit.findMany({
      where: {
        status: 'SUCCESS',
        telegramNotifiedAt: null,
        user: { telegramChatId: { not: null } },
      },
      select: {
        id: true,
        code: true,
        amountUsdt: true,
        userId: true,
        user: { select: { telegramChatId: true, telegramLang: true, balance: true } },
      },
      orderBy: { paidAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      amountUsdt: Number(row.amountUsdt),
      userId: row.userId,
      chatId: row.user.telegramChatId ?? '',
      lang: row.user.telegramLang,
      balance: Number(row.user.balance),
    }));
  }

  /** Đánh dấu đã báo — điều kiện null nên gọi trùng vô hại. */
  async markDepositNotified(depositId: string): Promise<void> {
    await this.prisma.deposit.updateMany({
      where: { id: depositId, telegramNotifiedAt: null },
      data: { telegramNotifiedAt: new Date() },
    });
  }

  /** Số dư hiện tại (USDT) — cho bot hiện nút "trả bằng số dư". */
  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    return user ? Number(user.balance) : 0;
  }
}
