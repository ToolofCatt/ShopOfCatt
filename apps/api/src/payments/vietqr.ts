/**
 * Dựng chuỗi VietQR theo chuẩn EMVCo (QR chuyển khoản liên ngân hàng VN).
 *
 * Hàm THUẦN, không I/O — chỗ này sai một ký tự là khách quét ra sai số tiền
 * hoặc sai tài khoản, nên nó được tách riêng để kiểm thử bằng dữ liệu thật.
 *
 * Cấu trúc EMVCo: mỗi trường là {ID 2 số}{ĐỘ DÀI 2 số}{GIÁ TRỊ}, lồng nhau được.
 * Trường cuối cùng (63) là CRC tính trên TOÀN BỘ chuỗi kể cả "6304".
 */

/** GUID của hệ thống VietQR (NAPAS). */
const VIETQR_GUID = 'A000000727';
/** Chuyển tới TÀI KHOẢN ngân hàng (khác QRIBFTTC = tới thẻ). */
const SERVICE_TRANSFER_TO_ACCOUNT = 'QRIBFTTA';
const CURRENCY_VND = '704';
const COUNTRY_VN = 'VN';

export interface VietQrInput {
  /** Mã BIN ngân hàng 6 số, ví dụ "970436" (Vietcombank). */
  bankBin: string;
  accountNumber: string;
  /** Số tiền VND, số nguyên dương. */
  amountVnd: number;
  /** Nội dung chuyển khoản — chỉ chữ/số ASCII để ngân hàng không cắt xén. */
  content: string;
}

/** Một trường EMVCo: id + độ dài 2 chữ số + giá trị. */
function field(id: string, value: string): string {
  const length = value.length.toString().padStart(2, '0');
  return `${id}${length}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: đa thức 0x1021, khởi tạo 0xFFFF, không đảo bit,
 * không XOR đầu ra — đúng biến thể mà EMVCo quy định.
 */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Chuẩn hoá nội dung chuyển khoản: bỏ dấu tiếng Việt và ký tự đặc biệt.
 * Nhiều ngân hàng cắt hoặc thay ký tự lạ, làm hỏng việc đối chiếu theo mã đơn.
 */
export function normalizeTransferContent(raw: string): string {
  return raw
    .normalize('NFD')
    // Dải dấu thanh/dấu phụ Unicode (combining diacritical marks)
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, 25);
}

/** Nội dung chuyển khoản của một đơn: mã đơn bỏ dấu gạch, ví dụ DH-AB12CD → DHAB12CD. */
export function transferContentForOrder(orderCode: string): string {
  return normalizeTransferContent(orderCode.replace(/-/g, ''));
}

/**
 * Chuỗi để mã hoá thành ảnh QR. Ném lỗi khi dữ liệu vào không hợp lệ —
 * thà hỏng lúc tạo đơn còn hơn in ra một QR quét không được.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  const bin = input.bankBin.trim();
  const account = input.accountNumber.trim();
  const amount = Math.round(input.amountVnd);
  const content = normalizeTransferContent(input.content);

  if (!/^\d{6}$/.test(bin)) {
    throw new Error(`Mã BIN ngân hàng phải gồm đúng 6 chữ số (nhận "${bin}")`);
  }
  if (!/^\d{6,19}$/.test(account)) {
    throw new Error('Số tài khoản chỉ gồm chữ số, dài 6–19 ký tự');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Số tiền VND phải là số nguyên dương');
  }

  const beneficiary = field('00', bin) + field('01', account);
  const merchantAccount =
    field('00', VIETQR_GUID) +
    field('01', beneficiary) +
    field('02', SERVICE_TRANSFER_TO_ACCOUNT);

  const body =
    field('00', '01') +
    // 12 = QR động (có sẵn số tiền), khác 11 = QR tĩnh
    field('01', '12') +
    field('38', merchantAccount) +
    field('53', CURRENCY_VND) +
    field('54', String(amount)) +
    field('58', COUNTRY_VN) +
    field('62', field('08', content));

  // CRC tính trên chuỗi ĐÃ nối sẵn "6304"
  const withCrcHeader = `${body}6304`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

/** Quy đổi USDT → VND theo tỉ giá cửa hàng, làm tròn lên tới đồng. */
export function usdtToVnd(amountUsdt: number, rate: number): number {
  return Math.ceil(amountUsdt * rate);
}
