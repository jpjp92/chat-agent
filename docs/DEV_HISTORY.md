# 개발 이력 (Development History)

> 버전별 상세 변경 내역. 기능 단위 구현 기록은 `docs/DEV_YYMMDD.md` 파일 참조.

---

## 최근 작업 로그

- [DEV_260427.md](DEV_260427.md) — **약품 카드 "자세히" 버튼 복구** (pharm_url 항상 null → nedrug 식약처 상세 직링크로 교체, `ITEM_SEQ` 기반 `mfds_url` 신규 필드) / **모바일 응답 실패 완화** (LangChain path maxOutputTokens 32768 → 8192, 약품 카드 생성 타임아웃 여유 확보) / **README·DEV_HISTORY 최신화** (Lighthouse 83→91, data_viz 모델, DEV_260421 누락 항목 복원 등)
- [DEV_260426.md](DEV_260426.md) — **스트리밍 중 `**` 볼드 마커 dangling 수정** / **날씨 이모지 테이블 누락 수정** / **MFDS 미등재 약품 검색 폴백 개선** / **MFDS 폴백 출처 칩 미표시 수정 3단계** / **소스 칩 스트리밍 완료 후 표시** / **첨부파일 UX 전면 개선** (자세한 내용은 DEV_260426.md 켜럼 수정 1~4 참조) / **이미지 썸네일 aspect-ratio 16/9 컨테이너** (`max-w-[220px]`, 폴백 컨테이너 크기 고정, 아이콘 축소) / **이미지 항상 Supabase 업로드** (크기 무관 `chat-imgs` 버킷 업로드 후 URL DB 저장 → 히스토리 미리보기 복원, `useChatStream.ts`)
- [DEV_260425.md](DEV_260425.md) — **npm audit fix** (22건 → 17건, 잔여 --force 불가) / **maxOutputTokens 8192 → 32768** (`generator.ts` 3곳, Vercel 60s 타임아웃 주의) / **보안 헤더 4종** (`vercel.json`, CSP 보류) / **SSRF hostname 차단** (`fetch-url.ts`, `proxy-image.ts`, 169.254.x.x·localhost)
- [DEV_260424.md](DEV_260424.md) — **SDK 스트리밍 인라인 인용 `[N]` 미제거 수정** (청크·fallback sendEvent 전 strip 추가, LangChain 경로와 정규식 통일) / **새 세션 첫 질의 스피너 미표시 수정** (`prevSessionIdRef`로 null→id 전환 시 useEffect 리셋 skip, B1 수정 부작용 해소) / **TS 에러 2건** (`activeSessionId ?? undefined`, `activeSessionId!`) / **보안 취약점 전체 현황 검토** (CRITICAL C1 IDOR·C2 supabase폴백, HIGH npm audit 22건, MEDIUM SSRF·bucket·보안헤더 등)

### v4.56 (Drug Card "자세히" Button Restore + Mobile Stability — 2026-04-27)
- **약품 카드 "자세히" 버튼 복구**: v4.52(J5)에서 pharm.or.kr dead code 제거 후 `pharm_url`이 항상 null → 버튼 미렌더 상태였음. nedrug 식약처 공식 상세 페이지 직링크(`ITEM_SEQ` 기반)로 교체. `drug-info-tool.ts`에 `ITEM_SEQ` 및 `MFDS_DETAIL_URL` 출력 추가 → `mfds_url` 필드 신규 생성. `DrugData` 인터페이스에 `mfds_url?: string` / `connectdi_url?: string` 추가. 버튼 조건 `data.pharm_url` → `data.mfds_url || data.pharm_url` 변경. ConnectDI URL은 기존 하단 소스 칩 역할 유지.
- **모바일 응답 실패 완화**: LangChain 경로(drug_id·drug_info) `maxOutputTokens: 32768 → 8192`. 약품 카드 JSON + 한 줄 요약은 1,500토큰 이내 — 32768 토큰 대기는 불필요했고 Router + MFDS API + Vision + 생성 시간이 Vercel 60s에 근접하던 문제 완화. SDK 경로(일반 쿼리) 32768 유지.
- **prompt.ts json:drug 스키마 정비**: `mfds_url` 필드 추가, PHARM_URL·MFDS_URL·CONNECTDI_URL 규칙 분리 명확화.

