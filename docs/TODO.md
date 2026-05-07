# TODO

> 완료된 항목은 [DEV_HISTORY.md](DEV_HISTORY.md)에 기록됩니다.

---

## 🔴 우선순위 1 — 에러처리 묶음 (C1·C2·H2)

DEV_260423에서 식별, 성격이 비슷해 한 번에 처리.

| # | 파일 | 위치 | 내용 |
|---|------|------|------|
| **C1** | `api/_lib/pill-logic.ts` | L15-27 | `Promise.all` → `Promise.allSettled` + 실패 항목 fallback. 단일 타임아웃 시 전체 약 검색 크래시 방지 |
| **C2** | `services/geminiService.ts` | L22, 84, 93 | `generateSpeech` 등 `response.ok` 가드 누락. 인증·API 실패 시 앱 크래시 방지 |
| **H2** | `api/fetch-url.ts` | L134 | 에러 시 `status(200)` → `status(502)` 변경. 프론트 성공/실패 구분 가능 |

- [ ] C1: `pill-logic.ts` Promise.allSettled 전환
- [/] C2: `geminiService.ts` response.ok 가드 — `streamChatResponse`·`uploadToStorage` 적용 완료, `loginUser`·`fetchSessions`·`createSession`·`deleteSession`·`updateSessionTitle`·`generateSpeech` 6개 미적용
- [ ] H2: `fetch-url.ts` 에러 반환 코드 502로 변경



## 🟡 우선순위 2 — 기능 개선

### 멀티턴 경고·차단

20개 메시지 시 Toast 경고, 30개 시 전송 차단 + 인라인 배너.

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

## 🟢 우선순위 3 — 예외처리 (P1, P3~P5) — DEV_260406 식별

| 순서 | 항목 | 영향 | 비용 |
|------|------|------|------|
| 1 | **P1** `geminiService.ts` `response.ok` 체크 (6개 함수) — ✅ C2와 동시 완료 | silent failure 방지 | 낮음 |
| 2 | **P4** SSE 라인 `JSON.parse` try-catch 방어 | 스트리밍 안정성 | 낮음 |
| 3 | **P5** `fetchSessions` error 필드 체크 | 세션 로드 실패 UX | 낮음 |
| 4 | **P3** `!currentUser` 에러 화면 새로고침 버튼 추가 | auth 실패 복구 UX | 낮음 |

> C2에서 `geminiService.ts` response.ok 수정 시 P1과 중복 — 함께 처리. **현재 `streamChatResponse`·`uploadToStorage` 적용 완료, `loginUser` 등 6개 함수 미적용.**

---

## 🟢 우선순위 4 — 성능 (Lighthouse)

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

_최종 수정: 2026-05-06_

---

## 🌐 외부 API 통합 계획 (2026-05-06 수립)

> **현황**: 7개 API 키 발급 및 연결 테스트 완료. 약국·병원 카드 디자인(v2) 프리뷰 완성.  
> **목표**: LLM 단독 답변 한계를 실시간 공공데이터로 보완 — 구조화된 카드 UI 렌더링.

---

### 🏗️ 전체 시스템 연동 구조

```
사용자 메시지
    ↓
router.ts — intent 분류
    ├─ "pharmacy_search"  → PharmacyTool   → 서울 약국 API   → PharmacyRenderer
    ├─ "hospital_search"  → HospitalTool   → 서울 병원 API   → HospitalRenderer
    ├─ "culture_event"    → CultureTool    → 서울 문화행사 API → CultureRenderer
    ├─ "paper_search"     → PaperTool      → arXiv / PubMed  → PaperRenderer
    ├─ "school_search"    → SchoolTool     → NEIS API        → SchoolRenderer
    ├─ "law_search"       → LawTool        → 국가법령 API     → LawRenderer
    └─ "drug_info" (기존) → DrugTool       → 의약품 API      → DrugRenderer (✅ 운영중)
```

**공통 패턴** (각 Tool 동일):
1. `tools.ts` — LangChain tool 정의 (API 호출 + 응답 파싱)
2. `generator.ts` — LANGCHAIN_INTENTS 추가 + allTools 분기
3. `router.ts` — intent 감지 패턴 추가
4. `ChatMessage.tsx` — `json:<type>` 블록 파서 추가
5. `components/<Type>Renderer.tsx` — 카드 UI 컴포넌트

---

### 📦 API별 상세 구현 계획

#### ① 병원 검색 (우선순위 ★★★)

