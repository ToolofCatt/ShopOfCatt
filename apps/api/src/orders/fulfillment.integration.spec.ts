import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FulfillmentService } from './fulfillment.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Test TÍCH HỢP trên PostgreSQL thật — không mock được phần này.
 *
 * `FOR UPDATE`, `FOR UPDATE SKIP LOCKED` và guard trạng thái chỉ tồn tại trong
 * cơ sở dữ liệu; một bản mock sẽ "đạt" mọi test kể cả khi ta xoá hết khoá đi.
 * Mỗi dòng StockItem là một món hàng đã mua bằng tiền: giao gấp đôi hay giao
 * trùng key là mất tiền thật, nên chỗ này phải được canh bằng chạy thật.
 *
 * Suite tự BỎ QUA khi không có PostgreSQL, để `pnpm test` vẫn xanh trên máy
 * chưa chạy `pnpm db:embedded`.
 */

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
/** CSDL riêng cho test — không bao giờ chạm vào CSDL của cửa hàng. */
const TEST_DB = 'webcatt_fulfillment_test';

function urlForDatabase(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function newClient(database: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: urlForDatabase(database) } },
  });
}

async function isPostgresReachable(): Promise<boolean> {
  const admin = newClient('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Không dùng `await` ở cấp cao nhất: tsconfig của api biên dịch ra CommonJS nên
 * `tsc --noEmit` từ chối (TS1378), dù vitest chạy được. Vì vậy việc kiểm kết nối
 * nằm trong beforeAll, và mỗi test tự bỏ qua qua `ctx.skip()`.
 */
let reachable = false;

let prisma: PrismaClient;
let service: FulfillmentService;

/** `it` nhưng tự bỏ qua khi không có PostgreSQL. */
function itDb(
  name: string,
  fn: () => Promise<void>,
  timeout?: number,
): void {
  it(
    name,
    async (ctx) => {
      if (!reachable) {
        ctx.skip();
        return;
      }
      await fn();
    },
    timeout,
  );
}

/** Chạy các file migration theo thứ tự — cũng là bài kiểm tra migration trên CSDL RỖNG. */
async function applyMigrations(client: PrismaClient): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    // Bỏ dòng chú thích TRƯỚC khi tách. Prisma đặt "-- CreateTable" ngay trên
    // mỗi câu lệnh; nếu tách trước rồi mới loại khối bắt đầu bằng "--" thì loại
    // luôn cả câu lệnh nằm dưới chú thích đó.
    // Migration của repo này chỉ có DDL thuần, không có khối $$...$$, nên tách
    // theo dấu ; là an toàn. Thêm khối như vậy thì phải đổi cách chạy ở đây.
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await client.$executeRawUnsafe(statement);
    }
  }
}

