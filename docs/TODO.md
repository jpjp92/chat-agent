# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🔴 P0 — 보안 즉시 수정

### SSRF 리다이렉트 차단

`fetch()`가 302/301 리다이렉트를 자동 추적해 hostname 블록리스트 우회 가능. 공개 배포 상태에서 현재 구조로 독립 수정 가능.

- [ ] `app/api/fetch-url/route.ts` — 일반 URL fetch에 `redirect: 'manual'` 또는 `redirect: 'error'` 적용
- [ ] `app/api/fetch-url/route.ts` — YouTube page fetch 동일 정책 적용 검토
- [ ] `app/api/proxy-image/route.ts` — 외부 이미지 fetch 리다이렉트 차단
- [ ] 공통 helper — hostname/IP 차단 로직 중복 제거 + Location 헤더 재검증 구조로 정리
- [ ] 회귀 검증 — 정상 URL 요약, Jina fallback, 프록시 이미지, 리다이렉트 차단 케이스

---

## 🟡 P1 — 기능 개선

> 진행 순서: 모바일 공백 → 프롬프트 언어 → 멀티턴 경고 → 알약/차트/동물병원

### 1. 모바일 초기 세션 공백

`loadUserSessions()` 병합 보정으로 재현 빈도 감소. 최소 방어만 우선.

- [ ] `useChatSessions.ts` — `currentSessionId` 있지만 `sessions`에서 찾지 못할 때 자동 복구
- [ ] `ChatArea.tsx` — `Suspense fallback={null}` → 메시지 skeleton 표시 검토
- [ ] 모바일 새로고침/앱 재개 후 첫 쿼리 수동 검증

후순위 보류:
- `ChatArea.tsx` — lazy chunk 로드 실패 재시도
- 모바일 uncaught error / unhandled rejection 로그 수집
- `useChatStream.ts` — 스트림 완료 후처리 미도달 시 제목 생성 누락 보정
- `useChatSessions.ts` — 응답은 있으나 제목이 기본값인 세션의 제목 재생성 fallback
- `ChatInput.tsx` — `onSend` 완료 전 입력값·첨부 상태 보존
- `useChatStream.ts` — `currentUser` 없음/세션 생성 실패 시 사용자 알림 + 입력 보존

### 2. 프롬프트 언어 혼합 정리

날씨 외 URL 요약·YouTube fallback·알약 DB fallback·router 설명의 언어 불일치 정리.

- [ ] `prompt.ts` — URL summary placeholder 문구 언어별 분리
- [ ] `prompt.ts` — YouTube fallback 안내 문장 언어별 분리
- [ ] `prompt.ts` — `getPillWarnFallback` 다국어화
- [ ] `router.ts` — intent 수 주석과 `in Seoul` stale 설명 정리
- [ ] `generator.ts` — current time 주입 포맷 중립화 또는 언어별 locale 적용 검토
- [ ] `prompt.ts` — renderer schema 전역 주입을 intent별 주입으로 분리 (Phase P-B)

### 3. 멀티턴 경고·차단

20개 메시지 시 Toast 경고, 30개 시 전송 차단 + 인라인 배너.

- [ ] `Toast.tsx` — `'warn'` 타입 추가 (앰버 계열)
- [ ] `useChatStream.ts` — 경고(20)·차단(30) 로직 + `onLimitReached` 콜백
- [ ] `App.tsx` — `isLimitReached` state + `onLimitReached` 핸들러
- [ ] `ChatArea.tsx` — 차단 배너 + 새 채팅 버튼
- [ ] `generator.ts` — 멀티턴 길이 기준 도달 시 thought signatures 제거 또는 히스토리 슬라이딩 윈도우 검토 (3.5 Flash thought preservation 비용 방지)

### 4. 알약 식별 후속 개선

- [ ] `generator.ts` — non-exact 후보 안내 문구 정밀화 (`색상·모양` → `각인 검색 확장 및 색상/제형 유사도`)
- [ ] `pill-logic.ts` — 추출 shape 기준 후보 정렬 보강 (타원형·장방형 상단 배치, 색상만 일치 후순위)

### 5. ChartRenderer 차트 품질 개선

- [ ] `prompt.ts` — `data_viz` intent에 차트 타입 선택 기준 명시 (시계열→bar/line, 비율→pie, 상관→scatter)
- [ ] `prompt.ts` — `chartType` 선택 가이드 주석 보강 + 레이블 10자 이내 지시
- [ ] `ChartRenderer.tsx` — x축 레이블 길이 초과 시 `\n` 줄바꿈 또는 45°/90° 회전
- [ ] `ChartRenderer.tsx` — y축 단위 자동 단축 (`1000000` → `1M`, `10000` → `1만`)
- [ ] `ChartRenderer.tsx` — `pie` 선택인데 항목 수 > 8이면 `bar`로 자동 보정