> 키: `HOSPITAL_KEY` (.env 등록 완료)  
> 카드 디자인: `scripts/card-preview.html` v2 확정  
> 포함 정보: 이름·주소·전화·운영시간(전 요일+공휴일)·GPS→카카오지도·[병원] 진료과목·응급실

**신규 파일**
- [ ] `api/_lib/agent/tools/hospital-tool.ts` — 서울 병원 API 호출 + 종류별 통계 + 응급실 여부
- [ ] `components/HospitalRenderer.tsx` — 병원 카드 (단일/목록 모드)

**기존 파일 수정**
- [ ] `api/_lib/agent/state.ts` — `"hospital_search"` intent 추가
- [ ] `api/_lib/agent/nodes/router.ts` — 감지 패턴 추가
  ```
  hospital: "병원", "병원 찾아", "응급실", "진료", "강남구 병원"
  ```
- [ ] `api/_lib/agent/nodes/generator.ts` — LANGCHAIN_INTENTS + allTools 분기
- [ ] `api/_lib/agent/prompt.ts` — intent hint 추가
- [ ] `components/ChatMessage.tsx` — `json:hospital` 블록 파서

응답 JSON 포맷 (`json:hospital` 블록):
```json
{
  "query": "강남구 병원",
  "count": 1,
  "hospitals": [{
    "name": "강남세브란스병원",
    "address": "서울 강남구 언주로 211",
    "phone": "1599-6114",
    "hours_today": "09:00~17:00",
    "is_open_now": true,
    "hours": { "mon":"09:00~17:00", "holiday":"휴무" },
    "lat": 37.4928, "lon": 127.0463
  }]
}
```

---

#### ② arXiv + PubMed 논문 검색 (우선순위 ★★★)

> 키: `NCBI_KEY` (.env 등록 완료), arXiv는 키 불필요  
> 특이사항: arXiv 서버 간헐적 timeout → AbortController + 3s retry 필수

**신규 파일**
- [ ] `api/_lib/agent/tools/paper-tool.ts`
  - arXiv: Atom XML 파싱 → 제목·저자·초록·PDF링크
  - PubMed: esearch(ID) → esummary(메타) → efetch(초록) 3단계 파이프라인
  - 쿼리에 "의학", "medical", "clinical" 포함 시 PubMed 우선, 나머지는 arXiv
- [ ] `components/PaperRenderer.tsx` — 논문 카드 (제목·저자·초록·링크)

**기존 파일 수정**
- [ ] `state.ts` — `"paper_search"` intent 추가
- [ ] `router.ts` — 감지 패턴: `"논문"`, `"arXiv"`, `"PubMed"`, `"공학논문"`, `"의학논문"`
- [ ] `generator.ts`, `prompt.ts`, `ChatMessage.tsx` — 공통 패턴 적용

---

#### ③ 서울 문화행사 (우선순위 ★★)

> 키: `CULTURE_API_KEY` (.env 등록 완료)  
> 카드 정보: 행사명·날짜·장소·구·요금·이미지URL·홈페이지

**신규 파일**
- [ ] `api/_lib/agent/tools/culture-tool.ts`
  - 구 필터링 + 오늘 이후 행사만 우선 정렬
  - `MAIN_IMG` → 썸네일 카드
- [ ] `components/CultureRenderer.tsx` — 행사 카드 (이미지+날짜+장소)

**기존 파일 수정**
- [ ] `state.ts` — `"culture_event"` intent 추가
- [ ] `router.ts` — 감지 패턴: `"문화행사"`, `"행사"`, `"전시"`, `"강남구 행사"`
- [ ] `generator.ts`, `prompt.ts`, `ChatMessage.tsx` — 공통 패턴 적용

---

#### ④ 학교기본정보 NEIS (우선순위 ★★)

> 키: `EDU_KEY` (.env 등록 완료)  
> 카드 정보: 학교명·종류(초/중/고)·주소·전화·홈페이지·남녀공학·설립일·시도교육청

**신규 파일**
- [ ] `api/_lib/agent/tools/school-tool.ts`
  - 파라미터: `SCHUL_NM`(학교명), `LCTN_SC_NM`(시도), `SCHUL_KND_SC_NM`(종류)
  - NEIS 응답구조: `schoolInfo[0].head` + `schoolInfo[1].row`
- [ ] `components/SchoolRenderer.tsx`

**기존 파일 수정**
- [ ] `state.ts` — `"school_search"` intent 추가
- [ ] `router.ts` — 감지 패턴: `"학교"`, `"초등학교"`, `"중학교"`, `"고등학교"`, `"○○중"`
- [ ] `generator.ts`, `prompt.ts`, `ChatMessage.tsx` — 공통 패턴 적용