beforeAll(async () => {
  reachable = await isPostgresReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fulfillment] Bỏ qua test tích hợp: không kết nối được PostgreSQL tại ${
        new URL(BASE_URL).host
      }. Chạy "pnpm db:embedded" rồi thử lại.`,
    );
    return;
  }
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.$disconnect();
  }
  prisma = newClient(TEST_DB);
  await applyMigrations(prisma);
  service = new FulfillmentService(prisma as unknown as PrismaService);
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}, 60_000);

afterEach(async () => {
  if (!reachable) return;
  // Xoá theo thứ tự phụ thuộc; StockItem trước vì nó trỏ tới OrderItem.
  await prisma.stockItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
});

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

interface Scenario {
  orderId: string;
  orderItemId: string;
  variantId: string;
}

/**
 * Dựng một đơn kèm kho. `reserved` = số dòng RESERVED gán sẵn cho order item,
 * `available` = số dòng AVAILABLE còn tự do trong cùng loại sản phẩm.
 */
async function makeScenario(options: {
  quantity: number;
  reserved: number;
  available: number;
  status?: 'PENDING' | 'PAID';
  expiresAt?: Date | null;
}): Promise<Scenario> {
  const { quantity, reserved, available } = options;
  const tag = unique('t');

  const user = await prisma.user.create({
    data: {
      email: `${tag}@test.local`,
      passwordHash: 'x',
      code: 10_000_000 + counter,
    },
  });
  const product = await prisma.product.create({
    data: { slug: tag, name: `San pham ${tag}` },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, name: 'Mặc định', price: '10.00' },
  });
  const order = await prisma.order.create({
    data: {
      code: tag.toUpperCase(),
      userId: user.id,
      status: options.status ?? 'PAID',
      subtotalAmount: '10.00',
      totalAmount: '10.00',
      expiresAt: options.expiresAt ?? null,
      items: {
        create: {
          productId: product.id,
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          unitPrice: '10.00',
          quantity,
        },
      },
    },
    include: { items: true },
  });
  const orderItemId = order.items[0].id;

  for (let i = 0; i < reserved; i++) {
    await prisma.stockItem.create({
      data: {
        variantId: variant.id,
        content: `${tag}-RESERVED-${i}`,
        status: 'RESERVED',
        orderItemId,
      },
    });
  }
  for (let i = 0; i < available; i++) {
    await prisma.stockItem.create({
      data: {
        variantId: variant.id,
        content: `${tag}-AVAILABLE-${i}`,
        status: 'AVAILABLE',
      },
    });
  }

  return { orderId: order.id, orderItemId, variantId: variant.id };
}

async function soldContents(orderItemId: string): Promise<string[]> {
  const rows = await prisma.stockItem.findMany({
    where: { orderItemId, status: 'SOLD' },
    select: { content: true },
    orderBy: { content: 'asc' },
  });
  return rows.map((r) => r.content);
}


/**
 * Dựng một loại sản phẩm với `soKey` dòng kho AVAILABLE, đặt trước kiểu rút.
 *
 * Kho nạp bằng `createMany` — GIỐNG HỆT đường mà trang quản trị đi — nên mọi
 * dòng có `createdAt` bằng nhau. Đó chính là điều kiện làm lộ ra chuyện "tuần
 * tự" có thật sự tuần tự hay không.
 */
async function makeKho(options: {
  soKey: number;
  drawMode: 'SEQUENTIAL' | 'RANDOM';
}): Promise<{ variantId: string; thuTuNap: string[] }> {
  const tag = unique('kho');
  const product = await prisma.product.create({
    data: { slug: tag, name: `San pham ${tag}`, stockDrawMode: options.drawMode },
  });
  const variant = await prisma.productVariant.create({
    data: { productId: product.id, name: 'Mặc định', price: '10.00' },
  });
  const thuTuNap = Array.from({ length: options.soKey }, (_, i) =>
    `${tag}-KEY-${String(i).padStart(3, '0')}`,
  );
  await prisma.stockItem.createMany({
    data: thuTuNap.map((content) => ({ variantId: variant.id, content })),
  });
  return { variantId: variant.id, thuTuNap };
}

/**
 * Rút `soLuong` dòng kho rồi trả về NỘI DUNG của chúng, theo đúng thứ tự rút.
 *
 * Đánh dấu RESERVED ngay trong cùng transaction — đúng như luồng đặt đơn thật
 * (`orders.service.ts`). `lockAvailableStock` chỉ KHOÁ chứ không đổi trạng thái,
 * mà khoá thì nhả khi transaction kết thúc; thiếu bước này thì hai lần rút liên
 * tiếp cùng trả về một dòng.
 */
async function rut(variantId: string, soLuong: number): Promise<string[]> {
  const ids = await prisma.$transaction(async (tx) => {
    const lay = await service.lockAvailableStock(tx, variantId, soLuong);
    if (lay.length > 0) {
      await tx.stockItem.updateMany({
        where: { id: { in: lay } },
        data: { status: 'RESERVED' },
      });
    }
    return lay;
  });
  const rows = await prisma.stockItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, content: true },
  });
  const theoId = new Map(rows.map((r) => [r.id, r.content]));
  return ids.map((id) => theoId.get(id) as string);
}

describe('FulfillmentService trên PostgreSQL thật', () => {
  itDb('rút kho tay KHÔNG giành được dòng mà một đơn đang giữ', async () => {
    const { variantId } = await makeKho({ soKey: 6, drawMode: 'SEQUENTIAL' });

    /*
     * Đây là bài quan trọng nhất của tính năng rút kho tay.
     *
     * Một "đơn của khách" giữ 4 dòng và CHƯA commit; cùng lúc chủ shop rút 6
     * dòng. Nếu việc rút tay đi bằng một truy vấn riêng không có SKIP LOCKED,
     * nó sẽ lấy trùng dòng của đơn kia — khách trả tiền xong mới biết key đã bị
     * thu hồi. Với SKIP LOCKED thì lượt rút chỉ được 2 dòng còn lại.
     */
    let donDaGiu: () => void = () => {};
    const dangGiu = new Promise<void>((res) => {
      donDaGiu = res;
    });
    let choRutXong: () => void = () => {};
    const rutXong = new Promise<void>((res) => {
      choRutXong = res;
    });

    const donCuaKhach = prisma.$transaction(async (tx) => {
      const ids = await service.lockAvailableStock(tx, variantId, 4);
      donDaGiu();
      await rutXong;
      return ids;
    });

    await dangGiu;
    const rutTay = await prisma.$transaction(async (tx) => {
      // Chủ shop chọn thứ tự ngay lúc rút, không theo cấu hình sản phẩm.
      const ids = await service.lockAvailableStock(tx, variantId, 6, 'RANDOM');
      await tx.stockItem.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      return ids;
    });
    choRutXong();
    const cuaDon = await donCuaKhach;

    expect(cuaDon).toHaveLength(4);
    expect(rutTay).toHaveLength(2);
    expect(rutTay.filter((id) => cuaDon.includes(id))).toEqual([]);
  }, 30_000);

  itDb('dòng đã rút không còn bán được nữa', async () => {
    const { variantId } = await makeKho({ soKey: 5, drawMode: 'SEQUENTIAL' });

    await prisma.$transaction(async (tx) => {
      const ids = await service.lockAvailableStock(tx, variantId, 3);
      await tx.stockItem.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
    });

    // Chỉ còn 2 dòng bán được, dù kho vẫn có 5 dòng.
    expect(
      await prisma.stockItem.count({ where: { variantId, status: 'AVAILABLE' } }),
    ).toBe(2);
    expect(await prisma.stockItem.count({ where: { variantId } })).toBe(5);

    const lay = await rut(variantId, 5);
    expect(lay).toHaveLength(2);
  });

  itDb('trả lại kho: dòng đã rút bán được trở lại', async () => {
    const { variantId } = await makeKho({ soKey: 4, drawMode: 'SEQUENTIAL' });

    const daRut = await prisma.$transaction(async (tx) => {
      const ids = await service.lockAvailableStock(tx, variantId, 2);
      await tx.stockItem.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      return ids;
    });

    const { count } = await prisma.stockItem.updateMany({
      where: { id: daRut[0], status: 'WITHDRAWN' },
      data: { status: 'AVAILABLE', withdrawnAt: null },
    });
    expect(count).toBe(1);
    expect(
      await prisma.stockItem.count({ where: { variantId, status: 'AVAILABLE' } }),
    ).toBe(3);

    // Bấm trả lại lần thứ hai khớp 0 dòng — không ghi đè trạng thái đã đổi.
    const lai = await prisma.stockItem.updateMany({
      where: { id: daRut[0], status: 'WITHDRAWN' },
      data: { status: 'AVAILABLE', withdrawnAt: null },
    });
    expect(lai.count).toBe(0);
  });

  itDb('rút TUẦN TỰ: đúng thứ tự nạp vào kho, kể cả khi createdAt giống hệt nhau', async () => {
    const { variantId, thuTuNap } = await makeKho({ soKey: 12, drawMode: 'SEQUENTIAL' });

    // Điều kiện tiên quyết: createMany làm mọi dòng cùng một mốc thời gian.
    const moc = await prisma.stockItem.findMany({
      where: { variantId },
      select: { createdAt: true },
    });
    const socMoc = new Set(moc.map((r) => r.createdAt.getTime()));
    expect(socMoc.size).toBe(1);

    expect(await rut(variantId, 4)).toEqual(thuTuNap.slice(0, 4));
    expect(await rut(variantId, 3)).toEqual(thuTuNap.slice(4, 7));
  });

  itDb('rút NGẪU NHIÊN: không bám theo thứ tự nạp', async () => {
    const { variantId, thuTuNap } = await makeKho({ soKey: 40, drawMode: 'RANDOM' });

    const lay = await rut(variantId, 10);
    expect(lay).toHaveLength(10);
    expect(new Set(lay).size).toBe(10); // không trùng nhau
    expect(new Set(thuTuNap).size).toBe(40);
    for (const k of lay) expect(thuTuNap).toContain(k);

    /*
     * Xác suất 10 lần rút đầu tiên trùng đúng 10 key đầu kho là 1/C(40,10)
     * ≈ 1 trên 847 triệu — nên phép so sánh này không phải là test hay hỏng vặt.
     */
    expect(lay).not.toEqual(thuTuNap.slice(0, 10));
  });

  itDb('rút ngẫu nhiên KHÔNG phá tính an toàn khi hai đơn đặt cùng lúc', async () => {
    const { variantId } = await makeKho({ soKey: 30, drawMode: 'RANDOM' });

    /*
     * Hai transaction chạy song song, mỗi bên rút 10 dòng và GIỮ khoá tới khi cả
     * hai cùng rút xong. Nếu SKIP LOCKED bị đánh mất khi đổi ORDER BY, hai bên
     * sẽ nhận chung dòng — đúng cái lỗi giao trùng key mà khoá này sinh ra để chặn.
     */
    let moKhoa: () => void = () => {};
    const caHaiDaRut = new Promise<void>((res) => {
      let dem = 0;
      moKhoa = () => {
        dem += 1;
        if (dem === 2) res();
      };
    });

    const mot = async (): Promise<string[]> =>
      prisma.$transaction(async (tx) => {
        const ids = await service.lockAvailableStock(tx, variantId, 10);
        moKhoa();
        await caHaiDaRut;
        return ids;
      });

    const [a, b] = await Promise.all([mot(), mot()]);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(10);
    const chung = a.filter((id) => b.includes(id));
    expect(chung).toEqual([]);
  }, 30_000);

  itDb('rút ngẫu nhiên vẫn vét sạch kho, không bỏ sót dòng nào', async () => {
    const { variantId, thuTuNap } = await makeKho({ soKey: 15, drawMode: 'RANDOM' });

    const daRut: string[] = [];
    for (let i = 0; i < 5; i++) daRut.push(...(await rut(variantId, 3)));

    expect(daRut).toHaveLength(15);
    expect([...daRut].sort()).toEqual([...thuTuNap].sort());
    expect(await rut(variantId, 3)).toEqual([]);
  });

  itDb('đổi kiểu rút giữa chừng có hiệu lực ngay, không cần khởi động lại', async () => {
    const { variantId, thuTuNap } = await makeKho({ soKey: 20, drawMode: 'SEQUENTIAL' });
    expect(await rut(variantId, 3)).toEqual(thuTuNap.slice(0, 3));

    await prisma.product.updateMany({
      where: { variants: { some: { id: variantId } } },
      data: { stockDrawMode: 'RANDOM' },
    });

    const sau = await rut(variantId, 8);
    expect(sau).toHaveLength(8);
    expect(sau).not.toEqual(thuTuNap.slice(3, 11));
  });

  itDb('giao hàng bình thường: dùng dòng RESERVED, đơn thành DELIVERED', async () => {
    const s = await makeScenario({ quantity: 1, reserved: 1, available: 3 });

    await expect(service.deliverOrder(s.orderId)).resolves.toBe(true);

    expect(await soldContents(s.orderItemId)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('DELIVERED');
  });

  itDb('HAI lần giao SONG SONG chỉ giao một lần (chống bấm "giao lại" hai lần)', async () => {
    // Đây là lý do dòng Order bị khoá FOR UPDATE trước mọi thứ khác. Không có
    // khoá đó, cả hai transaction cùng đọc alreadySold = 0 rồi SKIP LOCKED cấp
    // cho mỗi bên một tập dòng KHÁC NHAU — khách nhận gấp đôi số key.
    const s = await makeScenario({ quantity: 1, reserved: 1, available: 5 });

    const results = await Promise.all([
      service.deliverOrder(s.orderId),
      service.deliverOrder(s.orderId),
    ]);

    expect(results).toEqual([true, true]);
    expect(await soldContents(s.orderItemId)).toHaveLength(1);
  }, 30_000);

  itDb('BỐN lần giao song song vẫn chỉ đúng số lượng đã đặt', async () => {
    const s = await makeScenario({ quantity: 2, reserved: 2, available: 10 });

    await Promise.all([
      service.deliverOrder(s.orderId),
      service.deliverOrder(s.orderId),
      service.deliverOrder(s.orderId),
      service.deliverOrder(s.orderId),
    ]);

    expect(await soldContents(s.orderItemId)).toHaveLength(2);
  }, 60_000);

  itDb('markPaidAndDeliver gọi hai lần song song (webhook trùng) không cộng dồn', async () => {
    const s = await makeScenario({
      quantity: 1,
      reserved: 1,
      available: 5,
      status: 'PENDING',
    });
    await prisma.payment.create({
      data: {
        orderId: s.orderId,
        merchantTradeNo: unique('trade'),
        amount: '10.00',
      },
    });

    const results = await Promise.all([
      service.markPaidAndDeliver({ orderId: s.orderId }),
      service.markPaidAndDeliver({ orderId: s.orderId }),
    ]);

    // Bất biến thật sự: kho chỉ bán đúng MỘT dòng và đơn kết thúc ở DELIVERED.
    expect(await soldContents(s.orderItemId)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('DELIVERED');

    // Lần gọi thua cuộc thấy guard đã đóng (gate.count = 0) rồi đọc trạng thái
    // NGAY LÚC lần thắng còn đang giao, nên nó có thể báo 'PAID' — chấp nhận
    // được, vì nó không giao thêm dòng nào. Chỉ cần không có lần nào báo sai
    // thành trạng thái khác hai giá trị này.
    expect(results.every((r) => r !== null)).toBe(true);
    for (const r of results) {
      expect(['PAID', 'DELIVERED']).toContain(r?.status);
    }
    expect(results.some((r) => r?.status === 'DELIVERED')).toBe(true);
  }, 30_000);

  itDb('thiếu kho thì giữ PAID và KHÔNG đánh dấu DELIVERED', async () => {
    // Giao thiếu mà vẫn báo DELIVERED là khách trả tiền hai key nhận một key,
    // rồi không ai biết đơn nào còn nợ hàng.
    const s = await makeScenario({ quantity: 2, reserved: 0, available: 1 });

    await expect(service.deliverOrder(s.orderId)).resolves.toBe(false);

    expect(await soldContents(s.orderItemId)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('PAID');
  });

  itDb('hai đơn tranh nhau dòng kho CUỐI CÙNG: chỉ một đơn được nhận', async () => {
    // SKIP LOCKED bảo đảm bên thứ hai không nhận cùng một dòng — nếu thay bằng
    // findMany rồi update, hai khách nhận TRÙNG key.
    const productTag = unique('race');
    const product = await prisma.product.create({
      data: { slug: productTag, name: 'Hang sap het' },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, name: 'Mặc định', price: '10.00' },
    });
    await prisma.stockItem.create({
      data: { variantId: variant.id, content: 'DONG-KHO-CUOI-CUNG', status: 'AVAILABLE' },
    });

    const orderIds: string[] = [];
    const itemIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: {
          email: `${productTag}-${i}@test.local`,
          passwordHash: 'x',
          code: 20_000_000 + counter * 10 + i,
        },
      });
      const order = await prisma.order.create({
        data: {
          code: `${productTag}-${i}`.toUpperCase(),
          userId: user.id,
          status: 'PAID',
          subtotalAmount: '10.00',
          totalAmount: '10.00',
          items: {
            create: {
              productId: product.id,
              variantId: variant.id,
              productName: product.name,
              variantName: variant.name,
              unitPrice: '10.00',
              quantity: 1,
            },
          },
        },
        include: { items: true },
      });
      orderIds.push(order.id);
      itemIds.push(order.items[0].id);
    }

    const results = await Promise.all(orderIds.map((id) => service.deliverOrder(id)));

    // Đúng một đơn được giao đủ, đơn còn lại giữ PAID vì hết hàng.
    expect(results.filter(Boolean)).toHaveLength(1);
    const soldTotal = await prisma.stockItem.count({ where: { status: 'SOLD' } });
    expect(soldTotal).toBe(1);
    const sold = [...(await soldContents(itemIds[0])), ...(await soldContents(itemIds[1]))];
    expect(sold).toEqual(['DONG-KHO-CUOI-CUNG']);
  }, 30_000);

  itDb('quét đơn hết hạn KHÔNG nhả dòng đã bán của đơn đã giao', async () => {
    // Đơn đã DELIVERED mà bị nhả kho là dòng key đã giao cho khách quay lại kho
    // và được bán lần thứ hai cho người khác.
    const s = await makeScenario({
      quantity: 1,
      reserved: 1,
      available: 0,
      status: 'PAID',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await service.deliverOrder(s.orderId);

    await service.releaseExpiredOrders();

    expect(await soldContents(s.orderItemId)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('DELIVERED');
    expect(await prisma.stockItem.count({ where: { status: 'AVAILABLE' } })).toBe(0);
  }, 30_000);

  itDb('quét đơn hết hạn nhả kho của đơn PENDING quá hạn', async () => {
    const s = await makeScenario({
      quantity: 1,
      reserved: 1,
      available: 0,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await service.releaseExpiredOrders();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('EXPIRED');
    const stock = await prisma.stockItem.findFirstOrThrow({
      where: { variantId: s.variantId },
    });
    expect(stock.status).toBe('AVAILABLE');
    expect(stock.orderItemId).toBeNull();
  }, 30_000);

  itDb('đơn PENDING chưa quá hạn thì không bị nhả', async () => {
    const s = await makeScenario({
      quantity: 1,
      reserved: 1,
      available: 0,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    await service.releaseExpiredOrders();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe('PENDING');
  });

  itDb('giao hàng và quét hết hạn chạy song song không deadlock', async () => {
    // Cả hai đều khoá Order rồi mới tới StockItem. Đảo thứ tự ở một bên là
    // Postgres phải hủy một transaction vì deadlock.
    const paid = await makeScenario({ quantity: 1, reserved: 1, available: 2 });
    const stale = await makeScenario({
      quantity: 1,
      reserved: 1,
      available: 0,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await Promise.all([
      service.deliverOrder(paid.orderId),
      service.releaseExpiredOrders(),
      service.deliverOrder(paid.orderId),
      service.releaseExpiredOrders(),
    ]);

    expect(await soldContents(paid.orderItemId)).toHaveLength(1);
    const staleOrder = await prisma.order.findUniqueOrThrow({
      where: { id: stale.orderId },
    });
    expect(staleOrder.status).toBe('EXPIRED');
  }, 60_000);

  itDb('đơn đã DELIVERED thì markPaidAndDeliver không giao thêm', async () => {
    const s = await makeScenario({ quantity: 1, reserved: 1, available: 5 });
    await service.deliverOrder(s.orderId);

    const again = await service.markPaidAndDeliver({ orderId: s.orderId });

    expect(again).toEqual({ status: 'DELIVERED', delivered: true });
    expect(await soldContents(s.orderItemId)).toHaveLength(1);
  }, 30_000);

  itDb('markPaidAndDeliver với mã giao dịch không tồn tại trả null', async () => {
    await expect(
      service.markPaidAndDeliver({ merchantTradeNo: 'khong-ton-tai' }),
    ).resolves.toBeNull();
  });
});
