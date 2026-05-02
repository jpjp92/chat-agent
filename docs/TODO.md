# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🔴 우선순위 1 — 보안 (즉시)

### bucket 화이트리스트 — `upload.ts`, `create-signed-url.ts`

클라이언트가 `bucket` 파라미터를 직접 제어 → service_role 키로 임의 버킷 접근 가능. 코드 5줄로 해소.

**구현 계획** (`api/_lib/storage.ts` 신규):
```ts
export const ALLOWED_BUCKETS = ['chat-videos', 'chat-imgs', 'chat-docs'] as const;
export function isAllowedBucket(b: string): boolean {
    return (ALLOWED_BUCKETS as readonly string[]).includes(b);
}
```
- [ ] `api/_lib/storage.ts` 생성
- [ ] `upload.ts` — bucket 화이트리스트 검증 추가
- [ ] `create-signed-url.ts` — bucket 화이트리스트 검증 추가

**참고**: `supabaseAdmin || supabase` 폴백은 개발환경 대응 목적으로 유지 결정 (DEV_260424 논의).

---

## 🔴 우선순위 2 — 에러처리 묶음 (C1·C2·H1·H2)

DEV_260423에서 식별, 성격이 비슷해 한 번에 처리.

| # | 파일 | 위치 | 내용 |
|---|------|------|------|
| **C1** | `api/_lib/pill-logic.ts` | L15-27 | `Promise.all` → `Promise.allSettled` + 실패 항목 fallback. 단일 타임아웃 시 전체 약 검색 크래시 방지 |
| **C2** | `services/geminiService.ts` | L22, 84, 93 | `generateSpeech` 등 `response.ok` 가드 누락. 인증·API 실패 시 앱 크래시 방지 |
| **H1** | `api/chat.ts` | L143-150 | Supabase insert `.catch()` 추가. 유저 메시지 무음 소실 방지 |
| **H2** | `api/fetch-url.ts` | L134 | 에러 시 `status(200)` → `status(502)` 변경. 프론트 성공/실패 구분 가능 |

- [ ] C1: `pill-logic.ts` Promise.allSettled 전환
- [ ] C2: `geminiService.ts` response.ok 가드 (6개 함수)
- [ ] H1: `chat.ts` Supabase insert .catch 추가
- [ ] H2: `fetch-url.ts` 에러 반환 코드 502로 변경

---

## 🟡 우선순위 3 — 이미지 멀티턴 근본 수정 (I4·I5)

I6(`historyHasImage` Google Search 오염 방지)은 완료됐으나 근본 원인 미수정.

| # | 파일 | 내용 |
|---|------|------|
| **I4** | `api/chat.ts` L49 | `isRecent` 조건에 이미지 메시지 예외 추가 — 이미지 포함 메시지는 history에서 탈락 방지 |
| **I5** | `src/hooks/useChatStream.ts` L121 | inline base64 임계값 3MB → 1MB — 1MB 초과 이미지는 Supabase URL로 전달, body 경량화 |

```ts
// I4: api/chat.ts
const msgHasImage = msgAttachments.some((a: any) => a.mimeType?.startsWith('image/'));
const isRecent = msgHasImage || index >= array.length - 3;

// I5: useChatStream.ts
if (!isVideo && estimatedSize < (1 * 1024 * 1024) && isBase64) {
```

- [ ] I4: `api/chat.ts` isRecent 이미지 예외 추가
- [ ] I5: `useChatStream.ts` inline 임계값 1MB로 축소

---

## 🟡 우선순위 4 — 기능 개선

### 멀티턴 경고·차단

20개 메시지 시 Toast 경고, 30개 시 전송 차단 + 인라인 배너.

- [ ] `generator.ts` — `maxOutputTokens` 32768 ✅ 완료
- [ ] `Toast.tsx` — `'warn'` 타입 추가 (앰버 계열)
- [ ] `useChatStream.ts` — 경고(20)·차단(30) 로직 + `onLimitReached` 콜백
- [ ] `App.tsx` — `isLimitReached` state + `onLimitReached` 핸들러
- [ ] `ChatArea.tsx` — 차단 배너 + 새 채팅 버튼

### 모델명 상수화 (Phase A)

현재 모델명 문자열 9곳 하드코딩. `api/_lib/models.ts` 단일 파일 관리.

- [ ] `api/_lib/models.ts` 생성 (`MODELS.FLASH`, `MODELS.LITE`, `MODELS.TTS`)
- [ ] `src/lib/models.ts` 생성 (프론트엔드 전용)
- [ ] `router.ts`, `vision.ts`, `generator.ts`, `drug-info-tool.ts`, `state.ts`, `chat.ts`, `speech.ts`, `summarize-title.ts` import 교체

### React Error Boundary (M4)

훅 내 비동기 에러 발생 시 화이트스크린 방지.

- [ ] `App.tsx` — Error Boundary 컴포넌트 추가

---

## 🟢 우선순위 5 — 예외처리 (P1~P5) — DEV_260406 식별

| 순서 | 항목 | 영향 | 비용 |
|------|------|------|------|
| 1 | **P2** `useChatStream.ts` 스트리밍 catch → `onError()` 호출 | 에러 UX 즉시 개선 | 낮음 |
| 2 | **P1** `geminiService.ts` `response.ok` 체크 (6개 함수) | silent failure 방지 | 낮음 |
| 3 | **P4** SSE 라인 `JSON.parse` try-catch 방어 | 스트리밍 안정성 | 낮음 |
| 4 | **P5** `fetchSessions` error 필드 체크 | 세션 로드 실패 UX | 낮음 |
| 5 | **P3** `!currentUser` 에러 화면 새로고침 버튼 추가 | auth 실패 복구 UX | 낮음 |