---

#### ⑤ 국가법령정보 (우선순위 ★★)

> OC: `jpjp9202` (키 없이 URL 파라미터로 사용)  
> 2단계: 법령 검색(lawSearch) → 조문 조회(lawService)  
> 활용: LLM 할루시네이션 없는 원문 기반 법령 답변

**신규 파일**
- [ ] `api/_lib/agent/tools/law-tool.ts`
  - 1단계: `lawSearch` → 법령ID 획득
  - 2단계: `lawService` → 조문 배열 파싱
  - 사용자 질문과 관련 조문만 추출 → context 주입
- [ ] `components/LawRenderer.tsx` — 법령 카드 (법령명·시행일·조문 accordion)

**기존 파일 수정**
- [ ] `state.ts` — `"law_search"` intent 추가
- [ ] `router.ts` — 감지 패턴: `"법"`, `"법률"`, `"조항"`, `"규정"`, `"○○법 몇조"`
- [ ] `generator.ts`, `prompt.ts`, `ChatMessage.tsx` — 공통 패턴 적용
- [ ] `.env` — `LAW_OC=jpjp9202` 추가

---

### 📋 구현 순서 (우선순위)

```
Phase 1 — 즉시 착수 (카드 디자인 확정됨):
  ① 병원 Tool + HospitalRenderer

Phase 2 — 학술 정보:
  ③ arXiv + PubMed Tool + PaperRenderer

Phase 3 — 생활 정보:
  ④ 서울 문화행사 Tool + CultureRenderer
  ⑤ NEIS 학교정보 Tool + SchoolRenderer

Phase 4 — 전문 정보:
  ⑥ 국가법령 Tool + LawRenderer
```

### ⚠️ 공통 주의사항

- **서울시 API (약국/병원/문화행사)**: 전체 건수(5k~22k)에서 구 단위 클라이언트 필터 → 최대 100건씩 페이지 로드, 구 특정 시 500건으로 증가
- **arXiv timeout**: `AbortSignal.timeout(6000)` + 실패 시 `"arXiv 서버 응답 없음, 잠시 후 재시도"` fallback
- **PubMed 3단계**: esearch → esummary → efetch 순서 필수, `NCBI_KEY` 없으면 rate-limit 10 req/s
- **NEIS 응답 파싱**: `data.schoolInfo[0].head[1].RESULT.CODE` 에러 체크 필수 (구조 중첩)
- **법령 API**: `lawSearch` 결과가 1건이면 배열이 아닌 객체로 반환 → `[].flat()` 처리 필수

---

## 🤖 Agentic AI 업그레이드 방안 검토

> **현재 구조**: `router → (vision?) → generator ↔ tools` — 단일 generator가 모든 도메인을 처리하는 단순 ReAct 루프  
> **기존 툴 3종**: identifyPill, searchDrugInfo, searchWeb(DuckDuckGo)

---

### 방향 A — 더 똑똑하게 (Multi-Agent + Planning + Reflection)

도메인별 전문 서브에이전트를 두고, supervisor가 오케스트레이션.

| 항목 | 내용 | 복잡도 |
|------|------|--------|
| **A1** Supervisor Agent | 의도 분류 후 서브에이전트로 dispatch. 현재 router 역할 확장 | 중 |
| **A2** 도메인 서브에이전트 | biology / chemistry / physics / astronomy / medical / general 각자 전용 prompt + tool 세트 | 높음 |
| **A3** Planning Node | 복잡한 멀티스텝 쿼리에 대해 plan → execute 분리 (예: "CO2 분자 구조 설명 + 온실효과 검색 + 차트") | 높음 |
| **A4** Reflection Node | generator 응답 후 self-critique 패스 → 품질·정확도 검토 후 재생성 또는 통과 | 중 |

**트레이드오프**: 응답 품질·전문성 ↑, 레이턴시 ↑, 구현 복잡도 ↑

---

### 방향 B — 더 많이 할 수 있게 (Tool 확장 + 병렬 실행)

툴 종류를 늘리고, 여러 툴을 동시에 호출.

| 항목 | 내용 | 복잡도 |
|------|------|--------|
| **B1** 병렬 툴 호출 | 현재 순차 ReAct → `Promise.all` 기반 병렬 실행 (LangGraph fan-out) | 중 |
| **B2** 코드 실행 툴 | Python/JS 샌드박스 실행 (Vercel Sandbox 또는 E2B) — 수식 계산, 데이터 처리 | 높음 |
| **B3** 계산기 툴 | math.js 기반 정확한 수식 계산 (LLM 할루시네이션 방지) | 낮음 |
| **B4** Wikipedia / PubMed 툴 | 학술·의학 정보 조회 API 추가 | 낮음 |
| **B5** 차트 데이터 생성 툴 | LLM이 툴 호출로 구조화된 차트 데이터 생성 → ChartRenderer 연동 강화 | 중 |
| **B6** 파일 분석 툴 | 업로드된 CSV/XLSX를 에이전트가 직접 파싱·요약 | 중 |

