# 에러 처리 구조

> v4.76 기준 · 최종 검토: 2026-05-10

---

## 전체 흐름

```
사용자 액션
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Frontend                                           │
│                                                     │
│  geminiService.ts  →  Hook (try/catch)  →  UI       │
│  (response.ok 가드)    (Toast / 에러화면)  (배너)     │
└──────────────┬──────────────────────────────────────┘
               │ HTTP / SSE
               ▼
┌─────────────────────────────────────────────────────┐
│  Backend (Vercel Serverless)                        │
│                                                     │
│  API Endpoint  →  LangGraph Agent  →  SSE Stream    │
│  (try/catch)       (retry loop)      (heartbeat)    │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Infrastructure                                     │
│                                                     │
│  config.ts (API 키 로테이션)  ·  Supabase            │
└─────────────────────────────────────────────────────┘
```

---

## 1. API 키 관리 — `api/_lib/config.ts`

```
getNextApiKey()
  ├─ 정상 키 존재   → 라운드 로빈 반환
  ├─ 429 수신       → markKeyRateLimited  →  60초 쿨다운
  ├─ 401/403 수신   → markKeyInvalid      →  24시간 블랙리스트
  └─ 모든 키 소진   → null 반환
```

`null` 반환 시 caller별 처리:

| caller | 처리 |
|--------|------|
| `router.ts` | 키 없이도 휴리스틱 fallback으로 intent 분류 |
| `generator.ts` | `throw Error("No API key available")` → `chat.ts` catch → `rateLimit` 메시지 |

쿨다운 만료 키는 다음 호출 시 `rateLimitedUntil` 맵에서 자동 삭제되어 복구된다.

---

## 2. 백엔드 API 엔드포인트

### 공통 원칙

| 원칙 | 적용 파일 |
|------|----------|
| 내부 에러 정보 차단 (`error.message/stack` 제거) | 전체 엔드포인트 |
| SSRF 블록리스트 (RFC 1918 + IPv6 사설 대역) | `fetch-url.ts`, `proxy-image.ts` |
| SSRF 화이트리스트 (nedrug, pstatic, connectdi, health.kr) | `sync-drug-image.ts` |
| 버킷 화이트리스트 (`chat-imgs`, `chat-videos`, `chat-docs`) | `create-signed-url.ts`, `upload.ts` |
| 입력 검증 (타입·길이) | `speech.ts` (text: string, ≤10000자) |

### 엔드포인트별 응답

| 파일 | 성공 | 에러 |
|------|------|------|
| `auth.ts` | `200 { user }` | `400` (입력 누락) · `500 { error: 'Internal server error' }` |
| `sessions.ts` | `200 { sessions \| session \| messages }` | `400` · `500` |
| `fetch-url.ts` | `200 { content }` | **`502 { content: '[FETCH_ERROR:...]' }`** |
| `upload.ts` | `200 { url }` | `400` (버킷 불허) · `500` |
| `create-signed-url.ts` | `200 { signedUrl, publicUrl }` | `400` · `500` |
| `proxy-image.ts` | `200 image bytes` | `400` (SSRF 차단) · `502` |
| `speech.ts` | `200 { data }` | `400` (검증 실패) · `500` |
| `pill-search.ts` | `200 { results }` | `500` |
| `sync-drug-image.ts` | `200 { imageUrl }` | `400` (화이트리스트 불허) · `500` |

`fetch-url.ts`만 catch 블록에서 `502`를 반환한다. 나머지는 에러 시 모두 `500`.  
프론트(`fetchUrlData`)는 502에도 JSON body를 파싱하므로 동작 변경 없음.

---

## 3. LangGraph 에이전트

### `chat.ts` — 최상위 진입점

```
진입
  ├─ API_KEYS 없음 → sendEvent({ error }) → res.end()  즉시 종료
  │
  ├─ process.once('unhandledRejection') 가드 등록
  │    └─ LangGraph pregel 탈출 에러 포획 → sendEvent({ error }) 시도
  │
  └─ try { graph.streamEvents() }
       │
       ├─ 스트리밍 중 ─────────────────────────────────────────────
       │   ├─ on_chat_model_stream  → sanitize → sendEvent({ text })
       │   ├─ MAX_TOKENS 감지       → sendEvent({ cutOff: true })
       │   └─ on_tool_end(pharmacy) → Direct Injection → sendEvent({ text })
       │
       ├─ catch(error)
       │   ├─ 429 / RESOURCE_EXHAUSTED / No API key → CHAT_ERRORS.rateLimit[lang]
       │   ├─ 503 / UNAVAILABLE                     → CHAT_ERRORS.unavailable[lang]
       │   ├─ 401 / 403                             → CHAT_ERRORS.auth[lang]
       │   └─ 그 외                                 → CHAT_ERRORS.generic[lang]
       │   → sendEvent({ error: 다국어 메시지 })
       │
       └─ finally: clearInterval(heartbeatInterval) + res.end()
```

