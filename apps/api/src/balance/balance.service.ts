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
import { floorUsdt, type CryptoNetwork, type PaymentMethod } from '@webcatt/shared';
import { generateDepositCode } from '../common/codes';
import { K } from '../i18n/messages';
import { FulfillmentService } from '../orders/fulfillment.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { pickUniqueUsdt } from './unique-amount';
import { WalletCreditService } from './wallet-credit.service';

/** Chặn dưới/trên một lần nạp (VND) — dưới 10k phí chuyển ăn hết ý nghĩa,
 *  trên 100tr thì chắc chắn là gõ nhầm. */
export const DEPOSIT_MIN_VND = 10_000;
export const DEPOSIT_MAX_VND = 100_000_000;

/** Hạn của một mã nạp — NGẮN như đơn SePay và cùng lý do: mã VietQR chốt cứng
 *  số VND theo tỉ giá lúc tạo, để lâu là khách quét mã cũ chuyển số không còn khớp. */
const DEPOSIT_EXPIRE_MINUTES = 10;

/** Kênh crypto cho hạn rộng hơn: khoản nạp on-chain phải chờ xác nhận block +
 *  Binance ghi có + vòng đối soát 60 giây — 10 phút là dồn khách vô cớ. */
const DEPOSIT_EXPIRE_MINUTES_CRYPTO = 30;

/** Các phương thức được phép NẠP VÍ — mock (giả lập) và binance_pay (cần phiên
 *  checkout gắn với đơn) cố ý không có mặt. */