### 6. 동물병원 상세정보 선택형 보강

공공데이터 기본 검색 유지, 웹검색 기반 상세정보는 사용자 요청 시만 실행.

- [ ] `VetRenderer.tsx` — 병원별 `상세 정보 찾기` 액션 UX 검토
- [ ] `vet_search` 후속 흐름 — 선택된 병원 1곳 웹검색으로 영업시간/홈페이지/연락처 보강
- [ ] 자동 보강 시 상위 1~3개로 제한, 실패해도 기본 카드 유지
- [ ] 웹검색 보강 결과 출처/최신성 표기 방식 검토

---

## 🟢 P2 — 성능

현재 Lighthouse: Performance 91 / Accessibility 63 / Best Practices 100 / SEO 91 (2026-04-04)

### DB 쿼리 최적화 및 캐싱

**쿼리 효율화**
- [x] `sessions/route.ts` GET — `select('*')` → `select('id, title, updated_at, created_at')` (사이드바에 content 불필요)
- [x] `sessions/route.ts` GET — `count: 'exact'` 제거 + `hasMore: boolean` 패턴으로 교체 (매 페이지 `COUNT(*)` 제거)
- [x] `sessions/route.ts` GET messages — `select('*')` → `select('id, role, content, attachment_url, grounding_sources, created_at')`
- [x] `chat/route.ts` — `updated_at` 수동 업데이트(`sessions` 별도 write) → DB trigger 자동화 완료 (`trg_message_updates_session`)

**인덱스 확인**
- [ ] Supabase에서 `chat_messages(session_id, created_at)` 복합 인덱스 존재 여부 확인 — 메시지 정렬 쿼리 핵심
- [ ] `chat_sessions(user_id, updated_at DESC)` 인덱스 확인 — 세션 목록 정렬 핵심
- [ ] `users(nickname)` 인덱스 확인 — 로그인 시 nickname lookup

**캐싱 레이어**
- [ ] `sessions/route.ts` — Next.js `unstable_cache` 또는 `revalidateTag` 적용 검토 (세션 목록 단기 캐시, 새 메시지 전송 시 invalidate)
- [ ] 약국/병원/동물병원 툴 — 동일 지역 재검색 시 외부 API 재호출 방지용 인메모리 캐시 또는 Supabase 임시 테이블 캐시 검토 (TTL 1시간)
- [ ] `drug-info-tool.ts` Google Search 결과 — 동일 약품명 반복 검색 캐싱 검토

**연결 관리**
- [ ] `server/supabase.ts` — Vercel Fluid Compute 환경에서 인스턴스 재사용 시 연결 누수 여부 확인
- [ ] 요청량 증가 대비 Supabase connection pool 설정 점검 (현재 direct client, pgBouncer 전환 검토)

### LCP 개선 (~3,300ms — `isAuthLoading` 블로킹)

- [x] `App.tsx` — `isAuthLoading` 전체 차단 제거 + 백그라운드 인증 완료
- [x] `ChatInput` — `isAuthLoading || isTyping` disabled 처리
- [x] 사이드바 세션 로딩 중 스켈레톤 UI (기존 구현 확인)
- [x] 세션 전환 중 `isLoadingMessages` 스켈레톤 (기존 구현 확인)
- [ ] `handleNewSession` Optimistic UI (tempId 패턴)

### 번들 최적화

- [ ] FontAwesome CDN → `@fortawesome/fontawesome-svg-core` 전환 (18KB + 100ms)
- [ ] `framer-motion` 실사용 여부 확인 (~50KB gzip)
- [ ] KaTeX / Google Fonts 자체 호스팅 (CDN 의존성 제거 + CSP 전제조건)
- [ ] `fonts.gstatic.com` preconnect `crossorigin="anonymous"` 추가

> CSP 도입은 KaTeX·FontAwesome 자체 호스팅 + inline style 의존성 제거 완료 후 가능

---

## 🔵 P3 — 기능 확장

### 외부 API 신규 연동

공통 구현 패턴: `tools.ts` → `router.ts` → `generator.ts` → `prompt.ts` → `ChatMessage.tsx` → `Renderer.tsx`

**① arXiv + PubMed 논문 검색** (★★★)
- [ ] `server/agent/tools/paper-tool.ts` — arXiv Atom XML + PubMed esearch→esummary→efetch 파이프라인
- [ ] `components/PaperRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**② 서울 문화행사** (★★) — 키: `CULTURE_API_KEY`
- [ ] `server/agent/tools/culture-tool.ts` — 구 필터 + 오늘 이후 정렬 + 썸네일
- [ ] `components/CultureRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