`CHAT_ERRORS`는 ko / en / es / fr 4개 언어 × 4개 타입 맵으로 내부 정보 없이 사용자 메시지만 전달한다.

### `generator.ts` — SDK path 재시도 루프

```
while (sdkAttempt < MAX_KEY_RETRIES)
  try
    ├─ 성공               → responseText 누적 → sendEvent({ text }) 스트리밍
    ├─ 429                → markKeyRateLimited → 다음 키로 재시도
    ├─ 500 + 멀티모달     → forceTextOnly=true → 미디어 제거 후 재시도
    ├─ 401/403            → markKeyInvalid → 다음 키로 재시도
    └─ 그 외              → throw → 루프 탈출

모든 키 소진 또는 루프 탈출
  └─ LangChain path fallback 시도
       └─ LangChain도 실패 → throw → chat.ts catch
```

`chunk.text` 읽기 실패(SDK SAFETY 차단 등)는 `try/catch`로 `console.warn` 후 조용히 건너뜀.

### `router.ts` — 절대 throw하지 않음

```
LLM 분류 실패(모든 에러) → heuristicCheck() fallback
  ├─ "약국"                      → pharmacy_search
  ├─ "병원" / "응급실"            → hospital_search
  ├─ 의약품 키워드 + 이미지       → drug_id
  ├─ 의약품 키워드                → drug_info
  └─ 그 외                       → general
```

LLM 호출이 실패해도 항상 intent를 반환하여 generator 진행을 보장한다.

### DB 저장 — 무음 실패

```
유저 메시지 insert   (.then 비동기)   → 실패 시 console.error, UX 무영향
AI 응답 insert       (await Promise.all) → 실패 시 console.error, UX 무영향
fullAiResponse 빈 경우               → sendEvent({ error: 'LLM returned empty response.' })
```

---

## 4. SSE 스트림 프로토콜

### 서버 → 클라이언트 이벤트

| 이벤트 | 의미 | 클라이언트 처리 |
|--------|------|----------------|
| `{ heartbeat: true }` | 8초 연결 유지 펄스 | `continue` (무시) |
| `{ text: "..." }` | 텍스트 청크 | `onChunk` 누적 |
| `{ sources: [...] }` | 소스 칩 데이터 | `onMetadata` → 소스 칩 렌더 |
| `{ cutOff: true }` | 응답 잘림 감지 | `onCutOff` → amber 배너 |
| `{ done: true }` | 정상 완료 | `receivedDone = true` |
| `{ error: "..." }` | 에러 메시지 | `throw` → useChatStream catch |

### 클라이언트 SSE 수신 방어 (`streamChatResponse`)

```
JSON.parse 실패 (깨진 청크)
  → console.warn + continue          스트리밍 계속 진행

25초 무활동 (activityMonitor)
  → controller.abort() → AbortError
  → "응답을 받지 못했습니다. 다시 시도해주세요."  throw

부분 수신 후 네트워크 에러
  → receivedAnyText=true
  → onCutOff()                       amber 배너, throw 안 함

done 없이 스트림 종료
  → !receivedDone
  → onCutOff()                       amber 배너

아무 텍스트 미수신
  → "응답을 받지 못했습니다. 다시 시도해주세요."  throw
```

---

## 5. 프론트엔드 서비스 — `services/geminiService.ts`

### response.ok 가드 적용 현황

| 함수 | 타임아웃 | response.ok | 에러 전파 |
|------|:-------:|:-----------:|----------|
| `streamChatResponse` | 25s activityMonitor | ✅ | throw → useChatStream |
| `uploadToStorage` | — | ✅ (서명URL + PUT 각각) | throw → useChatStream |
| `loginUser` | — | ✅ | throw → useAuthSession |
| `updateRemoteUserProfile` | — | ✅ | throw → App.tsx |
| `fetchSessions` | — | ✅ | throw → useChatSessions |
| `createSession` | — | ✅ | throw → useChatSessions |
| `deleteSession` | — | ✅ | throw → useChatSessions |
| `updateSessionTitle` | — | ✅ | throw → useChatSessions |
| `generateSpeech` | — | ✅ | throw → ChatMessage.tsx |
| `fetchUrlData` | 15s AbortController | ❌ | catch → `{ content: "" }` |
| `summarizeConversation` | — | ❌ | catch → `"New Chat"` |

