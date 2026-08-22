'use client';

import { useEffect, useRef } from 'react';

/**
 * Nhắc khách quay lại khi họ rời khỏi tab mà đơn còn chưa trả tiền.
 *
 * Hai lớp, vì lớp nào cũng có thể không dùng được:
 *
 * 1. Đổi TIÊU ĐỀ tab. Không cần xin phép gì, thấy ngay trên thanh tab, và bấm
 *    vào tab là quay lại đúng trang này. Đây là lớp luôn hoạt động.
 * 2. Thông báo hệ thống. Bấm vào thì trình duyệt kéo tab này lên. Cần quyền, mà
 *    quyền thì chỉ xin được từ một cú bấm thật của người dùng — nên chỉ xin khi
 *    khách bấm đâu đó trên trang, không xin lúc mới mở.
 */

export interface ReminderText {
  /** Tiêu đề tab khi rời đi, ví dụ "⚠ Chờ thanh toán · DH-XXXX". */
  tabTitle: string;
  /** Tiêu đề thông báo hệ thống. */
  notifyTitle: string;
  /** Nội dung thông báo hệ thống. */
  notifyBody: string;
}

export function usePendingOrderReminder(active: boolean, text: ReminderText): void {
  const tieuDeGoc = useRef<string | null>(null);
  const thongBao = useRef<Notification | null>(null);

  useEffect(() => {
    if (!active) return;

    /*
     * Xin quyền từ CÚ BẤM đầu tiên trên trang. Gọi thẳng lúc mở trang thì
     * Firefox và Safari bỏ qua (đòi phải có tương tác), còn Chrome thì hiện một
     * hộp thoại giữa lúc khách chưa hiểu vì sao — cách nào cũng tệ hơn.
     */
    const xinQuyen = () => {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') void Notification.requestPermission();
    };
    document.addEventListener('click', xinQuyen, { once: true });
    return () => document.removeEventListener('click', xinQuyen);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    const doi = () => {
      if (document.visibilityState === 'hidden') {
        if (tieuDeGoc.current === null) tieuDeGoc.current = document.title;
        document.title = text.tabTitle;

        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          thongBao.current === null
        ) {
          try {
            const n = new Notification(text.notifyTitle, {
              body: text.notifyBody,
              // `tag` để nhiều lần rời tab không xếp thành một chồng thông báo.
              tag: 'catt-store-pending-order',
              requireInteraction: false,
            });
            n.onclick = () => {
              window.focus();
              n.close();
            };
            thongBao.current = n;
          } catch {
            // Một số trình duyệt chặn khi trang không có service worker — bỏ qua,
            // tiêu đề tab vẫn làm việc của nó.
          }
        }
        return;
      }

      // Quay lại tab: trả tiêu đề về như cũ và dọn thông báo.
      if (tieuDeGoc.current !== null) {
        document.title = tieuDeGoc.current;
        tieuDeGoc.current = null;
      }
      if (thongBao.current) {
        thongBao.current.close();
        thongBao.current = null;
      }
    };

    document.addEventListener('visibilitychange', doi);
    /*
      Chạy một lần ngay khi gắn, KHÔNG chỉ chờ sự kiện.

      Khách bấm chuột giữa hay "mở trong tab mới" thì trang này mở ra trong tab
      nền: nó đã ở trạng thái ẩn từ lúc mount nên `visibilitychange` không bao giờ
      nổ, và trước đây lời nhắc im lặng đúng ở tình huống cần nó nhất.
    */
    doi();

    return () => {
      document.removeEventListener('visibilitychange', doi);
      // Dọn khi đơn đã trả tiền hoặc khách rời trang, kể cả lúc tab đang ẩn.
      if (tieuDeGoc.current !== null) {
        document.title = tieuDeGoc.current;
        tieuDeGoc.current = null;
      }
      if (thongBao.current) {
        thongBao.current.close();
        thongBao.current = null;
      }
    };
  }, [active, text.tabTitle, text.notifyTitle, text.notifyBody]);
}
