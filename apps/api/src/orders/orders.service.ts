import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  type Coupon,
  type Order,
  type Payment,
  type Product,
  type ProductVariant,
  type User,
} from '@prisma/client';
import {
  calcDiscount,
  type CheckPaymentDto,
  type CreateOrderResponse,
  type CryptoNetwork,
  type DiscountType,
  type OrderDetailDto,
  type OrderStatus,
  type OrderSummaryDto,
  type PaymentMethod,
} from '@webcatt/shared';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import {
  matchDeposits,
  binanceNetworkToLabel,
  type BinanceDeposit,
} from '../binance-exchange/deposit-matcher';
import { generateMerchantTradeNo, generateOrderCode } from '../common/codes';
import { CouponsService } from '../coupons/coupons.service';
import { BinanceService, type BinanceCreateOrderResult } from '../payments/binance.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { FulfillmentService } from './fulfillment.service';
import { toOrderDetailDto, toOrderSummaryDto } from './order.mapper';
import { usdtToVnd } from '../payments/sepay-qr';
import { K } from '../i18n/messages';

type VariantWithProduct = ProductVariant & { product: Product };

interface ReservedItem {
  variant: VariantWithProduct;
  quantity: number;
  stockIds: string[];
}

export interface CreateOrderOptions {
  /** callback_query.id của Telegram — null/không truyền với đơn từ web. */
  telegramCallbackId?: string;
}

/** Khoản nạp được tính từ trước khi tạo đơn tối đa 10 phút (đồng bộ với matcher). */
const CRYPTO_SLACK_MS = 10 * 60_000;
/** Seed tách namespace khóa callback Telegram khỏi các advisory lock khác. */
const TELEGRAM_ORDER_LOCK_SEED = 0x43415454474f5244n;
/** Xóa các trường phiên Binance Pay khi chuyển sang phương thức khác. */
const CLEAR_PAY_SESSION = {
  prepayId: null,
  checkoutUrl: null,
  qrcodeLink: null,
  deeplink: null,
  universalUrl: null,
} as const;

/** Xóa các trường crypto khi chuyển sang phương thức khác. */
const CLEAR_CRYPTO = {
  cryptoNetwork: null,
  cryptoAddress: null,
  cryptoAmount: null,
  cryptoTxId: null,
} as const;

