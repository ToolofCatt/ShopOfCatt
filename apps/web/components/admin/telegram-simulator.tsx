'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, SendHorizontal } from 'lucide-react';
import type { TelegramPreviewDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Tabs } from '@/components/admin/tabs';

type PreviewLang = 'vi' | 'en' | 'zh';

/**
 * Text ở đây do CHÍNH renderer của bot dựng (API /admin/telegram/preview):
 * mọi nội dung từ CSDL đã qua escapeHtml, thẻ duy nhất là <b>/<i> do renderer
 * tự thêm — nên đổ thẳng vào innerHTML được. KHÔNG dùng hàm này cho chuỗi khác.
 */
function tgHtml(text: string): { __html: string } {
  return { __html: text.replace(/\n/g, '<br/>') };
}

/**
 * Một tin trong cuộc trò chuyện giả lập.
 *
 * Tin "storefront" giữ NGUYÊN bản preview của trang nó đang hiển thị + đang mở
 * chi tiết nào — để bấm nút là sửa ĐÚNG tin đó tại chỗ (mô phỏng
 * editMessageText của bot), các tin cũ hơn trong chat không bị đụng.
 */
type SimMessage =
  | { id: number; from: 'customer'; text: string; time: string }
  | { id: number; from: 'bot'; kind: 'plain'; html: string; time: string }
  | {
      id: number;
      from: 'bot';
      kind: 'storefront';
      data: TelegramPreviewDto;
      view: string; // 'storefront' | productId đang mở
      time: string;
    };

