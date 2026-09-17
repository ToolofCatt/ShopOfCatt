export function safeCustomerNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    // Trình duyệt chuẩn hoá backslash; chặn cả bản mã hoá trước khi router nhận URL.
    let decoded = value;
    for (let count = 0; count < 3; count += 1) {
      if (decoded.startsWith('//') || /[\\\x00-\x20\x7f]/.test(decoded)) return '/';
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value;
      decoded = next;
    }
  } catch { return '/'; }
  return '/';
}

export function isCustomerAfterSalesPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register' ||
    ['/orders', '/account', '/checkout', '/legal'].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