> C2에서 `geminiService.ts` response.ok 수정 시 P1과 중복 — 함께 처리.

---

## 🟢 우선순위 6 — 성능 (Lighthouse)

현재 점수: Performance 91 / Accessibility 63 / Best Practices 100 / SEO 91 (2026-04-04 측정)

**LCP 개선 (현재 ~3,300ms — `isAuthLoading` 블로킹)**
- [ ] `isAuthLoading` 제거 + 백그라운드 `loadUserSessions` (`App.tsx`)
- [ ] `ChatInput` — `!currentUser` 시 disabled 처리
- [ ] 사이드바 세션 로딩 중 스켈레톤 UI
- [ ] `handleNewSession` Optimistic UI (tempId 패턴)
- [ ] 세션 전환 중 `isLoadingMessages` 스켈레톤

**번들 최적화**
- [ ] `react-markdown` lazy loading (~247KB 절감)
- [ ] FontAwesome CDN → `@fortawesome/fontawesome-svg-core` 전환 (18KB + 100ms)
- [ ] `framer-motion` 실사용 여부 확인 (~50KB gzip)
- [ ] KaTeX / Google Fonts 자체 호스팅 (CDN 의존성 제거 + CSP 적용 전제조건)
- [ ] `fonts.gstatic.com` preconnect `crossorigin="anonymous"` 추가

> **CSP 적용 전제**: KaTeX·FontAwesome 자체 호스팅 완료 후 inline style 의존성 제거 → CSP 도입 가능

---

## ⚪ 백로그

### 핵심 UX
- [ ] **메시지 재생성** — 같은 프롬프트 재실행
- [ ] **메시지 편집** — 보낸 메시지 수정 후 해당 시점부터 재실행
- [ ] **세션 문서 컨텍스트 영구 저장** — `lastActiveDoc` Supabase 저장

### 보안 (중장기)
- [ ] `xlsx` 대안 패키지 검토 (fix 없는 Prototype Pollution·ReDoS)
- [ ] CSP 도입 — 번들 최적화(자체 호스팅) 완료 후 연계

#### 인증 시스템 도입 후 처리 (POC 단계 보류)

> **전제**: nickname 기반 → Supabase Auth 계정 기반으로 마이그레이션 완료 후 일괄 처리.
> 현재 `SUPABASE_KEY`가 `service_role` JWT이므로 RLS가 전면 비활성화된 상태 — 아래 항목들의 근본 원인.

- [ ] **IDOR-1** `api/auth.ts:52` — PATCH 핸들러에 소유권 검증 추가
  - 현재: 누구든 임의 UUID로 타 사용자 `display_name`·`avatar_url` 수정 가능
  - 수정: Auth JWT 검증 후 `authenticatedUserId === id` 확인
- [ ] **IDOR-2** `api/sessions.ts:10-53` — 세션 접근 전 소유자 확인 추가
  - 현재: 세션 ID만 알면 타 사용자 대화 전체 열람·삭제·수정 가능 (GET/DELETE/PATCH 전부)
  - 수정: 각 작업 전 `user_id === authenticatedUser` 검증
- [ ] **SSRF-1** `api/fetch-url.ts:76`, `api/proxy-image.ts:73` — 리다이렉트 추적 차단
  - 현재: hostname 블록리스트 적용 후 `fetch()`가 302 리다이렉트를 자동 추적 → `169.254.169.254` 우회 가능
  - 수정: `{ redirect: 'error' }` 옵션 추가 또는 Location 헤더마다 블록리스트 재검증
- [ ] **참고**: `supabase` 클라이언트를 `anon` 키 + RLS 정책으로 전환하면 IDOR-1·2는 DB 레이어에서 자동 차단됨

### 아키텍처 리팩토링
- [ ] `api/chat.ts` normalizer / stream-events / persistence 분리
- [ ] `geminiService.ts` 에러 계약 통일 (Result 패턴)
- [ ] `attachment` + `attachments` 필드 단일화
- [ ] `ChatInput.tsx` — `useSpeechInput` / `useAttachmentProcessor` 훅 분리
- [ ] i18n 중앙화 (`src/i18n/messages.ts`)

### 시각화 카드 전체화면 팝업
- [ ] `expandedViz` state + `VisualizationModal` Portal (`App.tsx`)
- [ ] ESC 키 닫기, `onExpand` prop (ChatMessage.tsx 7종 렌더러)
- [ ] `isExpanded` prop (BioRenderer.tsx), `isPaused` prop (PhysicsRenderer.tsx)

### 데이터 & 시각화
- [ ] CSV/XLSX 파싱 고도화 (대용량 행 제한·샘플링, 다중 시트)
- [ ] Chem-Viz 대형 분자 동적 스케일링

### 코드 품질
- [ ] ESLint / Prettier 설정
- [ ] 단위 테스트 (Vitest)
- [ ] `test-supabase.ts` 정리

### 낮은 우선순위 / 보류
- [ ] ARC (Agent RAG Cache) — 트래픽 증가 시 재검토
- [ ] 3D Astro-Viz, 3D Physics-Viz, Plotly/D3 벡터장
- [ ] Service Worker (PWA) — Vercel Edge로 커버

---

_최종 수정: 2026-05-02_
