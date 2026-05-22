# Vite → Next.js 전환 플랜

> 목적: 현재 React 19 + Vite + Vercel Serverless Functions 구조를 Next.js로 이전할 때의 범위, 순서, 위험 지점을 정리한다. 이 문서는 실행 계획이며, 우선순위 0 보안 수정과는 별도로 진행한다.

---

## 1. 현재 구조 요약

- Frontend: `index.html`, `index.tsx`, `App.tsx`, `components/**`, `src/hooks/**`
- Build: Vite (`vite.config.ts`)
- API: Vercel Functions (`api/*.ts`)
- Shared server code: `api/_lib/**`
- Client API wrapper: `services/geminiService.ts`
- Styling: Tailwind + `index.css`
- Deployment: `vercel.json` functions/header 설정

현재 구조는 SPA + Vercel Functions에 가깝다. Next.js 전환의 1차 목표는 SSR 앱 재작성보다 **동일 UX를 유지한 App Router 기반 SPA shell + Route Handlers**로 옮기는 것이다.

2026-05-21 재검토 기준:
- 전환 목적은 성능 최적화보다 **API 경계 정리, server-only 코드 격리, 향후 DTO/Auth/RLS 작업 기반 마련**에 둔다.
- `api/chat.ts` SSE와 파일 업로드/body size 계약이 가장 큰 위험 지점이다.
- `App.tsx`와 대부분 렌더러는 browser-only API를 사용하므로, 초기 전환에서는 React Server Components 최적화를 시도하지 않는다.

---

## 2. 전환 원칙

1. 기능 변경 없이 라우팅/빌드/배포 레이어만 먼저 이전한다.
2. 기존 `api/_lib/**` 서버 로직은 최대한 보존한다.
3. 채팅 UI는 우선 Client Component로 유지한다.
4. `fetch-url`, `proxy-image`, `sync-drug-image`의 SSRF 리다이렉트 차단은 Next.js 이전 전에 완료한다.
5. Supabase Auth/RLS 전환은 Next.js 이전과 분리한다.
6. `api/chat.ts` SSE 이전은 마지막 단계로 둔다. 일반 JSON API 이전 성공 후 별도 검증한다.
7. Route Handler는 기본적으로 Node runtime을 사용한다. Gemini SDK, LangGraph, Supabase service role, 파일 처리 경로를 Edge runtime으로 옮기지 않는다.

---

## 3. 목표 디렉터리 구조

```txt
app/
  layout.tsx
  page.tsx
  globals.css
  api/
    chat/route.ts
    speech/route.ts
    summarize-title/route.ts
    sync-drug-image/route.ts
    pill-search/route.ts
    sessions/route.ts
    upload/route.ts
    fetch-url/route.ts
    fetch-transcript/route.ts
    auth/route.ts
    create-signed-url/route.ts
    proxy-image/route.ts
components/
src/
server/
  config.ts
  models.ts
  supabase.ts
  agent/**
```

권장: `api/_lib/**`는 `server/**`로 이동하고, Route Handler에서만 import한다.

---

## 4. 단계별 계획

### Phase 0. 사전 정리

- `npx tsc --noEmit` 기준 통과 상태 확보
- P0 SSRF 리다이렉트 차단 완료
- `.env.local` / Vercel 환경변수 목록 정리
- 현재 Vite production build warning과 큰 chunk 목록 기록
- 현재 API 계약 스냅샷 기록:
  - `/api/chat` SSE 이벤트: `text`, `sources`, `heartbeat`, `cutOff`, `done`, `error`
  - `/api/chat` body size: Vercel Function `10mb`
  - `/api/upload` body size: Vercel Function `30mb`
  - `/api/proxy-image` binary image response
- `api/chat.ts`를 세부 함수로 먼저 쪼개는지 검토:
  - request normalization
  - SSE event writing
  - LangGraph event loop
  - source extraction
  - DB persistence

> `api/chat.ts` 분리는 Next 전환의 필수 선행 작업은 아니지만, Route Handler 이전 난도를 낮춘다.

### Phase 1. Next.js 기본 골격 추가

