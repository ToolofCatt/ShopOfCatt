import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type User } from '@prisma/client';
import {
  LEGAL_PAGE_SLUGS,
  STOREFRONT_PAGE_KINDS,
  validateStorefrontDocument,
  type SetupCheckDto,
  type SetupCheckState,
  type SetupStatusDto,
  type SetupStepDto,
  type SetupStepId,
} from '@webcatt/shared';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import { AuditService } from '../audit/audit.service';
import { K } from '../i18n/messages';
import { verifySepayWebhook } from '../payments/sepay-auth';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { tgCall, type TgUser } from '../telegram/telegram-api';
import { TranslationService } from '../translation/translation.service';
import { StorefrontService } from './storefront.service';

const STEPS: SetupStepId[] = ['system', 'design', 'payments', 'channels', 'catalog', 'review'];
const DYNAMIC_MAX_AGE_MS = 15 * 60_000;
const ROLLBACK_SENTINEL = 'DIGITAL_STORE_ROLLBACK_PROBE';

interface StoredCheck extends SetupCheckDto {
  signature?: string;
}

interface CheckInput {
  step?: SetupStepId;
  runDynamic: boolean;
  stored: StoredCheck[];
}

interface BuildResult {
  status: SetupStatusDto;
  storedChecks: StoredCheck[];
}

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly binance: BinanceExchangeService,
    private readonly translation: TranslationService,
    private readonly storefront: StorefrontService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<SetupStatusDto> {
    return (await this.buildStatus({ runDynamic: false, stored: await this.readStored() })).status;
  }

  async run(actor: User, step?: SetupStepId): Promise<SetupStatusDto> {
    if (step !== undefined && !STEPS.includes(step)) throw new BadRequestException(K.adminStorefrontInvalid);
    const built = await this.buildStatus({ step, runDynamic: true, stored: await this.readStored() });
    await this.prisma.storeSetup.update({
      where: { id: 'main' },
      // `signature` chỉ lưu nội bộ để cấu hình đổi là check động thành stale;
      // DTO public loại trường này nên không lộ dấu vân tay cấu hình.
      data: { checkResults: built.storedChecks as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log(
      actor,
      'setup.check',
      { type: 'setup', id: step ?? 'all' },
      { step: step ?? 'all', pass: built.status.checks.filter((row) => row.state === 'pass').length, fail: built.status.checks.filter((row) => row.state === 'fail').length },
    );
    return built.status;
  }

  async setStep(step: SetupStepId): Promise<SetupStatusDto> {
    await this.storefront.ensureSetup();
    await this.prisma.storeSetup.update({ where: { id: 'main' }, data: { currentStep: step } });
    return this.status();
  }

  async publish(actor: User) {
    const status = await this.run(actor);
    if (!status.canPublish) throw new BadRequestException(K.adminStorefrontPublishBlocked);
    return this.storefront.publish(actor);
  }

  private async readStored(): Promise<StoredCheck[]> {
    const setup = await this.storefront.ensureSetup();
    if (!Array.isArray(setup.checkResults)) return [];
    return setup.checkResults.filter(isStoredCheck) as unknown as StoredCheck[];
  }

  private async buildStatus(input: CheckInput): Promise<BuildResult> {
    const [setup, draft, setting, readiness, legalPages, catalog, admins] = await Promise.all([
      this.storefront.ensureSetup(),
      this.storefront.getDraft(),
      this.settings.getSetting(),
      this.settings.getReadiness(),
      this.prisma.legalPage.findMany({ select: { slug: true, title: true, body: true } }),
      this.catalogCounts(),
      this.prisma.user.findMany({ where: { role: 'SUPERADMIN' }, select: { passwordChangedAt: true } }),
    ]);

    const now = new Date();
    const checks: StoredCheck[] = [];
    const add = (row: Omit<StoredCheck, 'testedAt'> & { testedAt?: string }) => {
      checks.push({ ...row, testedAt: row.testedAt ?? now.toISOString() });
    };

    const webUrl = parseHttpUrl(this.config.get<string>('WEB_URL'));
    const apiUrl = parseHttpUrl(this.config.get<string>('API_PUBLIC_URL'));
    const production = (this.config.get<string>('NODE_ENV') ?? '').trim() === 'production';
    add({ id: 'system.database', step: 'system', state: 'pass', title: 'Database và migration', detail: 'PostgreSQL phản hồi và schema setup đã sẵn sàng.' });
    const jwt = (this.config.get<string>('JWT_SECRET') ?? '').trim();
    add({ id: 'system.secret', step: 'system', state: jwt.length >= 32 ? 'pass' : 'fail', title: 'Secret hệ thống', detail: jwt.length >= 32 ? 'JWT secret riêng đã được nạp.' : 'JWT_SECRET phải có ít nhất 32 ký tự.', actionHref: '/admin/setup?step=system' });
    const domainOk = webUrl !== null && apiUrl !== null && (!production || (webUrl.protocol === 'https:' && apiUrl.protocol === 'https:'));
    add({ id: 'system.domain', step: 'system', state: domainOk ? 'pass' : 'fail', title: 'Domain, HTTPS và CORS', detail: domainOk ? `${webUrl?.origin ?? ''} / ${apiUrl?.origin ?? ''}` : 'WEB_URL và API_PUBLIC_URL phải hợp lệ; production bắt buộc HTTPS.', actionHref: '/admin/setup?step=system' });
    const timezone = (this.config.get<string>('TZ') ?? '').trim();
    const timezoneOk = validTimezone(timezone);
    add({ id: 'system.timezone', step: 'system', state: timezoneOk ? 'pass' : 'fail', title: 'Múi giờ cửa hàng', detail: timezoneOk ? timezone : 'TZ phải là tên múi giờ IANA hợp lệ, ví dụ Asia/Ho_Chi_Minh.', actionHref: '/admin/setup?step=system' });
    const passwordChanged = admins.length > 0 && admins.every((row) => row.passwordChangedAt !== null);
    add({ id: 'system.owner-password', step: 'system', state: passwordChanged ? 'pass' : 'fail', title: 'Mật khẩu chủ cửa hàng', detail: passwordChanged ? 'Mọi SUPERADMIN đã đổi mật khẩu sau khi cài.' : 'Chủ cửa hàng phải đổi mật khẩu bootstrap trước khi xuất bản.', actionHref: '/account' });
    add(await this.backupCheck(now));

    const documentValidation = validateStorefrontDocument(draft.document);
    add({ id: 'design.document', step: 'design', state: documentValidation.ok ? 'pass' : 'fail', title: 'Cấu trúc giao diện', detail: documentValidation.ok ? `Đủ ${STOREFRONT_PAGE_KINDS.length} template trang và block nghiệp vụ bắt buộc.` : documentValidation.errors.slice(0, 3).join('; '), actionHref: '/admin/design' });
    const brandReady = Boolean(draft.document.brand.logoAssetId && draft.document.brand.faviconAssetId && draft.document.brand.name.trim() !== 'Digital Store');
    add({ id: 'design.brand', step: 'design', state: brandReady ? 'pass' : 'fail', title: 'Tên, logo và favicon', detail: brandReady ? 'Nhận diện cửa hàng đã được cấu hình.' : 'Đổi tên Digital Store và tải đủ logo, favicon.', actionHref: '/admin/design' });

    const realMethods = readiness.activePaymentMethods.filter((method) => method !== 'mock');
    add({ id: 'payments.real', step: 'payments', state: realMethods.length > 0 ? 'pass' : 'fail', title: 'Phương thức thanh toán thật', detail: realMethods.length > 0 ? `Đang hoạt động: ${realMethods.join(', ')}.` : 'Cần ít nhất một phương thức thanh toán thật hoạt động.', actionHref: '/admin/settings?tab=payments' });
    add({ id: 'payments.mock', step: 'payments', state: readiness.mockActive || setting.mockEnabled ? 'fail' : 'pass', title: 'Cổng giả lập', detail: readiness.mockActive || setting.mockEnabled ? 'Tắt mock trong database và PAYMENT_MOCK trước khi xuất bản.' : 'Cổng giả lập đang tắt.', actionHref: '/admin/settings?tab=payments' });
    const webhookProbe = verifySepayWebhook({ authorization: 'Apikey invalid-probe', rawBody: '{}', apiKey: setting.sepayApiKey, webhookSecret: setting.sepayWebhookSecret, nowMs: Date.now() });
    add({ id: 'payments.webhook', step: 'payments', state: webhookProbe.ok ? 'fail' : 'pass', title: 'Webhook fail-closed', detail: webhookProbe.ok ? 'Request vô hiệu đã được chấp nhận, cần kiểm tra ngay.' : `Request vô hiệu bị từ chối đúng như mong đợi: HTTP 401 (${webhookProbe.reason}).` });
    checks.push(await this.dynamicBinance(input, hash({
      setting: setting.updatedAt.toISOString(),
      configured: this.binance.isConfigured,
      apiKey: this.config.get<string>('BINANCE_API_KEY') ?? '',
      baseUrl: this.config.get<string>('BINANCE_API_BASE_URL') ?? '',
    })));

    const supportReady = !readiness.supportChannelsMissing;
    add({ id: 'channels.support', step: 'channels', state: supportReady ? 'pass' : 'fail', title: 'Kênh hỗ trợ', detail: supportReady ? 'Khách có ít nhất một kênh liên hệ.' : 'Thêm kênh hỗ trợ trước khi mở bán.', actionHref: '/admin/settings?tab=support' });
    const completeLegal = new Set(legalPages.filter((page) => page.title.trim() && page.body.trim()).map((page) => page.slug));
    const legalReady = LEGAL_PAGE_SLUGS.every((slug) => completeLegal.has(slug));
    add({ id: 'channels.policies', step: 'channels', state: legalReady ? 'pass' : 'fail', title: 'Điều khoản và chính sách', detail: legalReady ? 'Đủ điều khoản, hoàn tiền/bảo hành và bảo mật.' : 'Soạn đủ ba trang chính sách.', actionHref: '/admin/legal' });
    checks.push(await this.dynamicTelegram(input, setting.telegramBotEnabled, setting.telegramBotToken.trim()));
    checks.push(await this.dynamicTranslation(input, hash({
      provider: setting.aiProvider,
      baseUrl: setting.aiBaseUrl,
      model: setting.aiModel,
      apiKey: setting.aiApiKey || this.config.get<string>('ANTHROPIC_API_KEY') || '',
    })));

    add({ id: 'catalog.products', step: 'catalog', state: catalog.products > 0 && catalog.variants > 0 ? 'pass' : 'fail', title: 'Sản phẩm và loại đang bán', detail: `${catalog.products} sản phẩm, ${catalog.variants} loại active.`, actionHref: '/admin/products' });
    add({ id: 'catalog.stock', step: 'catalog', state: catalog.stock > 0 ? 'pass' : 'fail', title: 'Kho có thể giao', detail: `${catalog.stock} món AVAILABLE thuộc loại đang bán.`, actionHref: '/admin/products' });
    checks.push(await this.dynamicRollback(input, catalog.signature));

    const blockersBeforeReview = checks.filter((row) => row.step !== 'review' && row.state === 'fail').length;
    const staleBeforeReview = checks.filter((row) => row.step !== 'review' && row.state === 'stale').length;
    add({ id: 'review.blockers', step: 'review', state: blockersBeforeReview === 0 && staleBeforeReview === 0 ? 'pass' : 'fail', title: 'Blocker trước khi xuất bản', detail: blockersBeforeReview === 0 && staleBeforeReview === 0 ? 'Không còn mục fail hoặc stale.' : `Còn ${blockersBeforeReview} fail và ${staleBeforeReview} stale cần xử lý.` });

    const steps = STEPS.map((step): SetupStepDto => {
      const rows = checks.filter((row) => row.step === step);
      return { id: step, passed: rows.filter((row) => row.state === 'pass').length, total: rows.length, state: aggregateState(rows.map((row) => row.state)) };
    });
    const status: SetupStatusDto = {
      setupVersion: setup.setupVersion,
      published: setup.publishedAt !== null,
      maintenanceMode: setup.maintenanceMode,
      publishedAt: setup.publishedAt?.toISOString() ?? null,
      currentStep: STEPS.includes(setup.currentStep as SetupStepId) ? setup.currentStep as SetupStepId : 'system',
      canPublish: checks.every((row) => row.state !== 'fail' && row.state !== 'stale'),
      checks: checks.map(stripStoredFields),
      steps,
    };
    return { status, storedChecks: checks };
  }

  private async dynamicBinance(input: CheckInput, signature: string): Promise<StoredCheck> {
    const id = 'payments.binance-permissions';
    if (!this.binance.isConfigured) return check(id, 'payments', 'warn', 'Quyền khóa Binance', 'Chưa dùng khóa Binance; bỏ qua nếu chỉ nhận ngân hàng.', signature);
    const cached = findUsableCached(input, id, 'payments', signature);
    if (cached) return cached;
    if (!shouldRun(input, 'payments')) return staleCheck(id, 'payments', 'Quyền khóa Binance', signature);
    try {
      const status = await this.binance.getStatus();
      const safe = status.connected === true && status.permissions?.read === true && status.permissions.withdraw === false && status.permissions.trade === false;
      return check(id, 'payments', safe ? 'pass' : 'fail', 'Quyền khóa Binance', safe ? 'Khóa kết nối được, chỉ đọc, không có quyền rút hoặc giao dịch.' : 'Khóa phải kết nối được, bật read và tắt withdraw/trade.', signature);
    } catch (error) {
      // Wizard phải trả đủ từng kết quả; sự cố API ngoài không được biến cả lần
      // kiểm tra thành HTTP 500 khiến chủ cửa hàng không biết mục nào cần sửa.
      return check(id, 'payments', 'fail', 'Quyền khóa Binance', `Không kết nối được Binance: ${safeError(error)}`, signature);
    }
  }

  private async dynamicRollback(input: CheckInput, signature: string): Promise<StoredCheck> {
    const id = 'catalog.rollback-probe';
    const cached = findUsableCached(input, id, 'catalog', signature);
    if (cached) return cached;
    if (!shouldRun(input, 'catalog')) return staleCheck(id, 'catalog', 'Thử giữ kho có rollback', signature);
    const result = await this.runStockRollbackProbe();
    return check(id, 'catalog', result.ok ? 'pass' : 'fail', 'Thử giữ kho có rollback', result.detail, signature);
  }

  private async dynamicTelegram(input: CheckInput, enabled: boolean, token: string): Promise<StoredCheck> {
    const id = 'channels.telegram';
    const signature = hash({ enabled, token });
    if (!enabled) return check(id, 'channels', 'warn', 'Telegram và tự động hóa', 'Bot Telegram đang tắt; đây là dịch vụ tùy chọn.', signature);
    if (token === '') return check(id, 'channels', 'fail', 'Telegram và tự động hóa', 'Bot đang bật nhưng thiếu token.', signature);
    const cached = findUsableCached(input, id, 'channels', signature);
    if (cached) return cached;
    if (!shouldRun(input, 'channels')) return staleCheck(id, 'channels', 'Telegram và tự động hóa', signature);
    try {
      const bot = await tgCall<TgUser>(token, 'getMe', {}, 10_000);
      return check(id, 'channels', 'pass', 'Telegram và tự động hóa', `Đã kết nối @${bot.username ?? String(bot.id)}.`, signature);
    } catch (error) {
      return check(id, 'channels', 'fail', 'Telegram và tự động hóa', `Không kết nối được Telegram: ${safeError(error)}`, signature);
    }
  }

  private async dynamicTranslation(input: CheckInput, signature: string): Promise<StoredCheck> {
    const id = 'channels.translation';
    const cached = findUsableCached(input, id, 'channels', signature);
    if (cached) return cached;
    const status = await this.translation.getStatus();
    if (!status.configured) return check(id, 'channels', 'warn', 'AI dịch nội dung', 'AI dịch đang tắt; đây là dịch vụ tùy chọn.', signature);
    if (!shouldRun(input, 'channels')) return staleCheck(id, 'channels', 'AI dịch nội dung', signature);
    const probe = await this.translation.probeConnection();
    return check(id, 'channels', probe.connected ? 'pass' : 'fail', 'AI dịch nội dung', probe.detail, signature);
  }

  private async runStockRollbackProbe(): Promise<{ ok: boolean; detail: string }> {
    const before = await this.catalogCounts();
    const target = await this.prisma.stockItem.findFirst({ where: { status: 'AVAILABLE', variant: { active: true, product: { active: true } } }, select: { id: true } });
    if (!target) return { ok: false, detail: 'Không có món AVAILABLE để thử khóa.' };
    try {
      await this.prisma.$transaction(async (tx) => {
        // Dù chưa có đơn nào, truy vấn Order vẫn phải đứng trước truy vấn StockItem
        // để mọi đường giữ khóa trong hệ thống tuân cùng một thứ tự.
        await tx.$queryRaw`SELECT "id" FROM "Order" ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT s."id" FROM "StockItem" s
          JOIN "ProductVariant" v ON v."id" = s."variantId"
          JOIN "Product" p ON p."id" = v."productId"
          WHERE s."id" = ${target.id}
            AND s."status" = 'AVAILABLE'::"StockStatus"
            AND v."active" = true AND p."active" = true
          FOR UPDATE OF s SKIP LOCKED
        `);
        if (rows.length !== 1) throw new Error('STOCK_LOCK_UNAVAILABLE');
        await tx.stockItem.updateMany({ where: { id: target.id, status: 'AVAILABLE' }, data: { status: 'RESERVED' } });
        throw new Error(ROLLBACK_SENTINEL);
      });
      return { ok: false, detail: 'Transaction thử không rollback như thiết kế.' };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) return { ok: false, detail: `Không hoàn tất phép thử khóa: ${safeError(error)}` };
    }
    const [after, restored] = await Promise.all([this.catalogCounts(), this.prisma.stockItem.findUnique({ where: { id: target.id }, select: { status: true } })]);
    const unchanged = before.orders === after.orders && before.products === after.products && before.variants === after.variants && before.stock === after.stock && restored?.status === 'AVAILABLE';
    return { ok: unchanged, detail: unchanged ? 'Đã khóa Order → StockItem bằng SKIP LOCKED; transaction rollback và số liệu không đổi.' : 'Dữ liệu sau rollback không khớp trạng thái trước khi thử.' };
  }

  private async catalogCounts() {
    const [orders, products, variants, stock, orderLatest, productLatest, variantLatest, target] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.product.count({ where: { active: true } }),
      this.prisma.productVariant.count({ where: { active: true, product: { active: true } } }),
      this.prisma.stockItem.count({ where: { status: 'AVAILABLE', variant: { active: true, product: { active: true } } } }),
      this.prisma.order.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.product.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.productVariant.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.stockItem.findFirst({ where: { status: 'AVAILABLE', variant: { active: true, product: { active: true } } }, orderBy: { id: 'asc' }, select: { id: true } }),
    ]);
    return { orders, products, variants, stock, signature: hash({ orders, products, variants, stock, orderLatest: orderLatest?.createdAt, productLatest: productLatest?.updatedAt, variantLatest: variantLatest?.updatedAt, target: target?.id }) };
  }

  private async backupCheck(now: Date): Promise<StoredCheck> {
    const path = this.config.get<string>('BACKUP_HEARTBEAT_FILE') ?? '/backups/.last-success.json';
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { completedAt?: string; file?: string };
      const completedAt = new Date(parsed.completedAt ?? '');
      const age = now.getTime() - completedAt.getTime();
      const recent = Number.isFinite(completedAt.getTime()) && age >= 0 && age <= 48 * 60 * 60_000;
      const timestamp = Number.isFinite(completedAt.getTime()) ? completedAt.toISOString() : 'invalid';
      return check('system.backup', 'system', recent ? 'pass' : 'fail', 'Backup gần nhất', recent ? `${parsed.file ?? 'pg_dump'} lúc ${timestamp}.` : 'Heartbeat backup cũ hơn 48 giờ hoặc sai định dạng.', timestamp);
    } catch {
      const production = (this.config.get<string>('NODE_ENV') ?? '') === 'production';
      return check('system.backup', 'system', production ? 'fail' : 'warn', 'Backup gần nhất', production ? 'Không đọc được heartbeat backup.' : 'Môi trường dev chưa chạy backup container.', 'missing');
    }
  }
}