**③ NEIS 학교기본정보** (★★) — 키: `EDU_KEY`
- [ ] `server/agent/tools/school-tool.ts` — `SCHUL_NM`/`LCTN_SC_NM`/`SCHUL_KND_SC_NM` 파라미터
- [ ] `components/SchoolRenderer.tsx`
- [ ] `state.ts`, `router.ts`, `generator.ts`, `prompt.ts`, `ChatMessage.tsx` 공통 패턴 적용

> 주의사항: arXiv timeout → `AbortSignal.timeout(6000)` 필수 / PubMed `NCBI_KEY` 없으면 10 req/s / NEIS `schoolInfo[0].head[1].RESULT.CODE` 에러 체크 필수

### 국가법령정보 후속 확장

현행 법령 MVP 완료. 아래는 `law_search` 확장 또는 별도 intent.

- [ ] 판례/헌재결정례/행정심판례 검색 (`case_search` intent 분리 검토)
- [ ] 행정규칙·자치법규·고시 조회 지원
- [ ] 법령해석례·중앙부처 해석 조회
- [ ] 법령 연혁·신구법·3단 비교·변경이력 카드
- [ ] 법령용어/관련법령 지식베이스 검색 보강
- [ ] 별표·서식 목록 조회 및 원문 링크 카드

### 이미지 생성 (Imagen 4) — 키: `GEMINI_IMAGEN`

> 모델: Imagen 4 Standard ($0.04) / Fast ($0.02) / Gemini Flash-Image. 상세 테스트 결과: `logs/DEV_260504.md`

- [ ] `server/agent/state.ts` — `image_gen` intent 추가
- [ ] `server/agent/tools.ts` — `generateImageTool` (Imagen 4 API)
- [ ] `server/agent/nodes/router.ts` — 감지 패턴 추가 (`그려줘`, `draw`, `generate image` 등)
- [ ] `server/agent/nodes/generator.ts` — `LANGCHAIN_INTENTS`에 `image_gen` 추가
- [ ] `server/agent/prompt.ts` — `image_gen` intent focus hint 추가
- [ ] `components/ImageGenRenderer.tsx` — 이미지 카드 렌더러 (다운로드 + 프롬프트 복사)
- [ ] `components/ChatMessage.tsx` — `image-gen` 블록 파서 + lazy import 연결
- [ ] `.env.local` + Vercel에 `GEMINI_IMAGEN` 추가

---

## ⚪ 백로그

### 핵심 UX
- [ ] **메시지 재생성** — 같은 프롬프트 재실행
- [ ] **메시지 편집** — 보낸 메시지 수정 후 해당 시점부터 재실행
- [ ] **세션 문서 컨텍스트 영구 저장** — `lastActiveDoc` Supabase 저장

### 보안 (인증 전환 후)

> 전제: 장기 계획 **L1(서버 토큰 발급)** 완료 후 처리. 현재 `service_role` 키로 RLS 비활성 + 소유권 검증 없음.

- [ ] **IDOR-1** `app/api/auth/route.ts` — PATCH 소유권 검증 (Bearer 토큰 → `authenticatedUserId === id`)
- [ ] **IDOR-2** `app/api/sessions/route.ts` — GET/DELETE/PATCH 전 `user_id === authenticatedUser` 검증
- [ ] `xlsx` 대안 패키지 검토 (Prototype Pollution·ReDoS fix 없음)
- [ ] CSP 도입 — 번들 최적화(자체 호스팅) 완료 후 연계

### 아키텍처 리팩토링
- [ ] **DTO 레이어** — Route Handlers 경계에서 Zod 스키마 기반 요청·응답 DTO 정의
- [ ] `app/api/chat/route.ts` — normalizer / stream-events / persistence 분리
- [ ] `geminiService.ts` — 에러 계약 통일 (Result 패턴)
- [ ] `attachment` + `attachments` 필드 단일화
- [ ] `ChatInput.tsx` — `useSpeechInput` / `useAttachmentProcessor` 훅 분리
- [ ] i18n 중앙화 (`src/i18n/messages.ts`)

### 시각화 카드 전체화면 팝업
- [ ] `expandedViz` state + `VisualizationModal` Portal (`App.tsx`)
- [ ] ESC 키 닫기, `onExpand` prop (렌더러 전체)
- [ ] `isExpanded` prop (BioRenderer), `isPaused` prop (DiagramRenderer)

### 데이터 & 시각화
- [ ] CSV/XLSX 파싱 고도화 (대용량 행 제한·샘플링, 다중 시트)
- [ ] Chem-Viz 대형 분자 동적 스케일링

