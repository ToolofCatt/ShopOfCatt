import { describe, expect, it } from 'vitest';
import { cryptoAddressQr } from './crypto-qr';

const BEP20 = '0xe511f94ee9caca60d622add4acd51edbcf72c9ea';
const TRC20 = 'TPDTPQQ18b3iYMwLDJsJjFQusMDfQ9sCGS';

function decodeSvg(dataUri: string): string {
  expect(dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
  return Buffer.from(dataUri.split(',')[1], 'base64').toString('utf8');
}

/** Toạ độ các ô đen, đọc ngược từ chuỗi path "M{x} {y}h1v1h-1z". */
function darkModules(svg: string): Set<string> {
  const d = /d="([^"]*)"/.exec(svg)?.[1] ?? '';
  const set = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    set.add(`${m[1]},${m[2]}`);
  }
  return set;
}

function viewBoxSize(svg: string): number {
  const vb = /viewBox="0 0 (\d+) \d+"/.exec(svg);
  return Number(vb?.[1] ?? 0);
}

describe('cryptoAddressQr', () => {
  it('không có địa chỉ thì không dựng mã', () => {
    expect(cryptoAddressQr(null)).toBeNull();
    expect(cryptoAddressQr(undefined)).toBeNull();
    expect(cryptoAddressQr('   ')).toBeNull();
  });

  it('trả về data URI SVG dùng thẳng được cho thẻ img', () => {
    const svg = decodeSvg(cryptoAddressQr(BEP20)!);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<path');
    // Nền trắng: ví quét mã trên nền tối sẽ không đọc được.
    expect(svg).toContain('fill="#ffffff"');
  });

  it('mỗi địa chỉ ra một mã khác nhau, cùng địa chỉ luôn ra cùng mã', () => {
    const a = cryptoAddressQr(BEP20)!;
    const b = cryptoAddressQr(TRC20)!;
    expect(a).not.toBe(b);
    expect(cryptoAddressQr(BEP20)).toBe(a);
  });

  /*
   * Ba ô định vị (finder pattern) là thứ máy quét bám vào để tìm và xoay mã.
   * Kiểm chúng nằm đúng ba góc bắt được hai lỗi âm thầm mà mắt thường khó thấy:
   * vẽ lộn trục x/y, và vẽ đảo màu — cả hai đều cho ra một hình vuông đầy chấm
   * trông "giống mã QR" nhưng không quét được.
   */
  for (const [ten, diaChi] of [
    ['BEP20', BEP20],
    ['TRC20', TRC20],
  ] as const) {
    it(`ba ô định vị nằm đúng góc (${ten})`, () => {
      const svg = decodeSvg(cryptoAddressQr(diaChi)!);
      const dark = darkModules(svg);
      const quiet = 2;
      const size = viewBoxSize(svg) - quiet * 2;

      // Một ô định vị: viền ngoài 7×7 đen, vòng trong 5×5 trắng, lõi 3×3 đen.
      const finderOk = (ox: number, oy: number): boolean => {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            const vien = x === 0 || x === 6 || y === 0 || y === 6;
            const loi = x >= 2 && x <= 4 && y >= 2 && y <= 4;
            const phaiDen = vien || loi;
            if (dark.has(`${ox + x},${oy + y}`) !== phaiDen) return false;
          }
        }
        return true;
      };

      expect(finderOk(0, 0)).toBe(true);
      expect(finderOk(size - 7, 0)).toBe(true);
      expect(finderOk(0, size - 7)).toBe(true);
      // Góc thứ tư KHÔNG có ô định vị — đó là cách máy quét biết hướng.
      expect(finderOk(size - 7, size - 7)).toBe(false);
    });
  }

  it('có vùng trắng quanh mã', () => {
    const svg = decodeSvg(cryptoAddressQr(BEP20)!);
    const dark = darkModules(svg);
    const maxX = Math.max(...[...dark].map((k) => Number(k.split(',')[0])));
    // Ô đen cuối cùng phải nằm trong khung, chừa lề mỗi bên.
    expect(viewBoxSize(svg)).toBe(maxX + 1 + 2 * 2);
  });
});
