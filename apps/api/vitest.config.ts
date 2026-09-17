import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Nhiều suite tạo/xóa database đồng thời từng làm teardown vượt hạn dù logic xanh.
    // Giới hạn worker thay vì nới timeout để vẫn bắt test bị treo thật.
    maxWorkers: 4,
    /*
     * CHỈ chạy test từ mã nguồn. `nest build` cũng biên dịch file .spec.ts ra
     * dist/ dưới dạng CommonJS; vitest không import được bản đó và sẽ báo lỗi
     * giả, che mất kết quả thật.
     */
    include: ['src/**/*.spec.ts'],
    exclude: ['dist/**', 'dist-seed/**', 'node_modules/**'],
  },
});
