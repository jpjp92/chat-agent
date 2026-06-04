import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API routes use Node.js runtime (Gemini SDK, LangGraph, Supabase service role)
  // Do NOT set runtime: 'edge' globally
  outputFileTracingIncludes: {
    '/api/fetch-url': [
      './node_modules/@sparticuz/chromium/bin/al2023.tar.br',
      './node_modules/@sparticuz/chromium/bin/chromium.br',
      './node_modules/@sparticuz/chromium/bin/fonts.tar.br',
      './node_modules/playwright-core/browsers.json',
    ],
  },

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