### v4.55 (Streaming Bold Marker Fix + Weather Emoji Fix + MFDS Fallback + Attachment Icons + Citation Buffer + Attachment UX — 2026-04-26)
- **`**` 볼드 마커 dangling 수정**: `ChatMessage.tsx` `renderContent()` 내 2곳(incomplete viz 분기·normal 분기)에 홀수 `**` 감지 시 닫기 추가. `(processedRemaining.match(/\*\*/g) || []).length % 2 !== 0` 조건 시 `processedRemaining += '**'`. 스트리밍 도중 닫히는 `**`가 아직 미도착한 경우 ReactMarkdown이 `**` 기호를 리터럴로 렌더링하던 문제 해소. 기존 backtick dangling closure(` ``` ` 홀수 시 `\n` ``` 추가) 패턴과 동일 구조. 다음 청크 도착 시 실제 닫히는 `**`로 자연스럽게 중화.
- **날씨 이모지 테이블 누락 수정**: `api/_lib/agent/prompt.ts` 날씨 이모지 가이드와 예시 테이블의 맑음 이모지 불일치(`🌤️` vs `🌞`) 해소 → 예시 테이블을 `🌞 맑음`으로 통일. 테이블 셀에 이모지 MANDATORY 지시 추가. 비(`🌧️`)는 정상 표시되지만 맑음은 누락되던 문제 — 가이드 불일치로 모델이 혼선을 빚어 맑음 이모지를 생략하던 원인.
- **MFDS 미등재 약품 검색 폴백 개선**: 파스·연고·액제 등 비알약 제형은 MFDS 알약식별 DB에 원천 미등재. MFDS 실패 시 Google Search grounding → DuckDuckGo → LLM 내부 지식 3단계 폴백 체인으로 변경. `searchDrugViaGoogleSearch()` 헬퍼 추가(`GoogleGenAI` SDK + `googleSearch` tool + grounding chunks → `[WEB_SOURCE_URLS]` 블록 반환으로 소스 칩 표시). `prompt.ts` PROACTIVE DRUG VISUALIZATION·PRIORITY RULE·drug_info intent hint에 `[MFDS_NOT_FOUND]` 예외 추가. `chat.ts` 스트리밍 sanitizer에 누출 방어 3종 추가.
- **MFDS 폴백 출처 칩 미표시 수정 (1차)**: `groundingChunks`(개별 URL)가 빈 배열로 반환될 때 소스 칩이 미표시되던 문제. Gemini가 검색을 사용해도 특정 페이지를 명시하지 않으면 `groundingChunks`는 비어 있음. `webSearchQueries`(실제 사용 검색어)는 거의 항상 반환되므로 이를 Google 검색 URL로 변환해 폴백 소스 칩으로 표시. grounding 상태 진단 로그(`chunks: N | queries: [...]`) 추가.
- **MFDS 폴백 출처 칩 미표시 근본 해결 (2차)**: `on_tool_end` 이벤트 firing 여부 및 `event.data.output` 구조의 불확실성으로 의존 구조 자체가 취약. `on_chain_end` for "LangGraph" 핸들러에서 최종 그래프 state의 `messages`를 직접 순회해 ToolMessage 내 `[WEB_SOURCE_URLS]` 블록을 스캔하는 방식으로 교체. 그래프 완료 시점에 모든 ToolMessage가 상태에 포함되므로 누락 없음. 진단 로그 `[Chat API] LangGraph end — ToolMessage len: N, hasUrls: true/false` 추가.
- **소스 칩 실제 미렌더링 원인 해결 (3차)**: SSE 응답 확인 결과 `sources` 이벤트가 정상 전송되고 있었으나 텍스트 이벤트보다 먼저 도착하는 것이 문제. `sources` 콜백 실행 시점에 `modelMessageId` 메시지가 아직 `session.messages`에 없어 소스가 silently 무시됨. `useChatStream.ts`에 `pendingSources` 변수 추가 — `sources` 콜백에서 항상 최신 소스 보관, 첫 텍스트로 메시지 신규 생성 시 `pendingSources`를 `groundingSources`에 반영.
- **소스 칩 스트리밍 완료 후 표시 (4차)**: 소스 칩이 스트리밍 응답 도중에 노출되어 어색하다는 피드백. `sources` 콜백에서 즉시 `setSessions` 제거 — `pendingSources`에만 보관. `finally` 블록(스트리밍 완전 종료 후)에서 일괄 적용. `general` intent Google Search 소스도 동일 경로를 경유하므로 함께 개선.
- **첨부파일 타입 레이블 간소화**: `ChatMessage.tsx` 이미지 폴백 `"이미지 첨부파일"` → `"IMG"`, PDF `"PDF 문서"` → `"PDF"`. 기타 문서(docx·xlsx·pptx·csv·hwpx) 단순 행 레이아웃을 PDF 카드 스타일로 통일 — 아이콘 블록 + 파일명 + 확장자 뱃지(`DOCX` / `XLSX` / `PPTX` / `CSV` / `HWPX`).
- **첨부파일 깨진 이미지 아이콘 대체**: `ChatMessage.tsx`에 `AttachmentImage` 컴포넌트 추가. `src=''` 또는 `onError` 시 `fa-image` 아이콘 + "이미지 첨부파일" 텍스트 폴백 UI. `renderSingleAttachment`(isImage 분기)와 다중 이미지 그리드 2곳 모두 적용. 아이콘 색상 덮어쓰기 버그(`text-slate-400`) 분리 수정, hwpx mimeType 체크(`includes('hwpx') || includes('x-hwp')`) 추가.
- **첨부파일 mimeType·fileName 오추론 수정**: `useChatSessions.ts` `inferAttachment()`에 `EXT_MIME` 맵 추가(`.docx`·`.xlsx`·`.pptx`·`.hwpx`·`.csv`·`.mp4`·`.webm`·`.mov`). HTTP URL: 확장자 우선 추론 → 확장자 없을 때만 버킷 경로 폴백. mimeType 문자열 저장 케이스(base64 인라인): fileName도 `'image_attached'` 대신 `'document.docx'` 등으로 정확 설정. 기존 `chat-docs/` 경로 기반 추론이 docx·xlsx·pptx를 PDF로 오판하던 문제 해소.
- **스트리밍 `[N]` citation 청크 분할 수정**: PDF 문서 분석 시 `[15]` 등 인용 마커가 청크 경계에서 split되면 per-chunk strip이 동작 안 하던 문제 해소. `generator.ts`(SDK 스트리밍)에 `citationBuffer` + `incompletecitation = /\s?\[\d*(?:,\s*\d*)*$/` lookbehind 패턴 추가. 청크 처리 시 이전 버퍼 + 현재 청크 합산 → strip → 끝에 불완전 패턴 검출 시 버퍼 보류 → 다음 청크와 합산. 스트림 종료 후 버퍼 flush. `chat.ts`(LangChain `on_chat_model_stream`) 동일 패턴 `lcCitationBuffer`로 적용, `on_chain_end(LangGraph)` 이벤트에서 flush.
- **첨부파일 UX 개선 — 직사각형 레이아웃 & 문서 카드 정보 밀도**: 입력창 썸네일 이미지·비디오 `128×72px` / 문서 `160×72px` 직사각형 통일. hover 오버레이 삭제 버튼(클리핑 이슈 해결). 채팅 이력 이미지 `h-200px` 고정 직사각형. 문서 카드 아이콘 `w-12 h-12 text-2xl`, 파일명 `max-w-[280px]`, 파일 크기 `· 2.4 MB` 표시, 타입별 hover 색상. `types.ts` `fileSize?: number` 추가, `formatFileSize()` 헬퍼, `AttachmentImage` `style` prop 추가.
- **이미지 썸네일 aspect-ratio 16/9 컨테이너**: `ChatMessage.tsx` 이미지 렌더링을 `aspect-ratio: 16/9` 고정 비율 컨테이너 + `object-cover`로 전환. 최대 너비 `max-w-[220px]`(220×124px). 폴백 디브(`AttachmentImage`) `w-full h-full`로 부모 컨테이너 비율 따름 — 이미지 로드 실패 시에도 일관된 placeholder 표시. 다중 이미지 그리드도 동일 비율 적용. 폴백 아이콘 `text-3xl → text-lg`, 레이블 `text-xs → text-[10px]`.
- **이미지 항상 Supabase 업로드**: `useChatStream.ts` 업로드 분기 조건 `!isVideo → !isImage && !isVideo`로 변경. 이미지는 크기에 무관하게 `chat-imgs` 버킷에 업로드 → Supabase public URL을 `attachment_url`로 DB 저장. 세션 로드 시 `inferAttachment()`이 URL로 이미지 정상 복원. 기존 세션의 소용량 이미지(미저장 base64)는 IMG 폴백 유지(North star 외 들리없음).

