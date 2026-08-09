'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatUsdt, sumMoney, type RevenuePointDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { LOCALE_DATE_TAG } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Button, Card, Spinner } from '@/components/ui';
import { Tabs, type TabItem } from '@/components/admin/tabs';

type DaysOption = '7' | '30';

/** Chiều cao vùng vẽ (px hiển thị = đơn vị viewBox theo trục y). */
const PLOT_HEIGHT = 180;
/** Bề rộng viewBox theo trục x — kéo giãn theo bề rộng thẻ (preserveAspectRatio="none"). */
const VB_WIDTH = 1000;

/** 3 mốc chia "đẹp" phía trên đường gốc — lưới ngang 4 đường kể cả baseline. */
function niceTicks(max: number): number[] {
  const rawStep = max / 3;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = power * 10;
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * power >= rawStep) {
      step = factor * power;
      break;
    }
  }
  return [step, step * 2, step * 3];
}

/** Số gọn cho nhãn trục y: 1.2k, 3M... */
function compactNumber(value: number): string {
  const trim = (v: number) =>
    v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 });
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return trim(value);
}

/** Cột có bo tròn CHỈ ở cạnh trên (~2px), chân cột bám vào đường gốc. */
function barPath(x: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  const top = PLOT_HEIGHT - height;
  return [
    `M${x},${PLOT_HEIGHT}`,
    `L${x},${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `L${x + width - r},${top}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `L${x + width},${PLOT_HEIGHT}`,
    'Z',
  ].join(' ');
}

