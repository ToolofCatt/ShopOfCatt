/**
 * Seed dữ liệu — idempotent (upsert theo email/slug, chỉ thêm kho khi
 * loại sản phẩm chưa có dòng kho nào). Chạy bằng: pnpm --filter @webcatt/api db:seed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- Nạp biến môi trường từ apps/api/.env (không dùng thư viện ngoài) ----------

function loadEnvFile(): void {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
}

loadEnvFile();

const prisma = new PrismaClient();

/** Hộp thông báo trang chủ chỉ có duy nhất một bản ghi. */
const ANNOUNCEMENT_ID = 'main';

/**
 * Chỉ tạo dữ liệu mẫu (sản phẩm, khách demo, thông báo mẫu) khi SEED_DEMO=true.
 * Mặc định seed CHỈ bảo đảm có tài khoản chủ cửa hàng — cửa hàng thật khởi
 * động với danh mục trống, không bị chèn hàng mẫu.
 */
const SEED_DEMO = process.env.SEED_DEMO === 'true';

/** Tên loại mặc định — trùng với tên do migration tạo cho dữ liệu cũ. */
const DEFAULT_VARIANT_NAME = 'Mặc định';

// ---------- Sinh mã kho hàng ----------

const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DIGITS = '0123456789';

function randomChars(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

function keyBlocks(blockCount: number, blockLength: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push(randomChars(KEY_CHARS, blockLength));
  }
  return blocks.join('-');
}

/** Sinh `count` dòng kho duy nhất theo generator. */
function uniqueLines(count: number, generator: () => string): string[] {
  const set = new Set<string>();
  while (set.size < count) {
    set.add(generator());
  }
  return Array.from(set);
}

// ---------- Dữ liệu sản phẩm ----------

interface SeedVariant {
  name: string;
  price: string;
  sortOrder: number;
  stockCount: number;
  stockLine: () => string;
}

interface SeedProduct {
  slug: string;
  name: string;
  icon: string;
  category: string;
  sortOrder: number;
  shortDescription: string;
  description: string;
  variants: SeedVariant[];
}

/** Sản phẩm chỉ có một mức giá → một loại duy nhất tên "Mặc định". */
function singleVariant(
  price: string,
  stockCount: number,
  stockLine: () => string,
): SeedVariant[] {
  return [{ name: DEFAULT_VARIANT_NAME, price, sortOrder: 0, stockCount, stockLine }];
}

