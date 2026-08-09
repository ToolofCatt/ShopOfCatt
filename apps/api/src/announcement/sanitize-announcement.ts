import sanitizeHtml from 'sanitize-html';

/**
 * Lọc HTML của hộp thông báo theo danh sách thẻ CHO PHÉP.
 *
 * Nội dung do quản trị viên soạn nhưng vẫn hiển thị cho mọi khách, nên phải
 * lọc ở MÁY CHỦ — lọc phía trình duyệt có thể bị bỏ qua bằng cách gọi thẳng API.
 * Mọi thẻ/thuộc tính không nằm trong danh sách đều bị bỏ (giữ lại phần chữ).
 */

/** Chỉ cho phép căn lề — không cho style tùy ý (chặn `position`, `background:url(...)`…). */
const ALLOWED_TEXT_ALIGN = [/^left$/, /^center$/, /^right$/, /^justify$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'ul',
    'ol',
    'li',
    'h3',
    'h4',
    'blockquote',
    'code',
    'a',
    'span',
  ],
  allowedAttributes: {
    // target/rel do transformTags thêm vào — phải nằm trong danh sách cho phép,
    // nếu không chúng bị lọc mất ngay sau khi được thêm.
    a: ['href', 'target', 'rel'],
    p: ['style'],
    h3: ['style'],
    h4: ['style'],
    li: ['style'],
    span: ['style'],
  },
  allowedStyles: {
    '*': { 'text-align': ALLOWED_TEXT_ALIGN },
  },
  // Chỉ liên kết web/email — chặn javascript:, data:, file:…
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // Liên kết ra ngoài luôn mở tab mới và không rò rỉ phiên đăng nhập.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
    div: 'p',
    h1: 'h3',
    h2: 'h3',
  },
  // Bỏ hẳn nội dung bên trong các thẻ nguy hiểm thay vì giữ lại phần chữ.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
};

export function sanitizeAnnouncementHtml(raw: string): string {
  const cleaned = sanitizeHtml(raw, OPTIONS).trim();
  // Nội dung chỉ còn thẻ rỗng (ví dụ "<p></p>", "<p><br /></p>") coi như trống.
  return hasVisibleContent(cleaned) ? cleaned : '';
}

/** Còn chữ hoặc còn thẻ ngắt dòng thật sự hay không. */
export function hasVisibleContent(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text !== '';
}
