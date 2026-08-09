/** Bản đồ các trường đã đổi: { field: { from, to } } — hiển thị ở trang nhật ký. */
export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

const MAX_AUDIT_STRING = 80;

/** Rút gọn chuỗi dài (mô tả, nội dung...) để bản ghi nhật ký luôn nhỏ gọn. */
export function auditValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_AUDIT_STRING) {
    return `${value.slice(0, MAX_AUDIT_STRING - 1)}…`;
  }
  return value;
}

/**
 * So sánh hai ảnh chụp phẳng (cùng bộ khoá, giá trị vô hướng) và trả về
 * các trường đã thay đổi. Ảnh chụp rỗng ⇒ không có gì thay đổi.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChanges {
  const changes: AuditChanges = {};
  for (const field of Object.keys(before)) {
    if (before[field] !== after[field]) {
      changes[field] = {
        from: auditValue(before[field]),
        to: auditValue(after[field]),
      };
    }
  }
  return changes;
}