const PRODUCTS: SeedProduct[] = [
  {
    slug: 'key-windows-11-pro',
    name: 'Key bản quyền Windows 11 Pro',
    icon: 'KeyRound',
    category: 'Phần mềm',
    sortOrder: 1,
    shortDescription:
      'Key kích hoạt Windows 11 Pro bản quyền vĩnh viễn cho 1 PC, nhận cập nhật chính thức từ Microsoft.',
    description: [
      'Key bản quyền Windows 11 Pro chính hãng, kích hoạt vĩnh viễn cho 1 máy tính. Key được cung cấp từ kênh phân phối hợp pháp, kích hoạt online trực tiếp với máy chủ Microsoft và nhận đầy đủ các bản cập nhật bảo mật.',
      'Cách kích hoạt:\n- Mở Settings → System → Activation → Change product key.\n- Nhập key được giao ngay sau khi thanh toán.\n- Nhấn Activate và chờ Microsoft xác nhận (cần kết nối mạng).',
      'Lưu ý:\n- Key dùng cho 1 PC, gắn với phần cứng máy sau khi kích hoạt.\n- Hỗ trợ cả cài mới lẫn nâng cấp từ Windows 11 Home.',
      'Bảo hành:\n- Bảo hành kích hoạt trọn đời — đổi key mới miễn phí nếu key lỗi.\n- Hỗ trợ kỹ thuật qua email trong vòng 24 giờ.',
    ].join('\n\n'),
    variants: singleVariant('8.50', 15, () => keyBlocks(5, 5)),
  },
  {
    slug: 'key-office-2021-pro-plus',
    name: 'Key Microsoft Office 2021 Pro Plus',
    icon: 'AppWindow',
    category: 'Phần mềm',
    sortOrder: 2,
    shortDescription:
      'Key Office 2021 Professional Plus dùng vĩnh viễn cho 1 PC — đầy đủ Word, Excel, PowerPoint, Outlook.',
    description: [
      'Bộ Microsoft Office 2021 Professional Plus trọn đời cho 1 PC, bao gồm Word, Excel, PowerPoint, Outlook, Access và Publisher. Mua một lần, dùng vĩnh viễn — không phí thuê bao hàng tháng.',
      'Cách kích hoạt:\n- Tải bộ cài chính thức từ trang Microsoft (link hướng dẫn gửi kèm sau khi mua).\n- Cài đặt, mở một ứng dụng Office bất kỳ và nhập key khi được hỏi.\n- Kích hoạt online trong vài giây.',
      'Yêu cầu hệ thống:\n- Windows 10 hoặc Windows 11.\n- Không dùng được trên máy đã cài Office 365 bản thuê bao (cần gỡ trước).',
      'Bảo hành:\n- Đổi key mới nếu không kích hoạt được.\n- Hỗ trợ cài đặt từ xa miễn phí khi cần.',
    ].join('\n\n'),
    variants: singleVariant('12.00', 10, () => keyBlocks(5, 5)),
  },
  {
    slug: 'gift-card-steam-10',
    name: 'Steam Gift Card 10$',
    icon: 'Gift',
    category: 'Thẻ quà tặng',
    sortOrder: 3,
    shortDescription:
      'Thẻ nạp Steam Wallet trị giá 10 USD — nạp thẳng vào tài khoản Steam, mua game và vật phẩm.',
    description: [
      'Thẻ quà tặng Steam trị giá 10 USD, nạp trực tiếp vào ví Steam Wallet của tài khoản. Dùng để mua game, DLC, vật phẩm trong game hoặc phần mềm trên Steam Store.',
      'Cách nạp:\n- Đăng nhập Steam → chọn Games → Redeem a Steam Wallet Code.\n- Nhập mã thẻ được giao sau khi thanh toán.\n- Số dư 10 USD cộng ngay vào ví.',
      'Lưu ý:\n- Mã chỉ dùng được một lần, cho tài khoản Steam khu vực hỗ trợ USD.\n- Kiểm tra khu vực tài khoản trước khi nạp để tránh lỗi tiền tệ.',
      'Bảo hành:\n- Cam kết mã chưa qua sử dụng — hoàn tiền 100% nếu mã không hợp lệ (kèm video mở mã).',
    ].join('\n\n'),
    variants: singleVariant('10.50', 8, () => keyBlocks(3, 5)),
  },
  {
    slug: 'key-game-aaa-steam',
    name: 'Key game AAA trên Steam (random)',
    icon: 'Gamepad2',
    category: 'Game',
    sortOrder: 4,
    shortDescription:
      'Key game AAA ngẫu nhiên kích hoạt trên Steam — cơ hội nhận bom tấn với giá chỉ bằng ly cà phê.',
    description: [
      'Mỗi key là một tựa game AAA ngẫu nhiên kích hoạt trên Steam — từ các nhà phát hành lớn. Trò chơi may mắn dành cho game thủ thích bất ngờ: giá trị game nhận được luôn cao hơn số tiền bỏ ra.',
      'Cách kích hoạt:\n- Mở Steam → Games → Activate a Product on Steam.\n- Nhập key được giao sau khi thanh toán.\n- Game vào thẳng thư viện, tải và chơi ngay.',
      'Lưu ý:\n- Key ngẫu nhiên nên không hỗ trợ chọn game hoặc đổi trả theo sở thích.\n- Mỗi key chỉ kích hoạt được một lần, trên một tài khoản.',
      'Bảo hành:\n- Đổi key mới nếu key không kích hoạt được (báo trong 48 giờ kèm ảnh chụp lỗi).',
    ].join('\n\n'),
    variants: singleVariant('4.99', 20, () => keyBlocks(3, 5)),
  },
  {
    slug: 'khoa-hoc-lap-trinh-web',
    name: 'Khóa học Lập trình Web Fullstack (mã kích hoạt)',
    icon: 'GraduationCap',
    category: 'Khóa học',
    sortOrder: 5,
    shortDescription:
      'Mã kích hoạt trọn đời khóa học Lập trình Web Fullstack — chọn gói Cơ bản hoặc Nâng cao kèm mentor.',
    description: [
      'Khóa học Lập trình Web Fullstack với hơn 60 giờ video tiếng Việt: HTML/CSS, JavaScript, React, Node.js, cơ sở dữ liệu và triển khai thực tế. Học trọn đời, cập nhật nội dung miễn phí.',
      'Hai gói để bạn chọn:\n- Cơ bản: toàn bộ video bài giảng và mã nguồn dự án.\n- Nâng cao: thêm phần kiến trúc, kiểm thử, tối ưu hiệu năng và 4 buổi review code 1-1 với mentor.',
      'Nội dung chính:\n- Nền tảng HTML, CSS, JavaScript hiện đại (ES2023+).\n- Xây dựng giao diện với React và quản lý trạng thái.\n- Backend Node.js, REST API, PostgreSQL.\n- Dự án cuối khóa: xây dựng và deploy một web app hoàn chỉnh.',
      'Cách kích hoạt:\n- Truy cập trang khóa học, tạo tài khoản học viên.\n- Vào mục "Kích hoạt khóa học" và nhập mã được giao sau khi thanh toán.\n- Toàn bộ bài học của gói bạn mua mở khóa ngay lập tức.',
      'Bảo hành:\n- Mã không kích hoạt được sẽ được cấp lại trong 24 giờ.\n- Hỗ trợ học tập qua nhóm riêng dành cho học viên.',
    ].join('\n\n'),
    variants: [
      {
        name: 'Cơ bản',
        price: '15.00',
        sortOrder: 1,
        stockCount: 12,
        stockLine: () =>
          `COURSE-BASIC-${randomChars(KEY_CHARS, 4)}-${randomChars(KEY_CHARS, 4)}`,
      },
      {
        name: 'Nâng cao',
        price: '29.00',
        sortOrder: 2,
        stockCount: 6,
        stockLine: () =>
          `COURSE-PRO-${randomChars(KEY_CHARS, 4)}-${randomChars(KEY_CHARS, 4)}`,
      },
    ],
  },
  {
    slug: 'key-antivirus-1-nam',
    name: 'Key diệt virus bản quyền 1 năm',
    icon: 'Shield',
    category: 'Phần mềm',
    sortOrder: 6,
    shortDescription:
      'Key bản quyền phần mềm diệt virus 12 tháng — chọn gói 1 hoặc 3 thiết bị, bảo vệ thời gian thực.',
    description: [
      'Key bản quyền phần mềm diệt virus hàng đầu, thời hạn 12 tháng cho thiết bị Windows hoặc macOS. Bảo vệ thời gian thực, chống ransomware, lọc web độc hại và tường lửa thông minh.',
      'Chọn số thiết bị:\n- 1 thiết bị: dành cho một máy cá nhân.\n- 3 thiết bị: dùng chung cho cả gia đình, kích hoạt trên 3 máy bất kỳ.',
      'Tính năng nổi bật:\n- Quét virus thời gian thực với cơ sở dữ liệu cập nhật liên tục.\n- Chống ransomware và bảo vệ thư mục quan trọng.\n- Duyệt web an toàn, chặn trang lừa đảo.',
      'Cách kích hoạt:\n- Tải bản cài đặt chính thức từ trang chủ hãng.\n- Đăng nhập hoặc tạo tài khoản, vào mục nhập license key.\n- Nhập key được giao sau khi thanh toán — thời hạn 365 ngày tính từ lúc kích hoạt.',
      'Bảo hành:\n- Đổi key mới nếu kích hoạt lỗi trong suốt thời gian sử dụng.\n- Hỗ trợ kỹ thuật qua email 24/7.',
    ].join('\n\n'),
    variants: [
      {
        name: '1 thiết bị',
        price: '9.99',
        sortOrder: 1,
        stockCount: 10,
        stockLine: () => keyBlocks(4, 4),
      },
      {
        name: '3 thiết bị',
        price: '19.99',
        sortOrder: 2,
        stockCount: 5,
        stockLine: () => keyBlocks(4, 4),
      },
    ],
  },
  {
    slug: 'ebook-bao-mat',
    name: 'Ebook: Làm chủ bảo mật cá nhân (mã tải)',
    icon: 'BookOpen',
    category: 'Ebook',
    sortOrder: 7,
    shortDescription:
      'Mã tải ebook 250 trang về bảo mật cá nhân: mật khẩu, 2FA, VPN, chống lừa đảo — định dạng PDF/EPUB.',
    description: [
      'Ebook "Làm chủ bảo mật cá nhân" dày 250 trang, hướng dẫn từng bước bảo vệ tài khoản và dữ liệu cá nhân trong thời đại số. Ngôn ngữ dễ hiểu, ví dụ thực tế, cập nhật các thủ đoạn lừa đảo mới nhất.',
      'Bạn sẽ học được:\n- Xây dựng hệ thống mật khẩu mạnh và trình quản lý mật khẩu.\n- Bật xác thực hai lớp (2FA) đúng cách cho mọi tài khoản quan trọng.\n- Nhận diện email/tin nhắn lừa đảo và các chiêu social engineering.\n- Sử dụng VPN, mã hóa ổ đĩa và sao lưu an toàn.',
      'Cách nhận sách:\n- Sau khi thanh toán, bạn nhận được mã tải.\n- Truy cập trang tải sách, nhập mã để tải trọn bộ PDF + EPUB (không DRM).',
      'Bảo hành:\n- Mã tải dùng được 5 lần trong 1 năm.\n- Nhận miễn phí các phiên bản cập nhật của sách.',
    ].join('\n\n'),
    variants: singleVariant(
      '4.50',
      10,
      () => `EBOOK-${randomChars(KEY_CHARS, 4)}-${randomChars(DIGITS, 4)}`,
    ),
  },
  {
    slug: 'canva-pro-1-nam',
    name: 'Canva Pro (mã kích hoạt)',
    icon: 'Palette',
    category: 'Phần mềm',
    sortOrder: 8,
    shortDescription:
      'Mã kích hoạt Canva Pro chính chủ — chọn gói 1 tháng hoặc 1 năm, mở khóa toàn bộ template và công cụ AI.',
    description: [
      'Mã kích hoạt Canva Pro trên chính tài khoản của bạn — không dùng chung, không đổi chủ tài khoản. Mở khóa hơn 100 triệu template, ảnh, video stock cao cấp và bộ công cụ AI (Magic Studio).',
      'Chọn thời hạn:\n- 1 tháng: dùng thử trọn vẹn mọi tính năng Pro.\n- 1 năm: tiết kiệm nhất, gói Pro liên tục 365 ngày.',
      'Quyền lợi Canva Pro:\n- Kho template và tài nguyên premium không giới hạn.\n- Xóa nền ảnh một chạm, đổi kích thước thiết kế nhanh.\n- Bộ nhớ đám mây 1TB và Brand Kit cho thương hiệu.',
      'Cách kích hoạt:\n- Đăng nhập tài khoản Canva của bạn.\n- Truy cập link kích hoạt kèm theo mã được giao sau khi thanh toán.\n- Gói Pro áp dụng ngay cho chính tài khoản của bạn.',
      'Bảo hành:\n- Bảo hành trọn thời hạn gói — cấp lại mã nếu gói bị gián đoạn do lỗi mã.',
    ].join('\n\n'),
    // Cả hai loại đều hết hàng — để demo trạng thái "Hết hàng" trên trang chủ.
    variants: [
      {
        name: '1 tháng',
        price: '7.99',
        sortOrder: 1,
        stockCount: 0,
        stockLine: () => keyBlocks(4, 4),
      },
      {
        name: '1 năm',
        price: '19.99',
        sortOrder: 2,
        stockCount: 0,
        stockLine: () => keyBlocks(4, 4),
      },
    ],
  },
];

