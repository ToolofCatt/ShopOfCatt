/**
 * Địa chỉ công khai của cửa hàng. Không có nó thì Next.js không dựng được URL
 * tuyệt đối cho thẻ chia sẻ mạng xã hội — dán link vào Zalo/Facebook sẽ ra
 * ô trắng không tiêu đề, không ảnh.
 *
 * Hằng số này từng nằm trong `app/layout.tsx`, nhưng App Router chỉ cho phép
 * layout export đúng một tập tên định trước (`default`, `metadata`,
 * `generateMetadata`...). Mọi export lạ khiến `.next/types/app/layout.ts` sinh
 * ra kiểu `{ [x: string]: never }` và `pnpm typecheck` đổ với TS2344 — trong khi
 * `next dev` vẫn chạy bình thường, nên lỗi chỉ lộ ra lúc typecheck/build.
 *
 * NHÚNG VÀO BUNDLE LÚC BUILD → đổi NEXT_PUBLIC_SITE_URL thì phải build lại.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
).replace(/\/$/, '');
