import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Xuất bản dạng standalone để image Docker chỉ chứa đúng thứ cần chạy
  output: 'standalone',
  // Monorepo: trace file từ thư mục gốc để gom cả packages/shared
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@webcatt/shared'],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