// ---------- Thông báo trang chủ ----------

const ANNOUNCEMENT_TITLE = 'Giao hàng tự động 24/7';
const ANNOUNCEMENT_BODY = [
  'Mọi đơn hàng được giao ngay sau khi thanh toán thành công — mã sản phẩm hiện trực tiếp trong trang đơn hàng của bạn.',
  'Thanh toán bằng USDT qua Binance Pay. Cần hỗ trợ? Nhắn cho chúng tôi kèm mã đơn hàng, phản hồi trong vòng 24 giờ.',
].join('\n');

// ---------- Seed ----------

/**
 * Mã khách hàng ngẫu nhiên 8 chữ số, thử lại khi trùng — bản sao cục bộ của
 * `src/common/customer-code.ts` (seed được biên dịch riêng bằng
 * `tsc prisma/seed.ts` nên không import được từ src/).
 */
async function generateUniqueCustomerCode(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomInt(10_000_000, 100_000_000);
    const taken = await prisma.user.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  throw new Error('Không tìm được mã khách hàng trống sau nhiều lần thử');
}

/**
 * Tạo user nếu chưa có. KHÔNG BAO GIỜ ghi đè tài khoản đã tồn tại.
 *
 * Trước đây hàm này `update` cả `passwordHash` lẫn `role`, mà seed lại chạy ở
 * mỗi lần khởi động container: đổi mật khẩu admin xong khởi động lại là mật khẩu
 * quay về giá trị mặc định trong biến môi trường. Tệ hơn, ai đăng ký trước bằng
 * email admin sẽ được seed nâng thành SUPERADMIN.
 */