**트레이드오프**: 기능 범위 ↑, 개별 툴은 독립 구현 가능 → 점진적 확장 쉬움

---

### 방향 C — 더 기억하게 (Long-term Memory)

유저 선호, 과거 대화 요약, 벡터 검색으로 컨텍스트 유지.

| 항목 | 내용 | 복잡도 |
|------|------|--------|
| **C1** 세션 요약 저장 | 세션 종료 시 Gemini로 요약 → Supabase `session_summaries` 테이블 | 낮음 |
| **C2** 유저 프로필 메모리 | 유저가 명시적으로 알려준 선호·사실을 Supabase에 저장 (`user_memories` 테이블) | 중 |
| **C3** 벡터 검색 (RAG) | 과거 대화를 Gemini Embedding → pgvector 저장 → 관련 대화 자동 주입 | 높음 |
| **C4** 크로스세션 컨텍스트 | 새 세션 시작 시 관련 과거 세션 요약 자동 첨부 | 중 |

**트레이드오프**: 개인화·연속성 ↑, Supabase 스키마 변경 필요, 프라이버시 고려 필요

---

### 우선순위 추천

```
단기 (낮은 복잡도, 즉시 효과):
  B3 계산기 툴, B4 Wikipedia/PubMed, C1 세션 요약 저장

중기 (중간 복잡도, 큰 가치):
  B1 병렬 툴 호출, A4 Reflection Node, C2 유저 프로필 메모리

장기 (높은 복잡도, 구조 변경):
  A1~A3 Multi-Agent Supervisor, B2 코드 실행, C3 벡터 RAG
```

> **결정 전 확인 필요**: 어느 방향부터 시작할지 → 각 방향은 독립적으로 구현 가능

---

## 🧠 모델 확장 방안

> **현재 모델**: generator=`gemini-2.5-flash`, router=`gemini-2.5-flash-lite`  
> **현재 구조**: `config.ts`가 Gemini 키(`API_KEY*`)만 관리, `generator.ts`가 `@google/genai` SDK에 완전 종속

---

### 추가 예정 모델 목록

| 모델 | 프로바이더 | 타입 | 주요 특징 |
|------|-----------|------|----------|
| `gemini-2.0-flash` | Google | Chat | 빠른 속도, 저비용 (현재 2.5-flash-lite 대체 후보) |
| `gemini-2.5-flash-preview-image-generation` | Google | Chat+ImageGen | 텍스트→이미지 생성 지원 (채팅 중 이미지 출력) |
| `gemini-3.0-flash` (preview) | Google | Chat | 최신 플래그십, 멀티모달 강화 |
| `gemini-3.1-flash-lite` (preview) | Google | Chat | 초경량, 라우터·분류용 후보 |
| `imagen-4` | Google | ImageGen 전용 | 고품질 이미지 생성 — chat 아님, 별도 endpoint |
| `gpt-4o` | OpenAI | Chat | 멀티모달 (vision), tool use, 높은 추론 품질 |
| `gpt-4o-mini` | OpenAI | Chat | 저비용, 빠른 응답 — 라우터·요약용 후보 |
| `gpt-4.1` | OpenAI | Chat | 코딩·지시 이행 특화 |
| `gpt-4.1-mini` | OpenAI | Chat | gpt-4.1 경량 버전 |
| `o4-mini` | OpenAI | Reasoning | 추론 특화 (thinking 모드) |

---

### 개선 항목

#### M1 — 프로바이더 추상화 레이어 (핵심, 선행 필수)

현재 `generator.ts`가 `@google/genai` SDK에 하드코딩 → 멀티 프로바이더 지원 불가.

```
api/_lib/providers/
  gemini.ts   — 기존 Gemini SDK 로직 이관
  openai.ts   — OpenAI ChatCompletion + streaming
  index.ts    — 통합 인터페이스 (streamResponse, generateContent)
```