### 코드 품질
- [ ] ESLint / Prettier 설정
- [ ] 단위 테스트 (Vitest)

### 낮은 우선순위
- [ ] ARC (Agent RAG Cache) — 트래픽 증가 시 재검토
- [ ] 3D Astro-Viz, 3D Physics-Viz, Plotly/D3 벡터장
- [ ] Service Worker (PWA)
- [ ] 카카오 지도 모달 팝업 — 약국/병원 카드 마커 + 커스텀 오버레이

---

## 📋 장기 계획 (검토 중)

### 인증 시스템 전환

현재 nickname 기반 localStorage 인증 → 서버 검증 가능한 구조로 단계 전환.

| 단계 | 내용 | 선행 조건 |
|---|---|---|
| **L1** 서버 토큰 발급 | `auth_tokens` 테이블 + `POST /api/auth` 토큰 발급 + Bearer 헤더 검증 미들웨어 | — |
| **L2** IDOR 수정 | IDOR-1/2 소유권 검증 (토큰 기반 user_id 추출) → 백로그 항목 이행 | L1 |
| **L3** Supabase Auth 전환 | nickname → 이메일/OAuth 마이그레이션, `users` 테이블 재설계 | — (독립) |
| **L4** RLS 활성화 | anon 키 전환 + 테이블별 policy 작성, `supabaseAdmin`만 service role 사용 | L3 |

> L1/L2는 현재 구조 최소 변경으로 가능. L3/L4는 대규모 마이그레이션으로 별도 계획 필요.

### Trial / Playground

로그인 없이 서비스 체험 가능한 게스트 플레이그라운드.

- 세션 미저장 — in-memory only, 탭 닫으면 소멸 (Supabase write 없음)
- 메시지 횟수 제한 — 세션당 N회 (미정), 초과 시 회원가입 유도
- 일부 기능 비활성 — 파일 업로드, 세션 히스토리, 세션 이름 변경 등
- 모델 제한 — 기본 모델만 허용, Flash 고급 옵션 잠금
- 회원가입 유도 배너 — 제한 도달 시 / 일정 메시지 수 초과 시

> 선행 조건: L1(서버 토큰) 완료 후 guest 토큰 흐름 분기 추가

---

### Agentic AI 업그레이드

현재: `router → (vision?) → generator ↔ tools` 단순 ReAct 루프

| 방향 | 항목 | 복잡도 |
|---|---|---|
| **A. 더 똑똑하게** | A1 Supervisor, A2 도메인 서브에이전트, A3 Planning Node, A4 Reflection Node | 중~높음 |
| **B. 더 많이** | B1 병렬 툴 호출, B2 코드 실행, B3 계산기, B4 Wikipedia/PubMed, B5 차트 생성, B6 파일 분석 | 낮~높음 |
| **C. 더 기억하게** | C1 세션 요약, C2 유저 프로필 메모리, C3 벡터 RAG, C4 크로스세션 컨텍스트 | 낮~높음 |

추천 순서: B3/B4/C1(단기) → B1/A4/C2(중기) → A1~A3/B2/C3(장기)

### 모델 확장 (멀티 프로바이더)

M1(프로바이더 추상화) 없이 OpenAI 추가 시 `generator.ts` 과부하 → M1이 진입점.

| 단계 | 내용 |
|---|---|
| M1 프로바이더 추상화 | `server/providers/` — gemini.ts / openai.ts / index.ts |
| M2 API 키 확장 | `config.ts` OPENAI_API_KEY 추가, `getGeminiKey()` / `getOpenAIKey()` 분리 |
| M3 모델 레지스트리 | `server/models.ts` provider/capability metadata 확장 |
| M4 OpenAI 매핑 | 공통 내부 포맷 → 프로바이더 변환 (이미지/시스템프롬프트/YouTube/Search) |
| M5 이미지 생성 | Imagen 4 → P3에서 선행 구현 가능 (M1 불필요) |
| M6 프론트 UI | 멀티 프로바이더 그룹 표시, 세션별 모델 기억 |

**Gemini 3.5 Flash 전환 시 확인 항목** (DEFAULT_CHAT_MODEL 변경 시):
- `drug-info-tool.ts` — `temperature: 0.1` 제거 (`searchDrugViaGoogleSearch`, `extractImprintViaVision`)
- `generator.ts` LangChain path — `maxOutputTokens: 8192` → 65k 상향 검토
- 의학·YouTube·law 경로, Google Search two-track 동작 검증
- PDF 토큰 증가 실측 (`hasDocumentContent` 경로), 필요 시 `media_resolution` 조정
