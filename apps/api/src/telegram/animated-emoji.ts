/**
 * Emoji ĐỘNG (custom emoji) cho MỌI chữ bot gửi — bot gửi được qua Bot API,
 * đã thử thật ngày 25/08/2026 (200 OK, entity được lưu; tài liệu cũ nói cần
 * username Fragment nhưng thực nghiệm cho thấy không). Id tra bằng
 * SearchCustomEmoji qua tài khoản premium của chủ shop, và CHỈ giữ document
 * có `alt` đúng emoji — search trả cả emoji "liên quan" (🎁 từng dính id của
 * 📦, 🤖 dính id của 🧠) nên thiếu bước lọc alt là hiện SAI hình.
 *
 * Máy khách nào không render được custom emoji thì tự rơi về emoji thường
 * bên trong thẻ. CHỈ áp cho TEXT — nút bấm không nhận entity nên emoji trên
 * nút luôn tĩnh (giới hạn của Telegram, không phải của mình).
 *
 * Chủ shop gõ emoji vào TÊN/MÔ TẢ sản phẩm trong /admin là bot tự làm động
 * ở các màn chữ (chi tiết sản phẩm, kết quả tìm, tin giao hàng…) — miễn là
 * emoji có trong bảng này. Thiếu emoji nào thì tra id rồi thêm một dòng.
 */
export const ANIMATED_EMOJI: Record<string, string> = {
  // ---- Emoji giao diện bot đang dùng ----
  '⭐': '5226928895189598791',
  '👋': '5458904472598095631',
  '👇': '5470177992950946662',
  '🛒': '5226656353744862682',
  '💰': '5375312095346704820',
  '👤': '5373012449597335010',
  '☎️': '5260375446201050574',
  '🌐': '5447410659077661506',
  '🔎': '5445032810563771963',
  '📦': '5463172695132745432',
  '🎉': '5461151367559141950',
  '✅': '5246814447741183039',
  '❌': '5210952531676504517',
  '⏳': '5451732530048802485',
  '⌛': '5454415424319931791',
  '📊': '5231200819986047254',
  '👥': '5453957997418004470',
  'ℹ️': '5334544901428229844',
  '➡️': '5416117059207572332',
  '🧪': '5411512278740640309',
  '🪙': '5463046637842608206',
  '🏦': '5264895611517300926',
  '✖️': '5226660202035554522',
  '🎁': '5199749070830197566',
  '🇻🇳': '5474626200385104596',
  '🇬🇧': '5202196682497859879',
  '🇨🇳': '5431782733376399004',
  // 🧾 💳 ⬅️ 🟡 📧 KHÔNG có bản động nào trên Telegram (đã tra 25/08/2026) —
  // đành để tĩnh, đừng mất công tra lại.

  // ---- Emoji hay gõ vào tên/mô tả SẢN PHẨM ----
  '🔑': '5330115548900501467',
  '💻': '5364108698924885193',
  '📱': '5407025283456835913',
  '🎮': '5361741454685256344',
  '🎬': '5375464961822695044',
  '🎵': '5204153624216739288',
  '📺': '5373330964372004748',
  '🤖': '5372981976804366741',
  '🧠': '5226639745106330551',
  '✨': '5352693122528724986',
  '🔥': '5256047523620995497',
  '🚀': '5372917041193828849',
  '🎓': '5375163339154399459',
  '📚': '5373098009640836781',
  '🖥️': '5375099322666859339',
  '⚡': '5431449001532594346',
  '🌟': '5438496463044752972',
  '💎': '5235630047959727475',
  '👑': '5229011542011299168',
  '💡': '5422439311196834318',
  '🔒': '5231302159739395058',
  '☁️': '5287571024500498635',
  '💬': '5465300082628763143',
  '🛡️': '5373173798633752502',
  '🍀': '5251524493561569780',
  '🎯': '5350460637182993292',
  '🏆': '5226431245918942763',
  '🎟️': '5377599075237502153',
  '🎨': '5431456208487716895',
  '🕹️': '5453921696354419743',
  '🌈': '5411413769370740631',
  '💵': '5409048419211682843',
  '🥇': '5440539497383087970',
  '🆕': '5361979468887893611',
  '📌': '5397782960512444700',
  '🔔': '5242628160297641831',
  '❤️': '5460927548223398003',
  '😍': '5355198673305216688',
  '🤝': '5463256910851546817',
  '🧿': '5426900601101374618',
  '🎧': '5206607330443010889',
};

/**
 * VS16 (U+FE0F) — hậu tố "vẽ dạng emoji màu"; có/không đều là cùng một emoji.
 * Dựng từ mã số chứ không gõ ký tự trần: VS16 vô hình, để trần trong code là
 * formatter/copy-paste nuốt mất lúc nào không biết.
 */
const VS16 = String.fromCharCode(0xfe0f);
const VS16_CUOI = new RegExp(`${VS16}$`, 'u');

/** Tra id chấp cả hai dạng có/không VS16 — chủ shop gõ '⚡️' hay '⚡' đều trúng. */
function idCua(emoji: string): string | undefined {
  return (
    ANIMATED_EMOJI[emoji] ??
    ANIMATED_EMOJI[emoji.replace(VS16_CUOI, '')] ??
    ANIMATED_EMOJI[emoji + VS16]
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mẫu ghép từ khoá của bảng: dạng GỐC (bỏ VS16 cuối) + VS16 tuỳ chọn, xếp dài
 * trước ngắn sau để cờ hai-code-point (🇻🇳) không bị nuốt nửa chừng.
 */
const PATTERN = new RegExp(
  [...new Set(Object.keys(ANIMATED_EMOJI).map((k) => k.replace(VS16_CUOI, '')))]
    .sort((a, b) => b.length - a.length)
    .map((k) => `${escapeRegExp(k)}${VS16}?`)
    .join('|'),
  'gu',
);

/**
 * Vùng KHÔNG được đụng: nội dung <code>/<pre> là key giao cho khách — nhét
 * <tg-emoji> vào trong đó là Telegram trả 400 cho CẢ TIN và khách không nhận
 * được hàng. <tg-emoji> đã bọc rồi cũng chừa ra để gọi hai lần không lồng thẻ.
 */
const PROTECTED_SEGMENT =
  /(<code>[\s\S]*?<\/code>|<pre>[\s\S]*?<\/pre>|<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>)/g;

/** Bọc các emoji có bản động bằng thẻ tg-emoji — gọi SAU CÙNG, trên HTML đã dựng xong. */
export function animateEmoji(html: string): string {
  return html
    .split(PROTECTED_SEGMENT)
    .map((part, i) => {
      if (i % 2 === 1) return part; // phần lẻ = vùng cấm giữ nguyên
      return part.replace(PATTERN, (m) => {
        const id = idCua(m);
        return id ? `<tg-emoji emoji-id="${id}">${m}</tg-emoji>` : m;
      });
    })
    .join('');
}