`fetchUrlData`·`summarizeConversation`에 가드가 없는 이유: catch 블록이 fallback 값을 반환하고, 서버도 에러 시 항상 JSON body를 포함해 반환하므로 크래시 경로가 없다.

---

## 6. 훅 레이어

### `useAuthSession`

```
initAuth()
  ├─ localStorage JSON.parse 실패  → 캐시 삭제 → createGuestUser() 재시도
  ├─ loginUser() throw             → catch → return null
  └─ initAuth() 자체 throw         → .catch() → currentUser = null
                                              setIsAuthLoading(false)

결과: currentUser = null
  → App.tsx: isAuthLoading=false + !currentUser → 에러 화면 + Retry 버튼
```

### `useChatSessions`

```
모든 API 함수 → try/catch
  └─ catch → reportError(key) → SESSION_ERRORS[key][lang] → onError → Toast

SESSION_ERRORS 키 5종:
  createSession · loadSessions · loadMessages · deleteSession · renameSession

언어 4종: ko / en / es / fr
```

### `useChatStream`

```
handleSendMessage()
  ├─ 파일 업로드 실패              → onError(t.uploadFailed) → Toast
  ├─ 세션 생성 실패                → console.error만 (UX 중단 방지)
  └─ streamChatResponse 에러
       ├─ isRetryable              → Toast + "다시 시도" 안내
       │   ("다시 시도" · "Failed to fetch" · TypeError 포함)
       └─ 그 외                    → Toast 에러 메시지

onCutOff 콜백
  └─ message.isCutOff = true → ChatMessage amber 배너 렌더
```

---

## 7. UI 컴포넌트

| 컴포넌트 | 에러 상황 | 처리 방식 |
|----------|----------|----------|
| `App.tsx` | `!currentUser` (인증 실패) | 에러 화면 전체 표시 + Retry 버튼 (`window.location.reload`) |
| `ChatMessage.tsx` | TTS `generateSpeech` 실패 | `console.error` + 버튼 상태 리셋 (조용한 실패) |
| `BioRenderer.tsx` | RCSB `models.rcsb.org` 503 | `files.rcsb.org` 2차 fallback → 둘 다 실패 시 에러 메시지 인라인 표시 |
| `ChemicalRenderer.tsx` | PubChem 조회 실패 | LLM SMILES 유지, `cancelled` 플래그로 unmount 후 setState 방지 |
| `ConstellationRenderer.tsx` | 별자리 JSON sparse array | regex repair 후 silent skip |
| `DrugRenderer.tsx` | 이미지 없음 | Lightbox 버튼 자동 비활성화 |
| `Toast.tsx` | — | `error` / `success` / `info` 3종, `custom-toast` 커스텀 이벤트도 수신 |

---

## 구조적 취약점 — 백로그

### 보안 (인증 시스템 도입 후 처리)

현재 `SUPABASE_KEY`가 `service_role` JWT → RLS 전면 비활성화. 아래 항목의 공통 근본 원인.

| ID | 위치 | 현상 | 수정 방향 |
|----|------|------|----------|
| **IDOR-1** | `api/auth.ts` PATCH | 누구든 임의 UUID로 타 사용자 프로필 수정 가능 | JWT 검증 후 `authenticatedUserId === id` 확인 |
| **IDOR-2** | `api/sessions.ts` GET/DELETE/PATCH | 세션 ID만 알면 타 사용자 대화 열람·삭제·수정 가능 | 각 작업 전 `user_id === authenticatedUser` 검증 |
| **SSRF-1** | `api/fetch-url.ts`, `api/proxy-image.ts` | 블록리스트 적용 후 302 리다이렉트로 `169.254.169.254` 우회 가능 | `{ redirect: 'error' }` 또는 Location 헤더 재검증 |

`supabase` 클라이언트를 `anon` 키 + RLS 정책으로 전환하면 IDOR-1·2는 DB 레이어에서 자동 차단된다.

### 안정성 (우선순위 2 백로그)

| 항목 | 위치 | 현재 상태 | 위험도 |
|------|------|----------|:------:|
| React Error Boundary | `App.tsx` | 미적용 — 훅 비동기 에러 시 화이트스크린 가능 | 중 |
| `xlsx` 패키지 취약점 | 의존성 | Prototype Pollution·ReDoS fix 없음 (force 불가) | 낮음 |
