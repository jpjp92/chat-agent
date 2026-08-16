import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API routes use Node.js runtime (Gemini SDK, LangGraph, Supabase service role)
  // Do NOT set runtime: 'edge' globally
  allowedDevOrigins: ['127.0.0.1'],
  // kordoc은 nodejs 런타임에서 require로 동작. 번들링하면 webpack이 kordoc 내부의
  // pdfjs-dist worker(PDF 경로용·미설치) 정적 import를 해석하려다 빌드 실패 →
  // 외부 패키지로 지정해 번들 제외(HWP 경로만 사용하므로 런타임 정상). 설계: PLAN_KORDOC §2
  serverExternalPackages: ['kordoc'],
  // 프로덕션 빌드에서 console.log/info/debug/warn 제거(브라우저 콘솔 내부 태그·구조 노출 최소화).
  //
  // ⚠️ 이 설정은 **클라이언트뿐 아니라 서버 코드에도 적용된다.** 그래서 `[SearchPolicy]`·
  //    `[LangGraph] Router decided` 같은 판정 근거 로그가 프로덕션에 아예 존재하지 않았고,
  //    검색 판정 결함을 진단할 때 로그를 찾을 수 없었다(DEV_260815_DEPLOY_CHECK).
  //
  //    실측(2026-08-16): 클라이언트 `console.log` = **0개**, 서버 = 64개.
  //    즉 이 설정이 브라우저에서 지우는 것은 사실상 없고, 서버 진단 로그만 지우고 있었다.
  //
  // KEEP_LOGS=1 이면 전부 보존한다. 진단이 필요할 때만 켠다(로컬: `KEEP_LOGS=1 npm run dev`,
  // Vercel: 환경변수 추가 후 재배포 → 확인 끝나면 제거).
  //
  // ⚠️ 끌 때는 **`compiler` 키 자체를 빼야 한다**(실측 2026-08-16).
  //    `removeConsole: false`도, `compiler: {}`(빈 객체)도 Turbopack dev가 컴파일 직후
  //    **에러 없이 exit 0으로 죽는다.** 그래서 아래는 키 전체를 조건부 스프레드로 둔다.
  ...(process.env.KEEP_LOGS === '1'
    ? {}
    : { compiler: { removeConsole: { exclude: ['error'] } } }),
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