### v4.54 (npm audit fix + maxOutputTokens — 2026-04-25)
- **npm audit fix**: 의존성 취약점 22건 → 17건. `smol-toml` 등 non-breaking 5건 해소. 잔여 17건은 `@vercel/node@5.5.17→4.0.0` 다운그레이드 또는 `xlsx` fix 없음으로 `--force` 미적용.
- **maxOutputTokens 상향**: `generator.ts` SDK 스트리밍·fallback·LangChain 3경로 모두 8,192 → 32,768. Gemini 2.5 Flash 최대 65,536 기준 12.5% → 50% 허용. 한국어 응답 상한 ~5,000자 → ~20,000자. Vercel `maxDuration: 60` 기준 16,000토큰+ 응답 시 타임아웃 가능성 있음.
- **보안 헤더 추가**: `vercel.json`에 X-Content-Type-Options·X-Frame-Options·Referrer-Policy·HSTS·Permissions-Policy 5종 추가. CSP는 KaTeX·FontAwesome inline style 의존성으로 보류.
- **SSRF hostname 차단**: `fetch-url.ts` 선행 검사 + `proxy-image.ts` URL repair 후 검사. localhost·127.x.x.x·169.254.x.x(메타데이터 서버)·::1 차단. redirect 우회 한계 감수.

