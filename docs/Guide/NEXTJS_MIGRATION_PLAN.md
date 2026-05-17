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

---

## 2. 전환 원칙

1. 기능 변경 없이 라우팅/빌드/배포 레이어만 먼저 이전한다.
2. 기존 `api/_lib/**` 서버 로직은 최대한 보존한다.
3. 채팅 UI는 우선 Client Component로 유지한다.
4. `fetch-url`, `proxy-image`, `sync-drug-image`의 SSRF 리다이렉트 차단은 Next.js 이전 전에 완료한다.
5. Supabase Auth/RLS 전환은 Next.js 이전과 분리한다.

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

### Phase 2. UI Client Boundary 고정

- `App.tsx` 최상단 또는 wrapper에 `"use client"` 추가
- browser-only 코드 확인:
  - `window`
  - `localStorage`
  - `AudioContext`
  - `FileReader`
  - canvas download
- lazy renderer들은 Client Component 경계 안에서 유지
- `public/data/constellations.json` 접근 경로 확인

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

주의:
- `VercelRequest` / `VercelResponse` → `NextRequest` / `Response`
- SSE 응답은 `ReadableStream` 기반으로 재구성
- `maxDuration`은 route segment config 또는 Vercel 설정으로 이전
- Node runtime 필요 route는 `export const runtime = 'nodejs'`

### Phase 4. Server-only 보호

- `server/**`에 `server-only` 적용 검토
- `api/_lib/config.ts`의 환경변수 로딩이 client bundle에 포함되지 않는지 확인
- `LAW_OC`, Supabase service role, Gemini API key가 클라이언트 chunk에 노출되지 않는지 grep/build 결과로 검증

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

---

## 7. 보류 항목

Next.js 전환과 동시에 처리하지 않는다.

- Supabase Auth/RLS 마이그레이션
- IDOR 근본 수정
- i18n 중앙화
- renderer 대규모 리팩토링
- server actions 도입
- React Server Components 최적화