/** Nhãn trục x dạng dd/MM từ chuỗi YYYY-MM-DD. */
function ddMM(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/**
 * Biểu đồ doanh thu — SVG thuần, một chuỗi số liệu nên KHÔNG có chú giải
 * (tiêu đề thẻ tự đặt tên); số đơn chỉ nằm trong tooltip, không có trục y thứ hai.
 */
export function RevenueChart() {
  const { token } = useAuth();
  const { t, locale } = useI18n();

  const [days, setDays] = useState<DaysOption>('7');
  const [data, setData] = useState<RevenuePointDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [hover, setHover] = useState<number | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const plotRef = useRef<HTMLDivElement>(null);

  const dayTabs: TabItem<DaysOption>[] = [
    { value: '7', label: t.admin.revenueDays7 },
    { value: '30', label: t.admin.revenueDays30 },
  ];

  // Lấy GẤP ĐÔI khoảng thời gian trong một lần gọi: nửa sau để vẽ biểu đồ,
  // nửa trước để so sánh "so với kỳ trước".
  const [previous, setPrevious] = useState<RevenuePointDto[] | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setPrevious(null);
    setError(null);
    setHover(null);
    const span = Number(days);
    apiFetch<RevenuePointDto[]>(`/admin/stats/series?days=${span * 2}`, { token })
      .then((result) => {
        if (!active) return;
        setPrevious(result.slice(0, result.length - span));
        setData(result.slice(-span));
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [days, token, t, reloadKey]);

  const sum = (points: RevenuePointDto[] | null): number =>
    sumMoney((points ?? []).map((point) => point.revenue));
  const periodTotal = sum(data);
  const previousTotal = sum(previous);
  /** null = kỳ trước không có doanh thu nên phần trăm không có ý nghĩa. */
  const deltaPercent =
    previousTotal > 0
      ? Math.round(((periodTotal - previousTotal) / previousTotal) * 100)
      : null;

  const handleEnter = (index: number, count: number) => {
    setHover(index);
    const rect = plotRef.current?.getBoundingClientRect();
    if (rect) {
      // Kẹp tâm tooltip vào trong thẻ (tooltip rộng ~160px).
      const half = 80;
      const center = ((index + 0.5) / count) * rect.width;
      setTooltipLeft(Math.min(Math.max(center, half), Math.max(rect.width - half, half)));
    }
  };

  const allZero = data !== null && (data.length === 0 || data.every((p) => p.revenue === 0));

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="flex h-[220px] flex-col items-center justify-center gap-3">
        <p className="text-sm text-neutral-500">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
          {t.common.retry}
        </Button>
      </div>
    );
  } else if (data === null) {
    body = (
      <div className="flex h-[220px] items-center justify-center">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  } else if (allZero) {
    body = (
      <div className="flex h-[220px] items-center justify-center">
        <p className="text-sm text-neutral-500">{t.admin.chartEmpty}</p>
      </div>
    );
  } else {
    const count = data.length;
    const maxRevenue = Math.max(...data.map((p) => p.revenue));
    const ticks = niceTicks(maxRevenue);
    const yMax = ticks[ticks.length - 1];
    const slot = VB_WIDTH / count;
    const barWidth = slot * 0.65;
    const labelEvery = days === '30' ? 5 : 1;
    const hovered = hover !== null ? data[hover] : null;

    body = (
      <div className="mt-4">
        <div className="flex">
          {/* Nhãn trục y — nằm ngoài SVG để không bị kéo giãn */}
          <div className="relative h-[180px] w-10 shrink-0" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                style={{ bottom: `${(tick / yMax) * 100}%` }}
                className="absolute right-1.5 translate-y-1/2 text-[11px] tabular-nums text-neutral-500"
              >
                {compactNumber(tick)}
              </span>
            ))}
            <span className="absolute bottom-0 right-1.5 translate-y-1/2 text-[11px] tabular-nums text-neutral-500">
              0
            </span>
          </div>

          {/* Vùng vẽ */}
          <div ref={plotRef} className="relative h-[180px] min-w-0 flex-1">
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${VB_WIDTH} ${PLOT_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t.admin.revenueTitle}
            >
              {/* Lưới ngang — nằm sau cột */}
              {ticks.map((tick) => {
                const y = PLOT_HEIGHT - (tick / yMax) * PLOT_HEIGHT;
                return (
                  <line
                    key={tick}
                    x1={0}
                    x2={VB_WIDTH}
                    y1={y}
                    y2={y}
                    className="stroke-neutral-200"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              <line
                x1={0}
                x2={VB_WIDTH}
                y1={PLOT_HEIGHT}
                y2={PLOT_HEIGHT}
                className="stroke-neutral-200"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />

              {/* Cột doanh thu */}
              {data.map((point, index) => {
                if (point.revenue <= 0) return null;
                const height = Math.max((point.revenue / yMax) * PLOT_HEIGHT, 2);
                const x = index * slot + (slot - barWidth) / 2;
                return (
                  <path
                    key={point.date}
                    d={barPath(x, barWidth, height, 4)}
                    className={hover === index ? 'fill-neutral-950' : 'fill-neutral-900'}
                  />
                );
              })}

              {/* Vùng bắt hover — rect trong suốt cao hết biểu đồ, rộng hơn cột */}
              {data.map((point, index) => (
                <rect
                  key={`hit-${point.date}`}
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => handleEnter(index, count)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </svg>

            {/* Tooltip — div định vị tuyệt đối, kẹp trong thẻ */}
            {hovered !== null && (
              <div
                style={{ left: tooltipLeft }}
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm"
              >
                <p className="font-medium text-neutral-950">
                  {new Date(`${hovered.date}T00:00:00`).toLocaleDateString(
                    LOCALE_DATE_TAG[locale],
                  )}
                </p>
                <p className="mt-0.5 tabular-nums text-neutral-700">
                  {t.admin.chartTooltipRevenue(formatUsdt(hovered.revenue))}
                </p>
                <p className="tabular-nums text-neutral-700">
                  {t.admin.chartTooltipOrders(hovered.orders)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Nhãn trục x — dd/MM */}
        <div className="relative ml-10 h-5" aria-hidden="true">
          {data.map((point, index) =>
            index % labelEvery === 0 ? (
              <span
                key={point.date}
                style={{ left: `${((index + 0.5) / count) * 100}%` }}
                className="absolute top-1 -translate-x-1/2 text-[11px] tabular-nums text-neutral-500"
              >
                {ddMM(point.date)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Nói rõ "N ngày qua" để không lẫn với ô "Tổng doanh thu" phía trên. */}
          <h2 className="text-sm font-medium text-neutral-500">
            {t.admin.revenueTitleDays(Number(days))}
          </h2>
          {/* Con số chính của bảng điều khiển + so sánh với kỳ liền trước. */}
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-neutral-950">
            {data === null ? '—' : formatUsdt(periodTotal)}
          </p>
          {data !== null && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
              {deltaPercent === null ? (
                <span>{t.admin.chartNoPrevious}</span>
              ) : (
                <>
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums',
                      deltaPercent > 0
                        ? 'bg-neutral-950 text-white'
                        : deltaPercent < 0
                          ? 'border border-neutral-300 text-neutral-700'
                          : 'bg-neutral-100 text-neutral-600',
                    )}
                  >
                    {deltaPercent > 0 ? (
                      <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} />
                    ) : deltaPercent < 0 ? (
                      <ArrowDownRight className="h-3 w-3" strokeWidth={2.25} />
                    ) : null}
                    {deltaPercent > 0 ? '+' : ''}
                    {deltaPercent}%
                  </span>
                  <span>{t.admin.chartVsPrevious(Number(days))}</span>
                </>
              )}
            </p>
          )}
        </div>
        <Tabs items={dayTabs} value={days} onChange={setDays} />
      </div>
      {body}
    </Card>
  );
}