async function ensureUser(
  email: string,
  passwordHash: string,
  role: 'USER' | 'SUPERADMIN',
): Promise<{ code: number; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { code: true },
  });
  if (existing) {
    return { code: existing.code, created: false };
  }
  const code = await generateUniqueCustomerCode();
  const created = await prisma.user.create({
    data: { email, passwordHash, role, code },
    select: { code: true },
  });
  return { code: created.code, created: true };
}

async function seedUsers(): Promise<void> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@cattstore.local')
    .trim()
    .toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      'Thiếu ADMIN_PASSWORD — đặt trong .env trước khi seed. Không còn mật khẩu mặc định.',
    );
  }
  const adminHash = await bcrypt.hash(adminPassword, 10);

  // Chủ cửa hàng (SUPERADMIN) — chỉ tạo khi CHƯA có, không bao giờ ghi đè.
  const admin = await ensureUser(adminEmail, adminHash, 'SUPERADMIN');
  console.log(
    admin.created
      ? `✔ Đã tạo tài khoản chủ cửa hàng: ${adminEmail} (mã #${admin.code})`
      : `• Tài khoản chủ cửa hàng đã tồn tại: ${adminEmail} (mã #${admin.code}) — giữ nguyên mật khẩu và vai trò`,
  );

  if (!SEED_DEMO) return;
  const demoEmail = 'user@cattstore.local';
  const demoHash = await bcrypt.hash('User@123', 10);
  const demo = await ensureUser(demoEmail, demoHash, 'USER');
  console.log(`✔ Tài khoản demo: ${demoEmail} (mã #${demo.code})`);
}

