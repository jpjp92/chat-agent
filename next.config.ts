import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API 라우트는 Node.js 런타임 (Gemini SDK, LangGraph, Supabase service role)
  // runtime: 'edge' 를 전역으로 걸지 말 것
  allowedDevOrigins: ['127.0.0.1'],
  // next dev 가 레포 루트에 AGENTS.md·CLAUDE.md 를 자동 생성하지 않게 한다(불필요).
  agentRules: false,
  // kordoc은 nodejs 런타임에서 require로 동작한다. 번들링하면 webpack이 kordoc 내부의
  // pdfjs-dist worker(PDF 경로용·미설치) 정적 import를 해석하려다 빌드가 실패하므로
  // 외부 패키지로 지정해 번들에서 뺀다(HWP 경로만 사용). 설계: PLAN_KORDOC §2
  // pdfjs-dist 도 같은 이유로 서버 번들에서 뺀다 — fetch-url 이 링크 PDF 텍스트를 노드에서 추출한다(DEV_261014).
  // 브라우저 번들(lib/pdf-text.ts, 업로드 PDF)은 이 설정과 무관하다.
  serverExternalPackages: ['kordoc', 'pdfjs-dist'],
  // 프로덕션 빌드에서 console.log/info/debug/warn 제거(브라우저 콘솔 내부 태그·구조 노출 최소화).
  //
  // 주의: 이 설정은 **클라이언트뿐 아니라 서버 코드에도 적용된다** — 켜져 있으면 `[SearchPolicy]`·
  // `[LangGraph] Router decided` 같은 판정 근거 로그가 프로덕션에 남지 않는다(클라이언트 console.log 는
  // 거의 없고 대부분 서버 진단 로그다) → DEV_260815_DEPLOY_CHECK
  //
  // KEEP_LOGS=1 이면 전부 보존한다. 진단이 필요할 때만 켠다(로컬: `KEEP_LOGS=1 npm run dev`,
  // Vercel: 환경변수 추가 후 재배포 → 확인 끝나면 제거).
  //
  // 주의: 끌 때는 **`compiler` 키 자체를 빼야 한다.** `removeConsole: false`도, `compiler: {}`도
  // Turbopack dev가 컴파일 직후 에러 없이 exit 0으로 죽는다. 그래서 키 전체를 조건부 스프레드로 둔다.
  ...(process.env.KEEP_LOGS === '1'
    ? {}
    : { compiler: { removeConsole: { exclude: ['error'] } } }),
  // 보안 헤더 (vercel.json 에서 이전)
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
            // accounts.google.com — Google 로그인 버튼(GIS)이 iframe 으로 그려진다(components/GoogleIdButton.tsx).
            value: "frame-src https://www.youtube.com https://accounts.google.com; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
