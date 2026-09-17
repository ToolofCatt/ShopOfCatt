import type { ReactNode } from 'react';

export function PreviewContent({ children }: { children: ReactNode }) {
  // pointer-events không chặn Tab/Enter: BuyBox thật từng vẫn có thể tạo đơn.
  // Chỉ khoá nội dung slot, để shell chọn block và tay kéo bên ngoài vẫn hoạt động.
  return <div inert className="pointer-events-none select-none">{children}</div>;
}