/**
 * Dữ liệu cũ được migration chuyển thành một loại tên "Mặc định". Với sản phẩm
 * nay có nhiều loại, đổi tên loại đó thành loại đầu tiên để kho cũ không mồ côi.
 */
async function adoptLegacyDefaultVariant(
  productId: string,
  firstName: string,
): Promise<void> {
  if (firstName === DEFAULT_VARIANT_NAME) return;
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, name: true },
  });
  if (variants.length !== 1 || variants[0].name !== DEFAULT_VARIANT_NAME) return;
  await prisma.productVariant.update({
    where: { id: variants[0].id },
    data: { name: firstName },
  });
}

async function seedProducts(): Promise<void> {
  for (const item of PRODUCTS) {
    const data = {
      name: item.name,
      currency: 'USDT',
      icon: item.icon,
      category: item.category,
      sortOrder: item.sortOrder,
      shortDescription: item.shortDescription,
      description: item.description,
      active: true,
    };
    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: data,
      create: { slug: item.slug, ...data },
    });

    await adoptLegacyDefaultVariant(product.id, item.variants[0].name);

    for (const seedVariant of item.variants) {
      const existing = await prisma.productVariant.findFirst({
        where: { productId: product.id, name: seedVariant.name },
        select: { id: true },
      });
      const variant = existing
        ? await prisma.productVariant.update({
            where: { id: existing.id },
            data: {
              price: seedVariant.price,
              sortOrder: seedVariant.sortOrder,
              active: true,
            },
          })
        : await prisma.productVariant.create({
            data: {
              productId: product.id,
              name: seedVariant.name,
              price: seedVariant.price,
              sortOrder: seedVariant.sortOrder,
              active: true,
            },
          });

      const existingStock = await prisma.stockItem.count({
        where: { variantId: variant.id },
      });
      if (existingStock === 0 && seedVariant.stockCount > 0) {
        const lines = uniqueLines(seedVariant.stockCount, seedVariant.stockLine);
        await prisma.stockItem.createMany({
          data: lines.map((content) => ({ variantId: variant.id, content })),
        });
        console.log(
          `✔ "${item.name}" / "${seedVariant.name}" — đã thêm ${lines.length} dòng kho`,
        );
      } else {
        console.log(
          `✔ "${item.name}" / "${seedVariant.name}" — giữ nguyên kho (${existingStock} dòng)`,
        );
      }
    }
  }
}

