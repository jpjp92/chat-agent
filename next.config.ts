import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API routes use Node.js runtime (Gemini SDK, LangGraph, Supabase service role)
  // Do NOT set runtime: 'edge' globally
  allowedDevOrigins: ['127.0.0.1'],
  // kordoc은 nodejs 런타임에서 require로 동작. 번들링하면 webpack이 kordoc 내부의
  // pdfjs-dist worker(PDF 경로용·미설치) 정적 import를 해석하려다 빌드 실패 →
  // 외부 패키지로 지정해 번들 제외(HWP 경로만 사용하므로 런타임 정상). 설계: PLAN_KORDOC §2
  serverExternalPackages: ['kordoc'],
  // Security headers (ported from vercel.json)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-src https://www.youtube.com; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