/** Tên hiển thị đầy đủ của một dòng đơn: "Sản phẩm – Loại". */
function fullItemName(variant: VariantWithProduct): string {
  return `${variant.product.name} – ${variant.name}`;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fulfillment: FulfillmentService,
    private readonly binance: BinanceService,
    private readonly binanceExchange: BinanceExchangeService,
    private readonly settings: SettingsService,
    private readonly coupons: CouponsService,
  ) {}

  private get expireMinutes(): number {
    const raw = this.config.get<string>('ORDER_EXPIRE_MINUTES') ?? '30';
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  /**
   * Chuyển khoản ngân hàng có hạn RIÊNG, ngắn hơn: mặc định 10 phút.
   *
   * Vì mã VietQR chốt cứng số VND theo tỉ giá lúc tạo, mà bộ đối soát
   * (`matchSepayTransaction`) đòi số tiền khớp CHÍNH XÁC. Để mã sống 30 phút là
   * mở cửa cho tình huống tỉ giá đã đổi, khách quét mã cũ, chuyển đúng số in
   * trên mã nhưng số đó không còn khớp đơn nào — tiền vào tài khoản mà đơn treo,
   * phải xử lý tay. Napas chạy 24/7 nên 10 phút là quá đủ để chuyển xong.
   */
  private get sepayExpireMinutes(): number {
    const raw = this.config.get<string>('SEPAY_EXPIRE_MINUTES') ?? '10';
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  }

  private get webUrl(): string {
    return this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  }

  private get apiPublicUrl(): string {
    return this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3001';
  }

  /**
   * Tạo đơn: giữ kho bằng FOR UPDATE SKIP LOCKED trong MỘT transaction;
   * sau khi commit mới cấu hình thanh toán theo phương thức ĐANG BẬT đầu tiên
   * (gọi mạng ngoài transaction để không giữ lock). Nếu tạo phiên Binance Pay
   * thất bại, đơn vẫn PENDING để khách chọn phương thức khác trên trang thanh toán.
   */
  async create(
    user: User,
    dto: CreateOrderDto,
    options: CreateOrderOptions = {},
  ): Promise<CreateOrderResponse> {
    const telegramCallbackId = options.telegramCallbackId?.trim() || null;
    const [methods, telegram] = await Promise.all([
      this.settings.getEnabledMethods(),
      this.settings.getTelegramConfig(),
    ]);
    if (methods.length === 0) {
      // Chủ shop chưa bật phương thức nào — báo rõ thay vì âm thầm dùng cổng giả lập.
      throw new ServiceUnavailableException(K.paymentNoMethodConfigured);
    }
    const method = methods[0].method;
    if (telegramCallbackId) {
      const replay = await this.loadTelegramReplay(
        user.id,
        telegramCallbackId,
        method === 'mock',
      );
      if (replay) return replay;
    }
    const ownerAlertQueued =
      telegram.enabled &&
      telegram.token !== '' &&
      telegram.ownerChatId !== '' &&
      telegram.ownerOrderAlertsEnabled;

    // Gộp các dòng trùng variantId để tránh khóa trùng dòng kho trong cùng transaction.
    const merged = new Map<string, number>();
    for (const item of dto.items) {
      merged.set(
        item.variantId,
        (merged.get(item.variantId) ?? 0) + item.quantity,
      );
    }

    // Kiểm tra mã giảm giá TRƯỚC transaction để báo lỗi sớm và không giữ lock
    // kho trong lúc truy vấn. Lượt dùng được giữ chỗ bên trong transaction.
    const rawCoupon = dto.couponCode?.trim() ?? '';
    let checkedCoupon: { coupon: Coupon; discountAmount: number } | null = null;
    if (rawCoupon !== '') {
      const subtotal = await this.coupons.computeSubtotal(dto.items);
      checkedCoupon = await this.coupons.validate(user.id, rawCoupon, subtotal);
    }

    let created: {
      orderId: string;
      code: string;
      total: number;
      replayed: boolean;
    };
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          if (telegramCallbackId) {
            // Khóa từ ĐẦU transaction, trước khi rút kho. Unique ở cuối chỉ
            // chống tạo trùng nhưng bên thua có thể thấy "hết hàng" giả do
            // SKIP LOCKED; advisory lock khiến nó chờ và đọc lại đơn bên thắng.
            await tx.$queryRaw`
              SELECT pg_advisory_xact_lock(
                hashtextextended(${telegramCallbackId}, ${TELEGRAM_ORDER_LOCK_SEED})
              )::text AS "locked"
            `;
            const replay = await tx.order.findUnique({
              where: { telegramCallbackId },
              select: { id: true, userId: true, code: true, totalAmount: true },
            });
            if (replay) {
              if (replay.userId !== user.id) {
                throw new BadRequestException(K.orderNotFound);
              }
              return {
                orderId: replay.id,
                code: replay.code,
                total: Number(replay.totalAmount),
                replayed: true,
              };
            }
          }

          await this.fulfillment.releaseExpiredOrders(tx);

          const reservedItems: ReservedItem[] = [];
          for (const [variantId, quantity] of merged) {
            const variant = await tx.productVariant.findFirst({
              where: { id: variantId, active: true, product: { active: true } },
              include: { product: true },
            });
            if (!variant) {
              throw new NotFoundException(K.variantNotFound);
            }
            const stockIds = await this.fulfillment.lockAvailableStock(
              tx,
              variant.id,
              quantity,
            );
            if (stockIds.length < quantity) {
              const remaining = await tx.stockItem.count({
                where: { variantId: variant.id, status: 'AVAILABLE' },
              });
              throw new BadRequestException({
                key: K.orderInsufficientStock,
                params: { name: fullItemName(variant), remaining },
              });
            }
            reservedItems.push({ variant, quantity, stockIds });
          }

          let subtotalAmount = new Prisma.Decimal(0);
          for (const item of reservedItems) {
            subtotalAmount = subtotalAmount.add(
              item.variant.price.mul(item.quantity),
            );
          }

          // Áp mã giảm giá: giữ chỗ một lượt (nguyên tử) rồi tính lại số tiền
          // giảm trên đúng tiền hàng vừa chốt trong transaction này.
          let discountAmount = new Prisma.Decimal(0);
          let couponId: string | null = null;
          let couponCode: string | null = null;
          if (checkedCoupon) {
            const { coupon } = checkedCoupon;
            const subtotal = Number(subtotalAmount);
            if (subtotal < Number(coupon.minAmount)) {
              throw new BadRequestException({
                key: K.couponMinAmount,
                params: { min: Number(coupon.minAmount).toFixed(2) },
              });
            }
            await this.coupons.reserve(tx, coupon);
            discountAmount = new Prisma.Decimal(
              calcDiscount(
                subtotal,
                coupon.type as DiscountType,
                Number(coupon.value),
              ),
            );
            couponId = coupon.id;
            couponCode = coupon.code;
          }
          const totalAmount = subtotalAmount.sub(discountAmount);

          const code = await this.generateUniqueOrderCode(tx);
          const expiresAt = new Date(Date.now() + this.expireMinutes * 60_000);

          const order = await tx.order.create({
            data: {
              code,
              userId: user.id,
              status: 'PENDING',
              subtotalAmount,
              discountAmount,
              totalAmount,
              couponId,
              couponCode,
              currency: 'USDT',
              expiresAt,
              telegramCallbackId,
              // Tắt/chưa cấu hình thì đánh dấu ngay để lần bật sau không dội lại
              // toàn bộ đơn lịch sử như thể vừa mới phát sinh.
              telegramOwnerNewOrderNotifiedAt: ownerAlertQueued
                ? null
                : new Date(),
            },
          });

          for (const item of reservedItems) {
            const orderItem = await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: item.variant.productId,
                variantId: item.variant.id,
                productName: item.variant.product.name,
                variantName: item.variant.name,
                unitPrice: item.variant.price,
                quantity: item.quantity,
              },
            });
            await tx.stockItem.updateMany({
              where: { id: { in: item.stockIds } },
              data: { status: 'RESERVED', orderItemId: orderItem.id },
            });
          }

          // merchantTradeNo luôn được sinh; mode được cấu hình lại sau khi commit.
          const merchantTradeNo = generateMerchantTradeNo(code);
          await tx.payment.create({
            data: {
              orderId: order.id,
              provider: 'BINANCE_PAY',
              mode: 'MOCK',
              merchantTradeNo,
              amount: totalAmount,
              currency: 'USDT',
              status: 'PENDING',
            },
          });

          return {
            orderId: order.id,
            code,
            total: Number(totalAmount),
            replayed: false,
          };
        },
        // Callback trùng cố ý xếp hàng ở advisory lock; maxWait mặc định 2s
        // có thể làm bên chờ vỡ trước khi được đọc lại đơn bên thắng.
        { maxWait: 15_000, timeout: 15_000 },
      );
    } catch (error) {
      /*
       * Hai tiến trình hiếm khi cùng nhận một update: unique callback là trọng
       * tài. Bên thua đọc lại đơn bên thắng, không chạy lại giữ kho.
       */
      if (
        telegramCallbackId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.waitForTelegramReplay(
          user.id,
          telegramCallbackId,
          method === 'mock',
        );
        if (replay) return replay;
      }
      throw error;
    }

    if (created.replayed && telegramCallbackId) {
      const replay = await this.waitForTelegramReplay(
        user.id,
        telegramCallbackId,
        method === 'mock',
      );
      if (replay) return replay;
      throw new InternalServerErrorException(K.paymentSessionMissing);
    }

    if (created.total <= 0) {
      // Mã giảm 100%: không có gì để thanh toán → giao hàng ngay.
      await this.fulfillment.markPaidAndDeliver({ orderId: created.orderId });
    } else {
      // Cấu hình phương thức sau khi commit (Binance Pay/crypto cần gọi mạng/DB thêm).
      await this.applyPaymentMethod(created.orderId, method);
    }

    const detail = await this.loadOwnDetail(user.id, created.code);
    if (!detail.payment) {
      throw new InternalServerErrorException(K.paymentSessionMissing);
    }
    return { order: detail, payment: detail.payment };
  }

  private async loadTelegramReplay(
    userId: string,
    callbackId: string,
    allowMock = true,
  ): Promise<CreateOrderResponse | null> {
    const existed = await this.prisma.order.findUnique({
      where: { telegramCallbackId: callbackId },
      select: { userId: true, code: true },
    });
    if (!existed) return null;
    if (existed.userId !== userId) {
      throw new BadRequestException(K.orderNotFound);
    }
    const detail = await this.loadOwnDetail(userId, existed.code);
    if (!detail.payment) {
      throw new InternalServerErrorException(K.paymentSessionMissing);
    }
    // Payment được tạo MOCK làm placeholder ngay trong transaction giữ kho;
    // phương thức thật được cấu hình sau commit. Callback đua nhau phải chờ
    // bước đó xong, không được đem placeholder ra hướng dẫn khách.
    if (!allowMock && detail.payment.mode === 'MOCK') return null;
    return { order: detail, payment: detail.payment };
  }

  private async waitForTelegramReplay(
    userId: string,
    callbackId: string,
    allowMock: boolean,
  ): Promise<CreateOrderResponse | null> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const replay = await this.loadTelegramReplay(
        userId,
        callbackId,
        allowMock,
      );
      if (replay) return replay;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        timer.unref?.();
      });
    }
    return null;
  }

  /**
   * Đổi phương thức thanh toán trên trang thanh toán — chỉ với đơn PENDING
   * và phương thức đang bật.
   */
  async selectPayment(
    userId: string,
    code: string,
    method: PaymentMethod,
  ): Promise<OrderDetailDto> {
    await this.fulfillment.releaseExpiredOrders();
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException(K.orderCannotCancel);
    }

    const methods = await this.settings.getEnabledMethods();
    if (!methods.some((m) => m.method === method)) {
      throw new BadRequestException(K.paymentMethodUnavailable);
    }

    await this.applyPaymentMethod(order.id, method);
    return this.loadOwnDetail(userId, code);
  }

  async listOwn(userId: string): Promise<OrderSummaryDto[]> {
    await this.fulfillment.releaseExpiredOrders();
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { productName: true } } },
    });
    return orders.map((order) => toOrderSummaryDto(order));
  }

  async getOwnDetail(userId: string, code: string): Promise<OrderDetailDto> {
    await this.fulfillment.releaseExpiredOrders();
    return this.loadOwnDetail(userId, code);
  }

  /**
   * Kiểm tra thanh toán: mode BINANCE → truy vấn trạng thái từ Binance Pay;
   * mode CRYPTO → đối soát lịch sử nạp on-chain; mode MOCK → chỉ trả về
   * trạng thái hiện tại (endpoint mock/confirm mới là nơi chuyển trạng thái).
   */
  async checkPayment(userId: string, code: string): Promise<CheckPaymentDto> {
    await this.fulfillment.releaseExpiredOrders();
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      include: { payment: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }

    if (order.status === 'PENDING' && order.payment?.mode === 'BINANCE') {
      let gatewayStatus = '';
      try {
        gatewayStatus = await this.binance.queryOrderStatus(
          order.payment.merchantTradeNo,
        );
      } catch (error) {
        this.logger.warn(
          `Không truy vấn được trạng thái Binance cho đơn ${code}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (gatewayStatus === 'PAID') {
        await this.fulfillment.markPaidAndDeliver({ orderId: order.id });
      } else if (gatewayStatus === 'CANCELED' || gatewayStatus === 'EXPIRED') {
        await this.fulfillment.expireOrder(order.id);
      }
    } else if (order.status === 'PENDING' && order.payment?.mode === 'CRYPTO') {
      await this.reconcileCryptoOrder(order);
    }

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    const status: OrderStatus = fresh?.status ?? order.status;
    return { status, delivered: status === 'DELIVERED' };
  }

  /**
   * Khách tự nộp TxID sau khi chuyển USDT — xác minh với lịch sử nạp Binance:
   * đúng mạng, đúng số tiền, chưa được dùng cho đơn khác.
   */
  async submitTx(
    userId: string,
    code: string,
    txId: string,
  ): Promise<CheckPaymentDto> {
    await this.fulfillment.releaseExpiredOrders();
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      include: { payment: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException(K.orderCannotCancel);
    }
    const payment = order.payment;
    if (!payment || payment.mode !== 'CRYPTO' || !payment.cryptoNetwork) {
      throw new BadRequestException(K.paymentMethodUnavailable);
    }

    let deposit: BinanceDeposit | null = null;
    if (this.binanceExchange.isConfigured) {
      try {
        deposit = await this.binanceExchange.findDepositByTxId(txId.trim());
      } catch (error) {
        this.logger.warn(
          `Không tra cứu được TxID cho đơn ${code}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    // Chưa thấy hoặc chưa được ghi có thành công (status !== 1) → coi như chưa tìm thấy.
    if (!deposit || deposit.status !== 1) {
      throw new BadRequestException(K.paymentTxNotFound);
    }
    if (binanceNetworkToLabel(deposit.network) !== payment.cryptoNetwork) {
      throw new BadRequestException(K.paymentTxNetworkMismatch);
    }

    // Dùng ĐÚNG bộ khớp tự động thay vì luật riêng: cùng mạng, đúng số tiền duy
    // nhất (sai số 0.00005 = nửa bước 0.0001), và khoản nạp phải đến SAU khi đơn
    // được tạo. Trước đây nhánh "deposit.amount >= total" cho phép khai bất kỳ
    // khoản nạp nào lớn hơn tiền đơn — kể cả tiền của khách khác.
    const usedTxIds = await this.getUsedTxIds([deposit.txId]);
    // Phân biệt rõ hai lý do bị từ chối: đã có đơn khác nhận khoản nạp này,
    // hay số tiền/thời điểm không khớp. Gộp chung làm khách hiểu nhầm.
    if (usedTxIds.has(deposit.txId)) {
      throw new BadRequestException(K.paymentTxAlreadyUsed);
    }
    const matched = matchDeposits(
      [
        {
          orderId: order.id,
          network: payment.cryptoNetwork as CryptoNetwork,
          expected: Number(payment.cryptoAmount ?? order.totalAmount),
          createdAtMs: order.createdAt.getTime(),
        },
      ],
      [deposit],
      usedTxIds,
      { slackMs: CRYPTO_SLACK_MS },
    );
    if (matched.length === 0) {
      throw new BadRequestException(K.paymentTxAmountMismatch);
    }

    return this.claimDeposit(order.id, payment.id, deposit.txId);
  }

  async cancel(userId: string, code: string): Promise<{ status: OrderStatus }> {
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      include: { items: { select: { id: true } } },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }

    if (order.status !== 'PENDING') {
      throw new BadRequestException(K.orderCannotCancel);
    }
    // Dùng chung đường huỷ với admin: ngoài nhả kho nó còn TRẢ LẠI lượt dùng mã
    // giảm giá. Bản chép tay trước đây thiếu bước đó, nên đặt–huỷ lặp lại là làm
    // cạn một mã khuyến mãi có giới hạn.
    await this.fulfillment.cancelOrderInternal(order.id);

    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    if (fresh?.status !== 'CANCELLED') {
      throw new BadRequestException(K.orderCannotCancel);
    }
    return { status: 'CANCELLED' };
  }

  /**
   * Đặt lại hạn thanh toán theo phương thức khách vừa chọn, trả về hạn mới.
   *
   * Mốc luôn tính từ `createdAt`, KHÔNG từ thời điểm gọi — nếu tính từ "bây giờ"
   * thì khách bấm qua lại giữa các phương thức là gia hạn đơn vô thời hạn, giữ
   * kho mãi không nhả. Hạn của chuyển khoản ngân hàng lấy cái nào đến trước giữa
   * "createdAt + 30 phút" và "bây giờ + 10 phút", nên đổi sang ngân hàng chỉ có
   * thể làm hạn NGẮN đi.
   *
   * Rời ngân hàng sang phương thức khác thì hạn quay về createdAt + 30 phút:
   * mốc đó cố định nên vẫn không có cách nào xin thêm giờ.
   */
  private async apDungHan(
    orderId: string,
    createdAt: Date,
    method: PaymentMethod,
  ): Promise<Date> {
    const han = tinhHanThanhToan({
      taoLucMs: createdAt.getTime(),
      bayGioMs: Date.now(),
      method,
      phutMacDinh: this.expireMinutes,
      phutNganHang: this.sepayExpireMinutes,
    });
    // Có điều kiện trạng thái: một lần gọi lại muộn không được hồi sinh đơn đã
    // hết hạn, đã hủy hay đã trả tiền.
    await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { expiresAt: han },
    });
    return han;
  }

  /**
   * Cấu hình lại Payment của một đơn theo phương thức đã chọn — dùng chung
   * cho tạo đơn và đổi phương thức trên trang thanh toán.
   */
  private async applyPaymentMethod(
    orderId: string,
    method: PaymentMethod,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true, items: true },
    });
    if (!order || !order.payment) {
      throw new InternalServerErrorException(K.paymentSessionMissing);
    }
    const payment = order.payment;

    // Chốt hạn TRƯỚC khi dựng phiên: nhánh binance_pay đọc lại `hetHan` để báo
    // cho Binance, nên nó phải là giá trị sau khi đã điều chỉnh.
    const hetHan = await this.apDungHan(order.id, order.createdAt, method);

    if (method === 'mock') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          mode: 'MOCK',
          ...CLEAR_PAY_SESSION,
          ...CLEAR_CRYPTO,
        },
      });
      return;
    }

    if (method === 'binance_pay') {
      // Phiên cũ còn nguyên → dùng lại, không tạo phiên trùng merchantTradeNo.
      if (payment.mode === 'BINANCE' && payment.checkoutUrl) {
        return;
      }
      // Tạo phiên với merchantTradeNo MỚI — Binance từ chối mã đã dùng cho
      // phiên trước đó (trường hợp khách đổi qua lại giữa các phương thức).
      const merchantTradeNo = generateMerchantTradeNo(order.code);
      let session: BinanceCreateOrderResult;
      try {
        session = await this.binance.createOrder({
          merchantTradeNo,
          orderAmount: Number(order.totalAmount),
          currency: 'USDT',
          description: `Đơn hàng ${order.code}`,
          goods: order.items.map((item) => ({
            productId: item.productId,
            name: item.variantName
              ? `${item.productName} – ${item.variantName}`
              : item.productName,
            unitPrice: Number(item.unitPrice),
          })),
          returnUrl: `${this.webUrl}/orders/${order.code}`,
          cancelUrl: `${this.webUrl}/checkout/${order.code}`,
          webhookUrl: `${this.apiPublicUrl}/api/payments/binance/webhook`,
          orderExpireTime: hetHan.getTime(),
        });
      } catch (error) {
        // KHÔNG hủy đơn — đơn vẫn PENDING để khách chọn phương thức khác.
        this.logger.error(
          `Tạo phiên Binance Pay thất bại cho đơn ${order.code}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw new BadGatewayException(K.paymentSessionFailed);
      }
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          mode: 'BINANCE',
          merchantTradeNo,
          prepayId: session.prepayId,
          checkoutUrl: session.checkoutUrl,
          qrcodeLink: session.qrcodeLink,
          deeplink: session.deeplink,
          universalUrl: session.universalUrl,
          ...CLEAR_CRYPTO,
        },
      });
      return;
    }

    if (method === 'binance_id') {
      const binanceId = await this.settings.getBinanceId();
      if (binanceId === '') {
        throw new BadRequestException(K.paymentMethodUnavailable);
      }
      /*
       * Số tiền ĐÚNG BẰNG giá bán, không thêm phần lẻ.
       *
       * Đổi lại, số tiền một mình không còn chỉ ra được đơn nào: khách phải ghi
       * MÃ ĐƠN vào phần ghi chú khi chuyển. Không ghi thì bộ đối soát chỉ dám
       * khớp khi đúng một đơn chờ cùng số tiền — xem `matchPayTransfers`.
       */
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          mode: 'BINANCE_ID',
          cryptoNetwork: null,
          cryptoAddress: binanceId,
          cryptoAmount: new Prisma.Decimal(
            Number(order.totalAmount).toFixed(6),
          ),
          cryptoTxId: null,
          ...CLEAR_PAY_SESSION,
        },
      });
      return;
    }

    if (method === 'sepay') {
      const cauHinh = await this.settings.getSepayConfig();
      if (!cauHinh.ready) {
        throw new BadRequestException(K.paymentSepayNotReady);
      }
      /*
       * Số VND được CHỐT ở đây, không tính lại về sau.
       *
       * Tỉ giá do chủ shop đặt và có thể đổi bất cứ lúc nào; nếu trang thanh
       * toán tính lại theo tỉ giá hiện tại thì khách đang xem một số, chuyển
       * xong lại bị đối chiếu với số khác, và đơn treo.
       */
      const vnd = usdtToVnd(Number(order.totalAmount), cauHinh.vndPerUsdt);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          mode: 'SEPAY',
          cryptoNetwork: null,
          // Chụp lại nơi nhận tiền: đổi tài khoản sau đó thì đơn đang chờ vẫn
          // trỏ đúng chỗ đã báo khách.
          cryptoAddress: cauHinh.accountNumber,
          sepayBank: cauHinh.bank,
          vndAmount: new Prisma.Decimal(vnd),
          cryptoAmount: new Prisma.Decimal(
            Number(order.totalAmount).toFixed(6),
          ),
          cryptoTxId: null,
          sepayRef: null,
          ...CLEAR_PAY_SESSION,
        },
      });
      return;
    }

    // crypto_bep20 / crypto_trc20
    const network: CryptoNetwork =
      method === 'crypto_bep20' ? 'BEP20' : 'TRC20';
    const address = await this.settings.getCryptoAddress(network);
    if (address === '') {
      throw new BadRequestException(K.paymentMethodUnavailable);
    }

    /*
     * Số tiền ĐÚNG BẰNG giá bán, không thêm phần lẻ.
     *
     * Giao dịch on-chain không có chỗ ghi chú, nên khi hai khách cùng mua một
     * sản phẩm thì hai khoản nạp giống hệt nhau và hệ thống KHÔNG tự phân biệt
     * được. Khách dán TxID để chỉ rõ khoản nào của mình; bộ đối soát nền chỉ tự
     * khớp khi đúng một đơn chờ cùng số tiền.
     */
    const amount = Number(order.totalAmount);

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        mode: 'CRYPTO',
        cryptoNetwork: network,
        cryptoAddress: address,
        cryptoAmount: new Prisma.Decimal(amount.toFixed(6)),
        cryptoTxId: null,
        ...CLEAR_PAY_SESSION,
      },
    });
  }

  /**
   * Đối soát một đơn CRYPTO đang chờ với lịch sử nạp USDT trên Binance.
   * KHÔNG BAO GIỜ ném lỗi — lỗi mạng/API chỉ ghi log, trạng thái giữ nguyên.
   */
  private async reconcileCryptoOrder(
    order: Order & { payment: Payment | null },
  ): Promise<void> {
    const payment = order.payment;
    if (!payment || !payment.cryptoNetwork || payment.cryptoAmount === null) {
      return;
    }
    if (!this.binanceExchange.isConfigured) return;

    try {
      // TxID đã được ghi nhận (submit-tx/poller) nhưng đơn chưa chuyển trạng thái
      // (tiến trình bị ngắt giữa chừng) → chỉ cần giao hàng lại.
      if (payment.cryptoTxId) {
        await this.fulfillment.markPaidAndDeliver({ orderId: order.id });
        return;
      }

      const deposits = await this.binanceExchange.listUsdtDeposits(
        order.createdAt.getTime() - CRYPTO_SLACK_MS,
      );
      const usedTxIds = await this.getUsedTxIds(deposits.map((d) => d.txId));
      const matches = matchDeposits(
        [
          {
            orderId: order.id,
            network: payment.cryptoNetwork as CryptoNetwork,
            expected: Number(payment.cryptoAmount),
            createdAtMs: order.createdAt.getTime(),
          },
        ],
        deposits,
        usedTxIds,
      );
      const match = matches[0];
      if (!match) return;

      await this.claimDeposit(order.id, payment.id, match.txId);
      this.logger.log(
        `Đã khớp nạp crypto cho đơn ${order.code}: ${match.amount} USDT (${match.network}, tx ${match.txId})`,
      );
    } catch (error) {
      this.logger.warn(
        `Đối soát crypto thất bại cho đơn ${order.code}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Gán một khoản nạp cho đơn rồi giao hàng.
   *
   * Việc "TxID này đã dùng chưa" do RÀNG BUỘC `Payment.cryptoTxId @unique` quyết
   * định, không phải bằng một lần đọc trước đó: hai request song song cùng khai
   * một TxID sẽ có đúng một request ghi được, request còn lại nhận lỗi P2002.
   * Kiểm tra bằng `findFirst` rồi mới ghi là chỗ hở kinh điển (TOCTOU).
   */
  private async claimDeposit(
    orderId: string,
    paymentId: string,
    txId: string,
  ): Promise<CheckPaymentDto> {
    try {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { cryptoTxId: txId, status: 'SUCCESS' },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(K.paymentTxAlreadyUsed);
      }
      throw error;
    }
    const result = await this.fulfillment.markPaidAndDeliver({ orderId });
    return {
      status: result?.status ?? 'PAID',
      delivered: result?.delivered ?? false,
    };
  }

  /**
   * Trong `txIds`, những TxID đã được một đơn khác nhận — mỗi khoản nạp chỉ được
   * tính cho MỘT đơn.
   *
   * Chỉ tra đúng các TxID đang xét. Trước đây hàm này tải TOÀN BỘ cryptoTxId của
   * mọi đơn ở mỗi lần khách bấm "tôi đã chuyển", nên chi phí một request tăng
   * mãi theo số đơn crypto đã bán. `matchDeposits` cũng chỉ hỏi tới các TxID nằm
   * trong danh sách truyền vào, nên thu hẹp thế này là tương đương.
   *
   * Hàng rào chống dùng lại thật sự vẫn là ràng buộc `Payment.cryptoTxId @unique`
   * lúc ghi — đây chỉ để báo lỗi cho khách sớm và rõ ràng.
   */
  private async getUsedTxIds(txIds: string[]): Promise<Set<string>> {
    if (txIds.length === 0) return new Set();
    // Soát CẢ bảng Deposit: một khoản nạp đã cộng ví thì không được đem khai
    // cho đơn nữa (và ngược lại) — một khoản tiền chỉ đổi được một thứ.
    const [donRows, napRows] = await Promise.all([
      this.prisma.payment.findMany({
        where: { cryptoTxId: { in: txIds } },
        select: { cryptoTxId: true },
      }),
      this.prisma.deposit.findMany({
        where: { cryptoTxId: { in: txIds } },
        select: { cryptoTxId: true },
      }),
    ]);
    return new Set(
      [...donRows, ...napRows].map((row) => row.cryptoTxId as string),
    );
  }

  private async loadOwnDetail(
    userId: string,
    code: string,
  ): Promise<OrderDetailDto> {
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            stockItems: { orderBy: { createdAt: 'asc' } },
            product: { select: { slug: true } },
          },
        },
        payment: true,
      },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    return toOrderDetailDto(order);
  }

  private async generateUniqueOrderCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateOrderCode();
      const existing = await tx.order.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new InternalServerErrorException(K.orderCodeFailed);
  }
}

/**
 * Hạn thanh toán của một đơn, theo phương thức khách vừa chọn.
 *
 * Hàm THUẦN, tách riêng để kiểm được: nó quyết định kho bị giữ bao lâu, nên một
 * phép so sánh ngược dấu ở đây là đơn treo giữ kho vô hạn.
 */
export function tinhHanThanhToan(opts: {
  taoLucMs: number;
  bayGioMs: number;
  method: PaymentMethod;
  phutMacDinh: number;
  phutNganHang: number;
}): Date {
  // TRẦN cứng tính từ lúc tạo đơn. Mọi phương thức đều không vượt được mốc này,
  // nên bấm qua lại giữa các phương thức không bao giờ xin thêm được thời gian.
  const tran = opts.taoLucMs + opts.phutMacDinh * 60_000;
  if (opts.method !== 'sepay') {
    return new Date(tran);
  }
  const nganHan = opts.bayGioMs + opts.phutNganHang * 60_000;
  return new Date(Math.min(tran, nganHan));
}