- [ ] `api/_lib/providers/gemini.ts` — 기존 SDK 스트리밍·폴백·retries 이관
- [ ] `api/_lib/providers/openai.ts` — OpenAI SDK 스트리밍 (`openai` npm 패키지)
- [ ] `api/_lib/providers/index.ts` — `getProvider(model)` → 프로바이더 선택 분기
- [ ] `generator.ts` — providers/index.ts 통해 호출하도록 리팩토링

**트레이드오프**: 초기 구조 변경 비용 높음, 완료 후 모델 추가는 trivial

---

#### M2 — API 키 관리 확장

현재 `config.ts`는 Gemini 키만 관리 (`API_KEY`, `API_KEY2` ...).

- [ ] `config.ts` — `OPENAI_API_KEY` 로드 추가 (단일 키, rotation 불필요)
- [ ] 프로바이더별 키 분리: `getGeminiKey()` / `getOpenAIKey()`
- [ ] Vercel 환경변수에 `OPENAI_API_KEY` 추가 (`vercel env add`)

---

#### M3 — 모델 레지스트리 (`api/_lib/models.ts`)

TODO 우선순위 4에 이미 등록된 "모델명 상수화(Phase A)"를 멀티 프로바이더로 확장.

```ts
export const MODELS = {
  // Gemini
  FLASH:        { id: 'gemini-2.5-flash',    provider: 'gemini', vision: true,  tools: true,  search: true  },
  FLASH_LITE:   { id: 'gemini-2.5-flash-lite', provider: 'gemini', vision: false, tools: false, search: false },
  FLASH_3:      { id: 'gemini-3.0-flash',    provider: 'gemini', vision: true,  tools: true,  search: true  },
  FLASH_3_LITE: { id: 'gemini-3.1-flash-lite', provider: 'gemini', vision: false, tools: false, search: false },
  IMG_GEN:      { id: 'gemini-2.5-flash-preview-image-generation', provider: 'gemini', imageGen: true },
  // OpenAI
  GPT4O:        { id: 'gpt-4o',        provider: 'openai', vision: true,  tools: true,  search: false },
  GPT4O_MINI:   { id: 'gpt-4o-mini',   provider: 'openai', vision: true,  tools: true,  search: false },
  GPT41:        { id: 'gpt-4.1',       provider: 'openai', vision: true,  tools: true,  search: false },
  GPT41_MINI:   { id: 'gpt-4.1-mini',  provider: 'openai', vision: true,  tools: true,  search: false },
  O4_MINI:      { id: 'o4-mini',       provider: 'openai', vision: false, tools: true,  search: false },
  // Image Generation
  IMAGEN4:      { id: 'imagen-4',      provider: 'gemini', imageGen: true },
} as const;
```

- [ ] `api/_lib/models.ts` 생성 — 위 레지스트리 + 타입 정의
- [ ] `src/lib/models.ts` 프론트엔드용 (표시명, 아이콘, 설명 포함)

---

#### M4 — OpenAI 호환 Content 매핑

OpenAI는 Gemini와 content 포맷이 다름 → 공통 내부 포맷 → 각 프로바이더 변환.

| 항목 | Gemini | OpenAI |
|------|--------|--------|
| 이미지 | `inlineData` / `fileData` | `image_url` (base64 또는 URL) |
| 시스템 프롬프트 | `systemInstruction` | `system` role 메시지 |
| YouTube | `fileData(fileUri)` | ❌ 미지원 → 텍스트 요약으로 폴백 |
| Google Search | 네이티브 grounding | ❌ 미지원 → `searchWebTool` 자동 바인딩 |
| Tool call | LangChain 또는 SDK | `@langchain/openai` bindTools |

- [ ] 내부 공통 메시지 포맷 정의 (`api/_lib/types.ts`)
- [ ] OpenAI 선택 시 YouTube 요청 → `"이 모델은 YouTube 분석 미지원"` 안내
- [ ] OpenAI 선택 시 Google Search 대신 `searchWebTool` 자동 활성화

---

#### M5 — 이미지 생성 모델 지원 (Imagen 4 / Gemini Flash-Image)

> **모델**: `imagen-4.0-generate-001` (Standard, $0.04) / `imagen-4.0-fast-generate-001` (Fast, $0.02) / `gemini-2.5-flash-image` (Flash-Image)  
> **전달 방식**: base64 data URL → `json:image-gen` 블록 → `ImageGenRenderer`  
> **환경변수**: `GEMINI_IMAGEN` (기존 `GOOGLE_API_KEY`와 분리 관리)

**2026-05-03~04 테스트 결과** (`scripts/test-image-academic.js`):

