'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type KeyboardEvent } from 'react';
import { Check, ChevronRight, CircleAlert, CircleDashed, Database, LayoutTemplate, RadioTower, Rocket, ShoppingBasket, WalletCards } from 'lucide-react';
import type { SetupCheckDto, SetupCheckState, SetupStatusDto, SetupStepId } from '@webcatt/shared';
import { PageHeader } from '@/components/admin/page-header';
import { Badge, Button, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

const STEPS: Array<{ id: SetupStepId; vi: string; en: string; zh: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'system', vi: 'Hệ thống & cửa hàng', en: 'System & store', zh: '系统与商店', icon: Database },
  { id: 'design', vi: 'Thương hiệu & giao diện', en: 'Brand & design', zh: '品牌与界面', icon: LayoutTemplate },
  { id: 'payments', vi: 'Thanh toán', en: 'Payments', zh: '支付', icon: WalletCards },
  { id: 'channels', vi: 'Kênh & tự động hóa', en: 'Channels & automation', zh: '渠道与自动化', icon: RadioTower },
  { id: 'catalog', vi: 'Sản phẩm & kho', en: 'Catalog & stock', zh: '商品与库存', icon: ShoppingBasket },
  { id: 'review', vi: 'Kiểm tra & xuất bản', en: 'Review & publish', zh: '检查与发布', icon: Rocket },
];

export default function SetupPage() {
  return <Suspense fallback={<div className="flex min-h-80 items-center justify-center"><Spinner className="h-6 w-6" /></div>}><SetupContent /></Suspense>;
}