function shouldRun(input: CheckInput, step: SetupStepId): boolean {
  return input.runDynamic && (input.step === undefined || input.step === step || input.step === 'review');
}

function findUsableCached(input: CheckInput, id: string, step: SetupStepId, signature: string): StoredCheck | null {
  if (shouldRun(input, step)) return null;
  const row = input.stored.find((entry) => entry.id === id);
  if (!row || row.signature !== signature || Date.now() - new Date(row.testedAt).getTime() > DYNAMIC_MAX_AGE_MS) return null;
  return row;
}

function staleCheck(id: string, step: SetupStepId, title: string, signature: string): StoredCheck {
  return check(id, step, 'stale', title, 'Kết quả chưa có hoặc cấu hình đã đổi. Chạy lại bước này.', signature);
}

function check(id: string, step: SetupStepId, state: SetupCheckState, title: string, detail: string, signature?: string): StoredCheck {
  return { id, step, state, title, detail, testedAt: new Date().toISOString(), ...(signature ? { signature } : {}) };
}

function aggregateState(states: SetupCheckState[]): SetupCheckState {
  if (states.includes('fail')) return 'fail';
  if (states.includes('stale')) return 'stale';
  if (states.includes('warn')) return 'warn';
  return 'pass';
}

function stripStoredFields(row: StoredCheck): SetupCheckDto {
  const { signature: _signature, ...dto } = row;
  return dto;
}

function parseHttpUrl(raw: string | undefined): URL | null {
  try {
    const url = new URL((raw ?? '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function validTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
}

function isStoredCheck(value: unknown): value is StoredCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.step === 'string' && typeof row.state === 'string' && typeof row.testedAt === 'string';
}
