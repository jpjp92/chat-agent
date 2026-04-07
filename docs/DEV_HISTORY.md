# 개발 이력 (Development History)

> 버전별 상세 변경 내역. 기능 단위 구현 기록은 `docs/DEV_YYMMDD.md` 파일 참조.

---

## 최근 작업 로그

- [DEV_260407.md](DEV_260407.md) — **의약품 이미지 미표시 버그 3차 수정** (sync 실패 시 proxy fallback 무시 버그), **mapDbMessage attachment 복원 수정**, **useChatStream URL 처리 블록 try-catch 추가**
- [DEV_260406.md](DEV_260406.md) — 예외처리 플로우 전체 검토 (P1~P5), 의약품 이미지 버그 발견 (#1 race condition, #2 scope bug)
- [DEV_260405.md](DEV_260405.md) — 시각화 카드 전체화면 팝업 계획 정리, 세션 race condition 버그 수정, UI 폴리시 2차, 스트리밍 실시간 전송 버그 수정, 웰컴화면 질의 미표시 버그 수정, 사이드바 ⋯ 드롭다운 메뉴, **Lighthouse 성능 개선 계획**, **auth 에러 무한 LoadingScreen 수정**, **헤더 모델명 좌측 패딩 축소**, **App.tsx 오케스트레이션 훅 분리 리팩토링**, **응답 대기 bouncing 도트 인디고 컬러**, **사이드바 새채팅/검색 폰트·높이 축소**
- [DEV_260404.md](DEV_260404.md) — 약품검색 Strategy 3 버그 수정, ConnectDI URL 정규화, searchWebTool 소스칩, 에이전트 9-intent 오케스트레이션 설계 및 구현, 멀티턴 버그 수정, Lighthouse 측정, **UI 글래스모피즘 개선 구현**
- [DEV_260403.md](DEV_260403.md) — 타이레놀 검색 오매칭 수정, pharm.or.kr 각인 검증 강화

---

## v4.x — Multimodal & Agentic

### v4.32 (Drug Image MFDS-missing Fix — 2026-04-07)
- **MFDS 미등록 의약품 이미지 수정**: MFDS API에 없는 의약품(일부 OTC)에서 Pharm.or.kr 발견 결과를 버리던 문제 수정. MFDS 실패 시 `pharmUrlPromise` await 후 `PARTIAL_DATA`로 LLM에 pharm_url + image_url 전달.
- **pharm.or.kr 스크래핑 추가**: `sync-drug-image.ts`에 `isPharmOrKr` 분기 추가. pharm.or.kr 상세 페이지 HTML에서 `common.health.kr/shared/images/sb_photo/` CDN 이미지 추출. `_b.jpg` 우선, 없으면 `_s.jpg` fallback.

### v4.31 (Drug Image Proxy Fallback Fix — 2026-04-07)
- **sync 실패 시 imageError 잘못 설정 수정**: `sync-drug-image` non-OK 응답 시 `setImageError(true)` 호출로 유효한 `proxiedImageUrl`이 있어도 "이미지 준비 중"이 표시되던 문제 수정. sync 실패는 캐싱 실패일 뿐이며 `imageError`는 `<img onError>`에서만 설정하도록 변경.

### v4.30 (Attachment Restore + URL Error Handling — 2026-04-07)
- **mapDbMessage attachment 복원 수정**: `attachment_url`이 HTTP URL인 경우 mimeType 자리에 URL이 그대로 들어가던 버그 수정. `inferAttachment()` 헬퍼 추가 — Supabase 버킷 경로로 mimeType 추론, `data = URL`로 복원.
- **useChatStream URL 처리 try-catch 추가**: YouTube / 일반 URL fetch가 throw 시 `setIsTyping(false)` 미호출로 스피너 영구 고착되던 문제 수정. 각 처리 블록을 독립 try-catch로 감쌈, 실패 시 Toast 표시 후 스트리밍은 계속 진행.

### v4.29 (Drug Image Race Condition Fix #2 — 2026-04-07)
- **DrugRenderer race condition 수정**: `useEffect` cleanup 부재로 이전 drug 요청 완료 시 새 drug state를 덮어쓰던 문제 해결. `AbortController` + `signal` 추가, cleanup에서 `abort()` 호출, `AbortError`는 state 변경 없이 무시.
- **sync-drug-image 스코프 버그 수정**: `fileName`, `resolveInflight`가 `try` 블록 내 `const`/`let`으로 선언되어 `catch`에서 접근 불가했던 문제 해결. 두 변수를 `try` 바깥으로 이동하여 Promise leak(무한 대기) 방지.

### v4.28 (Exception Flow Audit — 2026-04-06)
- **예외처리 전체 검토**: `geminiService.ts` fetch 6개 함수 `response.ok` 미체크(P1), `useChatStream` 스트리밍 catch에서 `onError()` 미호출(P2), `!currentUser` 에러 화면 새로고침 버튼 부재(P3), SSE JSON.parse 무방어(P4), `fetchSessions` error 필드 무시(P5) 항목 식별 및 문서화. DEV_260405 미완성 체크리스트(Lighthouse, 시각화 팝업, 아키텍처 리팩토링) 이월 정리.

### v4.26 (Sidebar Action Compact — 2026-04-05)
- **새채팅·검색 폰트 축소**: 새채팅 버튼 텍스트·검색 input `text-[15px] → text-[13px]` 통일. 아이콘 `text-[16px]/[14px] → text-[14px]/[13px]`.
- **높이 축소**: 버튼·input `h-11`(44px) → `h-9`(36px) — 사이드바 상단 액션 영역 밀도 개선.

### v4.25 (Bouncing Dot Color — 2026-04-05)
- **응답 대기 도트 컬러**: `ChatArea.tsx`·`ChatMessage.tsx` bouncing dot `bg-slate-300 dark:bg-slate-600` → `bg-indigo-300 dark:bg-indigo-400`. AI 아바타 그라디언트(`indigo→violet`) 계열과 통일, 라이트/다크 모두 대비 향상.

### v4.24 (App.tsx Orchestration Refactoring — 2026-04-05)
- **useAuthSession 분리**: auth 초기화·localStorage 복원·익명 로그인 로직을 `src/hooks/useAuthSession.ts`로 추출. `isMounted` cleanup으로 언마운트 안전 처리. `hydratedUserProfile` 계산값 자동 반환.
- **useChatSessions 분리**: 세션 CRUD·메시지 lazy load를 `src/hooks/useChatSessions.ts`로 추출. `userId` 변경 시 자동 `loadUserSessions`, 빈 세션 선택 시 `fetchSessionMessages` 자동 호출.
- **useChatStream 분리**: 메시지 전송 전체 오케스트레이션(파일 업로드·URL/YouTube/PDF 분기·스트리밍 누적·제목 요약)을 `src/hooks/useChatStream.ts`로 추출. `statusMessages` prop으로 i18n 문자열 외부 주입.
- **App.tsx 대규모 축소**: `initAuth`, `loadUserSessions`, `handleSendMessage`, `handleEditMessage` 전체 본문 제거. 핸들러는 훅 위임 래퍼로만 남음. TypeScript 컴파일 오류 0개 확인.

### v4.23 (Header Pill Padding — 2026-04-05)
- **Header Left Padding**: 데스크탑(`md:`)에서 pill 컨테이너 `pl-2` 적용 — 모델명 선택 버튼이 더 왼쪽에 배치.

### v4.22 (Auth Error Handling — 2026-04-05)
- **Auth Infinite Loading 수정**: `initAuth().catch()` 추가 — 예상치 못한 에러로 `initAuth`가 throw해도 `setIsAuthLoading(false)` 호출. 무한 LoadingScreen 방지.
- **!currentUser 분리 처리**: `isAuthLoading || !currentUser` 단일 조건 → 각각 분리. `isAuthLoading` 중엔 "세션 준비 중", auth 실패(`!currentUser`) 시엔 "연결에 실패했습니다. 페이지를 새로고침 해주세요." 메시지 표시. 4개 언어 대응.
- **loginUser error 로깅**: `if (error)` 분기 추가 — 서버에서 에러 반환 시 `console.error` 명시.

### v4.21 (Sidebar ⋯ Dropdown i18n — 2026-04-05)
- **Sidebar Menu i18n**: 드롭다운 편집/삭제 텍스트를 i18n 객체(`t.edit` / `t.delete`)로 교체. ko/en/es/fr 4개 언어 대응.
- **Sidebar overflow-hidden 제거**: 세션 아이템 `overflow-hidden` 제거 — 드롭다운이 아이템 경계 밖으로 정상 표시.

### v4.20 (Sidebar ⋯ Dropdown — 2026-04-05)
- **⋯ Dropdown Menu**: 사이드바 편집/삭제 버튼 2개 → ⋯ 단일 아이콘 + 드롭다운 방식으로 교체. 긴 제목에서 버튼 겹침 문제 해결.
- **Title Space**: 제목 `pr-5` 고정 공간 확보 — ⋯ 버튼과 겹침 방지.
- **Outside Click**: `openMenuId` state + `menuRef` + `useEffect` 외부 클릭 감지로 드롭다운 자동 닫기.

### v4.19 (Streaming Fix + Welcome Bug — 2026-04-05)
- **Streaming Real-time**: SDK path `generateContent()` (비스트리밍) → `generateContentStream()`으로 교체. 청크 단위 실시간 타이핑 효과 복원.
- **sendEvent Chain**: `generator.ts → graph.ts → chat.ts` `sendEvent` 파라미터 체인으로 청크 즉시 전달. `trackingEvent` 래퍼로 `fullAiResponse` 자동 누적 (Supabase 저장용).
- **Welcome userMessage Bug**: 새 세션 생성 시 두 번의 `setSessions` 호출로 userMessage가 React 배치에서 소실되던 문제 수정. `messages: [userMessage]` 포함한 단일 `setSessions`로 통합.

### v4.18 (UI Polish 2 — 2026-04-05)
- **Sidebar Width**: 펼쳐진 상태 `280/300px` → `260/272px` 소폭 축소.
- **Profile Modal Compact**: `max-w-sm → max-w-xs`, `p-6 → p-4`, 아이콘 `w-24 → w-20`, 버튼 `py-3.5 → py-2.5`, 모서리 `rounded-[32px] → rounded-2xl`.
- **Profile Modal Position (dvh)**: `pb-20 sm:pb-48` 고정픽셀 → `pb-[22dvh]` — dynamic viewport height 기준으로 기기별 리스트 편차 최소화.
- **Delete Dialog Compact**: `max-w-sm → max-w-xs`, `p-8 → p-5`, 제목 `text-xl → text-base`, 버튼 `py-4 rounded-2xl → py-2.5 rounded-xl`. 안내 멘트 두 줄로 분리 (`whitespace-pre-line`), 4개 언어 모두 적용.
- **ChatArea Top Padding**: `pt-4` 추가 — 첫 대화 버블이 헤더에 붙는 문제 해결.

### v4.17 (Session Bug Fix — 2026-04-05)
- **Welcome Screen New Session**: 새로고침 후 웰컴 화면에서 메시지 입력 시 기존 세션에 추가되던 race condition 수정. `loadUserSessions`에서 자동 세션 선택(`handleSelectSession`) 제거. `handleSendMessage`에서 `currentSessionId === null` 시 `createSession()` 자동 호출 후 새 세션 생성 — `activeSessionId` 패턴으로 내부 참조 9곳 교체.

### v4.16 (UI Polish — 2026-04-05)
- **Sidebar Active Session**: 활성 세션 스타일 재정비 — `bg-indigo-100/80 dark:bg-white/[0.13]`, 라이트 `text-indigo-700` / 다크 `text-white`. `ring`/`border` 제거로 `rounded-full` 형태 깔끔히 유지.
- **Sidebar Hover**: 비활성 hover `bg-slate-200/60 dark:bg-white/[0.07]` — 이전 커밋 검증값 복원 + 다크 미세 강화.
- **Sidebar Action Buttons**: 편집/삭제 버튼 컨테이너 `bg-gradient-to-l` 사각형 fade 제거. 각 버튼에 `rounded-full` 적용으로 `rounded-full` 항목 내 직사각형 보더 제거.
- **User Bubble Light**: `bg-[#eff1f1]`(중립 회색) → `bg-[#e5eaf9]`(인디고 틴트) — 라이트 배경(`#eef2ff`) 계열과 자연스럽게 어울리도록 통일.
- **User Bubble Dark**: `bg-[#2f2f2f]`(중립 회색) → `bg-[#2a2d3e]`(다크 인디고-슬레이트) — 다크 배경(`#13152b`) 인디고 네이비 계열 통일.
- **DrugRenderer Font Scale Down**: 제목 `text-3xl→2xl`, 영문명 `text-sm→xs`, 성분/복용 내용 `text-[13px]→[12px]`, 섹션 아이콘 `text-sm→xs`, 효능 아이콘 `text-lg→base` — 카드 밀도 개선.
- **Header Compact**: pill `py-2→py-1.5` 높이 축소. 모델명 `text-lg/xl→base/lg`, 햄버거 버튼 `w-9/10→w-8/9`, 유저명 `text-sm→xs`, 아바타 `w-9→w-8` 소폭 축소.
- **LoadingScreen Gradient**: 초기 로딩 화면 배경 `bg-white dark:bg-[#131314]` 단색 → App.tsx와 동일한 135deg 그라디언트로 통일. 라이트/다크 모두 테마 톤 일치.

### v4.15 (UI Glassmorphism Redesign — 2026-04-04)
- **Ambient Background**: `App.tsx` 루트 배경을 단색 → 135deg 그라디언트로 교체. 라이트: `#f0f2ff → #eef2ff → #e6fff7`, 다크: `#0f1117 → #13152b → #0e1a2e`. `fixed -z-10` 앰비언트 블롭 3개 (인디고/블루/퍼플).
- **isDark MutationObserver**: `App.tsx`에 `isDark` state + `MutationObserver` 추가. 테마 전환 시 블롭 색상 즉시 반응.
- **Sidebar Glassmorphism**: `bg-white/60 dark:bg-slate-800/60 backdrop-blur-2xl`. 데스크톱: `p-3 rounded-3xl shadow-2xl` 부유 카드. 모바일: 기존 슬라이드인 유지.
- **Header Pill**: `sticky top-3 rounded-full backdrop-blur-xl` pill 형태. 다크 배경 사이드바와 통일(`dark:bg-slate-800/60`).
- **Model Name Gradient**: 모델명 텍스트 인디고→퍼플 그라디언트 (autoeval Dashboard 타이틀 동일 스타일).
- **Border Consistency**: 헤더/사이드바 border 통일 — 라이트 `border-white/60`, 다크 `border-slate-700/40`.
- **ChatInput Glass**: `bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm` + `border-slate-200/80 dark:border-white/10`. 배경 그라디언트가 비치는 glass 처리.
- **Sidebar Collapsed UX**: collapsed 시 상단에 토글·새채팅 아이콘, 하단에 언어 아이콘 3개 구조로 정리.
- **Active Session Color**: 활성 세션 `bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300` 인디고 계열 통일.

### v4.14 (Agent Orchestration 9-Intent — 2026-04-04)
- **9-Intent Semantic Router**: Flash-Lite 분류기를 `drug_id` / `drug_info` / `medical_qa` / `biology` / `chemistry` / `physics` / `astronomy` / `data_viz` / `general` 9종으로 확장. 이전 assistant 응답 300자 컨텍스트 주입으로 follow-up intent 연속성 보장.
- **SDK Path Expansion**: `medical_qa` / `biology` / `chemistry` / `physics` / `astronomy` 전부 `@google/genai` SDK 경로로 이동 → Google Search grounding 활성화. 기존 LangChain path는 `drug_id` / `drug_info` 전용으로 축소.
- **Per-Intent Tool Sets**: `drug_id` → `identifyPillTool + searchWebTool`, `drug_info` → `searchDrugInfoTool + searchWebTool`. 불필요한 툴 바인딩 제거.
- **Intent Focus Hints**: `prompt.ts`에 `INTENT_FOCUS_HINTS` 맵 추가. intent별 렌더러 집중 지침을 시스템 프롬프트 끝에 append — 전체 프롬프트 재구성 없이 응답 품질 향상.
- **data_viz Auto Model**: `data_viz` intent는 `gemini-2.5-flash-lite` 자동 선택.
- **IntentType Union**: `state.ts`에 `IntentType` 유니온 타입 정의, `intent` 필드 타입 강화.
- **YouTube Follow-up Fix**: YouTube 요약 완료 후 `lastActiveDoc.extractedText`에 요약본 저장. 후속 질문 시 동영상 재분석 없이 `[VIDEO_ANALYSIS_SUMMARY]` 태그로 컨텍스트 재주입.
- **lastActiveDoc Tag Bug Fix**: `[TAG]: filename]` → `[TAG: filename]` 포맷 수정.
- **Header Model Dropdown**: hover 기반 드롭다운 → click 토글 방식으로 변경. 외부 클릭 닫힘, chevron 회전 피드백.
- **Dead Field Cleanup**: `types.ts` / `App.tsx`에서 미사용 `lastActiveAttachments` 필드 제거.
- **Context-Aware YouTube Detection**: `isYoutubeRequest` 로직 개선. 현재 프롬프트 내 URL 우선 처리. ArXiv PDF 등 YouTube 링크가 포함된 비-유튜브 요청에서 오탐 제거.

### v4.12
- **Long-Press Context Menu**: Glassmorphism 스타일 플로팅 메뉴. 말풍선 길게 누르기로 텍스트 복사 / 메시지 수정 가능.
- **Robust URL Handling**: 네이티브 `URL` API로 `fbclid`, `utm_*` 트래킹 파라미터 정리. `pathname` 확장자 기반 PDF 감지.

### v4.11
- **YouTube In-Chat Playback**: `YoutubeEmbed` 컴포넌트 `React.lazy` + `Suspense` 적용. 채팅 버블 내 영상 직접 재생.
- **Long Video Stability**: 30분+ 영상 Vercel 타임아웃 방지. `[YOUTUBE_VIDEO_INFO]` 태그 정렬 + grounding 로직 최적화.
- **Toast Silent Mode**: 프로필 업데이트, 세션 이름 변경 등 루틴 동작에서 토스트 알림 제거.

### v4.10
- **YouTube Hybrid Analysis**: 트랜스크립트 우선, 없으면 `fileData` 직접 영상 분석으로 자동 폴백.

### v4.9
- **Timestamp Chunking**: `[[MM:SS](URL&t=S)]` 형식 클릭 가능 타임스탬프. 구조화된 테이블 스타일 요약.

### v4.7
- **Hybrid Upload Path**: 3MB 미만 파일 → Base64 직접 전송 (Double Hop 제거). 3MB 이상 → Supabase Storage 경로.

### v4.5
- **Flawless Multi-turn Continuity**: 이전 턴의 이미지/PDF 멀티모달 히스토리 완전 복원. 긴 대화 중 컨텍스트 유지.

### v4.1
- **High-Security Presigned URL Architecture**: 프론트엔드에서 Supabase 자격증명 완전 제거. 백엔드 생성 일회용 서명 URL로 전환.

### v4.0
- **100MB Direct Supabase Upload**: 브라우저에서 Supabase Storage로 직접 업로드. Vercel 4.5MB 페이로드 제한 우회.

---

## v3.x — Drug-Viz & Visualization Engine

### v3.8 (Drug Search DDG Fallback — 2026-04-04)
- **MFDS Strategy 3 제거**: base name 재검색 로직이 전혀 다른 약품을 반환하는 오매칭 버그 수정. 실패 시 `search_web` 툴 유도 메시지로 대체.
- **LLM-layer DDG Fallback**: MFDS 미등록 약품은 LLM이 `searchWebTool`로 DuckDuckGo 검색 후 결과 반환.
- **searchWebTool URL Parsing**: DDG `uddg=` 파라미터 디코딩으로 실제 URL 추출, `[WEB_SOURCE_URLS]` 블록 반환.
- **Source Chip from Tool**: `chat.ts` `on_tool_end` 핸들러에서 소스 URL 파싱 → SSE sources 이벤트 → 하단 소스 칩 렌더링.
- **ConnectDI URL regex 수정**: 한글 단위 구형 표기 `밀리그람` 대응 (`밀리그[램람]` 패턴).



### v3.7
- **Multimodal Routing v3.7**: 일반/이미지/PDF/YouTube 요청 전부 `@google/genai` SDK 경로로 통합. LangChain 경로는 의료/툴 호출 전용으로 분리.
- **Latency-Optimized URL Passthrough**: 대용량 PDF 링크(30MB+)를 LangGraph 상태 내 Just-in-Time 방식으로 처리.

### v3.6 (Drug-Viz Advanced Identification Engine)
- **Vision-powered Imprint Parsing**: MFDS API가 "마크"(로고) 반환 시 Gemini Vision으로 실제 각인 텍스트 추출.
- **pharm.or.kr Deep Linking**: 서버사이드 스텔스 POST로 내부 `idx` 추출, 원클릭 딥링크 생성.
- **Parallel Processing Engine**: pharm.or.kr idx 조회와 MFDS 메인 조회 병렬 처리로 응답 속도 향상.
- **Separated Link Architecture**: 약학정보원 버튼은 카드 내부. ConnectDI는 카드 하단 소스 칩으로 분리.
- **Drug-Only ConnectDI Search**: 용량 정보 제거 후 기본 약품명만으로 ConnectDI 검색.
- **2-Stage Image Verification**: ConnectDI HTML 서버파싱 + 각인 매칭(앞/뒤 검증). 이미지 정확도 70% → 95%+.
- **Server-Side Identification Extraction**: ConnectDI HTML에서 모양/색상/각인 직접 파싱. AI 추출 오류 제거. 정확도 60% → 98%+.
- **Dosage-based Image Syncing**: 용량 추출(5mg vs 10mg) → ConnectDI HTML 블록 매칭으로 정확한 이미지.
- **Auto Detail Page Navigation**: ConnectDI 검색 결과 페이지 자동 감지 후 상세 페이지로 이동.
- **Smart Imprint Field Selection**: "마크"/"각인" 등 일반 표기 시 "마크내용" 필드 자동 폴백.
- **Parallel Multi-Query Imprint Search**: 짧은 각인 변형(DP → DHP, DAP 등) 자동 생성 후 병렬 검색.
- **Drug Card State Isolation Fix**: 약품 변경 시 `syncedUrl`/`imageError`/`serverPillVisual` 상태 완전 리셋.

### v3.5 (Compact Mobile Architecture)
- **Zero-Waste Header**: 모바일 헤더 높이 25% 감소.
- **Slim Input Bar**: 한 손 조작을 위한 입력창 컴팩트화.
- **Drug-Viz Premium**: Hero Section 재설계, 즉시 카드 표시, 전폭 이미지 레이아웃, Shimmer 동기화 UI.
- **Efficacy Icon Overhaul**: FontAwesome 6 Free 100% 보장 아이콘 시스템. 대사/체중/호흡기/안과 카테고리 추가.

### v3.4 (Semantic Router + ConnectDI)
- **LLM-Based Semantic Router**: `gemini-2.5-flash-lite` 기반 의도 분류. 키워드 휴리스틱 대체.
- **ConnectDI Integration**: 약품 이미지 소스로 ConnectDI 통합.
- **Front/Back Imprint Separation**: 앞/뒤 각인 분리 배지 표시.
- **Multi-Line Imprint Handling**: 한 면에 여러 줄 각인 올바르게 처리.

---

## v2.x — Visualization Modules

### v2.x (Bio-Viz)
- **3D Protein Structure**: NGL Viewer PDB 렌더링. 고품질 Cartoon 표현.
- **Perfect Visual Centering**: CSS 기반 레이아웃 최적화. `autoView` 600ms 딜레이로 레이아웃 안정화.
- **Mobile-Optimized Tooltips**: 모바일에서 잔류기 정보를 고정 하단 패널로 표시.
- **WebGL Optimization**: 명시적 context 해제(dispose) + 이벤트 리스너 관리.

### v2.x (Chem-Viz)
- **SMILES Rendering**: smiles-drawer 기반 분자 구조 렌더링.
- **ViewBox Responsive Design**: SVG viewBox 스케일링으로 데스크톱(768px)/모바일 최적화.
- **Molecule Naming & SVG Export**: 흰 배경 PNG/SVG 다운로드.

### v2.x (Physics/Diagram-Viz)
- **Matter.js Engine**: 중력, 충돌 등 2D 물리 시뮬레이션.
- **Vector Arrow Overlay**: Force/Velocity 화살표 + 텍스트 레이블 실시간 렌더링.
- **Rotational Dynamics**: 각속도, 토크, 각운동량 보존 지원.
- **Diagram-Viz**: 경사면 힘 다이어그램. 중력/수직항력/마찰력 벡터 자동 생성.

### v2.x (Constellation-Viz)
- **Real-time Sky Rendering**: 현재 날짜/위치 기반 밤하늘 렌더링 + 일주운동.
- **Zodiac 12 Support**: 12개 황도 별자리 연결선 + 다국어 이름.
- **Milky Way Engine**: 파티클 클라우드 기반 은하수 렌더링.
- **Zoom & Pan + Time Travel**: 과거/미래 시간 이동, 줌 레벨 기반 별 레이블.

---

## 성능 최적화 이력

| 항목 | Before | After | 방법 |
|------|--------|-------|------|
| Lighthouse | 44/100 | 83/100 | 전반적 최적화 |
| CSS Bundle | 124 KiB | ~15 KiB | CDN → Build-time Tailwind |
| JS Bundle (gzip) | 1.0 MB | 365 KB | Code Splitting + Lazy Loading |
| Build Time | 17s | 13s | esbuild minification |
| CLS | - | 0.00 | 명시적 이미지 dimensions |
| Best Practices | - | 100/100 | 보안/리소스 최적화 |
| FontAwesome CSS | 18.3 KiB | ~6 KiB | Subset loading |

### 주요 최적화 기법
- **Code Splitting**: 모든 시각화 컴포넌트 동적 import (Bio, Chemical, Physics, Constellation, Chart, Drug, Diagram)
- **Build-Time CSS**: CDN Tailwind → PostCSS 빌드타임 컴파일 (85% 감소)
- **Zero CDN Runtime**: `react-markdown`, `remark-gfm`, `rehype-katex` 등 전부 로컬 npm 패키지로 전환
- **Forced Reflow 제거**: `ChatInput.tsx`에서 `requestAnimationFrame` + `cancelAnimationFrame` 적용
- **FontAwesome Subset**: `all.min.css` → `fontawesome.min.css` + `solid.min.css` + `regular.min.css`
- **font-display: swap**: FontAwesome woff2 폰트가 FCP 블로킹 방지
- **Google Fonts**: 폰트 weight 7개 → 3개 (400, 600, 700)

---

## 아키텍처 변화 이력

| 시점 | 변경 내용 |
|------|-----------|
| 초기 | 단일 `api/chat.ts` 모놀리식 파이프라인 |
| v3.4 | LangGraph.js StateGraph 도입. Router/Vision/Generator 노드 분리 |
| v3.7 | SDK path(`@google/genai`) / LangChain path 이중 분기. Google Search grounding 분리 |
| v4.0 | Supabase 직접 업로드. Presigned URL 보안 아키텍처 |
| 2026-04-04 | MFDS Strategy 3 제거. DDG 폴백 소스칩. 9-intent 오케스트레이션 계획 수립 |