function SetupContent() {
  const { token, user } = useAuth();
  const { locale, t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('step');
  const active: SetupStepId = STEPS.some((step) => step.id === requested) ? requested as SetupStepId : 'system';
  const [status, setStatus] = useState<SetupStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setStatus(await apiFetch<SetupStatusDto>('/admin/setup', { token, locale }));
    } catch (err) { setError(apiErrorMessage(err, t.common.connectionError)); }
  }, [locale, t.common.connectionError, token]);

  useEffect(() => { void load(); }, [load]);

  const selectStep = async (step: SetupStepId) => {
    router.replace(`/admin/setup?step=${step}`, { scroll: false });
    if (token && user?.role === 'SUPERADMIN') {
      apiFetch('/admin/setup/step', { method: 'PATCH', token, locale, body: { step } }).catch(() => undefined);
    }
  };

  const moveStepFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keyIndex = event.key === 'Home' ? 0 : event.key === 'End' ? STEPS.length - 1 : event.key === 'ArrowRight' ? (index + 1) % STEPS.length : event.key === 'ArrowLeft' ? (index - 1 + STEPS.length) % STEPS.length : -1;
    if (keyIndex < 0) return;
    event.preventDefault();
    const target = STEPS[keyIndex];
    void selectStep(target.id);
    window.requestAnimationFrame(() => document.getElementById(`setup-tab-${target.id}`)?.focus());
  };

  const run = async (scope: SetupStepId | 'all') => {
    if (!token) return;
    setRunning(scope);
    try {
      setStatus(await apiFetch<SetupStatusDto>(`/admin/setup/check/${scope}`, { method: 'POST', token, locale }));
      setError(null);
    } catch (err) { setError(apiErrorMessage(err, t.common.connectionError)); }
    finally { setRunning(null); }
  };

  const publish = async () => {
    if (!token) return;
    setRunning('publish');
    try {
      await apiFetch('/admin/setup/publish', { method: 'POST', token, locale });
      await load();
      router.refresh();
    } catch (err) { setError(apiErrorMessage(err, t.common.connectionError)); }
    finally { setRunning(null); }
  };

  if (error && !status) return <EmptyState icon={CircleAlert} title={error} action={<Button onClick={() => void load()}>{t.common.retry}</Button>} />;
  if (!status) return <div className="flex min-h-80 items-center justify-center"><Spinner className="h-6 w-6 text-neutral-400" /></div>;

  const current = STEPS.find((step) => step.id === active) ?? STEPS[0];
  const checks = status.checks.filter((check) => check.step === active);
  const completed = status.steps.filter((step) => step.state === 'pass').length;
  const next = STEPS[STEPS.findIndex((step) => step.id === active) + 1];
  const labels = copy(locale);

  return (
    <div className="pb-24">
      <PageHeader
        title={labels.title}
        description={labels.subtitle}
        actions={<Badge variant={status.published ? 'success' : 'outline'}>{status.published ? labels.published : labels.maintenance}</Badge>}
      />

      <div className="mb-8 overflow-x-auto border-b border-neutral-200 [scrollbar-width:none]">
        <div role="tablist" aria-label={labels.title} className="flex min-w-max">
          {STEPS.map((step, index) => {
            const state = status.steps.find((entry) => entry.id === step.id)?.state ?? 'stale';
            const selected = step.id === active;
            const Icon = step.icon;
            return (
              <button key={step.id} id={`setup-tab-${step.id}`} role="tab" aria-controls={`setup-panel-${step.id}`} aria-selected={selected} tabIndex={selected ? 0 : -1} onKeyDown={(event) => moveStepFocus(event, index)} onClick={() => void selectStep(step.id)} className={cn('relative flex min-w-40 cursor-pointer items-center gap-2.5 px-3 py-4 text-left text-sm transition-colors', selected ? 'text-neutral-950' : 'text-neutral-500 hover:text-neutral-950')}>
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-md border text-xs font-semibold', stateClass(state))}>{state === 'pass' ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
                <span><span className="block text-[11px] text-neutral-400">{labels.step} {index + 1}</span><span className="whitespace-nowrap font-medium">{step[locale]}</span></span>
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-neutral-950" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section id={`setup-panel-${active}`} role="tabpanel" aria-labelledby={`setup-tab-${active}`}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-medium uppercase text-neutral-400">{completed}/6 {labels.stepsComplete}</p><h2 className="mt-1 text-xl font-semibold">{current[locale]}</h2></div>
            <Button variant="outline" loading={running === active} onClick={() => void run(active)}>{labels.checkStep}</Button>
          </div>
          <div className="divide-y divide-neutral-200 border-y border-neutral-200 bg-white">
            {checks.map((check) => <CheckRow key={check.id} check={check} locale={locale} />)}
          </div>
          <StepActions step={active} locale={locale} />
        </section>

        <aside className="space-y-5 border-l border-neutral-200 pl-6">
          <div><p className="text-xs font-semibold uppercase text-neutral-400">{labels.progress}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200"><div className="h-full bg-neutral-950 transition-all" style={{ width: `${completed / 6 * 100}%` }} /></div><p className="mt-2 text-sm text-neutral-600">{completed}/6 {labels.stepsReady}</p></div>
          <div className="border-t border-neutral-200 pt-5"><p className="text-sm font-medium">{labels.publishRule}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{labels.publishHint}</p></div>
          {error && <p role="alert" className="border-l-2 border-red-500 pl-3 text-sm text-red-600">{error}</p>}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="hidden text-sm text-neutral-500 sm:block">{status.canPublish ? labels.ready : labels.notReady}</p>
          <div className="ml-auto flex gap-2">
            {next && <Button variant="outline" onClick={() => void selectStep(next.id)}>{labels.next}<ChevronRight className="h-4 w-4" /></Button>}
            {active === 'review' && <Button variant="outline" loading={running === 'all'} onClick={() => void run('all')}>{labels.runAll}</Button>}
            {active === 'review' && <Button loading={running === 'publish'} disabled={!status.canPublish} onClick={() => void publish()}><Rocket className="h-4 w-4" />{labels.publish}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ check, locale }: { check: SetupCheckDto; locale: 'vi' | 'en' | 'zh' }) {
  const Icon = check.state === 'pass' ? Check : check.state === 'stale' ? CircleDashed : CircleAlert;
  const localized = localizeCheck(check, locale);
  return <div className="grid gap-3 px-1 py-4 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]"><Icon className={cn('mt-0.5 h-4 w-4', check.state === 'pass' ? 'text-emerald-600' : check.state === 'warn' ? 'text-amber-600' : check.state === 'stale' ? 'text-neutral-400' : 'text-red-600')} /><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-neutral-950">{localized.title}</p><span className={cn('text-[10px] font-semibold uppercase', check.state === 'pass' ? 'text-emerald-700' : check.state === 'warn' ? 'text-amber-700' : check.state === 'stale' ? 'text-neutral-500' : 'text-red-700')}>{check.state}</span></div><p className="mt-1 text-sm leading-5 text-neutral-500">{localized.detail}</p><p className="mt-1 text-[11px] text-neutral-400">{new Date(check.testedAt).toLocaleString(locale === 'vi' ? 'vi-VN' : locale === 'zh' ? 'zh-CN' : 'en-US')}</p></div>{check.actionHref && <Link href={check.actionHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{locale === 'vi' ? 'Khắc phục' : locale === 'zh' ? '处理' : 'Fix'}</Link>}</div>;
}

const CHECK_TITLES: Record<string, { en: string; zh: string }> = {
  'system.database': { en: 'Database and migrations', zh: '数据库与迁移' },
  'system.secret': { en: 'System secrets', zh: '系统密钥' },
  'system.domain': { en: 'Domain, HTTPS and CORS', zh: '域名、HTTPS 与 CORS' },
  'system.timezone': { en: 'Store timezone', zh: '商店时区' },
  'system.owner-password': { en: 'Store owner password', zh: '店主密码' },
  'system.backup': { en: 'Latest backup', zh: '最近备份' },
  'design.document': { en: 'Storefront document', zh: '店面文档' },
  'design.brand': { en: 'Name, logo and favicon', zh: '名称、Logo 与图标' },
  'payments.real': { en: 'Real payment methods', zh: '真实支付方式' },
  'payments.mock': { en: 'Mock gateway', zh: '模拟支付网关' },
  'payments.webhook': { en: 'Fail-closed webhook', zh: 'Webhook 失败关闭' },
  'payments.binance-permissions': { en: 'Binance API permissions', zh: 'Binance API 权限' },
  'channels.support': { en: 'Support channels', zh: '支持渠道' },
  'channels.policies': { en: 'Terms and policies', zh: '条款与政策' },
  'channels.telegram': { en: 'Telegram and automation', zh: 'Telegram 与自动化' },
  'channels.translation': { en: 'AI translation', zh: 'AI 翻译' },
  'catalog.products': { en: 'Active products and variants', zh: '在售商品与规格' },
  'catalog.stock': { en: 'Deliverable stock', zh: '可交付库存' },
  'catalog.rollback-probe': { en: 'Rollback stock reservation probe', zh: '库存预留回滚测试' },
  'review.blockers': { en: 'Publish blockers', zh: '发布阻断项' },
};

function localizeCheck(check: SetupCheckDto, locale: 'vi' | 'en' | 'zh'): { title: string; detail: string } {
  if (locale === 'vi') return { title: check.title, detail: check.detail };
  const title = CHECK_TITLES[check.id]?.[locale] ?? check.title;
  const stale = locale === 'en' ? 'No current result, or related configuration changed. Run this step again.' : '尚无有效结果，或相关配置已变更。请重新运行此步骤。';
  if (check.state === 'stale') return { title, detail: stale };
  const passed = check.state === 'pass';
  const warned = check.state === 'warn';
  const en: Record<string, string> = {
    'system.database': 'PostgreSQL is responding and the setup schema is ready.',
    'system.secret': passed ? 'A unique JWT secret is loaded.' : 'JWT_SECRET must contain at least 32 characters.',
    'system.domain': check.detail.includes('http') ? check.detail : 'WEB_URL and API_PUBLIC_URL must be valid; production requires HTTPS.',
    'system.timezone': passed ? check.detail : 'TZ must be a valid IANA timezone, for example Asia/Ho_Chi_Minh.',
    'system.owner-password': passed ? 'Every SUPERADMIN has changed the bootstrap password.' : 'The store owner must change the bootstrap password before publishing.',
    'system.backup': warned ? 'The backup container is not required in development.' : passed ? 'The latest backup heartbeat is valid.' : 'The backup heartbeat is missing, invalid or older than 48 hours.',
    'design.document': passed ? 'All page templates and required business blocks are valid.' : 'The storefront document is invalid; open Page Builder to repair it.',
    'design.brand': passed ? 'Store identity is configured.' : 'Replace Digital Store and upload both a logo and favicon.',
    'payments.real': passed ? `Active methods: ${afterColon(check.detail)}.` : 'Enable at least one real payment method.',
    'payments.mock': passed ? 'The mock gateway is disabled.' : 'Disable mock in both the database and PAYMENT_MOCK before publishing.',
    'payments.webhook': passed ? 'An invalid request was rejected as expected.' : 'An invalid request was accepted; inspect the webhook immediately.',
    'payments.binance-permissions': warned ? 'Binance keys are not configured; this is fine when only bank transfer is used.' : passed ? 'The key is connected and read-only, with withdrawal and trading disabled.' : 'The key must connect with read enabled and withdrawal/trading disabled.',
    'channels.support': passed ? 'Customers have at least one support channel.' : 'Add a support channel before opening the store.',
    'channels.policies': passed ? 'Terms, refund/warranty and privacy policies are present.' : 'Complete all three policy pages.',
    'channels.telegram': warned ? 'Telegram is disabled; it is optional.' : passed ? 'Telegram bot is configured.' : 'Telegram is enabled but its token is missing.',
    'channels.translation': warned ? 'AI translation is disabled; it is optional.' : passed ? 'The translation provider is connected.' : 'The configured translation provider could not be reached.',
    'catalog.products': check.detail.replace('sản phẩm', 'products').replace('loại active', 'active variants'),
    'catalog.stock': check.detail.replace('món AVAILABLE thuộc loại đang bán', 'AVAILABLE items in active variants'),
    'catalog.rollback-probe': passed ? 'Locked Order → StockItem with SKIP LOCKED; the transaction rolled back and business counts stayed unchanged.' : 'The real lock-and-rollback probe did not complete without changing data.',
    'review.blockers': passed ? 'No fail or stale checks remain.' : 'Resolve all fail and stale checks before publishing.',
  };
  const zh: Record<string, string> = {
    'system.database': 'PostgreSQL 响应正常，设置架构已就绪。', 'system.secret': passed ? '已加载独立的 JWT 密钥。' : 'JWT_SECRET 必须至少包含 32 个字符。',
    'system.domain': check.detail.includes('http') ? check.detail : 'WEB_URL 与 API_PUBLIC_URL 必须有效；生产环境必须使用 HTTPS。', 'system.timezone': passed ? check.detail : 'TZ 必须是有效的 IANA 时区，例如 Asia/Ho_Chi_Minh。', 'system.owner-password': passed ? '所有超级管理员均已更改初始密码。' : '发布前店主必须更改初始密码。',
    'system.backup': warned ? '开发环境无需运行备份容器。' : passed ? '最近的备份心跳有效。' : '备份心跳缺失、无效或已超过 48 小时。', 'design.document': passed ? '所有页面模板与必需业务区块均有效。' : '店面文档无效，请在页面构建器中修复。',
    'design.brand': passed ? '商店品牌已配置。' : '请替换 Digital Store，并上传 Logo 与 favicon。', 'payments.real': passed ? `已启用：${afterColon(check.detail)}。` : '至少启用一种真实支付方式。',
    'payments.mock': passed ? '模拟支付网关已关闭。' : '发布前需在数据库和 PAYMENT_MOCK 中同时关闭模拟支付。', 'payments.webhook': passed ? '无效请求已按预期被拒绝。' : '无效请求被接受，请立即检查 webhook。',
    'payments.binance-permissions': warned ? '未配置 Binance 密钥；仅使用银行转账时可忽略。' : passed ? '密钥连接正常且仅可读，已关闭提现和交易权限。' : '密钥必须可连接、开启读取并关闭提现/交易权限。',
    'channels.support': passed ? '客户至少有一个支持渠道。' : '开店前请添加支持渠道。', 'channels.policies': passed ? '条款、退款/保修和隐私政策齐全。' : '请完成三个政策页面。',
    'channels.telegram': warned ? 'Telegram 已关闭；此服务为可选。' : passed ? 'Telegram 机器人已配置。' : 'Telegram 已启用但缺少 token。', 'channels.translation': warned ? 'AI 翻译已关闭；此服务为可选。' : passed ? '翻译服务已连接。' : '无法连接已配置的翻译服务。',
    'catalog.products': check.detail.replace('sản phẩm', '个商品').replace('loại active', '个在售规格'), 'catalog.stock': check.detail.replace('món AVAILABLE thuộc loại đang bán', '个可交付库存'),
    'catalog.rollback-probe': passed ? '已按 Order → StockItem 顺序使用 SKIP LOCKED；事务成功回滚且业务数量未变化。' : '真实锁定与回滚测试未能在数据不变的情况下完成。', 'review.blockers': passed ? '没有失败或过期检查。' : '发布前请处理所有失败和过期检查。',
  };
  return { title, detail: (locale === 'en' ? en : zh)[check.id] ?? check.detail };
}

function afterColon(value: string): string {
  return value.includes(':') ? value.slice(value.indexOf(':') + 1).replace(/[.]$/, '').trim() : value;
}

function StepActions({ step, locale }: { step: SetupStepId; locale: 'vi' | 'en' | 'zh' }) {
  const actions: Record<SetupStepId, Array<{ href: string; vi: string; en: string; zh: string }>> = {
    system: [{ href: '/account/password', vi: 'Đổi mật khẩu chủ', en: 'Change owner password', zh: '更改店主密码' }],
    design: [{ href: '/admin/design', vi: 'Mở Page Builder', en: 'Open Page Builder', zh: '打开页面构建器' }],
    payments: [{ href: '/admin/settings?tab=payments', vi: 'Cấu hình thanh toán', en: 'Configure payments', zh: '配置支付' }],
    channels: [{ href: '/admin/settings?tab=support', vi: 'Kênh hỗ trợ', en: 'Support channels', zh: '支持渠道' }, { href: '/admin/legal', vi: 'Soạn chính sách', en: 'Edit policies', zh: '编辑政策' }, { href: '/admin/telegram', vi: 'Telegram', en: 'Telegram', zh: 'Telegram' }],
    catalog: [{ href: '/admin/products', vi: 'Quản lý sản phẩm & kho', en: 'Manage catalog & stock', zh: '管理商品与库存' }],
    review: [{ href: '/', vi: 'Xem cửa hàng', en: 'View storefront', zh: '查看店面' }, { href: '/admin/design', vi: 'Xem trước giao diện', en: 'Preview design', zh: '预览界面' }],
  };
  return <div className="mt-5 flex flex-wrap gap-2">{actions[step].map((action) => <Link key={action.href} href={action.href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{action[locale]}</Link>)}</div>;
}

function stateClass(state: SetupCheckState): string { return state === 'pass' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : state === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-700' : state === 'fail' ? 'border-red-200 bg-red-50 text-red-700' : 'border-neutral-200 bg-neutral-50 text-neutral-500'; }

function copy(locale: 'vi' | 'en' | 'zh') {
  const all = {
    vi: { title: 'Thiết lập Digital Store', subtitle: 'Kiểm tra từng phần trước khi cửa hàng nhận tiền và tự giao sản phẩm.', published: 'Đã xuất bản', maintenance: 'Đang thiết lập', step: 'Bước', stepsComplete: 'bước hoàn tất', checkStep: 'Kiểm tra bước này', progress: 'Tiến độ', stepsReady: 'bước sẵn sàng', publishRule: 'Server là trọng tài cuối', publishHint: 'Nút Xuất bản luôn chạy lại toàn bộ blocker, kể cả khi giao diện đang hiển thị kết quả cũ.', ready: 'Đủ điều kiện xuất bản.', notReady: 'Xử lý toàn bộ fail và stale trước khi xuất bản.', next: 'Tiếp theo', runAll: 'Chạy toàn bộ', publish: 'Xuất bản' },
    en: { title: 'Set up Digital Store', subtitle: 'Verify each area before the store accepts money and delivers products.', published: 'Published', maintenance: 'Setup mode', step: 'Step', stepsComplete: 'steps complete', checkStep: 'Check this step', progress: 'Progress', stepsReady: 'steps ready', publishRule: 'The server is the final authority', publishHint: 'Publish reruns every blocker even when the UI shows an older result.', ready: 'Ready to publish.', notReady: 'Resolve every fail and stale result before publishing.', next: 'Next', runAll: 'Run all', publish: 'Publish' },
    zh: { title: '设置 Digital Store', subtitle: '在商店收款并自动交付商品前逐项检查。', published: '已发布', maintenance: '设置模式', step: '步骤', stepsComplete: '步已完成', checkStep: '检查此步骤', progress: '进度', stepsReady: '步已就绪', publishRule: '服务器是最终判断者', publishHint: '即使界面显示旧结果，发布也会重新运行所有阻断项。', ready: '可以发布。', notReady: '发布前处理所有失败和过期检查。', next: '下一步', runAll: '全部检查', publish: '发布' },
  };
  return all[locale];
}
