import { describe, expect, it } from 'vitest';
import { ANIMATED_EMOJI, animateEmoji, brandEmojiHtml } from './animated-emoji';

describe('animateEmoji', () => {
  it('bọc emoji có trong bảng bằng thẻ tg-emoji, chữ khác giữ nguyên', () => {
    const out = animateEmoji('⭐ Xin chào 👋 <b>abc</b>');
    expect(out).toContain('<tg-emoji emoji-id="5226928895189598791">⭐</tg-emoji>');
    expect(out).toContain('<tg-emoji emoji-id="5458904472598095631">👋</tg-emoji>');
    expect(out).toContain('<b>abc</b>');
    expect(animateEmoji('khong co gi')).toBe('khong co gi');
  });

  it('emoji nhiều code point: VS16 (☎️) và cờ (🇻🇳) đều trúng trọn vẹn', () => {
    expect(animateEmoji('☎️ Hỗ trợ')).toContain(
      `<tg-emoji emoji-id="${ANIMATED_EMOJI['☎️']}">`,
    );
    const co = animateEmoji('🇻🇳 Tiếng Việt');
    expect(co).toContain(`<tg-emoji emoji-id="${ANIMATED_EMOJI['🇻🇳']}">🇻🇳</tg-emoji>`);
  });

  it('chấp cả hai dạng có/không VS16 — chủ shop gõ kiểu nào cũng động', () => {
    const VS16 = String.fromCharCode(0xfe0f);
    // '⚡' trong bảng KHÔNG có VS16 — gõ '⚡️' (có VS16) vẫn phải trúng
    expect(animateEmoji(`⚡${VS16} nhanh`)).toContain(
      `emoji-id="${ANIMATED_EMOJI['⚡']}"`,
    );
    // '☎️' trong bảng CÓ VS16 — gõ '☎' trần vẫn phải trúng
    expect(animateEmoji('☎ goi')).toContain(`emoji-id="${ANIMATED_EMOJI['☎️']}"`);
  });

  it('emoji không có bản động (🧾) giữ nguyên, không bọc bừa', () => {
    expect(animateEmoji('🧾 Đơn của tôi')).toBe('🧾 Đơn của tôi');
  });

  it('KHÔNG đụng vào trong <code>/<pre> — key giao khách chứa emoji là hỏng cả tin', () => {
    const giao = 'Hàng: <tg-spoiler><code>KEY-⭐-01</code></tg-spoiler> xong 🎉';
    const out = animateEmoji(giao);
    expect(out).toContain('<code>KEY-⭐-01</code>'); // nguyên vẹn
    expect(out).toContain(`emoji-id="${ANIMATED_EMOJI['🎉']}"`); // ngoài code vẫn động
    expect(animateEmoji('<pre>⭐ raw</pre>')).toBe('<pre>⭐ raw</pre>');
  });

  it('gọi hai lần không lồng thẻ tg-emoji', () => {
    const mot = animateEmoji('⭐ sao');
    expect(animateEmoji(mot)).toBe(mot);
  });

  it('bảng: id toàn chữ số, không khoá rỗng', () => {
    for (const [emoji, id] of Object.entries(ANIMATED_EMOJI)) {
      expect(emoji.length, emoji).toBeGreaterThan(0);
      expect(id).toMatch(/^\d{10,25}$/);
    }
  });
});

describe('brandEmojiHtml — logo hãng theo từ khoá tên sản phẩm', () => {
  it('nhận ra các hãng shop đang bán thật', () => {
    expect(brandEmojiHtml('Tài khoản ChatGPT Plus 30 ngày')).toContain(
      'emoji-id="5359726582447487916"',
    );
    expect(brandEmojiHtml('Super grok account 7D')).toContain(
      'emoji-id="6237935849883835173"',
    );
    expect(brandEmojiHtml('Claude Pro 7 ngày (Không bảo hành)')).toContain(
      'emoji-id="6240235242230126724"',
    );
  });

  it('cụ thể thắng chung chung: youtube music ≠ youtube, photoshop ≠ adobe', () => {
    const ytm = brandEmojiHtml('YouTube Music 1 năm');
    expect(ytm).toContain('emoji-id="6240196213862308747"');
    expect(brandEmojiHtml('YouTube Premium 1 năm')).toContain(
      'emoji-id="5334681713316479679"',
    );
    expect(brandEmojiHtml('Adobe Photoshop 2026')).toContain(
      'emoji-id="5359480394922082925"',
    );
    expect(brandEmojiHtml('Adobe full bộ')).toContain('emoji-id="6240060303917195060"');
  });

  it('không nhận ra hãng → chuỗi rỗng, tên thường không dính logo bừa', () => {
    expect(brandEmojiHtml('Key bản quyền ABC')).toBe('');
    expect(brandEmojiHtml('Vé số kiến thiết')).toBe('');
  });

  it('logo đi qua animateEmoji không bị bọc lồng thẻ', () => {
    const html = `${brandEmojiHtml('Netflix 1 tháng')}<b>Netflix</b>`;
    const sau = animateEmoji(html);
    expect(sau).toBe(html); // 📺 fallback nằm TRONG thẻ tg-emoji — vùng cấm
  });
});