export const DEPOSIT_METHODS = [
  'sepay',
  'crypto_bep20',
  'crypto_trc20',
  'binance_id',
] as const satisfies readonly PaymentMethod[];
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

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
    private readonly walletCredit: WalletCreditService,
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
   * Các phương thức đang MỞ cho nạp ví — giao của danh sách phương thức thanh
   * toán đang bật (fail-closed sẵn trong getEnabledMethods) với DEPOSIT_METHODS.
   * Không có tỉ giá VND thì không kênh nào mở: mọi mức nạp đều nhập bằng VND.
   */
  async listDepositMethods(): Promise<DepositMethod[]> {
    const rates = await this.settings.getPublicRates();
    if (rates.vndPerUsdt <= 0) return [];
    const enabled = await this.settings.getEnabledMethods();
    return DEPOSIT_METHODS.filter((m) =>
      enabled.some((e) => e.method === m),
    );
  }

  /**
   * Tạo mã nạp. Số USDT cộng vào ví chốt theo tỉ giá LÚC TẠO và làm tròn
   * XUỐNG (floorUsdt) — phần lẻ thuộc về cửa hàng, không bao giờ cộng lố.
   *
   * Kênh crypto/Binance ID: số USDT được đẩy lệch bước 0.0001 để DUY NHẤT
   * giữa mọi khoản đang chờ (cả mã nạp lẫn đơn hàng crypto) — on-chain không
   * có chỗ ghi mã nạp, số tiền là thứ duy nhất chỉ ra khoản nào của ai. Số
   * cộng vào ví = đúng số khách đã chuyển, gồm cả phần lẻ đó.
   */
  async createDeposit(
    user: User,
    vndAmount: number,
    method: DepositMethod = 'sepay',
  ): Promise<{
    deposit: Deposit;
    /** Thông tin chuyển khoản — chỉ kênh SEPAY, kênh khác là null. */
    bank: { accountNumber: string; bank: string; accountHolder: string } | null;
  }> {
    if (
      !Number.isInteger(vndAmount) ||
      vndAmount < DEPOSIT_MIN_VND ||
      vndAmount > DEPOSIT_MAX_VND
    ) {
      throw new BadRequestException(K.depositAmountInvalid);
    }
    // Fail-closed: phương thức không nằm trong danh sách đang mở thì từ chối
    // — callback_data là dữ liệu client, khách sửa được tuỳ ý.
    const open = await this.listDepositMethods();
    if (!open.includes(method)) {
      throw new ServiceUnavailableException(K.paymentMethodUnavailable);
    }

    if (method === 'sepay') {
      const cfg = await this.settings.getSepayConfig();
      // Đường đối soát là webhook SePay — chưa sẵn sàng thì không tạo mã.
      if (!cfg.ready || cfg.vndPerUsdt <= 0) {
        throw new ServiceUnavailableException(K.paymentMethodUnavailable);
      }
      const amountUsdt = floorUsdt(vndAmount / cfg.vndPerUsdt);
      if (amountUsdt <= 0) {
        throw new BadRequestException(K.depositAmountInvalid);
      }
      const deposit = await this.prisma.deposit.create({
        data: {
          code: await this.freshCode(),
          userId: user.id,
          mode: 'SEPAY',
          amountUsdt: new Prisma.Decimal(amountUsdt.toFixed(6)),
          vndAmount: new Prisma.Decimal(vndAmount),
          expiresAt: new Date(Date.now() + DEPOSIT_EXPIRE_MINUTES * 60_000),
        },
      });
      return {
        deposit,
        bank: {
          accountNumber: cfg.accountNumber,
          bank: cfg.bank,
          accountHolder: cfg.accountHolder,
        },
      };
    }

    // ---- crypto_bep20 / crypto_trc20 / binance_id ----
    const network: CryptoNetwork | null =
      method === 'crypto_bep20'
        ? 'BEP20'
        : method === 'crypto_trc20'
          ? 'TRC20'
          : null;
    const address =
      network !== null
        ? await this.settings.getCryptoAddress(network)
        : await this.settings.getBinanceId();
    if (address === '') {
      throw new ServiceUnavailableException(K.paymentMethodUnavailable);
    }

    const rates = await this.settings.getPublicRates();
    const base = floorUsdt(vndAmount / rates.vndPerUsdt);
    if (base <= 0) {
      throw new BadRequestException(K.depositAmountInvalid);
    }
    const amountUsdt = pickUniqueUsdt(
      base,
      await this.walletCredit.takenUsdtAmounts(),
    );
    if (amountUsdt === null) {
      // 200 khoản chờ chen chúc quanh cùng một số tiền — gần như không thể,
      // nhưng nếu xảy ra thì từ chối rõ ràng thay vì tạo mã không khớp nổi.
      this.logger.error('Hết chỗ chọn số USDT duy nhất cho mã nạp crypto');
      throw new ServiceUnavailableException(K.paymentMethodUnavailable);
    }

    const deposit = await this.prisma.deposit.create({
      data: {
        code: await this.freshCode(),
        userId: user.id,
        mode: network !== null ? 'CRYPTO' : 'BINANCE_ID',
        amountUsdt: new Prisma.Decimal(amountUsdt.toFixed(6)),
        vndAmount: new Prisma.Decimal(vndAmount),
        cryptoNetwork: network,
        cryptoAddress: address,
        expiresAt: new Date(
          Date.now() + DEPOSIT_EXPIRE_MINUTES_CRYPTO * 60_000,
        ),
      },
    });
    return { deposit, bank: null };
  }

  /** Mã NAP- chưa ai dùng — trùng thì thử lại, cùng cách với mã đơn hàng. */
  private async freshCode(): Promise<string> {
    let code = generateDepositCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const existed = await this.prisma.deposit.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!existed) break;
      code = generateDepositCode();
    }
    return code;
  }

  /** Mã nạp đang chờ tiền — cho webhook SePay đối soát. Nhận cả EXPIRED chưa
   *  được cộng: tiền đã rời tài khoản khách thì phải cộng, muộn cũng cộng.
   *  CHỈ kênh SEPAY — mã crypto có số VND chỉ để hiển thị, khớp bên này là
   *  cộng theo một con số chưa từng hứa với ai. */
  async listAwaitingDeposits(): Promise<
    { id: string; code: string; expectedVnd: number }[]
  > {
    const rows = await this.prisma.deposit.findMany({
      where: { mode: 'SEPAY', status: { in: ['PENDING', 'EXPIRED'] }, sepayRef: null },
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
   * Cộng tiền một mã nạp SePay đã khớp giao dịch — uỷ quyền xuống
   * WalletCreditService (một chỗ ghi SUCCESS duy nhất cho mọi kênh).
   */
  async creditDeposit(depositId: string, sepayRef: string): Promise<boolean> {
    return this.walletCredit.credit(depositId, { sepayRef });
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