| 모델 | API 방식 | 평균 시간 | 평균 크기 | 학술 피규어 정확도 |
|------|---------|---------|---------|--------------|
| Imagen 4 Standard | `ai.models.generateImages()` | ~10s | ~1100KB | ★★★ (라벨 가장 정확) |
| Imagen 4 Fast | `ai.models.generateImages()` | ~5s | ~1200KB | ★★ |
| Gemini 2.5 Flash-Image | REST `/v1beta/models/gemini-2.5-flash-image:generateContent` | ~9s | ~1300KB | ★★ (오타 있음) |

**주요 발견사항**:
- Imagen Standard가 학술 다이어그램 라벨 정확도 최고 (오타·중복 최소)
- Flash-Image는 `responseModalities` 파라미터 불필요 — `generateContent`만 호출해도 이미지 반환
- Flash-Image SDK 호출 불가 (`@google/genai` v1.34.0 직렬화 버그) → REST API 직접 호출 필요
- 프롬프트 강화 효과: 라벨 명시적 열거 + "no duplicate labels, no spelling errors" 추가 시 정확도 개선
- `Buffer.from(imgData)` → `Buffer.from(imgData, 'base64')` 필수 (없으면 빈 PNG)
- `GEMINI_IMAGEN` 키를 Flash-Image에도 동일하게 사용 (별도 키 불필요)

**모델 선택 가이드**:
- 학술/과학 다이어그램 → **Imagen 4 Standard** (정확도 우선)
- 일반 이미지 빠른 생성 → **Imagen 4 Fast** (속도/비용 우선)
- 채팅 맥락 반영 이미지 → **Gemini Flash-Image** (대화 흐름 이해 강점)

**플로우**:
```
유저: "세포막 유동 모자이크 모델 그려줘"
  → Router: image_gen 감지
  → Generator (LangChain path): generateImageTool 호출
    → Imagen API → imageBytes(base64) 반환
  → Generator: json:image-gen 블록 출력
  → ChatMessage: ImageGenRenderer 렌더링 (이미지 + 다운로드)
```

**수정/생성 파일**:
| 파일 | 변경 |
|------|------|
| `api/_lib/agent/state.ts` | `IntentType`에 `"image_gen"` 추가 |
| `api/_lib/agent/tools.ts` | `generateImageTool` 추가 |
| `api/_lib/agent/nodes/router.ts` | image_gen 감지 패턴 추가 |
| `api/_lib/agent/nodes/generator.ts` | `LANGCHAIN_INTENTS`에 `"image_gen"` 추가 + intent hint |
| `api/_lib/agent/prompt.ts` | image_gen 시스템 지시 + intent focus hint 추가 |
| `components/ImageGenRenderer.tsx` | 신규 — 이미지 카드 렌더러 |
| `components/ChatMessage.tsx` | `image-gen` 블록 파서 + lazy import 추가 |

---

**Step 1: `state.ts` — intent 타입 추가**

```ts
// api/_lib/agent/state.ts
export type IntentType =
    | "drug_id" | "drug_info" | "medical_qa"
    | "biology" | "chemistry" | "physics" | "astronomy"
    | "data_viz" | "image_gen"   // ← 추가
    | "general";
```

- [ ] `state.ts` `IntentType`에 `"image_gen"` 추가

---

**Step 2: `tools.ts` — `generateImageTool` 추가**

```ts
// api/_lib/agent/tools.ts 하단에 추가
import { GoogleGenAI } from "@google/genai";

export const generateImageTool = tool(
    async ({ prompt, aspectRatio = "4:3", quality = "standard" }) => {
        const apiKey = process.env.GEMINI_IMAGEN;
        if (!apiKey) return JSON.stringify({ error: "GEMINI_IMAGEN 환경변수 없음" });

        const modelId = quality === "fast"
            ? "imagen-4.0-fast-generate-001"
            : "imagen-4.0-generate-001";

        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateImages({
                model: modelId,
                prompt,
                config: { numberOfImages: 1, aspectRatio },
            });
            const imgBytes = response.generatedImages?.[0]?.image?.imageBytes;
            if (!imgBytes) return JSON.stringify({ error: "이미지 생성 실패: imageBytes 없음" });

            const sizeKB = Math.round((imgBytes.length * 3) / 4 / 1024);
            return JSON.stringify({
                imageData: imgBytes,          // base64 string
                prompt,
                model: modelId,
                aspectRatio,
                sizeKB,
            });
        } catch (err: any) {
            return JSON.stringify({ error: err?.message?.slice(0, 200) ?? "알 수 없는 오류" });
        }
    },
    {
        name: "generate_image",
        description: "주어진 프롬프트로 Imagen 4 이미지를 생성합니다. 이미지 생성/그리기 요청에만 사용. 반드시 영어 프롬프트 사용.",
        schema: z.object({
            prompt: z.string().describe("영어로 작성된 이미지 생성 프롬프트 (상세할수록 좋음)"),
            aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]).optional()
                .describe("이미지 비율 (기본: 4:3)"),
            quality: z.enum(["standard", "fast"]).optional()
                .describe("standard=$0.04 고품질, fast=$0.02 저비용 (기본: standard)"),
        }),
    }
);
```