function gioBayGio(): string {
  return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** Bong bóng phía bot (trái, nền xám xanh của Telegram dark). */
function BotBubble({ html, time }: { html: string; time: string }) {
  return (
    <div className="max-w-[85%] self-start">
      <div className="relative rounded-xl rounded-bl-sm bg-[#182533] px-3 py-2 text-[13.5px] leading-relaxed text-neutral-100 [overflow-wrap:anywhere] [&_b]:font-semibold [&_i]:italic">
        <span dangerouslySetInnerHTML={tgHtml(html)} />
        <span className="float-right ml-2 mt-2 text-[10px] leading-none text-[#6d7f8f]">
          {time}
        </span>
      </div>
    </div>
  );
}

export function TelegramSimulator({
  botName,
  refreshKey,
}: {
  /** @username thật của bot (từ trạng thái sống); null = tên tạm. */
  botName: string | null;
  /** Tăng số này (sau khi lưu cấu hình) là cuộc trò chuyện chạy lại từ đầu. */
  refreshKey: number;
}) {
  const { token } = useAuth();
  const { t } = useI18n();

  const [lang, setLang] = useState<PreviewLang>('vi');
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement | null>(null);

  const fetchPreview = useCallback(
    async (previewLang: PreviewLang, page: number): Promise<TelegramPreviewDto> => {
      return apiFetch<TelegramPreviewDto>(
        `/admin/telegram/preview?lang=${previewLang}&page=${page}`,
        { token },
      );
    },
    [token],
  );

  /** Khách "gửi" một tin → bot trả lời đúng như handleMessage của bot thật. */
  const sendCustomer = useCallback(
    async (rawText: string, previewLang: PreviewLang) => {
      const text = rawText.trim();
      if (text === '' || !token) return;
      setError(null);
      setMessages((prev) => [
        ...prev,
        { id: nextId.current++, from: 'customer', text, time: gioBayGio() },
      ]);
      setTyping(true);
      try {
        // Độ trễ nhỏ cho giống người thật đang xem bot "đang soạn…"
        const [data] = await Promise.all([
          fetchPreview(previewLang, 1),
          new Promise((resolve) => setTimeout(resolve, 450)),
        ]);
        const replies: SimMessage[] = [];
        if (text.startsWith('/start') && data.announcement) {
          replies.push({
            id: nextId.current++,
            from: 'bot',
            kind: 'plain',
            html: data.announcement,
            time: gioBayGio(),
          });
        }
        replies.push({
          id: nextId.current++,
          from: 'bot',
          kind: 'storefront',
          data,
          view: 'storefront',
          time: gioBayGio(),
        });
        setMessages((prev) => [...prev, ...replies]);
      } catch {
        setError(t.common.connectionError);
      } finally {
        setTyping(false);
      }
    },
    [token, fetchPreview, t],
  );

  /** Đổi ngôn ngữ / lưu cấu hình → cuộc trò chuyện mới, tự chào /start. */
  useEffect(() => {
    if (!token) return;
    setMessages([]);
    void sendCustomer('/start', lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, lang, refreshKey]);

  // Luôn cuộn xuống tin mới nhất — như app chat thật.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  /** Bấm nút inline trên MỘT tin — sửa đúng tin đó, mô phỏng editMessageText. */
  const onButton = async (messageId: number, callbackData: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (!message || message.from !== 'bot' || message.kind !== 'storefront') return;

    if (callbackData.startsWith('p:')) {
      const productId = callbackData.split(':')[1];
      if (!message.data.details[productId]) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, view: productId } : m)),
      );
      return;
    }
    if (callbackData.startsWith('c:')) {
      const page = Number(callbackData.split(':')[1]);
      if (page === message.data.storefront.page) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, view: 'storefront' } : m)),
        );
        return;
      }
      try {
        const data = await fetchPreview(lang, page);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, data, view: 'storefront' } : m,
          ),
        );
      } catch {
        setError(t.common.connectionError);
      }
      return;
    }
    // Nút của luồng MUA (b:/q:/m:/k:…) — giả lập không tạo đơn thật được,
    // nói thẳng thay vì một cái nút chết không giải thích.
    setError(t.admin.telegramSimBuyNote);
  };

  const tenBot = botName ?? t.admin.telegramSimBotName;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Tabs<PreviewLang>
          items={[
            { value: 'vi', label: 'VI' },
            { value: 'en', label: 'EN' },
            { value: 'zh', label: 'ZH' },
          ]}
          value={lang}
          onChange={setLang}
        />
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            void sendCustomer('/start', lang);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-950"
        >
          <RotateCcw strokeWidth={1.75} className="h-3.5 w-3.5" />
          {t.admin.telegramSimReset}
        </button>
      </div>

      {/* ------------------------- khung điện thoại ------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#0e1621] shadow-lg">
        {/* Thanh tiêu đề chat — avatar + tên bot như Telegram thật. */}
        <div className="flex items-center gap-3 border-b border-black/40 bg-[#17212b] px-4 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-700 text-sm font-semibold text-white">
            {tenBot.replace('@', '').charAt(0).toUpperCase() || 'B'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{tenBot}</p>
            <p className="text-xs text-[#6d7f8f]">{t.admin.telegramSimBotTag}</p>
          </div>
        </div>

        {/* Dòng tin nhắn */}
        <div
          ref={scroller}
          className="flex h-[430px] flex-col gap-2 overflow-y-auto px-3 py-3"
        >
          <div className="self-center rounded-full bg-black/30 px-3 py-0.5 text-[11px] text-[#8a9aa9]">
            {t.admin.telegramSimToday}
          </div>

          {messages.map((message) => {
            if (message.from === 'customer') {
              return (
                <div key={message.id} className="max-w-[85%] self-end">
                  <div className="rounded-xl rounded-br-sm bg-[#2b5278] px-3 py-2 text-[13.5px] leading-relaxed text-white [overflow-wrap:anywhere]">
                    {message.text}
                    <span className="float-right ml-2 mt-2 text-[10px] leading-none text-[#9bbadb]">
                      {message.time}
                    </span>
                  </div>
                </div>
              );
            }
            if (message.kind === 'plain') {
              return <BotBubble key={message.id} html={message.html} time={message.time} />;
            }
            const noiDung =
              message.view === 'storefront'
                ? message.data.storefront
                : (message.data.details[message.view] ?? message.data.storefront);
            return (
              <div key={message.id} className="max-w-[85%] space-y-1 self-start">
                <BotBubble html={noiDung.text} time={message.time} />
                {noiDung.keyboard.length > 0 && (
                  <div className="space-y-1">
                    {noiDung.keyboard.map((row, rowIndex) => (
                      <div key={rowIndex} className="flex gap-1">
                        {row.map((button) => (
                          <button
                            key={button.callbackData}
                            type="button"
                            title={button.text}
                            onClick={() => void onButton(message.id, button.callbackData)}
                            className="min-w-0 flex-1 truncate rounded-lg bg-white/10 px-3 py-1.5 text-center text-[12.5px] font-medium text-white/90 transition hover:bg-white/20 active:bg-white/25"
                          >
                            {button.text}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {typing && (
            <div className="self-start rounded-xl rounded-bl-sm bg-[#182533] px-3.5 py-2.5">
              <span className="inline-flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#6d7f8f]"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          )}
        </div>

        {/* Ô nhập — gõ thử như khách, Enter để gửi. */}
        <form
          className="flex items-center gap-2 border-t border-black/40 bg-[#17212b] px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = input;
            setInput('');
            void sendCustomer(text, lang);
          }}
        >
          <button
            type="button"
            onClick={() => void sendCustomer('/start', lang)}
            className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-mono text-xs text-sky-300 transition hover:bg-white/20"
          >
            /start
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t.admin.telegramSimPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-[#6d7f8f] focus:outline-none"
          />
          <button
            type="submit"
            disabled={input.trim() === ''}
            className={cn(
              'shrink-0 rounded-full p-1.5 transition',
              input.trim() === '' ? 'text-[#6d7f8f]' : 'text-sky-400 hover:bg-white/10',
            )}
            aria-label={t.admin.telegramSimSend}
          >
            <SendHorizontal strokeWidth={1.75} className="h-5 w-5" />
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
