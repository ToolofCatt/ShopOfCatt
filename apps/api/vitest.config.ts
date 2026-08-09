import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * CHỈ chạy test từ mã nguồn. `nest build` cũng biên dịch file .spec.ts ra
     * dist/ dưới dạng CommonJS; vitest không import được bản đó và sẽ báo lỗi
     * giả, che mất kết quả thật.
     */
    include: ['src/**/*.spec.ts'],
    exclude: ['dist/**', 'dist-seed/**', 'node_modules/**'],
  },
});