- [ ] `tools.ts`에 `generateImageTool` 추가 (`@google/genai` import 포함)

---

**Step 3: `router.ts` — image_gen 감지 패턴 추가**

라우터의 LLM 분류 프롬프트와 휴리스틱 폴백에 추가:

```ts
// router.ts 의도 분류 프롬프트 예시 항목 추가
"image_gen": "이미지 생성/그리기 요청 (그려줘, 이미지 만들어줘, 그림 그려, draw, generate image, create a picture)"

// 휴리스틱 폴백 패턴 추가 (기존 패턴들 다음에)
if (/그려줘|그림.*그려|이미지.*만들|이미지.*생성|그려.*줘|draw\b|generate.*image|create.*image|create.*picture|illustrate/i.test(lastMsg)) {
    return "image_gen";
}
```

- [ ] `router.ts` LLM 분류 프롬프트에 `image_gen` 예시 추가
- [ ] `router.ts` 휴리스틱 폴백에 `image_gen` 패턴 추가

---

**Step 4: `generator.ts` — LANGCHAIN_INTENTS + 툴 바인딩**

```ts
// generator.ts
import { generateImageTool } from "../tools.js";

// 기존:
const LANGCHAIN_INTENTS = ["drug_id", "drug_info"];
// 변경:
const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "image_gen"];

// LangChain path의 allTools 배열에 추가 (image_gen일 때만):
const allTools = state.intent === "drug_id"
    ? [identifyPillTool, searchWebTool]
    : state.intent === "drug_info"
    ? [searchDrugInfoTool, searchWebTool]
    : state.intent === "image_gen"
    ? [generateImageTool]                    // ← 추가
    : [searchWebTool];
```

- [ ] `generator.ts` `LANGCHAIN_INTENTS`에 `"image_gen"` 추가
- [ ] `generator.ts` `allTools` 분기에 `image_gen` 케이스 추가

---

**Step 5: `prompt.ts` — 시스템 지시 + intent hint**

```ts
// prompt.ts getIntentFocusHint에 추가
image_gen: `[INTENT FOCUS: IMAGE GENERATION]
유저가 이미지 생성을 요청했습니다. generate_image 툴을 반드시 호출하세요.
툴 호출 시 prompt는 반드시 영어로, 최대한 구체적으로 작성하세요.
툴 결과를 받으면 아래 포맷으로 출력하세요:

\`\`\`json:image-gen
{
  "imageData": "<툴 결과의 imageData 그대로>",
  "prompt": "<사용한 영어 프롬프트>",
  "promptKo": "<한국어로 설명>",
  "model": "<툴 결과의 model>",
  "aspectRatio": "<비율>",
  "sizeKB": <크기>
}
\`\`\`

툴이 error를 반환하면 json:image-gen 블록 없이 에러 내용을 한국어로 안내하세요.
절대 이미지를 markdown 이미지(![])로 출력하지 마세요.`,
```

- [ ] `prompt.ts` `getIntentFocusHint` 맵에 `image_gen` 추가

---

**Step 6: `ImageGenRenderer.tsx` 신규 생성**

```tsx
// components/ImageGenRenderer.tsx
import React, { useState } from 'react';

interface ImageGenData {
    imageData: string;     // base64
    prompt: string;
    promptKo?: string;
    model: string;
    aspectRatio: string;
    sizeKB: number;
    error?: string;
}