- `next`, `eslint-config-next` 설치
- `next.config.js` 추가
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` 추가
- `index.html`, `index.tsx` 역할을 `app/page.tsx`로 이전
- `index.css`를 `app/globals.css`로 이동하거나 import 경로 조정
- `package.json` scripts 전환:
  - `dev`: `next dev`
  - `build`: `next build`
  - `start`: `next start`
- **환경 변수 접두사 변환**:
  - 기존 Vite의 `import.meta.env.VITE_SUPABASE_URL` 등을 Next.js용 `process.env.NEXT_PUBLIC_SUPABASE_URL`로 전환 필요. (클라이언트 번들에 노출되는 변수만 접두사를 붙이고, 백엔드 전용 API key는 `process.env.API_KEY` 형태로 안전하게 유지)

### Phase 2. UI Client Boundary 고정

- `App.tsx` 최상단 또는 wrapper에 `"use client"` 추가
- browser-only 코드 확인 및 예외 처리:
  - `window`
  - `localStorage`
  - `AudioContext`
  - `FileReader`
  - canvas download
- lazy renderer들은 Client Component 경계 안에서 유지
- `public/data/constellations.json` 접근 경로 확인

현재 확인된 browser-only 지점:
- `App.tsx`: `localStorage`, `document.documentElement`, `window.location`, custom event
- `services/geminiService.ts`: `AudioContext`, `atob`, SSE `ReadableStream` reader
- `ChatInput.tsx`: `FileReader`, canvas resize, `window.innerWidth`
- `ChatMessage.tsx`: clipboard, `window.open`, TTS audio unlock, context menu positioning
- visualization renderers: canvas, NGL/WebGL, `document.body` Portal, download link 생성
- `utils/astronomyHelper.ts`: `navigator.geolocation`

초기 전환에서는 `app/page.tsx`가 client wrapper를 렌더링하고, 기존 `App` 이하를 전부 Client Component graph로 유지한다.

**Hydration Mismatch 및 WebGL 라이브러리 방어 가이드**:
1. **Hydration Mismatch 대처**:
   - `App.tsx` 초기 마운트 시 `localStorage`나 `document` 상태를 동기적으로 읽어 useState에 넣으면 SSR HTML과 불일치가 발생합니다. 
   - `useEffect`가 실행된 직후(Mount 완료 시점)에 브라우저용 API값을 읽어 클라이언트 상태와 맞추거나, `isMounted` 플래그가 참일 때만 해당 요소를 렌더링하는 형태로 제어해야 합니다.
2. **동적 임포트 (`next/dynamic` ssr: false)**:
   - Canvas, WebGL, DOM을 조작하는 라이브러리(`ngl`, `smiles-drawer`, `apexcharts` 등)는 Next.js가 서버에서 사전 렌더링하려고 시도할 시 `window is not defined` 에러로 빌드가 깨집니다.
   - 해당 라이브러리를 참조하는 렌더러 컴포넌트(`ChemicalRenderer.tsx`, `BioRenderer.tsx`, `ChartRenderer.tsx` 등)는 반드시 dynamic import로 로드해야 합니다.
     ```typescript
     import dynamic from 'next/dynamic';
     const ChemicalRenderer = dynamic(() => import('./ChemicalRenderer'), { ssr: false });
     ```

### Phase 3. API Route Handler 이전

기존 `api/*.ts`를 `app/api/*/route.ts`로 이전한다.

| 기존 Vercel Function | Next.js Route Handler |
|----------------------|-----------------------|
| `api/chat.ts` | `app/api/chat/route.ts` |
| `api/fetch-url.ts` | `app/api/fetch-url/route.ts` |
| `api/proxy-image.ts` | `app/api/proxy-image/route.ts` |
| `api/sync-drug-image.ts` | `app/api/sync-drug-image/route.ts` |
| `api/sessions.ts` | `app/api/sessions/route.ts` |
| `api/auth.ts` | `app/api/auth/route.ts` |
| `api/upload.ts` | `app/api/upload/route.ts` |
| `api/create-signed-url.ts` | `app/api/create-signed-url/route.ts` |
| `api/summarize-title.ts` | `app/api/summarize-title/route.ts` |
| `api/speech.ts` | `app/api/speech/route.ts` |
| `api/pill-search.ts` | `app/api/pill-search/route.ts` |
| `api/fetch-transcript.ts` | `app/api/fetch-transcript/route.ts` |

주의 및 세부 설정:
- `VercelRequest` / `VercelResponse` → `NextRequest` / `Response`
- SSE 응답은 `ReadableStream` 기반으로 재구성
- `maxDuration`은 route segment config (`export const maxDuration = 60;`)로 명시
- Node runtime 필요 route는 `export const runtime = 'nodejs'`
- `api/chat.ts`의 `res.write()` 기반 SSE는 `ReadableStream` + `TextEncoder`로 이전
- **Body Parser 용량 한계 대응**:
  - App Router의 Route Handler는 Pages Router의 `export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }`와 같은 간편 설정을 지원하지 않습니다. 
  - Route Handler 내에서 큰 요청 바디 처리를 지원하기 위해 Vercel의 Serverless Function payload limit(Vercel Pro 플랜 4.5MB, Hobby 4.5MB 등)에 직접 도달하지 않도록 1MB 이상 크기의 파일은 Supabase Storage에 PUT으로 직접 업로드하고 backend API로는 URL만 넘기는 기존 설계를 확실히 엄수해야 합니다.
- `api/proxy-image.ts`는 `Buffer` binary 응답을 `Response` body로 변환
- `api/fetch-transcript.ts`는 이미 `Request`/`Response` 형태에 가까워 이전 난도가 낮음

Route Handler 공통 config 권장:

```ts
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
```

SSE route skeleton:

```ts
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 기존 LangGraph streamEvents 루프 이전
        sendEvent({ done: true });
      } catch (error) {
        sendEvent({ error: '...' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### Phase 4. Server-only 보호

- `server/**`에 `server-only` 적용 검토
- `api/_lib/config.ts`의 환경변수 로딩이 client bundle에 포함되지 않는지 확인
- `LAW_OC`, Supabase service role, Gemini API key가 클라이언트 chunk에 노출되지 않는지 grep/build 결과로 검증

권장 구조:
- `server/config.ts`, `server/supabase.ts`, `server/models.ts`, `server/agent/**` 상단에 `import 'server-only';` 적용
- Route Handler만 `server/**`를 import
- Client 코드(`App.tsx`, `services/geminiService.ts`, hooks, renderers)는 `server/**` import 금지
- build 후 `.next/static` 기준으로 secret-like 문자열 grep:
  - `API_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `LAW_OC`
  - 실제 env 값 prefix 일부

### Phase 5. Vercel 설정 이전

- `vercel.json` functions 설정을 Next.js route config와 맞춘다.
- 현재 보안 헤더는 `next.config.js` `headers()`로 이전 가능:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Strict-Transport-Security`
  - `Permissions-Policy`
  - `Content-Security-Policy`

### Phase 6. 검증

- 채팅 기본 응답
- YouTube 요약
- URL 요약 + Jina fallback
- 이미지/PDF/DOCX/XLSX 업로드
- 약품 카드 / 약국 / 병원 / 동물병원 / 법령 카드
- TTS
- 세션 CRUD
- 프로필 이미지 업로드
- SSE 중단/재시도
- 모바일 새로고침 후 첫 쿼리

---

## 5. 주요 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| SSE Route Handler 이전 | 채팅 응답 스트리밍 중단 | `api/chat.ts`를 가장 마지막에 이전, 별도 브랜치 검증 |
| browser-only 코드 SSR 실행 | 빌드 또는 런타임 크래시 | App 전체를 Client Component로 먼저 유지 |
| 서버 secret client 노출 | 보안 사고 | `server/**` 분리, build output grep |
| API 응답 계약 변경 | 프론트 훅 깨짐 | `services/geminiService.ts` 계약 유지 |
| Vercel maxDuration 차이 | 긴 응답 중단 | route config로 명시 |
| 번들 재분할 | 초기 로딩 변동 | 전환 후 Lighthouse 재측정 |
| body size 설정 차이 | 이미지/PDF 업로드 실패 | `chat` 10mb, `upload` 30mb 계약 별도 검증 |
| binary response 변환 | 프록시 이미지 깨짐 | `proxy-image`를 별도 검증 대상에 포함 |
| Route Handler caching | API 응답 stale/cache 오염 | 동적 API에 `dynamic = 'force-dynamic'` 명시 |

---

## 6. 권장 진행 순서

1. P0 SSRF 리다이렉트 차단 완료
2. Next.js 전환 브랜치 생성
3. UI만 Next.js App Router shell로 이동
4. 쉬운 API부터 이전: `auth`, `sessions`, `summarize-title`, `speech`
5. 파일/이미지 API 이전: `upload`, `create-signed-url`, `proxy-image`, `sync-drug-image`
6. URL/YouTube API 이전: `fetch-url`, `fetch-transcript`
7. 마지막으로 `chat` SSE 이전
8. 전체 회귀 테스트 후 Vercel Preview 배포

세부 순서 권장:
1. `app/layout.tsx`, `app/page.tsx`, `app/globals.css`만 추가하고 기존 UI 렌더 확인
2. `auth`, `sessions` 이전 후 로그인/세션 CRUD 확인
3. `summarize-title`, `speech` 이전 후 제목 생성/TTS 확인
4. `create-signed-url`, `upload` 이전 후 이미지/PDF/DOCX/XLSX 업로드 확인
5. `proxy-image`, `sync-drug-image`, `pill-search` 이전 후 약품 카드 이미지 확인
6. `fetch-url`, `fetch-transcript` 이전 후 URL/YouTube 사전 처리 확인
7. `chat` 이전 후 SSE, sources, heartbeat, cutOff, done 이벤트 확인
8. Vercel Preview에서 모바일 네트워크 드롭/재시도까지 확인

---

## 7. 보류 항목

Next.js 전환과 동시에 처리하지 않는다.

- Supabase Auth/RLS 마이그레이션
- IDOR 근본 수정
- i18n 중앙화
- renderer 대규모 리팩토링
- server actions 도입
- React Server Components 최적화