### v4.53 (SDK Streaming Citation Strip & New Session Spinner Fix — 2026-04-24)
- **SDK 스트리밍 `[N]` 인라인 마커 미제거 수정**: `generator.ts` SDK 스트리밍 청크·비스트리밍 fallback 양쪽에서 `sendEvent` 호출 전에 `\s?\[\d+(?:,\s*\d+)*\]/g` strip 적용. 기존 로직은 `AIMessage` 상태만 수정하고 SSE로 전송된 청크에는 무관했음. LangChain 경로(`chat.ts:221`)와 동일한 패턴으로 통일.
- **새 세션 첫 질의 스피너 미표시 수정**: `useChatStream.ts`에 `prevSessionIdRef` 도입. `null → sessionId` 전환(새 세션 생성)은 useEffect 리셋 skip, `sessionId → anything` 전환(사용자 전환)만 `isTyping=false` / `loadingStatus=null` 리셋. B1 수정(v4.51) 부작용으로 새 세션 생성 시 useEffect가 발화해 스피너를 즉시 꺼버리던 문제 해소.
- **TS 타입 에러 수정**: `streamChatResponse` 호출 시 `activeSessionId ?? undefined`, `updateSessionTitle` 호출 시 `activeSessionId!` non-null assertion 추가.
- [DEV_260423.md](DEV_260423.md) — **에러 처리 전체 감사** (CRITICAL/HIGH/MEDIUM/LOW 분류) / **약품 이미지 시스템 전면 수정** (J1~J5: nedrug 차단 시 ConnectDI 폴백, content-type 검증, 밀리그람 전략, pharm.or.kr dead code 23개 약품 0% 확인 후 제거) / **이미지 분석 bodyParser 10MB** / **멀티턴 이미지 분석 품질 저하 수정** (historyHasImage Google Search 오염 방지) / **세션 전환 시 입력창 비활성화 수정** (isTyping/loadingStatus 리셋 useEffect) / **스트림 에러 키 재시도 확장** (K1: INTERNAL/503/parse 에러 포함) / **DuckDuckGo 파싱 개선** (K2: Strategy 1 정규식 완화, Strategy 2 추가) / **chat.ts 다중 개선** (K3: unhandledRejection 가드, K4: Gemini 인라인 인용 `[1]` 스트리핑, K5: MFDS_NOT_FOUND 시스템 지시 누출 필터, K6: on_tool_end 출력 타입 핸들링)
- [DEV_260421.md](DEV_260421.md) — **prompt.ts 성능 회귀 롤백** (날씨·URL/PDF 포맷 회귀 수정, cc04895 기준 복원) / **모델 gemini-2.5-flash 전면 통일** (`data_viz` flash-lite 오버라이드 제거, `vision.ts` flash-lite → flash) / **URL 요약 헤딩 다국어 재적용** (KO/EN/ES/FR `URL_SUMMARY_LABELS` 맵, `getSystemInstruction` 블록 함수 전환)
- [DEV_260420.md](DEV_260420.md) — **URL 요약 `[1]` 인용 마커 제거** / **소스 텍스트 크기 18000→15000자 조정** / **다크모드 미드나잇 인디고 B+1 적용** / **한 줄 요약 blockquote 스타일 복원** / **모바일 사이드바 새 채팅 폰트 불일치 수정** / **PDF URL 요약 포맷 통일** / **날씨 이모지 누락 수정** / **URL 요약 헤딩 다국어 대응** (언어별 주입)
- [DEV_260419.md](DEV_260419.md) — **모바일 YouTube 요약 연결 끊김 수정** (`fetch-transcript` Edge 런타임 제거 → Node.js 전환 + 타임아웃 10s/8s → 25s/15s) / SSE Heartbeat 15s→8s + `X-Accel-Buffering: no` 헤더 추가 / `fetchYoutubeTranscript` 프론트 45s 타임아웃 명시
- [DEV_260418.md](DEV_260418.md) — **URL 요약 첫 시도 빈 응답 버그 수정** (`[FETCH_ERROR]` 감지 → `[URL_CONTENT]` 태그 미부착 → Google Search 자동 대체) / **Lighthouse 70점 성능 분석** (TBT forced reflow, ChatMessage 워터폴, 미사용 JS 281KB — 향후 수정 예정)
- [DEV_260417.md](DEV_260417.md) — **DrugRenderer null crash 수정** / **drug-info-tool PARTIAL_DATA 제거** / **fetch-url 콘텐츠 추출 개선** / **chat.ts API 키 소진 에러 분류** / **MFDS 미등록 약품 출처 칩 미표시 수정** / **URL 요약 품질 개선** / **Lighthouse TBT 개선** + **캐시 버그 3건** / **URL 요약 3-part 구조화** / **fetch-url 중첩 div 본문 잘림 수정** / **테이블 포맷 안정화 지침** / **URL 기반 PDF 세션 크래시 수정** / **YouTube 세션 크래시 3종 수정** — follow-up 재분석 차단·lite→standard 모델 변경·빈 응답 에러 throw / **generator.ts multimodal 500 smart retry** — forceTextOnly + Google Search 자동 활성 재시도 / **maxOutputTokens 8192→16384** — YouTube 요약 잘림 수정·MAX_TOKENS 감지 로그 / **[미수정] useChatStream lastActiveDoc YouTube 오염 버그**
- [DEV_260416.md](DEV_260416.md) — **전체 코드 보안 취약점 감사** — IDOR(auth/sessions), SSRF(fetch-url), bucket 화이트리스트 미적용(upload/create-signed-url), 에러 노출, fetch timeout 미적용(fetch-url/sync-drug-image) / **약품 카드 이미지 미표시(모바일) 수정** — sync-drug-image·proxy-image·DrugRenderer 전 fetch timeout 추가 / **채팅 이전 대화 AI 응답 누락 수정** — chat.ts DB 저장 fire-and-forget → await 변경 / **MFDS 장애 시 ConnectDI 폴백** — nedrug 404 시 drug_name 기반 ConnectDI 자동 검색·캐시. parseMedList + scoreNameMatch 기반 정확 매칭. 기존 drug_list 파싱 버그도 함께 수정
- [DEV_260415.md](DEV_260415.md) — **에러 처리 전체 감사 + 1~4라운드 적용 완료** / **SDK 스트리밍 중복 응답 버그 수정** / **`drug-info-tool.ts` timeout 3곳** / **`responseText` 스코프 버그 수정**
- [DEV_260413.md](DEV_260413.md) — **이미지 분석 Latency & 세션 종료 버그 수정** (Router fast-path, 공개 URL 이중 fetch 제거, Supabase fire-and-forget, SSE heartbeat)
- [DEV_260407.md](DEV_260407.md) — **의약품 이미지 미표시 버그 3차 수정** (sync 실패 시 proxy fallback 무시 버그), **mapDbMessage attachment 복원 수정**, **useChatStream URL 처리 블록 try-catch 추가**
- [DEV_260406.md](DEV_260406.md) — 예외처리 플로우 전체 검토 (P1~P5), 의약품 이미지 버그 발견 (#1 race condition, #2 scope bug)
- [DEV_260405.md](DEV_260405.md) — 시각화 카드 전체화면 팝업 계획 정리, 세션 race condition 버그 수정, UI 폴리시 2차, 스트리밍 실시간 전송 버그 수정, 웰컴화면 질의 미표시 버그 수정, 사이드바 ⋯ 드롭다운 메뉴, **Lighthouse 성능 개선 계획**, **auth 에러 무한 LoadingScreen 수정**, **헤더 모델명 좌측 패딩 축소**, **App.tsx 오케스트레이션 훅 분리 리팩토링**, **응답 대기 bouncing 도트 인디고 컬러**, **사이드바 새채팅/검색 폰트·높이 축소**
- [DEV_260404.md](DEV_260404.md) — 약품검색 Strategy 3 버그 수정, ConnectDI URL 정규화, searchWebTool 소스칩, 에이전트 9-intent 오케스트레이션 설계 및 구현, 멀티턴 버그 수정, Lighthouse 측정, **UI 글래스모피즘 개선 구현**
- [DEV_260403.md](DEV_260403.md) — 타이레놀 검색 오매칭 수정, pharm.or.kr 각인 검증 강화

---

## v4.x — Multimodal & Agentic

### v4.52 (Drug Image System Overhaul — 2026-04-23)
- **nedrug 차단 시 ConnectDI 자동 폴백 (J1)**: `sync-drug-image.ts` catch 블록에 ConnectDI 폴백 추가. nedrug ECONNRESET/timeout 시에도 동일 이미지 ID로 ConnectDI 검색·캐시. 23개 약품 테스트 기준 24% 차단 케이스 전부 커버.
- **HTML 점검 페이지 통과 차단 (J2)**: `proxy-image.ts` content-type 검증 추가. `image/` 또는 `application/octet-stream` 아닌 응답 422 반환 → `<img>` onError 오탐 제거.
- **MFDS 밀리그람 구표기 전략 추가 (J3)**: `drug-info-tool.ts` MFDS 검색 Strategy 3 추가. `밀리그램→밀리그람` / `마이크로그램→마이크로그람` 변환 후 재검색 → MFDS DB 실제 표기 기준 매칭 성공률 향상.
- **DrugRenderer sync 실패 로깅 (J4)**: sync 실패(4xx/5xx) 시 `console.warn` 추가. 원인 추적 가시성 개선.
- **pharm.or.kr 완전 제거 (J5)**: 23개 약품 전수 테스트에서 0% 성공 확인 후 dead code 제거. `getPharmOrKrDetailUrl` 198줄, 병렬 `pharmUrlPromise` 킥오프, 결과 포매팅 `Pharm_URL` 항목 전부 제거. `pharm_url` 지시 "항상 null, URL 추측 금지"로 고정.
- **23개 약품 테스트 스크립트**: MFDS 검색 74%, nedrug 직접 차단 24%(ConnectDI 커버), DB 미등재 4건(구조적 한계), ConnectDI JS렌더링 1건(엣지케이스) 확인.

### v4.51 (Image Analysis & Session Bug Fixes — 2026-04-23)
- **이미지 분석 bodyParser 10MB (I1)**: `api/chat.ts`에 `export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }` 추가. base64 인라인 이미지(~4MB) + history로 Vercel 기본 4.5MB 초과 → `TypeError: Load failed` 간헐 크래시 해소.
- **멀티턴 이미지 Google Search 오염 방지 (I6)**: `generator.ts`에 `historyHasImage` 체크 추가. `useGoogleSearch = !hasMultimodalContent && !historyHasImage`. 이미지 분석 2턴 이후 `isRecent` 컷오프로 이미지 탈락 → `hasMultimodalContent=false` → Google Search 강제 활성 → 짧은 generic 응답 체인 차단.
- **세션 전환 시 입력창 비활성화 수정 (B1)**: `useChatStream.ts`에 `currentSessionId` 변경 감지 `useEffect` 추가. 세션 전환 즉시 `isTyping=false` / `loadingStatus=null` 리셋. 스트리밍 도중 세션 전환 시 `finally` 타이밍 레이스로 `isTyping=true` 고착되던 문제 해소.

### v4.50 (Error Handling Audit & Chat Robustness — 2026-04-23)
- **에러 처리 전체 감사**: CRITICAL(C1 pill-logic Promise.all, C2 geminiService response.ok 미체크) / HIGH(H1 Supabase insert .catch 누락, H2 fetch-url 에러 시 200 반환, H3 drug-info-tool .catch 빈 삼킴) / MEDIUM(M1 URL fetch 실패 미표시, M2 sessions 파라미터 검증 없음, M3 upload base64 검증, M4 React Error Boundary 없음) / LOW(LangGraph 타임아웃, SSE disconnect 핸들링, API 키 circuit breaker) 분류·문서화.
- **스트림 에러 키 재시도 확장 (K1)**: `generator.ts` 429 Rate Limit 외 `Failed to parse stream` / `INTERNAL` / `503` 에러도 다음 API 키로 재시도. 재시도 로그에 실패 원인 포함.
- **DuckDuckGo 파싱 개선 (K2)**: `tools.ts` `extractRealUrl` 헬퍼 추출. Strategy 1 정규식 완화(`result__body` 래퍼 제거, result__a + snippet 근접 매칭). Strategy 2 추가(uddg= URL 독립 추출 fallback). 디버그 로깅 원시 HTML 600자 샘플.
- **unhandledRejection 가드 (K3)**: `api/chat.ts`에 LangGraph pregel 에러가 try-catch 외부로 탈출 시 에러 이벤트 전송 후 클린업.
- **Gemini 인라인 인용 스트리핑 (K4)**: `api/chat.ts` 스트림 청크·fallback 메시지 양쪽에서 `[1]`, `[1, 3]` 등 grounding 인라인 인용 패턴 제거.
- **MFDS_NOT_FOUND 지시 누출 필터 (K5)**: `api/chat.ts` `json:drug 블록은 생성하지 마세요` 등 시스템 지시문이 응답에 노출되는 경우 스트리핑.
- **on_tool_end 출력 타입 핸들링 (K6)**: `api/chat.ts` string / `{content: string}` / `{content: array}` 형식 모두 처리. 디버그 로그 추가.

### v4.49 (Mobile YouTube Transcript Fix — 2026-04-20)
- **모바일 YouTube 요약 연결 끊김 수정**: `fetch-transcript.ts` Edge 런타임 제거 → Node.js 전환 (Edge 30s 하드캡 해소). YouTube HTML fetch 타임아웃 10s→25s, XML 자막 fetch 8s→15s. 총 최대 소요 ~40s → Vercel 60s 이내 완료. 모바일 느린 네트워크에서 자막 fetch 실패 → native video analysis 폴백 → 60s 타임아웃 초과 연결 끊김 체인 차단.
- **SSE 연결 안정성 강화**: `api/chat.ts`에 `X-Accel-Buffering: no` 헤더 추가(모바일 nginx 프록시 버퍼링 방지). Heartbeat 간격 15s→8s(모바일 idle 연결 드롭 방지).
- **프론트 타임아웃 명시**: `fetchYoutubeTranscript`에 AbortController 45s 타임아웃 추가.
- **자동 재시도**: `useChatStream`에 cold start 빈 응답 자동 1회 재시도 추가 — `재시도 중...` 상태 표시 후 1.5s 대기, 재시도 불가 에러(429/503/인증)는 즉시 에러 표시.

### v4.49.1 (Prompt Rollback + Model Unification + i18n URL Headings — 2026-04-21)
- **prompt.ts 성능 회귀 롤백**: `cc04895` 이후 누적된 변경으로 날씨 응답 포맷 이상·URL/PDF 요약 잘림·PDF 분석 세션 타임아웃 회귀 발생. cc04895 기준으로 `prompt.ts` 전체 롤백. 비-prompt 개선사항(geminiService.ts 504 크래시 방지, useChatStream.ts 재시도 딜레이, generator.ts maxOutputTokens 8192 복원·[N] 마커 제거·hasUrlContent 300자 threshold)은 유지.
- **모델 gemini-2.5-flash 전면 통일**: `generator.ts` `data_viz` intent flash-lite 오버라이드 제거 → 모든 intent flash 사용. `vision.ts` `gemini-2.5-flash-lite` → `gemini-2.5-flash` 교체. flash-lite는 긴 문서·PDF 분석 품질 저하 및 세션 불안정 확인에 따른 결정.
- **URL 요약 헤딩 다국어 재적용**: `getSystemInstruction` arrow → block 함수 전환. `URL_SUMMARY_LABELS` 맵 추가(KO/EN/ES/FR). URL_CONTENT 포맷 블록 헤딩을 언어별 `${lbl.summary}` / `${lbl.content}` / `${lbl.points}` 변수로 주입 — `ENTIRE RESPONSE IN ENGLISH` 지시 시에도 한국어 헤딩 고정 출력되던 문제 해소.

### v4.48 (URL Summary Empty Response Fix — 2026-04-18)
- **URL 요약 첫 시도 빈 응답 버그 수정**: `fetch-url` 타임아웃 또는 네트워크 에러 시 `[FETCH_ERROR]` 또는 빈 문자열이 반환되어도 `[URL_CONTENT]` 태그가 webContext에 붙으면서 `hasUrlContent=true` → Google Search 비활성화 → LLM이 빈 내용으로 호출 → 빈 응답. `fetchUrlContent`에서 `[FETCH_ERROR]` 감지 시 빈 문자열 반환. `useChatStream`에서 pageContent가 비어있으면 `[URL_CONTENT]` 태그 미부착 → Google Search 자동 대체. `generator.ts`에서 `hasUrlContent` 체크를 정규식으로 개선(태그+실제 내용 모두 있어야 true).

### v4.47 (Lighthouse TBT Performance Improvement + Cache Bug Fixes — 2026-04-17)
- **ChatMessage 레이지 로딩 (`ChatArea.tsx`)**: `react-syntax-highlighter(Prism)` + `react-markdown` + `rehype-katex` 를 critical bundle에서 제거. 초기 로드 시 메시지 없음 → ChatMessage 청크 로드 안 됨 → Prism 언어 정의 초기화(forced reflow 원인)가 메인 스레드에서 제거. TBT 280ms → 150~180ms 목표.
- **katex CSS lazy 분리 (`App.tsx` → `ChatMessage.tsx`)**: `import 'katex/dist/katex.min.css'`를 App.tsx(critical CSS)에서 ChatMessage.tsx(lazy chunk)로 이동. 초기 CSS 번들에서 ~28 KiB katex CSS 제거 → FCP/LCP 개선.
- **sessions localStorage 캐시 (`useChatSessions.ts`)**: 앱 첫 렌더 시 localStorage 캐시(`chat_sessions_cache_v1`)에서 즉시 세션 목록 복원 → Vercel cold start 1,923ms 동안 빈 사이드바 대신 이전 목록 즉시 표시. API 응답 후 캐시 갱신(최대 30개). 세션 생성/삭제/유저 변경 시 캐시 동기화.
- **[Critical] `writeSessionsCache([])` 자기파괴 버그 수정**: `useEffect([userId])` 마운트 시 `userId=null`로 즉시 실행 → `writeSessionsCache([])` 호출로 복원한 캐시를 즉시 덮어쓰던 문제. `!userId` 분기에서 `writeSessionsCache([])` 제거 — 캐시는 명시적 사용자 리셋 시에만 초기화.
- **[Medium] `renameSession` 캐시 미동기화 수정**: 세션 제목 변경 시 React state만 업데이트하고 `writeSessionsCache()` 미호출. 함수형 `setSessions` + `writeSessionsCache(updated)` 패턴으로 통일.
- **[Medium] Suspense blank flash 수정 (`ChatArea.tsx`)**: 첫 메시지 전송 시 ChatMessage 청크 미로드 → Suspense `fallback={null}` → 빈 화면. 마운트 200ms 후 백그라운드 preload `useEffect` 추가로 해소.
- **배경 분석**: TBT 280ms 원인은 ChatArea → ChatMessage → react-syntax-highlighter 정적 import 체인. framer-motion은 이미 lazy-load된 DrugRenderer/BioRenderer/PhysicsRenderer에만 있어 문제 없음. 세션 API 1,923ms는 Vercel cold start 특성, 캐시로 체감 지연 해소.

### v4.46 (URL Summary Quality Fix + Drug Source Chip Fix — 2026-04-17)
- **URL 요약 품질 개선**: `generator.ts`에서 `[URL_CONTENT]` 감지 시 Google Search 비활성화. 기존에는 Google Search 스니펫을 우선 사용해 2~3문장 요약만 반환. 이제 fetch-url로 가져온 20,000자 전문을 단독 소스로 사용 → 구조화된 상세 요약. `prompt.ts`에 `[URL_CONTENT]` 처리 지침 추가(SOLE primary source, headings/bullets 요구).
- **MFDS 미등록 약품 출처 칩 미표시 수정**: `searchDrugInfoTool`이 MFDS 결과 없을 때 "search_web 툴을 호출하세요" 지시를 반환하면 LLM이 무시하고 가짜 [1], [2] 인용 생성. `searchWebTool.invoke()` 직접 호출로 변경 — DDG 결과 + `[WEB_SOURCE_URLS]`를 tool output에 임베딩. `chat.ts`에서 `search_drug_info` `on_tool_end` 이벤트도 URL 추출 대상에 추가.

### v4.45 (DrugRenderer Null Safety + Drug Info Tool Fallback Simplification — 2026-04-17)
- **DrugRenderer.tsx null crash 수정**: `data.category.split()` null 호출 크래시 → `(data.category || '').split()`으로 null safe 처리. `data.ingredient` null 렌더링도 `|| '-'` fallback 추가. ConnectDI 폴백으로 이미지만 있는 약품도 카드 정상 렌더링.
- **drug-info-tool.ts PARTIAL_DATA 제거**: MFDS 결과 없음 시 PARTIAL_DATA 강제 drug card 생성 방식 제거. 모든 필드 null인 빈 카드 문제 해소. `search_web "${drug_name} 성분 효능 용법 용량"` 지시로 단순화 — 실질적인 텍스트 정보 제공.
- **fetch-url.ts URL 콘텐츠 추출 개선**: 브라우저 User-Agent·Accept 헤더 추가(bot 차단 우회). og:title / og:description 메타 추출. nav·header·footer·aside·iframe 등 노이즈 태그 제거. `<article>` → `<main>` → class 패턴 우선 추출. 20,000자 제한 유지. 뉴스 기사 요약 품질 대폭 향상.
- **chat.ts API 키 소진 에러 분류**: `No API key available` / `API keys exhausted` 패턴 감지 → 429와 동일한 "잠시 지연" 메시지. 내부 에러 문자열 노출 없음.

### v4.44 (Node Bug Fixes + Drug Info Tool URL Fix — 2026-04-16)
- **drug-info-tool.ts ConnectDI URL 수정**: `connectdi.co.kr` (잘못된 도메인) → `connectdi.com/mobile/drug/?pap=search_result...` 형식으로 교체. MFDS 성공/실패 두 분기 모두 수정.
- **drug-info-tool.ts PARTIAL_DATA drug card 미생성 수정**: pharm.or.kr 발견 시 PARTIAL_DATA 지시문에 `[MANDATORY] json:drug 반드시 생성` 명시. 부분 데이터에도 drug card 먼저 생성하도록 순서 변경.
- **sync-drug-image.ts MFDS 200 HTML 처리**: MFDS 유지보수 시 200 text/html 응답은 `!externalResponse.ok` 조건을 통과해 content-type 체크에서 걸림. 해당 분기에도 ConnectDI fallback 추가.
- **generator.ts `[TRANSCRIPT]` 불일치 수정**: `[YOUTUBE_VIDEO_INFO]` → `[TRANSCRIPT]` 변경. YouTube 트랜스크립트 시 Google Search 비활성화 최적화 정상 동작.
- **generator.ts `sdkSuccess` 스코프 버그 수정**: `let sdkSuccess`를 `if (!useLangChain)` 블록 바깥으로 이동. SDK 완전 실패 시 ReferenceError 방지.

### v4.43 (MFDS Outage ConnectDI Fallback — 2026-04-16)
- **MFDS 장애 시 ConnectDI 폴백**: `sync-drug-image.ts`에 `tryConnectDIFallback` 추가. `nedrug.mfds.go.kr` 404 시 `drug_name`에서 기본명을 추출해 ConnectDI 검색 → `parseMedList` 파싱 → `scoreNameMatch`(score ≥ 40) 최적 매칭 → 이미지 다운로드 → Supabase 캐시. MFDS 서버 전체 중단 시에도 이미지 표시 가능.
- **기존 ConnectDI 검색결과 파싱 버그 수정**: `html.split(drug_list div)` → `parseMedList + scoreNameMatch`로 교체. `drug_list` 클래스는 실제 ConnectDI HTML에 없어 항상 0개 블록이었음.

### v4.42 (Drug Card Image Timeout + Chat History AI Response Fix — 2026-04-16)
- **약품 카드 이미지 미표시(모바일) 수정**: `sync-drug-image.ts` 내부 fetch 전체에 AbortController 추가 (HEAD 5s, 메인 12s, pharm.or.kr 8s×2, 스크래핑 8s, ConnectDI HTML 8s×2). `proxy-image.ts` 외부 fetch 10s timeout 추가. `DrugRenderer.tsx` 클라이언트 sync fetch 20s timeout → 초과 시 abort → proxy fallback 자동 전환. Shimmer 영구 표시 해소.
- **채팅 이전 대화 AI 응답 누락 수정**: `api/chat.ts` 스트리밍 완료 후 AI 응답 DB 저장을 fire-and-forget(`.then()`)에서 `await Promise.all([...])`로 변경. Vercel 함수 freeze로 `.then()` callback 미실행되던 근본 원인 해소. SSE 스트림은 이미 완료 상태이므로 UX 지연 없음.

### v4.40 (Error Handling Round 3~4 + Scope Fix — 2026-04-16)
- **drug-info-tool.ts timeout 3곳**: `extractImprintViaVision` nedrug 이미지 fetch 6초, `getPharmOrKrDetailUrl` pharm.or.kr 전략 루프 fetch 8초/iteration, `fetchMFDS` MFDS API fetch 8초. AbortController try/finally 패턴.
- **generator.ts `responseText` 스코프 버그 수정**: `let responseText`/`groundingSources`가 `try {}` 내에서 선언되어 `catch {}` 블록에서 접근 불가했던 문제 수정. `while` 루프 직하로 이동. 중복 응답 방지 가드가 이제 실제로 동작.

### v4.39 (Error Handling Round 2 — 2026-04-15)
- **config.ts `markKeyInvalid`**: 401/403 응답 키를 24시간 비활성화. 기존 `markKeyRateLimited`(60초)와 차등화.
- **generator.ts 401/403 처리**: SDK·LangChain 양쪽 catch에서 `markKeyInvalid` + 다음 키 retry. SDK fallthrough 명시적 경고 로그. `lcApiKey = getNextApiKey() ?? apiKey`로 소진 키 재사용 최소화.
- **vision.ts retry + 로그**: 429 시 다음 키로 1회 retry (`MAX_ATTEMPTS=2`). JSON parse 실패 시 `console.warn` 추가.
- **fetch-transcript.ts timeout**: YouTube HTML fetch 10초, XML fetch 8초 AbortController 적용.
- **tools.ts DDG timeout**: `searchWebTool` DuckDuckGo fetch 8초 AbortController 적용.

### v4.38 (Error Handling Round 1 — 2026-04-15)
- **config.ts 키 소진 순환 방지**: 모든 키 rate-limited 시 제한된 키를 재반환하던 "last resort" 로직 제거 → `null` 반환. 모든 호출자가 이미 null 처리 중.
- **router.ts 429 키 마킹**: Router LLM 429 시 `markKeyRateLimited` 추가. Router와 Generator가 같은 키로 연속 429하던 패턴 차단.
- **summarize-title.ts, speech.ts 429 키 마킹**: 두 엔드포인트의 catch에서도 429 시 공유 키 풀에 반영.
- **chat.ts 에러 메시지 sanitize**: `error.message` 직접 노출 제거. 429/503/401/기타 코드별 사용자 친화 메시지로 분기.
- **useChatStream.ts 에러 표시 개선**: 에러를 `setLoadingStatus`(5초 소멸)→ `onError`(토스트)로 변경. `finally`의 `if (!hasError)` 조건 제거로 에러 시 로딩 상태 고착 버그 동시 수정.

### v4.37 (SDK Stream Duplicate Response Fix — 2026-04-15)
- **중복 응답 버그 수정**: SDK 스트리밍 도중/직후 429/503 에러 발생 시 retry가 텍스트를 중복 전송하던 문제 수정. `catch` 블록에 `responseText` guard 추가 — 이미 텍스트가 전송됐으면 즉시 반환하여 재시도 차단.

### v4.36 (Image Latency & Session Drop Fix — 2026-04-13)
- **Router fast-path**: 이미지 첨부 + 의약품 키워드 없음 → Router LLM 호출 스킵, `"general"` 즉시 반환 (~1s 단축)
- **공개 URL 이중 fetch 제거**: generator.ts에서 Supabase 공개 URL을 서버 re-fetch → base64 변환하던 로직 제거. Gemini SDK `fileData.fileUri`로 직접 전달 (~2~5s 단축)
- **Vision Node URL 처리 개선**: vision.ts에서도 동일하게 공개 URL 재-fetch 제거, `image_url` 타입으로 직접 전달
- **Supabase fire-and-forget**: chat.ts에서 스트리밍 완료 후 Supabase 쓰기를 순차 `await`하던 로직을 `.then()` 비동기 처리로 변경. `res.end()`를 DB 쓰기 전에 선행하여 Vercel 60s 한계로 인한 세션 종료 해소
- **SSE heartbeat**: Router/Vision 실행 중 15s마다 `{ heartbeat: true }` 이벤트 전송으로 무음 구간 연결 유지. geminiService.ts 파서에서 heartbeat 무시 처리

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
| Lighthouse | 44/100 | 91/100 | 전반적 최적화 |
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
| v4.24 | App.tsx 오케스트레이션 훅 분리 — `useAuthSession` / `useChatSessions` / `useChatStream` |
| v4.49.1 | 전 intent `gemini-2.5-flash` 통일 (Router 제외). flash-lite는 Router 전용으로 축소 |
| v4.55 | 이미지 항상 Supabase `chat-imgs` 버킷 업로드 → URL DB 저장으로 히스토리 미리보기 복원 |