export default function ImageGenRenderer({ data }: { data: ImageGenData }) {
    const [copied, setCopied] = useState(false);

    if (data.error) {
        return (
            <div className="my-4 p-4 rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                <i className="fa-solid fa-circle-exclamation mr-2" />
                이미지 생성 실패: {data.error}
            </div>
        );
    }

    const src = `data:image/png;base64,${data.imageData}`;
    const isStandard = data.model.includes('fast') ? false : true;

    const handleDownload = () => {
        const a = document.createElement('a');
        a.href = src;
        a.download = `imagen-${Date.now()}.png`;
        a.click();
    };

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(data.prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-4 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 backdrop-blur-sm">
            {/* 이미지 */}
            <img
                src={src}
                alt={data.promptKo ?? data.prompt}
                className="w-full object-contain"
            />
            {/* 하단 정보 바 */}
            <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 dark:border-white/5">
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {data.promptKo ?? data.prompt}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                        {isStandard ? 'Imagen 4 Standard' : 'Imagen 4 Fast'} · {data.aspectRatio} · {data.sizeKB}KB
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={handleCopyPrompt}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                    >
                        <i className={`fa-solid ${copied ? 'fa-check text-green-500' : 'fa-copy'} mr-1`} />
                        {copied ? '복사됨' : '프롬프트'}
                    </button>
                    <button
                        onClick={handleDownload}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors"
                    >
                        <i className="fa-solid fa-download mr-1" />
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] `components/ImageGenRenderer.tsx` 위 코드로 생성

---

**Step 7: `ChatMessage.tsx` — 파서 + lazy import 연결**

```tsx
// 상단 lazy import 추가
const ImageGenRenderer = lazy(() => import('./ImageGenRenderer'));

// renderContent의 blockRegex 수정
const blockRegex = /```json\s*:\s*(chart|smiles|bio|constellation|diagram|drug|image-gen)\s*\n([\s\S]*?)\n```/gi;

// parts 타입 확장
type PartType = 'text' | 'chart' | 'chemical' | 'bio' | 'constellation' | 'diagram' | 'drug' | 'image-gen' | 'chart_loading';

// blockType 분기에 추가
} else if (blockType === 'image-gen') {
    parts.push({ type: 'image-gen', data: jsonData });
}

// 스트리밍 미완성 감지 regex 수정 (image-gen 포함)
const hasIncompleteViz = /```json\s*:\s*(chart|smiles|bio|constellation|diagram|drug|image-gen)/i.test(remainingText);

// 렌더링 분기에 추가
if (part.type === 'image-gen') {
    return (
        <Suspense key={idx} fallback={<LoadingFallback />}>
            <ImageGenRenderer data={part.data} />
        </Suspense>
    );
}
```

- [ ] `ChatMessage.tsx` lazy import `ImageGenRenderer` 추가
- [ ] `ChatMessage.tsx` `blockRegex`에 `image-gen` 추가
- [ ] `ChatMessage.tsx` `parts` 타입에 `'image-gen'` 추가
- [ ] `ChatMessage.tsx` blockType 파싱 분기에 `image-gen` 추가
- [ ] `ChatMessage.tsx` 스트리밍 미완성 감지 regex 업데이트
- [ ] `ChatMessage.tsx` 렌더링 분기에 `image-gen` 케이스 추가

---

**환경변수 확인**
- [ ] `.env.local`에 `GEMINI_IMAGEN=...` 추가 확인
- [ ] Vercel 환경변수에 `GEMINI_IMAGEN` 추가 (`vercel env add GEMINI_IMAGEN`)

---

#### M6 — 프론트엔드 모델 선택 UI

유저가 채팅 중 모델을 바꿀 수 있는 UI.

- [ ] `ChatInput.tsx` 또는 `Header.tsx` — 모델 선택 드롭다운
- [ ] `src/lib/models.ts` — 표시용 모델 목록 (그룹별: Gemini / OpenAI / ImageGen)
- [ ] `useChatStream.ts` — 선택 모델을 API 요청에 포함
- [ ] `App.tsx` — 선택 모델 state 관리, 세션별 모델 기억

---

### 모델 확장 우선순위

```
선행 필수 (구조):
  M1 프로바이더 추상화 → M2 API 키 확장 → M3 모델 레지스트리

단기 (기능):
  M3 완료 후 Gemini 신모델(3.0-flash, 3.1-flash-lite) 즉시 추가 가능
  M6 프론트 모델 선택 UI

중기 (복잡):
  M4 OpenAI content 매핑 + OpenAI 모델 실제 연결

장기 (신규 기능):
  M5 이미지 생성 모델 (별도 렌더러·엔드포인트)
```

> **주의**: M1(프로바이더 추상화) 없이 OpenAI를 붙이면 `generator.ts`가 2000줄짜리 괴물이 됨 → M1이 진입점

### 카카오 지도 모달 팝업 구현 (B안)
- [ ] 카카오 디벨로퍼스 JavaScript API 키 발급 및 `.env` 추가
- [ ] `react-kakao-maps-sdk` 도입 검토 또는 직접 Script 주입 방식 구현
- [ ] 약국/병원 카드에서 마커 및 커스텀 오버레이가 포함된 지도 모달(팝업) 컴포넌트 렌더링