async function seedAnnouncement(): Promise<void> {
  const existing = await prisma.announcement.findUnique({
    where: { id: ANNOUNCEMENT_ID },
  });
  // Đã có nội dung do quản trị viên soạn → không ghi đè.
  if (existing && (existing.title.trim() !== '' || existing.body.trim() !== '')) {
    console.log('✔ Thông báo trang chủ — giữ nguyên nội dung hiện có');
    return;
  }

  const data = {
    active: true,
    title: ANNOUNCEMENT_TITLE,
    body: ANNOUNCEMENT_BODY,
  };
  await prisma.announcement.upsert({
    where: { id: ANNOUNCEMENT_ID },
    create: { id: ANNOUNCEMENT_ID, ...data },
    update: data,
  });
  console.log('✔ Thông báo trang chủ — đã thêm thông báo mẫu (đang bật)');
}

async function main(): Promise<void> {
  console.log('Bắt đầu seed dữ liệu...');
  await seedUsers();
  if (SEED_DEMO) {
    await seedProducts();
    await seedAnnouncement();
  } else {
    console.log(
      '• Bỏ qua sản phẩm/thông báo mẫu (đặt SEED_DEMO=true nếu muốn dữ liệu demo).',
    );
  }
  console.log('Hoàn tất seed dữ liệu.');
}

main()
  .catch((error) => {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
