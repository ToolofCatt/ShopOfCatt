'use client';

/**
 * Lưới an toàn cuối cùng: lỗi xảy ra ngay trong layout gốc thì `error.tsx`
 * không kịp gắn vào cây React, nên file này phải tự dựng cả <html>/<body>.
 * Không dùng được từ điển đa ngôn ngữ ở đây (I18nProvider nằm trong layout đã
 * hỏng), nên viết song ngữ Việt–Anh cho chắc.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
          color: '#0a0a0a',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 .5rem' }}>
            Trang gặp sự cố
          </h1>
          <p style={{ color: '#525252', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            Đã xảy ra lỗi ngoài dự kiến. Vui lòng thử lại — nếu vẫn không được,
            hãy liên hệ cửa hàng.
            <br />
            <span style={{ fontSize: '.875rem' }}>
              Something went wrong. Please try again.
            </span>
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              borderRadius: '.5rem',
              border: 'none',
              background: '#0a0a0a',
              color: '#fff',
              padding: '.625rem 1.25rem',
              fontSize: '.875rem',
              fontWeight: 500,
            }}
          >
            Thử lại / Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: '1rem',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '.75rem',
                color: '#a3a3a3',
              }}
            >
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
