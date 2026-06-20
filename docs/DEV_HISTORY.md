# 개발 이력 (Development History)

> 버전별 상세 변경 내역. 기능 단위 구현 기록은 `docs/logs/DEV_YYMMDD.md` 파일 참조.

---

## 최근 작업 로그

> 형식 안내: v4.78(2026-05-11)부터 버전 번호 부여를 중단하고 **일별 로그 링크**로 기록합니다. 아래 버전 changelog(`v4.78` 이하)는 그 이전 이력입니다.

- [DEV_260620.md](logs/DEV_260620.md) — **docs 정합성 정리 + kordoc 한글문서 파싱 연동 검토·검증·계획 + 이미지+검색 할루시네이션 수정 + dev 서버 경고 해소**: ① docs staleness 교정 — TODO.md(완료된 영화 ④ 블록 제거·FontAwesome 전제 역전 정정·신규 툴 경로 `server/agent/tools/`→`server/agent/`·Lighthouse·maxOutputTokens 라인 드리프트), PLAN_INDEX(존재하지 않는 "TODO.md P0" 참조 제거, 보안은 백로그 §보안/SSRF는 DEV_260504 완료), DEV_HISTORY(v4.78부터 일별 로그 링크 형식임을 안내 노트로 명확화). ② **kordoc(v3.1.1) 연동** — `.hwpx`만 JSZip `<hp:t>`(표 소실)·구형 `.hwp`/`.hwp3`/`.hwpml` 미지원인 현 상태를 서버 라우트로 개선. **스코프: HWP 4종만 kordoc, PDF는 native 유지(멀티모달 회귀 방지)**. 검증 스크립트 4종 작성, 정부 사업계획서 4종(문체부 3.64MB·중기부 3.91MB·데이터바우처 1.71MB·NIA 32MB) 실측 — **전부 파싱 성공·표 `<table>` 구조 보존**, 기존 방식 대비 셀 경계 보존이 핵심 가치. **🔴 전송 재설계**: 3/4가 base64 시 Vercel 4.5MB 초과 → **4MB 임계값 라우팅 확정**(raw≤4MB 직행 multipart=55~62% 빠름 / 초과는 Storage 경유 signed-url). 첨부 시점 백그라운드 파싱으로 체감 제거. 계획서 `docs/plans/PLAN_KORDOC_INTEGRATION_260620.md` 수립·PLAN_INDEX P1 등재. ⚠️ kordoc 신규 취약점 12건 → 배포 전 점검. ③ **이미지+검색 할루시네이션 수정(구현 완료)** — 이미지 첨부 후 "검색해서 확인" 후속턴이 grounding 없이 가짜 출처(`[1]`·ScienceDaily URL) 생성하던 버그 근본 수정. **`generator.ts` `dropImageForSearch` 가드 신설**: `intent=general` && 현재 턴 이미지 없음 && history 이미지 있음 && `_explicitSearchForGuard` 조건 충족 시 `forceTextOnly=true`(history 이미지 파트 제거) + `useGoogleSearch` 강제 허용 → 실제 grounding 수행 → 진짜 소스 칩 표시. **`_explicitSearchForGuard` 구조 개선**: 초기 키워드 정규식 단독 → `state.needsSearch === true`(라우터 LLM 문맥 판정) 1순위 + 키워드 정규식 보조로 변경 — "팩트체크를 위해 웹에서 검토해보자" 같이 키워드 없는 의미상 검색 요청을 라우터가 이미 `needsSearch=true`로 판정했음에도 제너레이터가 무시하던 구조적 불일치 해소. **`prompt.ts` 절대 규칙 삽입**: `[CRITICAL — ABSOLUTE RULE: NEVER FABRICATE SOURCES]` 블록을 모든 포맷 지시보다 최우선 위치에 배치 — `google_search` 실제 호출 시에만 인용 허용, 미호출 시 `[N]`·참고 자료·URL·"검색 결과" 표현 일절 금지. 모델명 `Gemini 2.5 Flash` → `Gemini 3.5 Flash`. ④ **`next.config.ts` `allowedDevOrigins: ['127.0.0.1']`** — dev 서버 HMR cross-origin 경고 해소(프로덕션 영향 없음). (kordoc 구현은 대기 중)
- [DEV_260613.md](logs/DEV_260613.md) — **미사용 의존성 점검·제거**: `package.json` 전 의존성을 코드베이스 전수 grep(동적 import·`require()`·CSS import·configs 포함, scraped 산출물·docs 제외)으로 대조해 미사용 8개 제거 — `@fortawesome/*`×4(import 0, ~21M), `react-apexcharts`(ChartRenderer는 vanilla `apexcharts` 직접 사용), `youtube-transcript`(자막 기능 제거됨), `xml2js`·`@types/jszip`(jszip 자체 타입 번들 → 중복 스텁). deps 28→26·devDeps 10→8·node_modules ~25M 절감. `dotenv`는 `scripts/` 테스트가 사용해 유지. `npm run build` ✓(13 라우트·정적 13/13, import/타입 오류 0).
- [DEV_260612.md](logs/DEV_260612.md) — **영화 질의 프로덕션 전용 라우팅 버그 수정 + README 반영**: 영화 통합(86a2d68) 배포 후 프로덕션에서만 영화 질의가 카드 대신 Google Search 일반 표 응답으로 폴백(로컬 정상). 로그 진단 — `Semantic Router LLM failed: 400` → 정규식 폴백 → `intent=general`+검색. 라우팅이 1차 LLM(flash-lite)→실패 시 2차 정규식 구조라 **로컬은 LLM 성공으로 폴백을 안 타서 정상**이었고, 프로덕션 400으로 폴백이 노출되며 영화 정규식의 "영화+정보" 조합 빈틈이 드러남. 400 원인 분석: 로컬 12키 flash-lite 전수 OK → 프로덕션 키셋의 죽은 키 추정 + 구조 버그 발견 — **Gemini는 무효 키를 401이 아닌 400(API_KEY_INVALID)으로 반환**하는데 기존 코드는 401/403만 블랙리스트 처리해 죽은 키가 로테이션에 영구 잔존하며 호출을 무작위 오염. **수정 3건**: ① `intentRules.ts` 영화 정규식 보강(영화정보/일정/스케줄/뭐·상영작·볼만한/개봉 영화 — 11개 매칭·오탐 0 테스트) ② `router.ts` 키 교체 1회 재시도 후 폴백 + API_KEY_INVALID→markKeyInvalid 영구 제외 + 에러 메시지 본문 로깅(기존 status만) ③ `generator.ts` SDK·LangChain 양 경로 isAuth에 400 무효키 포함 → 3중 방어(재시도 생존/정규식 수용/원인 로깅). **README 영화 반영**: 렌더러 10→11(§1-3 표+§1-6 신설), §2-1 다이어그램에 /api/showtimes·movieTool·Multiplex, §2-3~2-8 표·목록, §4 구조(신규 5파일), env BROWSERLESS_KEY 용도. **★영화 멀티턴 후속 질문(클라이언트 캐리 하이브리드)**: 턴2 "메가박스에만 상영하는 경우 있어?"가 또 같은 카드를 내던 버그 — 원인 ①후속 질문에 체인명 포함→정규식 재라우팅→fast-pass 카드 ②클라 페치 구조라 상영표가 LLM 컨텍스트에 없음(json:movie엔 region/defaults만). 해결: `MovieRenderer`가 가져온 상영표를 `lib/movieContext.ts` 클라 스토어에 적재→`useChatStream`/`geminiService`가 다음 메시지에 `movieContext` 동봉→`router`가 카드 존재+질문형이면 movie_search→general 재분류(카드 재생성 차단)+needsSearch=false(검색이 화면데이터 무시하고 일반표 내는 것 방지)→`generator`가 general에 상영표+규칙 주입해 요약 답변, 없는 정보는 검색 안내. 새 지역 요청("홍대 영화 상영시간표")은 질문형 아니라 그대로 카드. 신규 `lib/movieContext.ts` + 배관 6파일(MovieRenderer·useChatStream·geminiService·state·route·router·generator). 시뮬 검증(후속질문→general/새지역→카드) + build✓. **렌더러 가이드** `docs/guide/REF_Movie.md` 신규. 다음: 재배포 E2E(카드·멀티턴) + Vercel API_KEY* 대조.
- [DEV_260611.md](logs/DEV_260611.md) — **영화 카드 메인 챗 통합 준비 — 채팅창 미리보기 + 롯데 색 분리**: Movie spike([DEV_260610](logs/DEV_260610.md)) 후속, 카드를 메인 챗에 넣기 전 사전 작업. **① 채팅창 카드 미리보기**(`test-chat-card-preview.mjs`): 서버 `<style>` 추출 재사용 + 라이브 `/showtimes` 데이터로 채팅 mock(헤더·오브·말풍선·AI응답+카드)을 모바일 390/데스크톱 760·라이트/다크 렌더, browserless 스샷 자가평가. 평가 — 테마 조화 자연스럽고 좁은 폭에서 카드 자동 1열, 단 (a)세로 길이(3사×다수 영화=긴 메시지) (b)이중 박스(말풍선→체인패널 테두리→카드 3중 중첩)가 모바일 관건. 데스크톱은 2열이라 OK. **② 모바일 폰트 더 안 줄이기로 결정**: 현재 상영관/좌석 8.5px가 가독 하한이라 더 줄이면 접근성 손해>밀도 이득. 진짜 레버는 폰트가 아니라 칩 1열+패널 경량화. **③ 롯데 체인색 와인→블루**: CGV 빨강(#e6002d)과 롯데 와인(#a4133c)이 둘 다 적색이라 구분 약함 → 후보별 흰배지 WCAG 대비+시각 비교(블루 5.17 AA, 틸 3.74, 앰버 3.19, 로즈 4.60, 인디고는 메가박스 보라와 유사) 끝에 **블루 `#2563eb` 채택**, `#a4133c`→`#2563eb` 3개 스크립트 일괄 교체(`--c` 토큰으로 배지·테두리·칩·cdot 자동 반영). 3사 색=CGV 빨강·롯데 블루·메가박스 보라. **④ 모바일 채팅 변형 적용**(`.chatv`): 칩 1열(`grid2/rest`→1fr, 상영관명 잘림 해소)·패널 경량화(말풍선→패널→카드 3중 박스를 얇은 체인색 상단 액센트만 남김)·영화 더보기(체인당 MV=3 + 토글로 세로 길이 완화) → 좁은 폭 가독·세로 단축·박스 중첩 모두 해소, 데스크톱 2열 유지. **⑤ CGV 상영관명 정제**: `scnsNm`(`4관[SCREENX] (리클라이너,Laser)`)이 과하게 길어 `cleanCgvScreen`로 괄호 제거·대괄호→특수관만·16자 컷(`1관 (Laser)`→`1관`, `4관[SCREENX]…`→`4관 SCREENX`), 풀네임은 `screenFull`로 보존해 칩 `<u title>`로 데스크톱 호버 노출(모바일 호버 없음→정제 필수, 정보 손실 0). **⑥ ★메인 챗 React 통합(영화 도구 정식 편입)**: 초기 로딩=클라이언트 페치 구조 채택(지점 드롭다운+스켈레톤+캐시 UX가 어차피 클라 호출 엔드포인트 요구) — `movieTool`은 region→3사 기본지점만 담은 가벼운 `json:movie` 반환(상영표 미포함, fast-pass로 LLM 우회), `MovieRenderer`가 마운트·드롭다운변경 시 `/api/showtimes` 호출해 스켈레톤→카드. 챗 응답 즉시 종료(CGV browserless ~2.5s가 챗 함수 밖). 신규: `data/theater-branches.json`(3사 532지점 번들, 메가박스 HTML엔티티 디코드)·`lib/theaters.ts`(공유 헬퍼 flatBranches/findDefaultBranch 지역키워드→최적지점+강남폴백)·`app/api/showtimes/route.ts`(3사 fetch+SWR캐시 이식, HTML 대신 구조화 JSON 반환, nodejs·icn1·maxDuration60)·`server/agent/movie-tool.ts`·`components/MovieRenderer.tsx`(글래스 드롭다운+스켈레톤+칩 카드 React/Tailwind 포팅, 채팅변형 칩1열·패널경량·영화더보기·CGV정제 title). 배선은 lawTool 패턴 그대로(state IntentType·intentRules 정규식·router 카테고리·prompt hint·generator LANGCHAIN_INTENTS/게이트/fast-pass·graph ToolNode·chat route on_tool_end blockType 'movie'·ChatMessage blockRegex/파싱/lazy/렌더). 검증: build✓·tsc 클린, 포팅 fetch 라이브 확인(메가박스/롯데 오늘 19편+좌석), findDefaultBranch 매칭 OK. 다음: 브라우저 E2E 확인.
- [DEV_260610.md](logs/DEV_260610.md) — **영화 상영관 지점 선택 검증 + 메가박스 direct 엔드포인트 발견**: Movie spike([DEV_260608](logs/DEV_260608.md) §9) 후속으로, 메인 챗 통합 전 "카드 내 지점 드롭다운" UX를 standalone에서 검증. **① 3사 지점 목록 열거**(`test-branch-list.mjs` → `branches.json`): CGV 177(searchRegnList, siteNo)·롯데 239(GetCinemaItems direct, cinemaID=`Division|int(Detail)|CinemaID`)·메가박스 116. 메가박스 지점은 browserless 극장별 스크랩이 불안정(0개)이라 **`/theater/list`가 Cloudflare 없이 직접 200+정적 HTML에 `<li data-brch-no>` 포함**을 발견해 정규식 파싱. **② ★메가박스 direct 발견**: `POST /on/oh/ohc/Brch/schedulePage.do`(`{masterType:"brch",detailType:"area",areaCd:"",brchNo,firstAt:"Y",playDe,sellChnlCd:"MEGABOX"}`)가 Cloudflare/browserless 없이 JSON(`megaMap.movieFormList`) 직접 반환 — **browserless 30~60초 렌더 → direct ~0.1초**, 게다가 기존 DOM 스크랩으론 못 얻던 **좌석 잔여/총석(restSeatCnt/totSeatCnt) 확보**. areaCd는 빈 값 허용, brchNo가 실제 키. **③ 실시간 테스트 서버**(`test-showtimes-server.mjs`, :5188): `/branches` + `/showtimes?chain&code&nm`→카드 HTML, 롯데·메가박스 direct·CGV browserless, 드롭다운 change 시 실시간 재조회. 지점별 지연 실측 — 롯데 77~341ms·메가박스 93~151ms·CGV 7~8s(browserless가 유일 병목). **버그 수정**: 롯데 카드 안뜸(드롭다운 value `code+"|"+nm`이 cinemaID 파이프와 충돌 → value=코드 단독+`selectedOptions[0].textContent`), 메가박스 포스터 미표시(`moviePosterImg` 상대경로 → `www.megabox.co.kr` prefix). **④ 글래스 커스텀 드롭다운**(네이티브 select OS 흰팝업 회피, 배경 테마 매칭 + 지점 검색 필터). **⑤ 지연 일관성**: 롯데·메가박스 direct는 0.1~0.3s인데 CGV browserless만 ~7s라 비대칭 → (a) **CGV direct 서명은 불가 판정**: Node HMAC 재현해 api.cgv.co.kr 직접 호출 시 Cloudflare Bot Management 403("비정상 접속", 한국 IP·서명 무관, Node TLS 지문 차단) — browserless(실 Chrome) 불가피, (b) **SWR 인메모리 캐시**(fresh 120s/stale 30분+백그라운드 갱신): CGV 콜드 7.3s→웜 0.003s(2400배), (c) **스켈레톤**(카드 shimmer 골격으로 레이아웃 예약+최소 320ms로 번쩍 방지), meta는 캐시배지·"N초 전" 제거하고 `오후 H:MM 조회` 절대시각. **⑥ CGV 콜드 ~7s→~2.5s**: 벤치 결과 범인은 `networkidle2`+고정 2s 대기 → `domcontentloaded` + 리소스(이미지/폰트/CSS) `setRequestInterception` 차단 + `api.cgv.co.kr/robots.txt` 직접 goto(S6+block, 격리 1.3~1.6s/실서버 2.4~3.4s). 남은 ~2s floor=browserless 기동(실 Chrome spin-up), 제거하려면 세션 재사용뿐이나 과금·복잡도 대비 실익 작아 미채택(캐시가 반복을 0초화). 남은 일: 본 스크립트 fetchMegabox를 schedulePage.do direct로 리팩터, 메인 챗 React 통합(server `/showtimes`·캐시 로직을 tool/route로 이식).
- [DEV_260609.md](logs/DEV_260609.md) — **법률 질의 프로덕션 전용 실패 진단 → 서울 리전 고정**: 모바일 웹에서 "야생동물 관련 법률 알려줘" 등 법률 질의가 정상 `json:law` 카드 대신 LLM 일반지식 폴백("국가법령정보센터 API 일시적 통신 오류…")을 내는 현상(로컬은 정상, 프로덕션만 실패). 런타임 로그에서 결정적 차이 포착 — 요청은 `icn1`(서울)로 인입되는데 **Function Region이 `iad1`(미국 버지니아)**, Duration이 `maxDuration=60`을 정확히 초과(60044ms), Gemini ×5 호출에 503/timeout. `law-tool.ts`는 law.go.kr에 `15s×3회` 재시도라 미국 IP에서 한국 정부 API가 지연/차단되면 최대 45초가 쌓이고 Gemini 지연까지 겹쳐 60초 한도 초과 → 응답이 끊겨 폴백 생성. **오진 정정**: 초기에 `vercel env pull`이 `LAW_OC=""`로 나와 "프로덕션 env 빈 값" 가설을 세웠으나, 같은 pull에서 실제 작동 중인 `SUPABASE_KEY`·`BROWSERLESS_KEY`도 전부 `len=0`으로 나온 게 반례 — **pull은 Sensitive 타입 변수의 복호화 값을 못 가져옴**(빈 env 증거 아님). law.go.kr 직접 호출(OC=jpjp9202)은 HTTP 200·0.43초로 API·키 정상 확인. **수정**: ① `app/api/chat/route.ts`에 `export const preferredRegion = 'icn1'` 추가 — law·약국·병원·동물병원·약품 도구가 모두 `/api/chat` 함수 내 실행되므로 이 라우트 1곳 고정으로 한국 API 호출 전부가 서울에서 나감(재배포 필요). ② 오진 과정에서 건드린 프로덕션 `LAW_OC`을 Sensitive+`jpjp9202`로 복원(Production ✓, Preview는 CLI가 비대화형 "모든 프리뷰 브랜치" 추가를 거부해 미등록 — 라이브 영향 없음). 검증(재배포 후): Function Region `iad1→icn1`, 법률 카드 정상 렌더, Duration 60초 이내. Gemini 503은 별개 2차 이슈(provider 과부하, 키 로테이션/폴백 의존).
- [DEV_260608.md](logs/DEV_260608.md) — **사이드바 멀티턴 대화 일부 미로딩 버그 수정 (캐시→DB 단일 출처)**: 이전 대화를 사이드바에서 다시 열 때 멀티턴 중 일부 턴이 안 보이는 현상 점검. 데이터 흐름 추적 결과 **저장은 정상**(매 턴 user/assistant가 `chat_messages`에 insert, 조회 API도 limit 없이 전체 반환)이고 원인은 **localStorage 세션 캐시**. `useChatStream.ts:482`의 `writeSessionsCache`가 `latestHistory.length <= 2`(첫 턴)에서만 호출돼 캐시가 `[u1,m1]` 1턴 스냅샷에 고정 → 재로드 시 ① 병합 로직(`useChatSessions.ts:130`)이 부분 캐시를 DB보다 우선하고 ② `selectSession`(`:269`)의 `messages.length>0` 가드가 DB 재조회를 스킵 → DB엔 멀쩡히 있는 나머지 턴이 가려짐. 직접 대화한 + 캐시 상위 30개 세션만 깨져 "일부만" 증상. **수정**: `writeSessionsCache`가 메시지를 빼고 세션 메타만 캐시(`{...session, messages: []}`)하도록 변경 — 모든 캐시 쓰기의 단일 통로라 1곳 수정으로 전체 적용. 메시지는 `selectSession`에서 DB lazy-load. 라이브 채팅 보호를 위해 `selectSession` 가드·병합 메시지 보존 로직·`lastActiveDoc` 캐시는 의도적으로 유지. `tsc --noEmit` 통과. 후속(미처리): 재시도 중복 user 메시지(`useChatStream.ts:511`), 에러 턴 assistant orphan(`route.ts:241`).
- [DEV_260607.md](logs/DEV_260607.md) — **모바일 멀티턴 UI 턴 간격 조정 + Notion DEV Records 동기화 복구/정리**: 멀티턴 대화에서 AI 응답 후 다음 턴(유저 메시지) 시작 전 시각적 구분이 부족하다는 피드백 대응. 총 3단계로 최종 확정 — ① AI 응답 `mb-8→mb-16 sm:mb-8`으로 하단 마진 분리 ② `ChatArea.tsx` `space-y-2` 제거(CSS specificity 충돌로 `mt-*` override) + AI 응답에 `mt-8 sm:mt-0` 추가해 위아래 대칭 ③ 간격 축소 조정 → 최종 `mt-4 mb-10 sm:mt-0 sm:mb-8`. 데스크톱 레이아웃 변경 없음(`sm:mt-0 sm:mb-8`). / **Notion DEV Records 자동 동기화 점검**: 실제 구성은 GitHub webhook이 아니라 `.git/hooks/post-commit` → `docs/notion/sync-notion-dev-records.mjs` 로컬 hook. 기존 hook이 stdout/stderr를 `/dev/null`로 버려 실패가 보이지 않았고, 실제 원인은 Notion date payload(`start` offset + `time_zone`) invalid 조합. 스크립트에 `REPO_ROOT` 고정, `time_zone` 제거, Notion SDK v5 `dataSources.query` + DB metadata `data_sources[0].id` 자동 감지, full/short commit URL 중복 조회를 추가. 최근 누락 4건을 생성하고, `제목+참고링크` 완전 중복 7개를 휴지통 처리(active 125→118, 완전 중복 0). 기존 `chat-agent` 커밋 행 110개를 Git 실제 커밋 시간으로 보정하고 short hash 링크를 full hash 링크로 정규화(`--update-existing-times` 옵션 추가). Notion 3개 뷰(Default table/캘린더/상태별 보드)에 `날짜` descending sort 적용, API ascending/descending 검증 완료.

- [DEV_260606.md](logs/DEV_260606.md) — **Wikidocs(Cloudflare) fetch 공급자 정량 비교 → browserless 전환 + Supabase 캐시 도입**: 운영 Vercel 로그에서 `/api/fetch-url`가 wikidocs(`/blog/@jaehong/8007/`)를 53초 끌다 502(ScraperAPI `render=true` 52초 타임아웃)를 내는 최악 UX를 출발점으로, `scripts/audit-wikidocs-failfast.mjs`로 정책을 정량 검증. **전제 반박**: direct fetch는 0.06~0.2초 만에 Cloudflare 403(`Just a moment…`)을 즉시 반환 → "direct가 시간낭비"라는 Codex 가설은 거짓이고 진짜 병목은 ScraperAPI render. 모든 wikidocs 경로(`/api`, `.md`, `/feed`, `/book`)와 `r.jina.ai`까지 전부 403 → 무료 우회 경로 전무, JS 챌린지 풀이만 유효. **ScraperAPI 실측**: 성공 시 24~44초·성공률이 배치마다 50~90%로 출렁이는 비결정성·성공당 20 credits, `ultra_premium`은 프리티어 차단. 24초 이전 성공이 0건이라 "12초 cap→handoff" 안은 성공률 0%로 기각. **순차-간격 vs 버스트 A/B**: parallel=5 단독은 5/5(100%)지만 5-URL 버스트는 0/5 → 동시성 throttle이 아니라 시간상관 bad window가 원인이며, 병렬은 good window에서 페이지당 100 credits로 비용 폭발이라 기각(단일 순차 + 캐시 + 간격 재시도가 최적). **공급자 재비교**(신규 `scripts/audit-provider-compare.mjs`): scrapedo(super)·scrapingbee(premium)는 0% 실패, ScraperAPI base는 한 window 0/6까지 출렁이는 반면 **browserless `/unblock`이 9/9(100%)·18~24초·본문 3,585~8,483자로 압도적 1위**. 최적화로 **residential을 빼면(datacenter) 10~16초로 더 빠르고 더 싸며 동일하게 안정적**(일시적 500은 즉시 재시도로 흡수)임을 확인. **unit 비용 측정**: 대시보드 델타 370→378(4콜=8 units) → **datacenter /unblock ≈ 회당 ~2 units**, 1000 units/월 + 캐시로 **고유 URL ~400개/월 + 반복읽기 무한**(ScraperAPI 대비 ~8배 효율), 동시성 한도 2. **구현**: `supabase/migrations/url_cache.sql`(url_key PK/content/status/provider/fetched_at) 생성·실행, `app/api/fetch-url/route.ts`를 캐시 조회(HIT 즉시 반환, TTL 14일) → wikidocs는 browserless `/unblock` datacenter 1차(+일시 500 대비 1회 재시도) → ScraperAPI render 폴백 → handoff 순으로 재작성, security-block 판정은 추출 본문만 적용(cf_clearance 오탐 방지), ScraperAPI cap 52→45s·browserless cap 30s·`maxDuration` 60→120s. `tsc --noEmit` 0 errors + 로컬 e2e 검증(1차 23.2s 신선 fetch+캐시 저장 → 2차 0.08s `cached:true`, ~280배 가속·browserless unit 0 소비). **배포 후 버그 수정**: 운영 로그상 라우트는 정상(browserless 200/17.5s + 캐시 201 + 함수 200/19.1s)이나 UI엔 실패 메시지가 떴는데, 원인은 호출자 `services/geminiService.ts` `fetchUrlData`의 **클라이언트 타임아웃 15초**(옛 direct-fetch 시절 값)가 browserless(~18s) 완료 전 abort → `[URL_FETCH_FAILED]` → `app/api/chat/route.ts`가 "원문을 가져오지 못했습니다" 메시지 생성. 클라 타임아웃을 **35초로 상향**(browserless 성공 ~10~24s + 일시 500 재시도 커버)해 해결; 서버는 클라 abort 후에도 maxDuration까지 완주해 캐시를 채우므로 재요청 시 캐시 HIT로 즉시 성공. 남은 수동 작업: Vercel 환경변수 `BROWSERLESS_KEY` 등록 + 클라 수정 재배포. 상세 §1~12 참조.
- [DEV_260605.md](logs/DEV_260605.md) — **Wikidocs Playwright fallback 실제 대화 플로우 검증 + Vercel trace 누락 수정 + 403 진단 + ScraperAPI 전환 + Notion DEV Records 자동 동기화 구축**: `https://wikidocs.net/blog/@jaehong/10121/` 실제 UI 대화에서 `/api/fetch-url` Playwright fallback 성공(`article`, 4,964자, 3.7s) → `[URL_CONTENT]` 주입 → `/api/chat`에서 `URL content provided — Google Search disabled` 확인 → Gemini 3.5 Flash가 검색 없이 제공 원문 기반 응답 경로 진입. 이후 Vercel에서 `playwright-core/lib/coreBundle.js`가 런타임에 요구하는 `playwright-core/browsers.json`이 function trace에서 빠져 external module load 실패 → `/api/fetch-url` 전용 `outputFileTracingIncludes`에 `./node_modules/playwright-core/browsers.json` 추가. 후속으로 `@sparticuz/chromium/bin/swiftshader.tar.br` 누락 ENOENT가 발생해 해당 Brotli 파일도 include에 복구. 재빌드 성공, 최종 trace 78.23MB/220 files, `browsers.json`·`swiftshader.tar.br` 포함 확인. 패키징 이후 `wikidocs.net/blog/@jaehong/12473/`가 Vercel에서 403/body 158자로 실패하나 로컬 Sparticuz는 200/`article`/3,925자 성공 → Vercel egress IP 또는 serverless/headless fingerprint 차단으로 판단. Playwright context header/timezone/automation flag 보강 + 실패 로그 sample 추가. 후속 Vercel 로그에서 `title: 'Just a moment...'`와 Cloudflare 보안 확인 sample이 확인되어, Vercel 내부 Playwright만으로는 wikidocs 안정 처리가 어렵고 외부 render worker/proxy/OpenAI web search fallback 중 하나가 필요하다고 결론. 이후 ScrapingBee/Scrape.do 외부 API를 비교해 ScrapingBee 무료 범위는 wikidocs 403으로 실패, Scrape.do `render=true`는 성공 가능하나 latency와 rotation 안정성 이슈가 있어 URL 타입별 최적화 검토: blog는 raw HTML + `waitSelector=article` + `timeout=35000`이 13~14초 성공 사례가 있으나 일부 URL은 여전히 `ROTATION_FAILED`, 책형은 `output=markdown + waitSelector=.page-content + wikidocs markdown cleaner`가 9.9~36초 성공하며 meta/nav/댓글 쉘을 50% 안팎 줄일 수 있음을 확인. Browserless default/stealth도 `/blog/@jaehong/13700/`에서 403 Cloudflare challenge로 실패. 이후 ScraperAPI `render=true`는 5개 wikidocs 샘플(`/13700`, `/31695`, `/8007`, `/12473`, `/288633`)에서 모두 성공(18~26초, 20 credits/request, `article` 또는 `.page-content` 추출)해 현재 wikidocs 외부 fallback 최유력 후보로 판정. Vercel wikidocs Playwright fallback은 비활성화하고 ScraperAPI fallback으로 대체하는 방향이 합리적. 실제 코드도 `/api/fetch-url`에서 Playwright helper/import/trace/dependency를 제거하고, wikidocs direct 실패 시 ScraperAPI `render=true`를 호출하도록 전환; `/13700` 로컬 route 호출 200/8,684자/22.9초/20 credits 확인. 배포 후 `/12473` 운영 로그에서 ScraperAPI가 기존 40초 AbortController 제한에 걸려 timeout된 것을 확인해 fallback timeout을 52초로 조정하고 error log에 `timeoutMs`를 추가. **Notion DEV Records 자동 동기화**: `docs/notion/sync-notion-dev-records.mjs` + `.git/hooks/post-commit` 구성 — 커밋 메시지에서 카테고리/기술스택 자동 분류, `[chat-agent]` 프리픽스, GitHub 커밋 URL 링크, rate limit 방지 딜레이, `--after`/`--last`/`--dry-run` 옵션 지원. 5월 7일 이후 110개 일괄 동기화 완료, 이후 커밋부터 hook으로 자동 기록.
- [DEV_260604.md](logs/DEV_260604.md) — **i18n cleanup 1·2단계 + MFDS DB 감사 + Wikidocs URL fetch 감사·Playwright fallback 적용 + CI 검토·main 브랜치 보호 적용**: `PLAN_I18N_CLEANUP_260602`의 고ROI·저리스크 1·2단계를 코드 반영. **1단계**: App.tsx i18n의 죽은 키 8개(`profileUpdated`·`renameFailed`·`analyzingDoc`·`analyzingFile`·`analyzingVideo`·`preparingSession`·`checkingYoutube`·`analyzingTranscript`)를 레포 전체 참조 0 확인 후 삭제 + `t.profileUpdated` 죽은 주석 제거. **2단계**: `ChatStreamMessages` 타입 + `statusMessages` prop + App.tsx subset 객체(10줄) 제거 → status 번역을 `useChatStream` 내부 모듈 레벨 `STATUS: Record<Language,…>` 맵(8키)으로 이관, `const status = STATUS[language]||STATUS.ko`로 소비(stale closure 없음). **추가 흡수**: useChatStream 하드코딩 한국어 status 2개(`analyzingLargeDoc`·`analyzingAttachment`)도 맵에 넣어 en/es/fr 번역 적용 — 비한국어 사용자에게 한국어 노출되던 기존 i18n 누락 동시 해소. **순효과**: App.tsx i18n 15키×4언어 → `profileUpdateFailed` 1키×4언어로 축소(유일 생존 소비처 1곳). **검증**: `npx tsc --noEmit` 0 errors + dev(Turbopack) `✓ Compiled` 무에러 + 산출물에 신규 번역 존재·`statusMessages` 잔재 0. 미관찰: 브라우저 라이브 렌더(드라이버 부재). 3단계(`src/i18n/` 공통 모듈)·5단계 보류. **추가 작업(같은 날)**: ① **MFDS `mfds_pills` DB 활용 감사**(읽기 전용) — 22,555행, 약품명/이미지/모양/색상/크기 사실상 100% 채움이나 각인코드는 90%+ 비어 있음 → 약품명 `drug_info` 경로와 `/api/pill-search`가 아직 로컬 DB 미활용, 후보 랭킹에 크기·제형·양면 색상 활용 제안(§5). ② **Wikidocs URL fetch 실패 경로 감사 + fallback 구현** — `wikidocs.net` 기준 직접fetch/Jina/Gemini urlContext 실패(403·보안페이지·`URL_RETRIEVAL_STATUS_ERROR`), OpenAI `web_search`·Playwright Chromium만 성공 확인 후 OpenAI fallback은 보류하고 `/api/fetch-url`에 wikidocs 전용 `playwright-core + @sparticuz/chromium` fallback 적용. direct fetch 실패/짧은 본문 추출 시 wikidocs만 Jina를 건너뛰고 Playwright 실행, 일반 URL은 기존 direct/Jina 유지. Node engine `^22.17.0 || >=24.0.0`, `/api/fetch-url` tracing include, WebGL off(`swiftshader` 제외), 동시 Chromium 작업 1개 제한, queue/launch/nav timeout 적용. `npm run build` 성공, `/api/fetch-url` trace 74.81MB, wikidocs 3건과 일반 Python docs 로컬 API 검증 성공(§6). ③ **CI 검토 + main 브랜치 보호 적용** — auto-PR(dev→main)은 경량 승격 자동화로 합리적, Vercel `next build`가 타입체크+린트 수행해 실질 게이트. 유일 갭이던 **main 미보호를 `gh api`로 해소**: Require PR(승인 0, self-merge 유지) + Required checks(`Vercel – chat-agent`/`-dev`, en-dash 정확 일치) + force push/삭제 차단 + admin bypass 허용. Actions 독립 CI는 테스트 없어 후순위(§7). 상세 §1~7 참조.
- [DEV_260603.md](logs/DEV_260603.md) — **멀티턴 URL 후속턴 tool_code 환각 버그 수정**: URL 요약(1턴) → 같은 세션에서 URL과 무관한 **새 검색질의**(멀티턴) 시 응답 본문에 `[tool_code] print(google_search(...))[/tool_code]` 도구 호출 코드가 그대로 노출되던 버그 수정. **원인**: `generator.ts`의 `historyHasUrl` 게이트가 히스토리에 URL이 한 번이라도 있으면 `useGoogleSearch=false`를 **무조건** 적용 → 명시적 검색 요청도 grounding 없이 단일패스로 떨어지고, 모델은 검색 의도가 강한데 툴이 없으니 내부 호출 코드를 본문 텍스트로 토출(Gemini Flash 환각 패턴). + responseText에 대한 tool_code 후처리 필터 부재(`prompt.ts` 금지 지시만으로는 안 막힘). **Fix A(근본)**: `historyHasUrl`을 follow-up 참조형(`isFollowupReference`)이고 새 검색요구(`classifySearchNeed==='on'`)가 아닐 때만 off로 좁힘 — 새 검색질의는 게이트를 열어 general 게이트가 판정하도록 위임, `currentMsgHasNonYtUrl`(현재 메시지 URL)은 기존 off 유지. import에 `isFollowupReference` 추가. **Fix B(안전망)**: responseText 확정 직후 `/\[tool_code\]|print\s*\(\s*google_search/i` 감지 시 Google Search 켜고 1회 재시도(2.5 fallback, `thinkingBudget:0`) → 실패 시 `[tool_code]` 블록·`print(google_search)` 라인 strip. **검증**: `npx tsc --noEmit` 0 errors + 실런타임 4턴(①URL요약 off ②새일반질문 게이트열림→needsSearch=false off ③가공·참조 follow-up 억제 ④**새 명시검색 grounding on→25출처**) 모두 tool_code 환각 없이 정상. Fix B는 A가 근본원인을 막아 미발동(이상적). 곁다리: Turn2 38.5s 누적 컨텍스트 latency는 별도 이슈로 기록. 상세 §1~4 참조.

- [DEV_260602.md](logs/DEV_260602.md) — **Lighthouse 최적화 계획 분리 + 사이드바 제목 캐시 버그 수정 + OpenAI Image2 인포그래픽 테스트 + Stage1 thinking 최적화 + 문서 정리**: **3.5 Flash 검색 응답 지연 원인 분석 + Stage1 budget0 적용** — 3.5+검색 two-track(Stage1 2.5+grounding → Stage2 3.5 synthesis)에서 단순 날씨 질의도 느린 원인을 실측. 초기 가설 "Stage2가 느리다"는 오답(이미 `thinkingLevel: minimal`, 1.4~2s)이고, 실제 병목은 **Stage1의 dynamic thinking** — production 시스템 프롬프트(~41KB)가 dynamic thinking을 폭증시켜(thoughts 147→879) Stage1이 ~8.5s까지 늘어남. 테스트 스크립트 검증(`test-stage1-thinking-budget.ts` 날씨·주가·뉴스 평균 8,536→4,470ms ~48% 단축·출처 동등 / `test-stage1-budget0-stress.ts` 순위·비교·시계열·다중홉 6쿼리 빈응답 0/6·5,6 동등~우수) 후 `generator.ts` Stage1 thinkingConfig 3곳(421 본 호출·458 빈응답 재시도·584 2.5 fallback)을 `state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 }`로 적용 — **비-medical만 budget0**, medical_qa는 출처 정밀도 위해 3000 유지, Stage2(3.5)는 변경 없음(이미 minimal). 적용 후 e2e 회귀(`test-generator-budget0-e2e.ts`, generator 노드 직접 호출)에서 날씨·주가·뉴스(general)+타이레놀(medical_qa) **4/4 PASS·빈응답 0**, grounding 출처(1/4/6/15)·표·medical 상세 전부 무손실 확인. generator.ts가 `server-only`를 import해 tsx 단독 실행이 막혀 resolve 훅 shim(`scripts/_loader-server-only-shim.mjs`/`_resolve-server-only.mjs`) 추가. 396행 `thinkingLevel: "low"`(비검색 general=코드·추론 지배)는 minimal 검증 미완료라 변경 보류. `npx tsc --noEmit` 통과. / **문서/계획 정리**: `docs/plans` 파일명 `PLAN_` 접두 통일(CHANGES_LATENCY_SEARCH_ROUTING·DB_MIGRATION·ERROR_HANDLING·LIGHTHOUSE·NEXTJS_MIGRATION·SECURITY_VERIFICATION·OPENAI_IMAGE2 등), 분석 문서 `PLAN_THINKING_LATENCY_260602.md`·`PLAN_I18N_CLEANUP_260602.md` 신규. README §4-1 Documentation Conventions(plans/logs/guide 규칙) 추가, Mermaid 다이어그램 축소(시퀀스1+플로차트1만 유지, 나머지 4종 `docs/guide/REF_Architecture.md`로 이동) 및 syntax 에러 수정, §2-1 Agent And Tool Overview를 📥입력/📤출력+실선요청/점선응답으로 재설계. **i18n 사용 감사(분석만)**: App.tsx 15키 중 실사용 7·타입만 2·완전 사망 6키 식별, statusMessages 배관 제거+죽은키 삭제는 다음 세션 적용 예정. `.gitignore`에 `scripts/_*` 추가. / 기존 6/2 작업(Lighthouse 계획 분리·사이드바 New Chat flicker 수정·OpenAI Image2 인포그래픽 파이프라인 테스트)은 아래 §1~4 참조. 기존 6/2 Lighthouse 분석 및 프론트엔드 최적화 기획 내용을 `docs/plans/PLAN_LIGHTHOUSE_FRONTEND_OPTIMIZATION_260602.md`로 이동하고, `DEV_260602.md`는 실제 변경 이력 중심으로 재정리. / **Supabase MCP warning 검토**: Codex MCP 설정이 구 프로젝트 ref(`axpvmgndefueicehdetu`)를 가리키고 있고 앱 env는 신규 ref(`gaomgqnpsjtabrvwnpad`)를 사용함을 확인. warning은 앱 런타임 문제가 아니라 MCP OAuth refresh 및 project_ref 불일치 문제로 판단, 실제 수정은 우선순위 낮아 보류. / **사이드바 `New Chat` 순간 노출 수정**: 새 페이지 진입 시 localStorage `chat_sessions_cache_v1`의 오래된 기본 제목이 DB fetch 전 먼저 렌더링되던 현상 수정. `writeSessionsCache()`를 export하고 `useChatStream.ts`에서 새 세션 생성 및 제목 요약 완료 시 화면 상태와 localStorage 캐시를 함께 갱신. 기존 캐시에 남은 빈 `New Chat` placeholder는 hydration 단계에서 제외. 검증: `npx tsc --noEmit` 통과. / **OpenAI Image2 테스트**: `scripts/openai-image2-pipeline-test.mjs` 추가 — `gemini-2.5-flash-lite -> infographic JSON -> prompt builder -> gpt-image-2-2026-04-21` 파이프라인 검증. `response_format` 파라미터가 Image API에서 거부되어 제거. `1536x1024` 조건에서 영어/한국어 normal/dense 및 medium 샘플 성공. low는 25~45s, output image tokens 158로 안정적이며 한국어 텍스트도 대체로 읽힘. medium dense는 61.69s, output image tokens 1372로 비용/latency 증가. 카드형 외 `diagram/pipeline/timeline/matrix/decision_tree/mindmap/poster` layout taxonomy 추가. 생물/물리 주제는 카드형 prompt로는 요약 카드에 수렴해 `diagram` layout이 필요함을 확인. 세포호흡 diagram은 플로우 도식으로 생성됐고, `myelin sheath action potential`은 영어 canonical label 기반 textbook-style diagram이 가장 안정적. 학문/공학 도식 활용 범위를 생물·물리 외 컴공·지구과학·기계공학·전기전자·화학·수학·사회과학으로 확장 정리하고, 초기 서비스 리밋 초안(`free 3 images/day`, 사용자당 active job 1, global concurrency 2, global rate 4 images/min, medium은 premium/regenerate 전용)을 추가. `--case-set subtypes` smoke test로 16개 diagram subtype을 low에서 각각 1장 생성했고 16/16 최종 성공(평균 33.03s, output image tokens 전부 158). Gemini 503 transient 처리를 키 로테이션에 포함. `--case-set styles`로 non-figure 스타일 8개를 low에서 생성해 8/8 성공(평균 31.97s), 한국어 스타일 3개도 3/3 성공(평균 32.13s). 한국어는 whiteboard sketch/comic explainer가 가장 안정적이고 editorial poster는 카드형으로 수렴하는 경향 확인. comic explainer 샘플에서 사람 팔/손 오류가 보여, 사람/손/기기 잡는 포즈는 기본 prompt에서 제외하고 필요 시 medium regenerate 및 별도 QA 대상으로 두기로 정리. 1차 결론: 기본값 `low`, premium/regenerate `medium`, `high`는 보류. 상세 계획/결과는 `docs/plans/PLAN_OPENAI_IMAGE2_INFOGRAPHIC_TEST_260602.md`.

- [DEV_260531.md](logs/DEV_260531.md) — **general intent 검색 라우팅 (needsSearch)** / **모바일 입력창 폰트 축소** / **세션 정렬 버그 수정 (Supabase 트리거)**: `general` intent에서 검색 불필요 질문(코드·번역·개념설명·계산 등)에도 Google Search가 항상 켜져 발생하던 불필요한 two-track 지연 해소. **3-게이트 + 멀티턴 가드** 설계 적용 — 강한 OFF(코드/번역/창작/계산/개념) → Search off, 강한 ON(시의성/실시간/인물/시세) → Search on, 회색지대 → router LLM `needs_search` 판정, 판정 누락 시 **default-on** 안전판(기존과 동일 폴백). **멀티턴 가드**: 직전 턴 검색됨 + 현재 메시지가 follow-up 가공형(요약·정리·비교·방금)이면 재검색 억제, "더 최신 걸로" 같은 새 최신 요구는 ON 유지. / **수정 파일 4종**: ① `server/agent/intentRules.ts` 신규 — `classifySearchNeed`(3게이트 룰), `shouldSuppressSearchForFollowup`(멀티턴 가드), `SEARCH_OFF/ON/FOLLOWUP/PAST_REF` 패턴 ② `server/agent/state.ts` — `needsSearch: Annotation<boolean>` 추가, reducer `??` 필수(`||` 시 false 덮임 버그 방지), `default: () => true` ③ `server/agent/nodes/router.ts` — LLM 프롬프트 출력에 `needs_search` 추가(동일 콜, 추가 LLM 호출 없음), general에서만 게이트 적용 ④ `server/agent/nodes/generator.ts` — renderer 게이트 직후 `intent==='general' && useGoogleSearch===true`일 때만 needsSearch·멀티턴 가드 게이트 적용, 기존 image/url/video/renderer/medical 분기 무손상. / **검증**: 단일턴 22/22, 멀티턴 가드 4/4, 합성 결정 15/15, lite 다국어 14/14, `npx tsc --noEmit` 0 errors. / **버그픽스 2종 (동일 세션)**: ① `gemini-3.5-flash` single-pass `MALFORMED_FUNCTION_CALL` 빈응답 — systemInstruction JSON 지시에서 3.5-flash가 function-call 토큰 흉내내다 깨짐 → `MALFORMED_FUNCTION_CALL` 감지 시 `SEARCH_FALLBACK_MODEL`(2.5-flash)로 1회 폴백, `thinkingBudget:0`, 기존 SAFETY 경로 무영향 ② Two-track stage1(2.5+search) empty → LangChain 폴백 → 또 빈응답 루프 — stage1 empty 직후 `getNextApiKey()` 키 교체 후 stage1 1회 재시도, 성공 시 정상 stage2 진행, 실패 시만 기존 throw. `npx tsc --noEmit` 0 errors. / **모바일 입력창 폰트 축소** (`ChatInput.tsx`): `textarea` className에 `text-sm sm:text-base` 추가 — 모바일 14px, sm: 이상 16px 유지. / **세션 정렬 버그 수정**: 새로고침 시 가장 최근 문서 첨부 세션이 상단으로 이동하는 문제 — `updated_at`이 `updateSessionTitle` PATCH(첫 교환)에서만 갱신되어 후속 메시지 순서 반영 안 됨. Supabase 트리거 `trigger_session_updated_at` 추가 — `chat_messages INSERT` 시 `chat_sessions.updated_at` 자동 갱신, DB 레벨 원자적 처리.

- [DEV_260530.md](logs/DEV_260530.md) — **기본 모델 3.5 Flash로 변경**: `DEFAULT_CHAT_MODEL` → `FLASH_3_5` (`src/lib/models.ts`, `server/models.ts`). 드롭다운 순서도 3.5 Flash → 2.5 Flash로 재배치 — 첫 방문(localStorage 없음) 및 서버 폴백 모두 3.5 Flash로 통일.

- [DEV_260529.md](logs/DEV_260529.md) — **이미지 의도 분류 버그 수정**: 이미지 첨부 시 약품 무관 케이스가 모두 `drug_id` → Vision Node로 강제 라우팅. `isAmbiguousImageIdentificationRequest()` → `hasMedicalIntentKeyword`로 교체. / **약품 식별 DB 조회 개선**: ① ToolMessage `"[object Object]"` fast-pass 실패 수정 ② Vision 프롬프트 `"dHP"` 예시 제거(편향) + score line 구분 명시 ③ `filterResults` 1단계-b 추가·2단계-b 2자 전용 제한·대소문자 보존 쿼리·3자→2자 역방향 검색. / **pharm.or.kr 구조적 한계**: 마그네스정 각인이 이미지로만 저장 → 텍스트 검색 불가, 색상/모양 파라미터도 동작 안 함 확인. / **MFDS Open API 조사**: `MARK_CODE_BACK_ANAL: "dHP,dP,d-P,cHP"` 각인 변형 전체 저장 확인. `item_name` 외 필터 무시(25,558건 = 전체 DB). / **`mfds_pills` Supabase 동기화**: 22,558건 저장, `mark_codes TEXT[]` GIN 인덱스, `mark_codes @> ['DP'] + 노랑 + 장방형` 쿼리로 마그네스정 반환 검증 완료. / **`mfds-logic.ts` 신규**: 3단계 매칭(exact 1건/imprint_only 복수/similar), 각인 변형 코드 생성, MFDS 상세 URL 자동 생성. / **`identifyPillTool` 교체**: MFDS DB 1순위 + pharm.or.kr 폴백 이중 구조. / **약품 식별 UX 개선**: exact 조건을 결과 1건으로 제한 → 복수 후보는 `imprint_only` → `pillCandidateTableMessage` 후보 테이블 렌더링(단일 drug 카드 오확정 방지). 안내 문구 "약학정보원"→"MFDS 식약처" 표기 수정. / **마그네스정 후보 테이블 누락 수정**: `mark_code_front_anal` null + 뒷면 각인(`back_anal`)으로만 등록된 약품이 기본 정렬 순서에서 밀려 `limit=8`에 잘림. `limit 8→20` 확대 + `sortByRelevance()` 추가(mark_codes 배열 길이 오름차순 정렬 → 구체적 각인 약품 우선) — 11건 전체 포함, 마그네스정 7번째 위치 확보. / **3.5 Flash 멀티턴 타임아웃 수정**: `maxDuration=60` 환경에서 멀티턴 `thinkingLevel: "medium"` → 복잡한 쿼리에서 60초 초과. `"medium"` 분기 제거, 멀티턴/단일턴 모두 `"low"` 통일(`generator.ts`). / **Treemap 차트 raw JSON 출력 수정**: AI가 `` ```json:treemap `` 블록 타입을 사용해 `blockRegex` 매칭 실패 → raw JSON 노출. 프롬프트에 `json:chart` 전용 경고 추가 + `ChatMessage.tsx` `blockRegex`·분기·스트리밍 감지 3곳에 `treemap` 폴백 처리 추가(`prompt.ts`, `ChatMessage.tsx`).

- [DEV_260528.md](logs/DEV_260528.md) — **2.5 Flash URL 패칭 동작 수정**: `historyHasUrl` 체크가 `slice(0,-1)`로 현재 턴 누락 → 첫 메시지 URL에서 Google Search 비활성화 안 됨. `currentMsgHasNonYtUrl` 추가로 현재 메시지 비YouTube URL도 감지 (`generator.ts`). / **2.5 Flash 멀티턴 서두 문구 금지**: "제공된 정보에 따르면" 등 boilerplate opener 금지 규칙 `getSystemInstruction`에 추가 (`prompt.ts`). / **서두 문구 금지 규칙 개선**: "제시된 **내용**을 바탕으로 한" 변형 패턴 우회 발견 → 문구 전면 금지 → **boilerplate opener로 사용 시만 금지**로 완화 + `내용/주어진` 변형 패턴 추가 (`prompt.ts`, `generator.ts` synthesisInstruction). / **빈 응답(empty response) 처리 강화**: `gemini-3.5-flash` 멀티턴에서 SDK 빈 텍스트 반환 → LangChain fallback도 빈 응답 → 클라이언트 에러 발생. 수정: ① `thinkingLevel: "medium"` 빈 응답 시 `"minimal"`로 자동 재시도 ② `finishReason`/`safetyRatings` 로깅 추가 ③ `SAFETY` 차단 즉시 propagate(`safetyBlock` 플래그) ④ `route.ts` `safety` 에러 타입 + 4개 언어 메시지 추가. / **`<br>` 태그 그대로 노출 수정** (`ChatMessage.tsx`): `rehypeRaw` 미설치로 테이블 셀 내 `<br>` HTML이 텍스트로 렌더링 → `<br>` → ` · ` 변환 전처리 3곳 추가. / **`**` 볼드 마커 노출 수정 1차** (`ChatMessage.tsx`): lookahead `[가-힣A-Za-zÀ-ÿ]` → `[가-힣A-Za-zÀ-ÿ0-9]` 확장 — 숫자 뒤 한글 패턴(`**25% GPU**만으로`) 미처리 케이스 해소. / **표 셀 간결성 규칙 강화** (`prompt.ts`): `[CELL CONTENT LIMIT]` ≤25 words → **≤12 words**, `~입니다/합니다/있습니다` 서술 어미 금지, 키워드·구절 스타일(`→ ↑ ↓ ·`) 강제. / **DB 쿼리 최적화** (`sessions/route.ts`, `chat/route.ts`, `useChatSessions.ts`): ① `select('*', {count:'exact'})` → 컬럼 명시 + `hasMore: boolean` 패턴 전환(`COUNT(*)` 제거) ② 메시지 조회 `select('*')` → 필요 컬럼만 명시(`session_id` 제외) ③ POST/PATCH `.select()` → 컬럼 명시 ④ Supabase DB 트리거(`trg_message_updates_session`) 생성 — `chat_messages INSERT` 시 `chat_sessions.updated_at` 자동 갱신 ⑤ `chat/route.ts` 스트림 완료 후 `chat_sessions.update()` 별도 write 제거(트리거 위임), write 횟수 3회 → 2회. / **LCP 개선** (`App.tsx`, `ChatInput`): `isAuthLoading` 전체 앱 차단(`<LoadingScreen>` 전체 반환) 제거 → 첫 방문자도 UI 즉시 렌더, 인증 완료 전 `ChatInput disabled={isAuthLoading}` 처리 — 사이드바 skeleton·메시지 spinner는 기존 구현 활용. / **`**` 볼드 마커 노출 최종 수정 + 회귀 테스트** (`ChatMessage.tsx`, `scripts/test-markdown-bold-regression.mjs`): 여는 `**` 앞 공백 삽입 가설은 다중 bold span에서 이전 closing marker를 오인해 `**` 노출을 악화시키는 것으로 확인. 위험한 opening-side 보정을 제거하고, 줄 시작/공백/문장부호 뒤에서 시작한 plausible bold span에만 closing `**` 뒤 한국어/영숫자 보정을 적용. 실제 `react-markdown + remark-gfm` 렌더링 기반 회귀 스크립트 추가 — `Previous failures: 2`, `Applied failures: 0`. / **`** 환경과 **` 볼드 회귀 수정** (`ChatMessage.tsx`): opening-side 보정 정규식 `[^*\n]+?`가 연속 bold span 사이 공백 시작 내용(`환경과`)을 falsely capture → `[^\s*\n][^*\n]*?`로 첫 글자 비공백 조건 추가. / **YouTube 멀티턴 Google Search 비활성 누락** (`generator.ts`): 2턴부터 `hasVideoData=false`가 되어 Search 재활성 → 엉뚱한 내용 요약. `hasVideoSummary = state.webContent.includes('[VIDEO_ANALYSIS_SUMMARY')` 추가하고 비활성 조건에 포함. / **YouTube 2.5-flash 503 → 3.5-flash 폴백 + LangChain 차단** (`generator.ts`): 12키 모두 503/429 소진 시 LangChain fallback이 `fileData` 미지원으로 hallucinated content 생성하던 문제. ① `thinkingBudget: 0` 전체 YouTube 요청으로 확장 ② SDK 실패 후 `gemini-3.5-flash` 단일 재시도(`thinkingLevel: minimal`) ③ 3.5도 실패 시 다국어 에러 메시지 반환(KO/EN/ES/FR) ④ `hasVideoData` 스코프 에러(`while` loop 내부 → 외부 hoisting) 수정. 검증: 12키 소진 후 `YouTube 3.5-flash fallback succeeded` 로그 확인. / **`.gitignore` 정리**: `.superpowers/brainstorm/세션ID/파일` 8줄 → `.superpowers/` 1줄, `.understand-anything/intermediate/batch-N.json` 13줄 → `.understand-anything/` 1줄, `scripts/image-gen-output/academic/*.png` 10줄 → `scripts/image-gen-output/` 1줄, `scripts/test-*.js`/`scripts/test-*.ts` 패턴 도입, 중복 항목 제거.

- [DEV_260527.md](logs/DEV_260527.md) — **GitHub Actions 자동 PR 워크플로우 버그 수정**: dev push 후 Actions 즉시 실패 — `workflow file issue`. 원인: `BODY` 멀티라인 변수 내 `---`(YAML 문서 구분자)·빈 줄 인라인 삽입 + `→` 유니코드 특수문자. 수정: workflow name/title `→` → `->` ASCII 변경, PR body를 `printf > /tmp/pr_body.md` 임시 파일로 분리 후 `--body-file` 전달, PR 존재 확인 `jq '.[0].number'` → `jq length` 숫자 비교로 안정화.

- [DEV_260526.md](logs/DEV_260526.md) — **main 브랜치 배포 완성**: `dev`에서 URL 버그 fix·Vite 잔재 제거·Next.js 마이그레이션을 완료했으나 `main`에는 cherry-pick 2건만 반영되어 `package.json`에 `next` 미포함 → Vercel "No Next.js version detected" 빌드 에러. `dev → main` 전체 머지로 52개 파일 반영 후 빌드 성공 + 전체 기능 테스트 완료. / **dev/main 동기화**: `git merge main --ff-only`로 두 브랜치 동일 커밋 유지. / **불필요 브랜치 삭제**: `copilot/review-overall-flow` 로컬·원격 제거. / **README 정리**: Mermaid 다이어그램·Tech Stack·Project Structure·Getting Started를 Next.js App Router 기준으로 전면 업데이트, "Next.js migration plan" 주석 제거. / **Next.js 마이그레이션 계획 점검**: 계획 vs 실제 구현 전항목 대조 — 핵심 5개 Phase + SSRF 차단 모두 완료 확인. / **vercel.json 삭제**: 보안 헤더 6개가 `next.config.ts`와 중복 → 파일 자체 삭제. Next.js App Router 프레임워크 자동 감지로 기능 손실 없음. / **force-dynamic GET route 2개 추가**: POST는 Next.js가 항상 dynamic 처리하므로 불필요. GET인 `sessions`·`proxy-image`에만 추가 — `npm run build` 12개 전부 `ƒ (Dynamic)` 확인. / **`api/_lib/` → `server/` 리네임 완료**: 17개 파일 이동, Route Handler 10개 파일 15줄 import 경로 일괄 수정, 빈 `api/` 디렉토리 삭제(Vite 잔재 완전 제거), README 5곳 업데이트, 빌드 성공 확인. / **Vite 잔재 추가 정리**: 전체 구조 검토 후 `index.tsx`(Vite 진입점)·`index.css`(globals.css 중복)·`dist/`(Vite 빌드 결과물) 삭제, `tailwind.config.js` content 경로 정리(`index.html`·`index.tsx` 제거, `src/**` 추가). / **README 불일치 수정**: `docs/Guide` 트리 경로 오류(`ERROR_HANDLING`·`DB_SCHEMA`·`LAW_API_TEST`), 환경변수 `SUPABASE_KEY` primary 명확화. / **Understand-Anything 플러그인 설치**: 코드베이스 → 인터랙티브 지식 그래프 시각화. `/understand`, `/understand-dashboard`, `/understand-diff` 등 제공. / **GitHub Actions 자동 PR**: `.github/workflows/auto-pr.yml` — dev push 시 `dev → main` PR 자동 생성, 중복 스킵, `GITHUB_TOKEN` 자동 주입.

- [DEV_260525.md](logs/DEV_260525.md) — **Supabase 신규 프로젝트 이전**: 구 계정 → 신규 계정 전면 마이그레이션. DB 3테이블(users 681건·chat_sessions 1,267건·chat_messages 4,223건) + Storage 3버킷(172개 파일, drug-cache 91개 skip) 이전 완료. 초기 `GENERATED ALWAYS AS IDENTITY` 제약으로 user.id 재생성 문제 → `GENERATED BY DEFAULT`로 변경 후 재마이그레이션으로 원본 id 유지. attachment_url 117건 URL prefix 일괄 업데이트. `.env` 파일이 Vercel CLI API 라우트에서 `.env.local`보다 우선 적용되는 것 확인하여 양쪽 교체. 마이그레이션 스크립트 7종 `scripts/` 디렉토리에 보관. **DB 문서화**: `docs/DB_SCHEMA.md`·`docs/DB_MIGRATION_PLAN.md` 신규 생성. / **3.5 Flash Stage2 날씨 표 형식 수정**: `synthesisInstruction`에 다중 행 구조 데이터(날씨·일정·비교표 등)는 markdown table 강제 규칙 추가 — 2.5 Flash와 동일한 표 형식 출력 확인. / **`**` 볼드 렌더링 수정** (`ChatMessage.tsx`): `따옴표 + ** + 한국어` 패턴에서 `**`가 raw 텍스트로 출력되는 문제 수정. ZWNJ(U+200C) 전처리를 기존 공백 삽입 fix 앞에 추가해 CommonMark rule (a)로 right-flanking 강제 — 3곳(textPart·processedVisible·processedRemaining) 동일 적용. / **사이드바 세션 infinite scroll 구현**: `api/sessions.ts` limit 없이 1,267건 전체 반환 → 초기 30개 + 스크롤 하단 도달 시 30개씩 추가 fetch 방식으로 전환. `sessions.ts` offset/limit/count 지원, `fetchSessions` 파라미터 추가, `useChatSessions` `isLoadingMore·hasMore·loadMoreSessions` 상태·함수 추가, `ChatSidebar` `scrollRef` 스크롤 감지 + `loadingMore` i18n 4개 언어(ko·en·es·fr) 로딩 인디케이터 추가.

- [DEV_260524.md](logs/DEV_260524.md) — **타임아웃·연결 끊김 에러 키 로테이션 보완**: 기존 catch 블록이 429/503/401만 처리하고 `DEADLINE_EXCEEDED`(타임아웃)·`504`(게이트웨이 타임아웃)·`ERR_STREAM_DESTROYED`(스트림 끊김)를 non-retryable로 방치하던 구조 수정. 총 4곳 보완 — ① **SDK 외부 catch**: `isTimeout` 감지 추가, 2.5/3.5 Flash 공유 catch 동시 적용 ② **Two-track Stage2 inner catch**: 타임아웃 시 키 로테이션 후 재시도 → 소진 시 2.5 fallback 진입 ③ **Stage2 fallback catch**: 동일 처리 ④ **LangChain catch**: `isTimeout` 추가 + `isUnavailable(503)` 상태 코드 직접 체크 누락 보완. `chat.ts` 최종 에러 분류 `504/DEADLINE_EXCEEDED → unavailable` 매핑. / **ConstellationRenderer 모바일 UI 개선**: 카드가 세로로 긴 직사각형으로 표시되던 문제 개선 — ① 캔버스 모바일 높이 420→340px(390px 폭 기준 정사각형 근접) ② 별 이름 레이블 폰트 12px 고정 → `isMobileCanvas` 분기로 10px(모바일)/12px(데스크톱) ③ 헤더 패딩·폰트 전체 모바일 축소(`py-1.5`, `text-[9px]~text-[10px]`) ④ **카메라 버튼 높이 정렬**: `p-1` 배경 없는 아이콘 → 시간 버튼과 동일한 `py-0.5 px-1 bg-white/10 rounded` 패턴으로 통일 ⑤ 줌/리셋 버튼 `w-10 h-10` → `w-8 h-8 sm:w-10 sm:h-10` ⑥ 별 인포패널 패딩·폰트·min-width 모바일 축소. 별자리명 헤더→캔버스 워터마크 이동 방안 `constellation-card-sample.html`에 A/B 샘플 작성 후 검토 중.

- [DEV_260522.md](logs/DEV_260522.md) — **3.5 Flash 멀티턴 포맷 보정 3종**: ① **Two-track 고정 포맷 반복**: Stage2 `synthesisInstruction`에 `isMultiTurn = sdkContents.length > 1` 분기 추가 — 1턴은 "한 줄 요약 → 주요 내용 → 고려 사항" 3단 구조 유지, 2턴 이상은 고정 섹션 없이 대화 흐름에 맞는 자연스러운 응답 지시로 전환. ② **PDF/URL 멀티턴 two-track 오분기**: `historyHasUrl` 히스토리 스캔 추가 — 이전 사용자 메시지에 URL이 있으면 `useGoogleSearch = false` 강제, 문서 분석 후속 질문이 Google Search two-track으로 잘못 분기하던 버그 수정. ③ **Stage2 포맷 요청 무시**: `synthesisInstruction` 최상단에 `[USER_REQUEST]` 섹션 추가 — Stage2 모델이 사용자의 표/목록 등 포맷 요청을 수신해 준수. `scripts/test-multiturn-35flash.mjs`로 세 수정 모두 사전 검증 완료.

- [DEV_260521.md](logs/DEV_260521.md) — **Gemini 2.5 Flash vs 3.5 Flash 비교 문서화**: API 파라미터 차이(temperature/topP/topK 3.5-flash 제거), thinkingConfig 분기(`thinkingLevel` vs `thinkingBudget`), Google Search Two-track 아키텍처, Function Calling id 차이, 일일 할당량 특성, 스트리밍 제거 배경, 모델별 사용처 현황표, 잔여 TODO 정리. / **3.5-flash temperature/topP/topK 제거**: `generator.ts` Stage2, single-pass(`is3xModel` 조건), LangChain path(`is3xLcModel` 조건) 적용. Stage1·Stage2 fallback(2.5-flash 고정)은 유지. / **`config.ts` `isDailyQuotaError` 수정**: `msg`(소문자화) 기준으로 `perday`·`freetier` 검사 추가 — free tier 일일 한도 에러(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`)를 RPM이 아닌 RPD로 정확히 분류. / **`fetch-url.ts` 직접 fetch throw 시 Jina 폴백 연결**: `try...finally` → `try...catch...finally` 전환, 네트워크 오류·타임아웃 시에도 Jina Reader 시도. / **Jina 보안 챌린지 감지**: `isJinaSecurityBlock()` 추가 — Jina가 Cloudflare 챌린지 페이지를 200으로 반환할 때 감지(7개 패턴)해 `[FETCH_ERROR: 보안 인증...]` 반환, 모델 empty response 방지. / **`useChatStream.ts` 보안 차단 컨텍스트 분리**: `fetchUrlContent` → `fetchUrlData` 전환, 보안 차단 시 `[URL_SECURITY_BLOCKED]` 태그로 모델에 안내 메시지 생성 지시. / **BioRenderer 모바일 호버 툴팁 수정**: `mousemove`만 리스닝하는 NGL 구조 때문에 모바일 터치 시 `hovered` 시그널 미발화 → `touchmove`에서 좌표 업데이트 + canvas에 synthetic `mousemove` 디스패치로 NGL picking 트리거, `touchend`에서 툴팁 초기화. / **Intent routing fallback 분리 및 다국어 보강**: `api/_lib/agent/intentRules.ts` 신규 추가, `router.ts` 내부 heuristic 제거 후 `classifyIntentByRules()`·`hasMedicalIntentKeyword()` 호출로 분리. `ko/en/es/fr` 핵심 키워드 기반으로 pharmacy/hospital/vet/law/science/visualization/drug fallback 보강, 라틴권 의료 키워드는 단어 경계 regex로 오탐 방지. / **3.5 Search two-track 시각화 오분기 보정**: `astronomy`·`biology`·`chemistry`·`physics`·`data_viz` renderer intent는 명시적 검색 요청이 없으면 Google Search를 비활성화해 2.5 Stage1 검색 요약 → 3.5 synthesis 경로 대신 구조화 JSON 렌더러 응답(`json:constellation` 등)을 우선. / **3.5 Search Stage2 합성 포맷 보정**: Stage2 synthesis prompt에 `제시된 정보를 바탕으로`/`Based on...` 등 내부 handoff성 메타 서문 금지, 바로 본문 시작, `한 줄 요약` → `주요 내용` → 필요 시 `고려 사항` 구조를 언어별로 적용하도록 지시.

- [DEV_260520.md](logs/DEV_260520.md) — **Gemini 3.5 Flash 신규 모델 추가 및 기본값 변경**: `src/lib/models.ts`·`api/_lib/models.ts`에 `FLASH_3_5: 'gemini-3.5-flash'` 추가, `DEFAULT_CHAT_MODEL` → FLASH_3_5, Flash Lite 드롭다운 비활성화, `services/geminiService.ts` 기본값 갱신, `Header.tsx` 모델 설명 간략화(영/스/프). / **3.5 Flash Google Search grounding 자동 폴백**: `generator.ts`에서 `needsSearchFallback` 감지 후 grounding 시 `SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH`(2.5 Flash)로 자동 전환 — 3.5 Flash 무료 티어 grounding 미지원 대응. 초기 구현 FLASH_LITE → 응답 중간 끊김 확인 후 FLASH로 수정. / **RPD(일일 할당량) 소진 대응**: `config.ts`에 `isDailyQuotaError()`(per day/daily/quota_exceeded 키워드 감지)·`markKeyDailyExhausted()`(24h 비활성화)·`isAllKeysDailyExhausted()`(5분 초과 쿨다운 = RPD 판단) 추가. `generator.ts`·`router.ts`·`vision.ts`·`speech.ts`·`summarize-title.ts` 5개 파일에 429 분기 적용 — RPD 에러 시 60s 루프 대신 24h 비활성화. `api/chat.ts` `dailyExhausted` 전용 에러 타입 및 4개 언어 메시지 추가(기존 `rateLimit`과 분리). / **physics/chemistry maxTokens 4096 → 8192 + grounding effectiveMaxTokens 가드**: partial stream 방지. Google Search 활성 시 최소 8192 보장. / **BioRenderer 단백질 구조 호버 툴팁 수정**: Chrome에서 WebGL GPU 합성 레이어 + `overflow: hidden` 부모 체인이 `position: fixed` 툴팁을 클리핑하는 렌더링 버그. `createPortal`로 툴팁을 `document.body`에 직접 렌더링하여 완전 해결. / **불필요한 console.log 8개 제거**: `BioRenderer` NGL hover 디버그, `vet-tool` 주소 파싱 trace 3개, `hospital-tool` API 파라미터 trace 2개, `pharmacy-tool` 주소 파싱 trace 2개 — 운영 로그(`generator`·`vision`·`config`)는 유지. / **React Error Boundary M4 구현**: 화이트스크린 방지 2레벨 에러 격리 완료. `components/ErrorBoundary.tsx` 신규 — 클래스 기반 `getDerivedStateFromError`+`componentDidCatch`, 렌더러용 인라인 에러 카드(`DefaultInlineFallback`)·루트용 전체화면 fallback(`AppErrorFallback`, ko/en 병기+새로고침 버튼). `index.tsx` 앱 루트 `<ErrorBoundary fallback={<AppErrorFallback />}>` 래핑. `ChatMessage.tsx` 11개 lazy 렌더러(`ChartRenderer`·`ChemicalRenderer`·`BioRenderer`·`DiagramRenderer`·`ConstellationRenderer`·`DrugRenderer`·`PharmacyRenderer`·`HospitalRenderer`·`VetRenderer`·`LawRenderer`·`YoutubeEmbed`) 각각 `<ErrorBoundary key={idx}><Suspense>` 패턴으로 교체 — 렌더러 하나 크래시 시 해당 카드만 인라인 에러 표시, 나머지 앱 정상 유지. / **3.5 Flash 스트리밍 안정화**: 간헐적 스트리밍 끊김(Vercel 60s 타임아웃 + thinking 지연) 및 테이블 내 raw HTML 태그 삽입 현상 확인 → 기본 모델을 2.5-flash로 환원(3.5는 두 번째 선택지), `generator.ts` thinkingConfig 모델 분기 적용(`test-thinking-35flash.ts` 3회 검증 후): 3.5-flash SDK path 전 경로에 `thinkingLevel: "low"` 적용(YouTube는 `"minimal"`), 2.5-flash는 `thinkingBudget` 유지. `effectiveModel` 기준 분기로 Google Search 폴백 경로도 올바른 config 적용. / **generator.ts 스트리밍 제거 + Two-track Google Search**: `generateContentStream` 완전 폐기 → `generateContent` 단일 경로 전환. 3.5-flash+search 선택 시 Stage1(2.5-flash+search 그라운딩) → Stage2(3.5-flash synthesis `thinkingLevel: "minimal"`) 두 단계 처리. Stage2 quota 소진 시 2.5-flash fallback → 최종 실패 시 Stage1 텍스트 직접 반환. `config.ts` 일일 할당량 감지 키워드 확장(perday·free_tier·freetier). `summarize-title.ts` 503 처리 추가, `SUMMARY_MODELS` FLASH_3_5 제거 `[FLASH_LITE, FLASH]` 구조.

- [DEV_260517.md](logs/DEV_260517.md) — **Law-Viz / `law_search` 1차 구현**: 국가법령정보센터 Open API 하이브리드 조회 경로 추가. `lawSearch.do?target=law`로 법령 목록 후보를 잡고 `lawService.do?target=law`로 본문/조항호목을 조회하는 `lawTool` 구현. Router는 `law_search`까지만 판단하고, `lawTool` 내부에서 Gemini 2.5 Flash가 `{mode, law_name, article_no, query}`를 정규화한 뒤 Open API를 호출하는 하이브리드 해석 구조 적용. `LawSearch.law`와 `법령.조문.조문단위`가 객체/배열 양쪽으로 반환되는 구조를 정규화. `JO` 6자리 코드(`제44조` → `004400`) 변환 추가. `LawRenderer.tsx` 신규 추가, `json:law` 블록 파서/렌더링 및 `chat.ts` fast-pass 연결. 본문/조문 카드에 공개 원문 링크, 고정 폭 accordion, 5개 단위 페이지네이션 추가. “신호위반”·“음주운전” 같은 주제형 질의가 앞쪽 조문만 반환하지 않도록 관련도 필터와 키워드 확장(`제5조`/`제156조`, `제44조`/`제148조`) 추가. `소방법`/`교통법` 등 통칭 법령명 후보 보정 추가. / **법령 API 테스트 자산 추가**: `docs/Guide/LAW_API_TEST.md`, `scripts/test-law-openapi.mjs` 추가. `LAW_OC`는 코드 fallback 없이 환경변수 필수로 정리하고 로컬 `.env.local`/Vercel 환경변수로 관리. `node scripts/test-law-openapi.mjs --oc your_law_openapi_oc`, `npx tsc --noEmit`, `npm run build` 성공(기존 chunk size warning 유지).
- [DEV_260514.md](logs/DEV_260514.md) — **Wikidocs Jina Reader fallback 적용**: Node 서버 사이드 직접 fetch가 Cloudflare 차단(`403 Forbidden` + `Just a moment...`)으로 본문 수집 불가함을 `scripts/test-url-extract.mjs`로 확인. Jina Reader(`r.jina.ai`)로 `200 OK`·4.4KB Markdown 본문 확보. `api/fetch-url.ts`에 최소 조건(비정상 status 또는 `<title>Just a moment...</title>`)만으로 Jina fallback 적용. / **Jina Reader URL 이중 프로토콜 버그 수정**: `https://r.jina.ai/http://${targetUrl}` → `https://r.jina.ai/${targetUrl}`. `targetUrl`에 이미 `https://`가 포함되어 이중 프로토콜이 생성되고, Jina가 캐시된 무관 기사를 반환하던 원인. / **뉴스 기사 오요약 근본 원인 3종 수정**: ① `generator.ts` `hasUrlContent` 300자 threshold — Vercel(해외 IP)에서 Naver 등 한국 사이트가 짧은 HTML을 반환하면 `hasUrlContent = false` → Google Search 활성화 → 전혀 다른 기사 요약. `[URL_CONTENT:` 태그 존재 여부만으로 판단하도록 수정(`state.webContent.includes('[URL_CONTENT:')`). ② `isBlockedOrChallenge` 오탐 — `cf-chl`·`cloudflare`·`challenge-platform` 패턴이 CDN 사용 정상 사이트 HTML에서도 오탐. `!response.ok || <title>Just a moment...` 두 조건으로 최소화. ③ `content < 300` → Jina 추가 호출 경로 — 직접 fetch 성공 후에도 Jina를 호출해 캐시된 엉뚱한 기사로 덮어씌우던 경로 완전 제거. 최종 동작: 직접 fetch 성공 → URL_CONTENT 태그 → Google Search 비활성 / Cloudflare 차단 → Jina fallback → URL_CONTENT 태그 / Jina 실패 또는 fetch 오류 → FETCH_ERROR → Google Search 허용.
- [DEV_260513.md](logs/DEV_260513.md) — **동물병원 상세정보 보강 방향 정리**: 행정안전부 동물병원 API는 병원명·주소·전화번호·영업상태·인허가일자 중심이라 운영시간/휴무일/홈페이지/리뷰 보강에는 웹검색이 필요하나, 결과별 자동 웹검색은 지연시간과 정확도 편차가 커서 기본 검색 경로에는 넣지 않기로 정리. 기본 `vetTool` fast-pass 카드 응답은 유지하고, 향후 병원별 `상세 정보 찾기` 같은 선택형 보강 UX를 TODO로 추가. / **모바일 첫 쿼리 빈 화면 레이스 보정**: 새로고침 후 제목·응답이 존재하는 증상 기준으로 서버/DB가 아닌 프론트 로컬 세션 상태 overwrite 문제로 재분석. 앱 초기 `loadUserSessions()`가 늦게 도착해 새 세션/메시지를 `setSessions(mappedSessions)`로 덮어쓰는 경로를 `mergeSessionsPreservingLocalMessages()` 병합 방식으로 수정해 로컬 메시지·진행 중 세션을 보존. / **SQL/KQL 코드블록 출력 안정화**: 프론트는 fenced block이면 `sql`·`kql`도 코드 박스로 렌더링하므로, 모델이 평문 쿼리로 응답하는 문제를 줄이기 위해 `prompt.ts` `[CODE GENERATION STANDARDS]`에 SQL/KQL/Kusto/LogQL/PromQL/GraphQL/Cypher/Elasticsearch DSL/shell query는 반드시 언어 태그가 있는 fenced code block으로 출력하도록 명시. / **다음 개선 우선순위 정리**: 모바일 초기 세션 공백 마무리 → 프롬프트 언어 혼합 정리 → 멀티턴 경고·차단 → LCP/초기 로딩 개선 → 기능 확장 순서로 TODO 상단에 정리. / **모바일 초기 세션 최소 개선 범위 재조정**: 현재 재현 빈도가 낮아졌으므로 큰 구조 변경은 보류하고 `currentSessionId` 자동 복구와 `ChatArea` skeleton/fallback 정도만 최소 방어 후보로 축소.
- [DEV_260512.md](logs/DEV_260512.md) — **모델 레지스트리 중앙화 완료**: 현재 모델 문자열 하드코딩 위치 점검 후 Phase A 서버 상수화(`api/_lib/models.ts`: `SERVER_MODELS`, `DEFAULT_CHAT_MODEL`, `ROUTER_MODEL`, `SUMMARY_MODELS`) + Phase B 프론트 레지스트리(`src/lib/models.ts`: `CHAT_MODELS`, `ChatModelId`, `CHAT_MODEL_OPTIONS`, `isChatModelId`) 적용 / `App.tsx` preferred_model 검증·저장 추가, `Header.tsx` 모델 드롭다운 옵션 배열 기반 전환, `chat.ts`·`state.ts`·`generator.ts`·`router.ts`·`vision.ts`·`drug-info-tool.ts`·`speech.ts`·`summarize-title.ts` import 교체 / `tsconfig.json` include를 앱 본류로 축소해 `reference/**`·`scripts/**` 실험 파일 제외 / `sync-drug-image.ts` in-flight resolver nullable 정리 + `PharmacyRenderer.tsx` 요일 라벨 타입 shape 통일 / `npx tsc --noEmit` 성공 / `npm run build` 성공(기존 chunk size warning만 유지) / 모바일 초기 세션 공백 이슈 원인 후보(`ChatInput` fire-and-forget, 현재 세션 미선택, transient `!userId`, stale `sessions`)와 수정 체크리스트 문서화 / 날씨 응답 포맷을 언어별 `WEATHER_FORMATTING`으로 분리해 비한국어 모드에서 `맑음` 등 한국어 condition label 혼입 방지 / 프롬프트 전체 점검 후 URL 요약·YouTube fallback·Pill fallback·router stale 설명·current time 포맷·renderer schema 전역 주입 정리 계획 수립 / ChatInput 프랑스어·스페인어 placeholder를 짧게 조정해 기본 화면 2줄 줄바꿈 완화 / TODO 완료 흔적(`[x]`, `✅`, 완료 확인 문구) 제거 및 완료 내용은 DEV_HISTORY·날짜별 DEV 문서로 이관 / 모델 확장 TODO 후보에서 Gemini 2.0·Gemini 2.5 flash preview·GPT-4/o4 계열을 제외하고 GPT-5.2·GPT-5 mini·GPT-5.4 mini 후보로 정리 / 동물병원 `-동` 단위 검색 보정(`ROAD_NM_ADDR::LIKE`는 시군구까지만 사용, `sigungu`·`dong_name` 단독 fallback, 동명 원문+핵심어 비교, `ROAD_NM_ADDR || LOTNO_ADDR` 클라이언트 동 필터, `LOTNO_ADDR::LIKE` 재조회, 시군구 fallback notice, VetRenderer 안내 배너) / OpenAI·Gemini 멀티 프로바이더 추상화는 별도 프로젝트로 보류
- [DEV_260511.md](logs/DEV_260511.md) — **Vet-Viz 전국 동물병원 검색 구현** (행정안전부 `1741000/animal_hospitals/info` API, `returnType=JSON` 직접 수신, `cond[ROAD_NM_ADDR::LIKE]` 텍스트 주소 검색, 영업중 필터 0건 시 전체 재조회, EPSG:5174 좌표 WGS84 불가 → 카카오지도 텍스트 검색, VetRenderer 틸 테마·🐾·영업상태 배지) + **버그 3종**: `LANGCHAIN_INTENTS` `vet_search` 누락(SDK 경로 오분기) / serviceKey URLSearchParams 이중 인코딩 → Unauthorized / `chat.ts` `on_tool_end` vetTool 핸들러 누락 → empty response 에러 + **에러 보완 5종**: 검색 조건 없는 전국 첫 페이지 노출 차단 / VET_KEY 누락 가드 / HTTP·JSON·API 오류 분리 / 병원명 단독 검색 fallback 확장 / `펫` 키워드 과매칭 축소 + **TODO/코드 대조**: `react-markdown` lazy loading 완료 확인, 외부 API 계획에 Vet 완료 단계 반영
- [DEV_260510.md](logs/DEV_260510.md) — **Hospital-Viz 전국 병원 검색 구현** (HIRA `hospInfoServicev2` API, sidoCd/sgguCd 전국 코드표, CITY_TO_SIDO fallback, dong_name 필터, HospitalRenderer 인디고 카드, fast-pass 직접 스트림) + **에러처리 4종 완료 (C1·C2·H2·B1) + 이미지 분석 복구 2종 (I1·I2) + 모바일 버그 1종 (S1)** + **`docs/Guide/ERROR_HANDLING.md` 에러 처리 전체 구조 문서화** (7-layer 맵: API 키 관리·백엔드 엔드포인트·LangGraph 에이전트·SSE 프로토콜·geminiService·훅 레이어·UI 컴포넌트, 백로그 취약점 현황 포함): `pill-logic.ts` 1차·2차 약 검색 `Promise.all` → `Promise.allSettled` 전환(단일 페이지 타임아웃 시 전체 크래시 방지) / `geminiService.ts` 7개 함수(`loginUser`·`updateRemoteUserProfile`·`fetchSessions`·`createSession`·`deleteSession`·`updateSessionTitle`·`generateSpeech`) `response.ok` 가드 추가 — 비정상 HTTP 응답의 `.json()` SyntaxError 크래시 방지, `deleteSession`·`updateSessionTitle` 실패 시 silent UI 업데이트 bug도 함께 수정 / `fetch-url.ts` catch 블록 `status(200)` → `status(502)` — HTTP 레이어에서 에러 판별 가능, 프론트 호환성 영향 없음(JSON body 유지) / `streamChatResponse` `receivedAnyText`·`receivedDone` 변수 `try` 블록 내부 → 함수 스코프로 이동 — 네트워크 드롭 시 catch 블록 `ReferenceError` 수정, amber 배너 경로 정상화 / **이미지 분석 전면 불가 버그 수정**: 이미지 업로드 후 `attachment.data`가 Supabase URL로 교체되어 Gemini `fileData` 경로를 타던 구조 → `data` 는 원본 base64 유지, Supabase URL은 `storageUrl`에 분리 저장 — `types.ts` `MessageAttachment.storageUrl` 추가, `useChatStream.ts` 이미지 분기 수정, `api/chat.ts` DB 저장 시 `storageUrl` 우선 사용
- [DEV_260507.md](logs/DEV_260507.md) — **대용량 문서 500 에러 원천 차단** (문서 인라인 Base64 임계값 3MB→1MB, 1MB+ 즉시 Supabase `chat-docs` 업로드 → Vercel 4.5MB 제한 영구 회피) / **이미지 멀티턴 메모리 Wontfix** (Gemini API 멀티모달+Grounding 동시 활성화 불가 기술 한계 확인, 이미지 기억 보존 시 Google Search 영구 봉인 → 실용성 우선 폐기) / **약국 UI 마무리** (토스트 메시지 간소화, PharmacyRenderer 데스크톱 전화번호 UX 점검) / **README 최신화** (Pharmacy-Viz 정식 등재, `hospital_search` WIP 항목 삭제, Mermaid 구조도 업데이트) / **TODO 백로그 정리** (구현 완료 항목 삭제, Hospital Phase 1로 명확화)
- [DEV_260506.md](logs/DEV_260506.md) — **외부 API 통합 기획 확정** (약국/병원/arXiv+PubMed/문화행사/NEIS/법령 6종, API 키 7개 발급·테스트 완료) / **PharmacyTool 완전 구현** — 13개 최적화: ① LangGraph `on_tool_end` Direct Injection으로 LLM 스트리밍 우회(10~15초 단축) ② LangChain `maxRetries: 0`으로 429 Hang 차단 ③ 공공데이터 1000건 단일 호출(병렬→단일 전환, 전국 약국 누락 방지) ④ `sigungu` 띄어쓰기 Sanitize(공공데이터 0건 버그 우회) ⑤ `keyword` 파라미터 동·약국명 클라이언트 필터 ⑥ 0건 시 `searchWebTool` 폴백 ⑦ 3단계 가중치 정렬(영업중+100·일요일/공휴일+20·토요일+10) ⑧ 모바일/데스크톱 전화번호 분기(`tel:` vs 클립보드 Toast) ⑨ Toast 멀티라인 고도화 ⑩ 모바일 영업시간 그리드 반응형 튜닝 ⑪ Zod 스키마 `sido`/`sigungu` 분리 ⑫ Token Minification으로 스트림 파싱 크래시 해소 ⑬ 의도 분류 프롬프트 의도+예시+NOT 패턴 3요소 구조 / **Intent 현황 문서화** (11종 분류 전체 흐름 정리)
- [DEV_260505.md](logs/DEV_260505.md) — **프로필 이미지 업로드 용량 2MB→10MB** (`Header.tsx`, 안내 문구 4개 언어 일괄 수정) / **`sizeError` 다국어 누락 수정** (i18n 딕셔너리에 `sizeError` 키 4개 언어 추가, Toast 간결 포맷: `"용량 초과 (최대 10MB)"`) / **프로필 모달 글래스모피즘 적용** (배경 `bg-white/80 dark:bg-slate-900/60 backdrop-blur-2xl`, 테두리 `border-white/50`, 오버레이 `backdrop-blur-md`, 버튼·입력창 `bg-black/5 dark:bg-white/5`)
- [DEV_260504.md](logs/DEV_260504.md) — **보안 강화 7종** (SSRF 블록리스트 확장 `fetch-url`·`proxy-image`, `sync-drug-image` SSRF 화이트리스트 신규, 임의 버킷 접근 차단 `create-signed-url`·`upload`, 내부 에러 객체 노출 차단 6파일, AI 컨텍스트 에러 노출 차단 `fetch-url`·`drug-info-tool`, `speech.ts` 타입 검증, CSP 헤더 추가) / **에러 메시지 다국어화 4종** (`chat.ts` LLM 에러 `CHAT_ERRORS` 맵 4언어, `geminiService` `ERROR_MESSAGES` dead code 제거, `useChatSessions` `SESSION_ERRORS` 5종×4언어 + `reportError` 단순화, `App.tsx` `profileUpdateFailed` 4언어 + `useChatSessions` language 연동) / **성능 최적화 2종** (YouTube OEmbed + page fetch 직렬→`Promise.allSettled` 병렬 최악 18초→10초, YouTube 분석 시 `fetchUrlContent` 제거로 API 호출 블로킹 해소 전체 38~50초→30~40초) / **PubChem SMILES 검증 통합** (`ChemicalRenderer.tsx` 2단계 조회 — 이름 GET + SMILES POST 검증, 한국어 혼합명 영어 추출, `activeSmiles`·`smilesSource` 상태, "PubChem 검증"/"AI 생성" 소스 뱃지, 비동기 백그라운드 업데이트로 초기 렌더링 블로킹 없음)
- [DEV_260502.md](logs/DEV_260502.md) — **ChatInput 컴팩트 리사이즈 + 모바일 정렬 수정** / **라이트 모드 글래스모피즘 일관성 개선** (패널 테두리 인디고 tint, subtitle 대비) / **다크모드 글래스모피즘 UI 개선** (radial-gradient 레이어링, animated orb 3개, sidebar active glow) / **YouTube Shorts URL 매칭 수정** (`ytRegex`에 `shorts\/` 추가, native video 분석 활성화) / **전체 보안 검토** (IDOR-1·2·BUCKET·SSRF 4종) / **PhysicsRenderer 삭제 + DiagramRenderer 4종 확장** (Matter.js 제거, `free_body`·`projectile`·`collision` 신규) / **세션 초기화 에러 화면 수정** / **ConstellationRenderer UI 개선** (툴팁 좌표·호버 2x·지평선 선 버그 수정, 캔버스 500px·폰트 12px·pinch zoom·버튼 40px) / **별자리 JSON parse 수정** (sparse array repair, catch silent skip, prompt CRITICAL JSON RULES) / **시각화 intent maxOutputTokens 추가** (astronomy·biology 8192, chemistry·physics 4096) / **ConstellationRenderer 비주얼 리디자인** (Deep Space 방사형 그라디언트 배경·대기 glow·bgStars 280개·별 색온도·그라디언트 연결선·Glassmorphism 고정 info panel) / **ChemicalRenderer UI 개선** (헤더 항상 표시·1줄 레이아웃·isLoading 오버레이·헤더·푸터 색상 통일·다운로드 파일명) / **복잡 분자 겹침 수정** (`explicitHydrogens: false`, `overlapResolutionIterations: 8`, `bondLength: 37`, 적응형 높이 `resolvedHeight`) / **BioRenderer RCSB 폴백** (`models.rcsb.org` 503 → `files.rcsb.org` 2차 fallback 체인) / **BioRenderer 다운로드 파일명** (`${slug}_${date}_${time}.png` 규칙 통일) / **BioRenderer UI 안정화** (`SequenceView` 컴포넌트 외부 이동·`isLoading` 조건부 초기값·`isDark` effect 분리·PDB 재로드 deps 수정·`useMemo` 정리) / **BioRenderer React StrictMode double-invoke 수정** (`cancelled` 플래그 + `setTimeout(0)` dispose 보호 패턴 — Stage 파괴 방지, render 순서 변경) / **console.log 정리** (tools·chat·auth·pill-logic·drug-info-tool·DrugRenderer verbose 로그 제거)
- [DEV_260501.md](logs/DEV_260501.md) — **세션 타이틀 모델 경량화**: `SUMMARY_MODELS`를 `gemini-2.5-flash-lite` 중심으로 정리. `thinkingBudget: 0` 적용 상태에서 품질 차이가 거의 없어 lite만으로도 충분하고 더 빠르며 quota 효율적.
- [DEV_260430.md](logs/DEV_260430.md) — **YouTube 요약 처리 성능 개선** / **transcript 추출 전면 제거** (모든 방법 YouTube IP 차단 확인, `youtubei.js` 언인스톨, native video 단일 경로) / **YouTube native video thinkingBudget: 1024** (55.5s→35-40s, 60s Vercel 타임아웃 해소) / **세션 타이틀 생성 1·2·3차 개선**: 프롬프트 5단어→5~15단어, 마크다운 strip + URL strip, 첫 줄만 추출, maxOutputTokens 120→400, `thinkingBudget: 0`으로 thinking 비활성화(단어 중간 잘림 근본 해결)
- [DEV_260429.md](logs/DEV_260429.md) — **maxOutputTokens 인텐트별 분기** (PDF 16384 / 이미지 4096 / URL 8192 / YouTube 8192 / data_viz 8192 / 코드·일반 32768, 실측 검증 완료) / **PDF `hasDocumentContent` 플래그** (`fileData` 분기 감지로 `image_url` 분기 감지 실패 수정) / **응답 잘림 감지 UI** (generator.ts `cutOff` SSE 이벤트, chat.ts `done` 이벤트, useChatStream.ts `isCutOff` 플래그, ChatMessage.tsx amber 경고 배너) / **YouTube 요약 최적화** (트랜스크립트 20,000자 상한, native video maxTokens 오분기 수정, URL 칩 중복 수정, fetch-transcript timeout 25s→12s) / **모바일 SSE 안정성 강화** (AbortController + 25s activityMonitor, receivedDone 드롭 감지, Failed to fetch 재시도, MAX_TOKENS cutOff 이벤트 누락 수정) / **YouTube 멀티턴 미리보기 재등장 수정** (`isYoutubeFromPrompt` 플래그 도입, 2턴 native 영상 재전송 차단, groundingSources 재전송 차단 → 임베드 재렌더링 방지)
- [DEV_260427.md](logs/DEV_260427.md) — **약품 카드 "자세히" 버튼 복구** (pharm_url 항상 null → nedrug 식약처 상세 직링크로 교체, `ITEM_SEQ` 기반 `mfds_url` 신규 필드) / **모바일 응답 실패 완화** (LangChain path maxOutputTokens 32768 → 8192, 약품 카드 생성 타임아웃 여유 확보) / **약품 카드 이미지 Lightbox** (이미지 클릭 → 전체 화면 팝업, Portal + framer-motion spring 애니메이션, 다크 오버레이 + X버튼 닫기) / **약품 카드 다크모드 시각 개선** (글래스모피즘 베이스, 푸터 투명화, MED INDEX 인디고-퍼플 그라디언트) / **README·DEV_HISTORY 최신화** (Lighthouse 83→91, data_viz 모델, DEV_260421 누락 항목 복원 등)
- [DEV_260426.md](logs/DEV_260426.md) — **스트리밍 중 `**` 볼드 마커 dangling 수정** / **날씨 이모지 테이블 누락 수정** / **MFDS 미등재 약품 검색 폴백 개선** / **MFDS 폴백 출처 칩 미표시 수정 3단계** / **소스 칩 스트리밍 완료 후 표시** / **첨부파일 UX 전면 개선** (자세한 내용은 DEV_260426.md처럼 수정 1~4 참조) / **이미지 썸네일 aspect-ratio 16/9 컨테이너** (`max-w-[220px]`, 폴백 컨테이너 크기 고정, 아이콘 축소) / **이미지 항상 Supabase 업로드** (크기 무관 `chat-imgs` 버킷 업로드 후 URL DB 저장 → 히스토리 미리보기 복원, `useChatStream.ts`)
- [DEV_260425.md](logs/DEV_260425.md) — **npm audit fix** (22건 → 17건, 잔여 --force 불가) / **maxOutputTokens 8192 → 32768** (`generator.ts` 3곳, Vercel 60s 타임아웃 주의) / **보안 헤더 4종** (`vercel.json`, CSP 보류) / **SSRF hostname 차단** (`fetch-url.ts`, `proxy-image.ts`, 169.254.x.x·localhost)
- [DEV_260424.md](logs/DEV_260424.md) — **SDK 스트리밍 인라인 인용 `[N]` 미제거 수정** (청크·fallback sendEvent 전 strip 추가, LangChain 경로와 정규식 통일) / **새 세션 첫 질의 스피너 미표시 수정** (`prevSessionIdRef`로 null→id 전환 시 useEffect 리셋 skip, B1 수정 부작용 해소) / **TS 에러 2건** (`activeSessionId ?? undefined`, `activeSessionId!`) / **보안 취약점 전체 현황 검토** (CRITICAL C1 IDOR·C2 supabase폴백, HIGH npm audit 22건, MEDIUM SSRF·bucket·보안헤더 등)

### v4.78 (Vet-Viz — 2026-05-11)
- **VetTool 구현**: 행정안전부 `1741000/animal_hospitals/info` API 연동. `VET_KEY` 별도 (PHARM_KEY와 동일 공공데이터 포털 키, ⚠️ 만료 2028-05-10). `returnType=JSON` 지원으로 XML 파싱 불필요. `cond[ROAD_NM_ADDR::LIKE]` 텍스트 주소 검색 — 약국 API(Q0/Q1)와 유사 패턴. native fetch + AbortController(20s). 영업중(`SALS_STTS_CD=01`) 필터 → 0건 시 전체 상태로 자동 재조회. 가나다순 정렬, top 10 반환.
- **좌표계 제약**: 응답 좌표가 EPSG:5174(Bessel 중부원점TM)로 WGS84 변환 없이 Kakao 지도 좌표 링크 불가 → 병원명+주소 텍스트 기반 카카오지도 검색 URL 사용.
- **VetRenderer 신규**: 틸/에메랄드 테마 (🐾, 병원 인디고·약국 에메랄드 대비 차별화). 영업상태 배지 (영업중 틸·휴업 앰버·폐업 슬레이트). 인허가일자 표시. 전화·카카오지도(텍스트 검색) 버튼. 5개씩 페이지네이션.
- **통합 연결**: `graph.ts` ToolNode 등록, `generator.ts` LANGCHAIN_INTENTS 추가·fast-pass·allTools 분기, `state.ts` `vet_search` IntentType 추가, `router.ts` 유효 intent 목록·휴리스틱("동물병원"/"수의사") 추가, `prompt.ts` INTENT_FOCUS_HINTS 추가, `ChatMessage.tsx` `json:vet` 블록 파서·VetRenderer 등록, `chat.ts` `on_tool_end` 핸들러 추가.
- **버그 3종 수정**: ① `LANGCHAIN_INTENTS` `vet_search` 누락 → SDK(Google Search) 경로 오분기 ② serviceKey `URLSearchParams` 이중 인코딩(`%2F`→`%252F`) → `Unauthorized` ③ `chat.ts` `on_tool_end` vetTool 핸들러 누락 → fast-pass 후 빈 SSE → `LLM returned empty response.` 에러 루프
- **에러 보완 5종**: 검색 조건 없는 요청은 API 호출 전 지역명/병원명 요청으로 차단, `VET_KEY` 누락 가드 추가, HTTP 비정상 응답·JSON 파싱 실패·공공데이터 API 오류 코드를 0건 응답과 분리, 병원명 단독 검색도 영업중 0건 시 전체 상태 재조회, 라우터 fallback에서 `펫` 단독 키워드를 제거해 `펫보험`·`펫푸드`·`펫샵` 오분류 감소.
- **TODO/코드 대조**: `ChatArea.tsx`에서 `ChatMessage` lazy load로 `react-markdown` 번들 분리가 이미 적용된 것을 확인해 TODO 미완료 목록에서 제거. 외부 API 통합 계획에 `vet_search` 완료 단계를 추가하고, Paper/Culture/School/Law 툴은 미구현 상태로 유지.

### v4.77 (Hospital-Viz — 2026-05-10)
- **HospitalTool 구현**: 건강보험심사평가원 `hospInfoServicev2/getHospBasisList` API 연동. `PHARM_KEY` 공용 사용. ⚠️ **API 키 만료일: 2028-05-07** (재신청 필요) B551182 백엔드가 Node.js `https` 모듈 타임아웃 발생 → native fetch + AbortController(20s) 방식 (약국 API와 정반대). 전국 sidoCd(17개 시도) + sgguCd(서울 25개 + 전국 주요 시군구) 코드표 내장, 의사수 내림차순 + 가나다 정렬, top 10 반환.
- **CITY_TO_SIDO fallback**: LLM이 `sido_name`에 "전주시"·"청주시" 등 기초자치단체명을 넘기는 경우 상위 도(道) 코드로 자동 변환. `findSgguCd` suffix matching 보완 — "전주시 덕진구" 공백 포함 입력 시 마지막 토큰("덕진구")으로 재탐색.
- **dong_name 파라미터**: HIRA API에 읍면동 필터 파라미터 없음 → sgguCd로 API 조회 후 `addr` 텍스트로 클라이언트 필터. "덕진구 금암동 병원" 같은 동 단위 검색 지원.
- **HospitalRenderer 신규**: 인디고 테마 (약국 에메랄드 대비). 종별 뱃지 색상 구분 (상급종합 보라·종합병원 인디고·병원 파랑·의원 슬레이트). 의사수·개원일·주소 표시. 전화·카카오지도·홈페이지 액션 버튼. 5개씩 페이지네이션.
- **Graph/Generator 연결**: `graph.ts` ToolNode에 `hospitalTool` 등록, `generator.ts` fast-pass 패턴 적용 (약국과 동일한 LLM 우회 직접 스트림), `prompt.ts` `hospital_search` intent focus hint 추가.
- **README / TODO / DEV_260510 최신화**: 렌더러 수 6→8 수정, Hospital-Viz 등재, ① 병원 검색 완료 처리, HOSPITAL_KEY → PHARM_KEY 공용 반영.

### v4.76 (Error Handling Hardening — 2026-05-10)
- **C1 `pill-logic.ts` Promise.allSettled 전환**: 1차(5페이지)·2차 변형 검색(5페이지×4변형) 루프 모두 `Promise.all` → `Promise.allSettled`로 교체. 단일 페이지 요청이 reject되어도 나머지 24개 결과 정상 수집. `fetchPage`가 이미 try/catch로 `[]` 반환하므로 happy path 동일, 예외 전파 경로 차단만 추가.
- **C2 `geminiService.ts` response.ok 가드 전면 적용**: `loginUser`·`updateRemoteUserProfile`·`fetchSessions`·`createSession`·`deleteSession`·`updateSessionTitle`·`generateSpeech` 7개 함수에 `!response.ok → throw Error` 추가. 비정상 HTTP 응답이 `.json()` 파싱으로 넘어가 SyntaxError로 앱 크래시하던 경로 차단. 기존 `streamChatResponse`·`uploadToStorage`와 일관성 확보. 부수 효과: `deleteSession`·`updateSessionTitle` 실패 시 호출부가 성공으로 오인해 UI를 업데이트하던 silent bug 해소 — 이제 catch 블록으로 분기 후 에러 toast 표시.
- **H2 `fetch-url.ts` 에러 상태 코드 502로 정정**: catch 블록 `res.status(200)` → `res.status(502)`. HTTP 레이어에서 URL 페치 실패 판별 가능, 모니터링·로깅 정확도 향상. 프론트 `fetchUrlData`는 502에도 JSON body를 그대로 파싱하며 `[FETCH_ERROR` 접두사 감지 로직 유지 — 동작 변경 없음.
- **B1 `streamChatResponse` 변수 스코프 버그 수정**: `receivedAnyText`·`receivedDone`을 `try {}` 블록 내부 → 함수 스코프로 이동. 네트워크 드롭(`reader.read()` throw) 시 catch 블록의 `ReferenceError` 제거, 부분 수신 후 amber 배너 표시 경로 정상화. GPT-5.5 Codex 리뷰에서 발견.
- **I1 이미지 분석 전면 불가 버그 수정**: 이미지 업로드 후 `attachment.data`를 Supabase URL로 덮어써서 Gemini `fileData` 경로를 타던 구조가 근본 원인. Supabase 공개 URL은 안정적인 `fileData` 대상이 아님 — `data`는 원본 base64 유지, Supabase URL은 `storageUrl`로 분리. `types.ts` `MessageAttachment.storageUrl?: string` 추가, `useChatStream.ts` 이미지/비이미지 분기 수정(`isImage ? storageUrl : data 교체`), `api/chat.ts` DB 저장 시 `storageUrl` 우선 사용. 로컬 테스트로 이미지 분석 복구 확인.
- **I2 이미지 클라이언트 압축**: I1으로 base64가 페이로드에 포함되면서 Vercel 4.5MB 한계 초과 가능. `ChatInput.tsx`에 `compressImage` 함수 추가 — Canvas API 1920px 리사이즈 + JPEG 85% 재인코딩. GIF 원본 유지, PNG 투명도 흰 배경 처리. 스마트폰 사진 8MB → base64 ~500KB로 압축.
- **S1 모바일 세션 목록 순간 소멸 수정**: 모바일 백그라운드→포그라운드 복귀 시 페이지 재로드 → `userId = null` → `setSessions([])` → localStorage 캐시 hydration 즉시 초기화로 세션 목록 소멸. `!userId` 분기에서 `setSessions([])` 제거, `setCurrentSessionId(null)`만 유지.
- **P1·P4·P5·P3 우선순위 3 항목 전체 해소**: P1은 C2와 동시 완료, P4는 `streamChatResponse`에 기적용, P5는 `fetchSessions` response.ok 가드로 대체, P3는 `App.tsx:289~300`에 기구현 확인.

### v4.75 (Document Payload Fix + Image Memory Wontfix + Cleanup — 2026-05-07)
- **대용량 문서 500 에러 차단**: `useChatStream.ts` 문서 인라인 Base64 임계값 3MB → 1MB로 하향. 1MB 이상은 Supabase `chat-docs` 버킷 업로드 후 URL만 전송 → Vercel 4.5MB 페이로드 제한 초과 `500 Internal Server Error` 영구 해소.
- **이미지 멀티턴 메모리 Wontfix**: Gemini API는 프롬프트 내 멀티모달 데이터(이미지) 존재 시 Google Search Grounding 강제 차단. 이미지를 계속 기억하게 하면 세션 전체에서 실시간 검색 봉인 → 실용성 판단으로 폐기. 관련 코드 원상 복구.
- **약국 UI 마무리**: 데스크톱 전화번호 복사 토스트 메시지 간소화. `PharmacyRenderer` UX 최종 점검.
- **README + docs 최신화**: Pharmacy-Viz 모듈 정식 등재 (7종 렌더러 완성), Mermaid 구조도·Project Structure 업데이트, `hospital_search` WIP 항목 삭제.
- **TODO 백로그 정리**: 구현 완료 항목 일괄 삭제, 외부 API 통합 계획 Phase 1을 Hospital로 명확화.

### v4.74 (PharmacyTool Full Implementation — 2026-05-06)
- **외부 API 통합 기획 확정**: 약국·병원·arXiv+PubMed·서울 문화행사·NEIS 학교·국가법령 6종 로드맵 수립. API 키 7개 발급·테스트 완료.
- **⚠️ API 키 만료일**: 국립중앙의료원 전국 약국 정보 조회 서비스 **2028-05-06**, 건강보험심사평가원 병원정보서비스 **2028-05-07** — 만료 전 재신청 필요.
- **Intent 분류 설계 고도화**: `pharmacy_search`·`hospital_search` 추가. LLM 프롬프트 "의도+예시+NOT 패턴" 3요소 구조로 충돌 케이스 해결 (예: "두통약 파는 약국" → `pharmacy_search` vs "두통약 성분" → `drug_info`).
- **PharmacyTool 13개 최적화**:
  - **Direct Injection**: `on_tool_end` 이벤트에서 Tool 결과 SSE 직접 주입, LLM 스트리밍 생성 10~15초 우회.
  - **maxRetries: 0**: LangChain 내부 지수 백오프 차단 → 429 발생 시 즉시 Round Robin 키 교체.
  - **1000건 단일 호출**: `Promise.allSettled` 200건 → `numOfRows=1000` 단일 호출로 대도시 약국 누락 방지.
  - **sigungu Sanitize**: 띄어쓰기 포함 시 공공데이터 0건 버그 → `split(/\s+/)` 마지막 단어 추출 방어막.
  - **keyword 파라미터**: Zod 스키마에 추가, 동·약국명 클라이언트 필터로 세밀 검색.
  - **0건 폴백**: API 결과 없을 시 `searchWebTool` DuckDuckGo 자동 전환.
  - **가중치 정렬**: 영업중+100·일요일/공휴일+20·토요일+10 점수 내림차순.
  - **전화번호 분기**: 모바일 `tel:` 다이얼러, 데스크톱 클립보드 복사+Toast 커스텀 이벤트.
  - **Toast 멀티라인**: `whitespace-pre-wrap break-words`·`rounded-2xl`·`max-w-[320px]` 확장.
  - **모바일 영업시간 그리드**: `text-[7.5px]`·`tracking-tighter`·`whitespace-nowrap` 극한 튜닝.
  - **Zod 스키마**: `sido`·`sigungu` 분리, 행정구역 LLM 파싱 고도화.
  - **Token Minification**: JSON.stringify 들여쓰기 제거 → GoogleGenAI SDK 스트림 파싱 크래시 해소.
  - **Anti-Hallucination**: "반환된 텍스트를 토씨 하나 틀리지 말고 그대로 출력" 프롬프트 강제.

### v4.73 (Profile Image Upload + Modal Glassmorphism — 2026-05-05)
- **프로필 이미지 용량 상향**: `Header.tsx` 파일 크기 검증 2MB → 10MB. 모달 내 안내 문구 4개 언어 일괄 수정.
- **`sizeError` 다국어 누락 수정**: `i18n` 딕셔너리에 `sizeError` 키 4개 언어 추가. 기존 `undefined` Toast → `"용량 초과 (최대 10MB)"` 등 간결 포맷.
- **프로필 모달 글래스모피즘**: 배경 `bg-white/80 dark:bg-slate-900/60 backdrop-blur-2xl`, 테두리 `border-white/50 dark:border-white/10`, 오버레이 `backdrop-blur-md`, 버튼·입력창 `bg-black/5 dark:bg-white/5` 적용.

### v4.72 (Security Hardening + i18n Error Handling — 2026-05-04)
- **SSRF 방어 강화**: `fetch-url.ts`·`proxy-image.ts` 블록리스트에 RFC 1918 전 대역(`10.x`, `172.16-31.x`, `192.168.x`) 및 IPv6 사설 대역(`fc`, `fd`, `fe80`) 추가. `sync-drug-image.ts` 최초 SSRF 방어 적용 — 화이트리스트 방식(`nedrug.mfds.go.kr`, `pstatic.net`, `connectdi.com`, `terms.naver.com`, `health.kr`).
- **임의 버킷 접근 차단**: `create-signed-url.ts`·`upload.ts`에 `ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs']` 화이트리스트 추가. `supabaseAdmin` 사용으로 RLS 우회 가능했던 취약점 해소.
- **내부 에러 정보 차단**: `upload.ts`(`details: error` 객체 제거)·`auth.ts`·`sessions.ts`·`create-signed-url.ts`·`pill-search.ts`·`sync-drug-image.ts`(`message`+`stack` 제거) — 전부 `'Internal server error'`로 통일.
- **AI 컨텍스트 에러 차단**: `fetch-url.ts` `[FETCH_ERROR: ${error.message}]` → 고정 메시지. `drug-info-tool.ts` LangGraph 툴 결과의 `e.message` 제거.
- **입력 검증**: `speech.ts` `typeof text !== 'string'` 체크 + `length > 10000` 상한 추가.
- **CSP 헤더**: `vercel.json`에 `frame-src https://www.youtube.com; object-src 'none'; base-uri 'self'` 추가. 최초 `frame-src 'none'` 적용 후 `YoutubeEmbed.tsx` iframe 차단 확인 → `https://www.youtube.com` 단독 허용으로 수정.
- **LLM 에러 다국어화**: `chat.ts` catch 블록 한국어 하드코딩 → `CHAT_ERRORS` 맵(rateLimit·unavailable·auth·generic × ko/en/es/fr). `language` 파라미터 활용.
- **세션 에러 다국어화**: `useChatSessions` `language` prop 추가, `SESSION_ERRORS` 맵(5종 × 4언어), `reportError` 시그니처 단순화(내부 에러 메시지 노출 구조도 함께 제거).
- **프로필 에러 다국어화**: `App.tsx` `profileUpdateFailed` i18n 키 추가(4언어), `showToast(e.message)` → `showToast(t.profileUpdateFailed)`. `useChatSessions`에 `language` 전달.
- **Dead code 제거**: `geminiService.ts` `ERROR_MESSAGES` 상수 — 정의만 있고 참조 없던 코드 삭제.
- **H1 Supabase insert 에러 처리 (v4.50 식별 → 적용)**: `api/chat.ts` L181 유저 메시지 insert `.then()` 블록에 `if (error) console.error(...)` 추가. insert 실패 시 무음 소실 방지. (참고: assistant 응답 insert는 L405 `await Promise.all([...]).then(([{error}]))`로 이미 처리됨)
- **C2 response.ok 가드 부분 적용 (v4.50 식별 → 일부 적용)**: `geminiService.ts` `streamChatResponse`(L226)·`uploadToStorage`(L41, L59)에 `!response.ok` 가드 적용 완료. `loginUser`·`fetchSessions`·`createSession`·`deleteSession`·`updateSessionTitle`·`generateSpeech` 6개 함수는 미적용 상태 — TODO C2/P1 잔여.
- **YouTube fetch 병렬화**: `fetch-url.ts` YouTube 처리에서 OEmbed(8s) + page description(10s) 직렬 → `Promise.allSettled` 병렬화. 최악 18초 → 10초. `allSettled` 선택 이유: 한쪽 실패 시 다른 쪽 결과 유지하는 기존 폴백 동작 보장(`Promise.all`은 한쪽 reject 시 전체 throw). `clearTimeout` 양쪽 일괄 해제.
- **YouTube `fetchUrlContent` 제거**: `useChatStream.ts` YouTube 분기에서 `fetchUrlContent` 호출 제거. Gemini가 `fileData`로 영상 직접 분석하므로 사전 수집하는 제목/채널/description 텍스트는 중복. fetch-url.ts 대기(8~10초)가 API 호출을 블로킹하던 구조 해소. 전체 YouTube 분석 대기 38~50초 → 30~40초. 일반 URL 경로 `fetchUrlContent`는 유지.
- **PubChem SMILES 검증 통합** (`ChemicalRenderer.tsx`): LLM 생성 SMILES를 PubChem(NIH 공개 API)으로 검증·교체. 2단계 조회 — ① 이름 기반 GET(`/compound/name/{name}/property/SMILES/JSON`, 5s timeout) ② 이름 조회 실패 시 LLM SMILES POST 검증(`/compound/smiles/property/SMILES/JSON`, 6s timeout). 한국어 혼합명 처리: `"아스피린 (Aspirin)"` → regex로 `"Aspirin"` 추출. 순한국어명(`히스타민`, `데스모프레신`)은 Step 1 404 → Step 2 SMILES 구조 검증. `activeSmiles`/`smilesSource` 상태 추가 — 초기값 LLM SMILES로 즉시 렌더링, 백그라운드에서 PubChem 응답 수신 시 교체 + 뱃지 전환("AI 생성" → "PubChem 검증"). `cancelled` 플래그로 unmount 후 setState 방지. i18n 4개 언어 뱃지 텍스트 포함.

### v4.71 (ChatInput Compact Resize + Alignment Fix — 2026-05-03)
- **데스크탑 컴팩트 리사이즈**: 좌우 버튼 `sm:w-10 sm:h-10` (40px) 통일 (기존 왼쪽 44px/오른쪽 36px 불일치 해소). 컨테이너 `sm:p-1·sm:rounded-[28px]·sm:min-h-[48px]`. 아이콘 `sm:text-base/sm:text-sm` 반응형 분기. 모바일 변경 없음.
- **모바일 버튼 하단 쏠림 수정**: textarea wrapper의 중복 `py-1` 제거. wrapper 높이가 버튼 높이(36px)와 동일해져 `items-end` 기준 세 컬럼 정렬. textarea 자체 `py-1 sm:py-2` 패딩은 유지.

### v4.70 (Light Mode Glassmorphism Consistency — 2026-05-03)
- **라이트 모드 패널 테두리**: `border-white/60`(투명) → `border-indigo-200/50`. 헤더·사이드바 glass 패널이 배경과 구분됨. 다크 모드 `border-white/[0.12]`와 일관된 디자인 언어.
- **WelcomeMessage subtitle 대비**: `text-slate-400` → `text-slate-500`. 라이트 배경 대비 개선.
- **라이트 모드 orb opacity 완화**: 0.5/0.4/0.3 → 0.4/0.32/0.25.

### v4.69 (Dark Mode Glassmorphism UI Enhancement — 2026-05-03)
- **배경 radial-gradient 레이어링**: `linear-gradient` 단순 2포인트 → radial-gradient 2겹 + linear-gradient 3겹 합성. 베이스 색상 `#141629` → `#080d1a` (더 깊은 네이비). glass 패널 대비 강화.
- **Animated Ambient Orbs**: 정적 blob 2개 → 3개 애니메이션 orb. `orbFloat` 20s ease-in-out infinite. oklch 색상 공간 적용. `will-change: transform` + `contain: layout style`로 GPU 최적화. `prefers-reduced-motion` 대응.
- **Sidebar active session glow**: 선택된 세션 아이템에 `dark:ring-1 dark:ring-indigo-500/30 dark:shadow-[0_0_16px_rgba(99,102,241,0.22)]` 추가. pill 형태에 맞는 외곽 glow 방식.

### v4.68 (YouTube Shorts URL Fix — 2026-05-03)
- **YouTube Shorts URL 매칭 수정** (`api/chat.ts`): `ytRegex`에 `shorts\/` 패턴 추가. 기존 regex는 `youtube.com/shorts/VIDEO_ID` 형식을 매칭하지 못해 `isYoutubeFromPrompt = false` → `fileData` 미전송 → Gemini가 메타데이터만으로 요약하며 "자막 데이터를 직접 추출할 수 없어..." fallback 메시지 간헐적 노출. 수정 후 Shorts도 video ID 추출 → `watch?v=ID`로 변환 → native video 분석 + `thinkingBudget: 0` 적용.

### v4.67 (BioRenderer StrictMode Fix + Console Cleanup — 2026-05-03)
- **BioRenderer React StrictMode double-invoke 수정**: `doubleInvokeEffectsOnFiber`가 `[]` cleanup에서 `nglStage.dispose()`를 호출해 WebGL 컨텍스트가 파괴되던 문제 해결. `setTimeout(0)` + `clearTimeout` 패턴으로 double-invoke 시 dispose를 취소하고 실제 unmount 시에만 dispose. `cancelled` 플래그로 Mount 1의 in-flight 콜백이 Mount 2 stageRef를 침범하지 못하도록 차단. `setIsLoading(false)` → rAF → `viewer.render()` 순서로 변경해 `backdrop-blur` 간섭 방지.
- **console.log verbose 로그 정리**: `tools.ts`(`[DDG Debug]`·tool call 로그) / `chat.ts`(tool output 길이·LangGraph end ToolMessage) / `auth.ts`(nickname 수신) / `pill-logic.ts`(4종 검색 경과) / `drug-info-tool.ts`(MFDS 전략별·Vision 추출 결과) / `DrugRenderer.tsx`(pill visual 추출) 제거. `console.warn`·`console.error` 유지.

### v4.66 (DiagramRenderer 4-Type + ConstellationRenderer Redesign + Security Review — 2026-05-02)
- **PhysicsRenderer 삭제 → DiagramRenderer 4종 통합**: Matter.js 시뮬레이션(`PhysicsRenderer.tsx`) 제거. `DiagramRenderer`에 `free_body`·`projectile`·`collision` 3종 신규 추가, 기존 `inclined_plane` 포함 총 4종. 공통 `arrow()` 헬퍼·`getTheme()` 다크/라이트 분리. `ChatMessage.tsx` physics 블록 파서 제거.
- **prompt.ts 마이그레이션**: `json:physics` → `json:diagram` 4종 타입 가이드 대체. 렌더러 수 7 → 6.
- **ConstellationRenderer 버그 3종 수정**: ① 툴팁 좌표 `clientX/Y` → `rect` 차분(컨테이너 기준) ② 호버 감지 `* 2` 제거·threshold 15로 통일(CSS px ↔ 논리 px 불일치 해소) ③ 지평선 아래 별 연결선 `visible` 체크 추가.
- **ConstellationRenderer UX 개선**: 캔버스 데스크톱 400→500px·모바일 375→420px / 별 이름 9→12px / 줌 버튼 28→40px / 모바일 pinch-to-zoom 추가 / `containerRef` dead code 제거 / state 선언 순서 정리.
- **별자리 JSON parse 수정**: AI가 `[, , , ]` sparse array 생성 시 raw JSON 채팅 노출 문제 — parse 전 regex repair + catch silent skip 처리. `prompt.ts`에 CRITICAL JSON RULES 추가(빈 배열 금지, 물병자리 lines 예시).
- **시각화 intent maxOutputTokens 분기 추가**: astronomy·biology 32768→8192, chemistry·physics 32768→4096 (`generator.ts`).
- **ConstellationRenderer 비주얼 리디자인**: Deep Space 방사형 그라디언트 배경 / 하단 대기 glow / bgStars 280개(결정론적, screen-space) / 별 색온도(`getStarColor`) — 청백→주황 5단계 / 별자리 선 그라디언트(양 끝 fade + 0.5px white core) / 호버 팝업 → 좌하단 고정 frosted glass info panel(`backdrop-blur-xl`, CSS fade-in) / `tooltipPos` state 제거.
- **전체 보안 검토**: IDOR(auth.ts·sessions.ts), 임의 버킷 업로드, SSRF 리다이렉트 4종 식별. POC 단계 보류 → TODO 백로그.
- **세션 재설정 에러 화면 수정**: `handleReset` `clearStoredUser()` 제거 → localStorage 직접 제거+reload.
- **useAuthSession localStorage 폴백 강화**: `createGuestUser()` 헬퍼 분리, JSON.parse 실패 시 게스트 재생성.
- **LoadingScreen children prop 추가**: 에러 상태 "다시 시도" 버튼 지원.
- **ChemicalRenderer UI 개선**: 헤더 항상 표시(다운로드 버튼 조건부 소실 버그 수정) / 이름 1줄 고정(`items-center` + `truncate`) / `isLoading` 에메랄드 bounce 오버레이 / 헤더·푸터 배경 `dark:bg-white/[0.04]` 통일 / 다운로드 파일명 `${slug}_${date}_${time}.svg`.
- **복잡 분자 겹침 수정**: `explicitHydrogens: false`(CH₃·OH 노드 클러터 제거) / `overlapResolutionIterations: 8`(레이아웃 반복 강화) / `bondLength: 37.0` / 적응형 `resolvedHeight`(SMILES 길이 기반 300·380·460px) / SVG `viewBox`·다운로드 `tempSvg` height → `resolvedHeight` 참조 버그 수정.
- **BioRenderer RCSB 503 폴백**: `models.rcsb.org`(bcif.gz) 1차 → 실패 시 `files.rcsb.org`(cif) 2차 fallback 체인. 두 엔드포인트 모두 실패 시 한국어 에러 메시지 표시.
- **BioRenderer 다운로드 파일명**: `${data.pdbId}.png` → `${slug}_${date}_${time}.png`. ChemicalRenderer·ConstellationRenderer 규칙 통일.
- **BioRenderer UI 안정화**: ① `SequenceView` 컴포넌트 외부 이동(인라인 정의 → 부모 state 변경 시 unmount/remount 방지) ② `isLoading` 초기값 `useState(type === 'pdb' && !!data?.pdbId)`(첫 로드 인디케이터 표시) ③ `isDark` 전용 effect 분리(테마 전환 시 배경색만 업데이트) ④ 메인 PDB 로드 effect deps `[type, data.pdbId, isDark]` → `[type, data.pdbId]`(테마 전환 시 구조 재다운로드 차단) ⑤ `useMemo` 미사용 import 제거.
- **전체 다크모드 색상 검토 + 수정**: `Header.tsx`(모델 드롭다운 `dark:bg-slate-800`) / `ChatSidebar.tsx`(히스토리 라벨 `dark:text-white/30`·언어 드롭다운 `dark:bg-slate-900/95`) / `ChatInput.tsx`(첨부 카드 `dark:bg-slate-800/60`·textarea `dark:text-slate-100`·전송 버튼 비활성 `dark:text-white/20`) / `ChartRenderer.tsx`(카드 배경 glassmorphism·헤더 `dark:bg-white/[0.04]`·스크롤 fade `dark:from-slate-900`) / `Dialog.tsx`(`dark:bg-slate-900`) / `WelcomeMessage.tsx`(텍스트 `dark:text-slate-400`) / `DrugRenderer.tsx`(engName·efficacy 가시성 개선) — 하드코딩 hex `#1e1e1f`·`#2f2f2f` 제거 및 Tailwind 토큰 통일.

### v4.65 (Session Title Model Lightweighting — 2026-05-01)
- **타이틀 생성 모델 경량화**: `SUMMARY_MODELS` 순서 변경 — `gemini-2.5-flash` → `gemini-2.5-flash-lite` primary, flash는 fallback으로 이동. `thinkingBudget: 0` 적용 상태에서 두 모델 간 실질 품질 차이 없음. lite가 더 빠르고 quota 효율적.

### v4.64 (YouTube thinkingBudget 1024→0 — 2026-04-30)
- **`thinkingBudget: 0`으로 하향**: 긴 영상(15분+)에서 영상 처리 30~50s + thinking 1024(~10s) + 응답 생성이 60s를 초과해 타임아웃 재발. YouTube 요약은 deep reasoning 불필요 → 완전 비활성화. 429로 첫 번째 키 실패 시 0.3s 낭비도 마진 부족의 원인.

### v4.63 (YouTube Native Video Timeout Fix — 2026-04-30)
- **`thinkingBudget: 1024` for YouTube native video**: `gemini-2.5-flash` 무제한 thinking이 20~30s 소비해 Vercel 60s 초과. `isYoutubeRequest && hasVideoData` 조건 시 1024 토큰으로 제한 → Gemini API 55.5s → ~35-40s. 스트리밍·fallback 경로 모두 적용.
- **transcript 추출 전면 제거**: HTML 스크래핑, timedtext API, youtubei.js InnerTube 등 모든 방법이 YouTube IP 차단(iad1, hnd1)으로 실패 확인. `fetchYoutubeTranscript()` 제거, `youtubei.js` 언인스톨, `fetch-transcript.ts` 즉시 에러 반환으로 전환. YouTube 요약은 native Gemini video 단일 경로로 통합.

### v4.62 (Session Title Mid-word Truncation Fix — 2026-04-30)
- **`thinkingBudget: 0` 추가**: `gemini-2.5-flash` 기본 thinking이 `maxOutputTokens` 예산을 먼저 소비해 제목이 단어 중간("줄기세")에서 잘리던 문제 해소. Thinking 비활성화로 400토큰 전부 제목 출력에 사용.
- **추가 개선**: `maxOutputTokens` 200→400, `response.text` 첫 줄만 추출(설명문 블리드 방지), 유저 메시지 URL `stripUrls()` 제거, 어시스턴트 컨텍스트 300→500자 확대.

### v4.61 (Session Title Generation Fix Round 2 — 2026-04-30)
- **어시스턴트 응답 전처리**: `stripMarkdown()` 헬퍼 추가 — 코드블록·볼드·불릿 등 제거 후 300자 트림. 마크다운 노이즈로 인해 모델이 첫 구절만 제목으로 추출하던 문제 해소.
- **`제목:` 접미사 제거**: 프롬프트 끝의 `\n\n제목:`이 신문 헤드라인 단편 스타일(`앤트로픽, IPO 앞두고`) 유발 — 접미사 제거로 모델이 완결된 문장 생성 유도.
- **프롬프트 미완성 구 금지 명시**: `'~앞두고', '~관련'` 등 미완성 구 금지 지시 추가. 단어 수 "10단어 이내" → "5~15단어 사이"로 하한도 지정.

### v4.60 (Session Title Generation Improvement — 2026-04-30)
- **세션 타이틀 프롬프트 개선**: `api/summarize-title.ts` 전 언어(KO/EN/ES/FR) 프롬프트 "5단어 이내" → "10단어 이내, 내용이 무엇인지 알 수 있게" 변경. 원인은 maxOutputTokens 부족이 아닌 프롬프트 지시 과도 축약.
- **maxOutputTokens 상향**: 120 → 200. 한국어 10단어 여유분 확보.

### v4.59 (YouTube Request Latency Optimization — 2026-04-30)
- **fetchUrlContent + fetchYoutubeTranscript 병렬화**: `useChatStream.ts` YouTube 분기에서 두 fetch를 `Promise.all`로 동시 실행. 메타데이터와 자막 fetch 간 순서 의존성 없음 — 직렬 합산 시간 → 느린 쪽 단일 시간으로 단축.
- **Router YouTube fast-path**: `router.ts`에 `hasYoutubeUrl` 감지 조건 추가. YouTube URL(프롬프트 또는 webContent)이 있고 의약품 키워드가 없으면 `gemini-2.5-flash-lite` LLM 분류 없이 즉시 `general → generator` 라우팅. 기존 이미지 fast-path와 동일 패턴.
- **fetch-transcript.ts timeout 단축**: 페이지 HTML fetch 12s → 6s, caption XML fetch 15s → 8s. 자막 추출 실패 케이스 최대 대기 27s → 14s.
- **geminiService.ts 클라이언트 timeout 단축**: `fetchYoutubeTranscript` AbortController timeout 45s → 20s. 서버 최대(14s) 대비 충분한 여유 유지.

### v4.58 (Mobile SSE Stability + YouTube Multi-turn Embed Fix — 2026-04-29)
- **모바일 SSE 연결 안정성**: `geminiService.ts`에 `AbortController` + `activityMonitor` 추가. 25s(heartbeat 8s × 3회) 무활동 시 연결 강제 종료 → AbortError → 재시도 가능 에러 변환. `receivedDone` 플래그로 done 없이 종료 시 `onCutOff()` 호출. `useChatStream.ts` `isRetryable`에 `Failed to fetch` / `TypeError` 추가.
- **MAX_TOKENS cutOff 이벤트 누락 수정**: `generator.ts`에서 `finishReason === 'MAX_TOKENS'` 감지 시 `hitMaxTokens` 플래그 설정 → 스트림 종료 후 `sendEvent({ cutOff: true })`. 기존에는 로그만 찍고 amber 배너 미표시.
- **YouTube 멀티턴 미리보기 재등장 수정**: `chat.ts`에 `isYoutubeFromPrompt` 플래그 도입. 현재 프롬프트에 YouTube URL이 있는 신규 분석 요청과 멀티턴 follow-up을 명시적으로 구분. native 영상 `fileData` 전송·`groundingSources` 전송 모두 `isYoutubeFromPrompt`일 때만 실행 → 2턴 AI 응답에 `<YoutubeEmbed>` 재렌더링 차단. 실측 검증: 1턴 요약 후 2턴 세부 질의 시 미리보기 미등장 확인.

### v4.57 (maxOutputTokens Intent-based Routing + Cut-off Detection UI + YouTube Optimization — 2026-04-29)
- **maxOutputTokens 인텐트별 분기**: `generator.ts` SDK path에 `resolvedMaxTokens` IIFE 추가. PDF(`hasDocumentContent`) 16384 / YouTube(`isYoutubeRequest`) 8192 / 이미지(`hasMultimodalContent`) 4096 / URL 요약(`hasUrlContent`) 8192 / `data_viz` 8192 / 코드·일반 32768 유지. 폴백(비스트리밍) 경로도 동일 적용. 실측 검증: 이미지 2080자·PDF 1811자·YouTube 2799자 정상 완료, 이전 MAX_TOKENS 잘림 해소.
- **PDF `hasDocumentContent` 플래그**: PDF는 `chat.ts`에서 `fileData` 형식으로 전달 — `image_url` 분기 감지로는 무효. `fileData` 분기(`part.fileData.mimeType === 'application/pdf'`)에 추가로 적용. PDF + `data_viz` 인텐트 조합에서도 `hasDocumentContent` 우선 적용 확인(`maxTokens: 16384`).
- **응답 잘림 감지 UI**: `generator.ts` mid-stream 에러 후 부분 반환 시 `sendEvent({ cutOff: true })` 추가. `chat.ts` 정상 완료 후 `sendEvent({ done: true })` 추가. `geminiService.ts` `streamChatResponse`에 `onCutOff?` 파라미터 추가, SSE 파싱 블록에서 `data.cutOff` / `data.done` 처리. `types.ts` `Message` 인터페이스에 `isCutOff?: boolean` 추가. `useChatStream.ts` `onCutOff` 콜백 전달 → 수신 시 해당 메시지 `isCutOff: true` 반영. `ChatMessage.tsx` `!isUser && message.isCutOff` 시 amber `fa-triangle-exclamation` 경고 배너 렌더링.
- **YouTube 요약 최적화**: (1) `useChatStream.ts` 트랜스크립트 20,000자 상한 — 초과 시 `[자막이 너무 길어 일부만 제공됩니다]` 힌트 부착. (2) `generator.ts` `isYoutubeRequest` 조건을 `hasMultimodalContent` 앞으로 이동 — 트랜스크립트 없이 native video(`fileData: video/mp4`) fallback 시 `hasMultimodalContent=true`로 이미지 분기(4096)에 잘못 떨어지던 버그 수정, 8192 정상 적용 확인. (3) `useChatStream.ts` `manualGroundingSources` YouTube URL 정규화(`youtu.be/ID` · `shorts/ID` → `youtube.com/watch?v=ID`) — backend `pendingSources`와 URI 불일치로 Map dedup 실패해 URL 칩 2개 렌더되던 버그 수정. (4) `fetch-transcript.ts` 페이지 fetch timeout 25000ms → 12000ms.

### v4.56 (Drug Card "자세히" Button Restore + Mobile Stability + Lightbox + Dark Mode Polish — 2026-04-27)
- **약품 카드 "자세히" 버튼 복구**: v4.52(J5)에서 pharm.or.kr dead code 제거 후 `pharm_url`이 항상 null → 버튼 미렌더 상태였음. nedrug 식약처 공식 상세 페이지 직링크(`ITEM_SEQ` 기반)로 교체. `drug-info-tool.ts`에 `ITEM_SEQ` 및 `MFDS_DETAIL_URL` 출력 추가 → `mfds_url` 필드 신규 생성. `DrugData` 인터페이스에 `mfds_url?: string` / `connectdi_url?: string` 추가. 버튼 조건 `data.pharm_url` → `data.mfds_url || data.pharm_url` 변경. ConnectDI URL은 기존 하단 소스 칩 역할 유지.
- **모바일 응답 실패 완화**: LangChain 경로(drug_id·drug_info) `maxOutputTokens: 32768 → 8192`. 약품 카드 JSON + 한 줄 요약은 1,500토큰 이내 — 32768 토큰 대기는 불필요했고 Router + MFDS API + Vision + 생성 시간이 Vercel 60s에 근접하던 문제 완화. SDK 경로(일반 쿼리) 32768 유지.
- **prompt.ts json:drug 스키마 정비**: `mfds_url` 필드 추가, PHARM_URL·MFDS_URL·CONNECTDI_URL 규칙 분리 명확화.
- **약품 카드 이미지 Lightbox**: `DrugRenderer.tsx`에 `createPortal` 기반 전체 화면 이미지 뷰어 추가. 이미지 클릭 → `backdrop-blur-xl` 다크 오버레이 + spring easing scale 애니메이션(`[0.34, 1.56, 0.64, 1]`). 배경 탭 또는 X 버튼으로 닫기. 기존 hover expand 아이콘 실제 동작 연결. 이미지 없을 때 자동 비활성화. 신규 의존성 없음(기존 framer-motion 재활용).
- **약품 카드 다크모드 시각 개선**: 카드 베이스 `dark:bg-[#1e1e1f]` → 글래스모피즘(`dark:bg-white/[0.06] dark:backdrop-blur-xl`), 테두리 `dark:border-white/10`. 푸터 `dark:bg-black/20` → `dark:bg-transparent`(검은 띠 제거). MED INDEX 텍스트 `text-slate-400` → 인디고-퍼플 그라디언트(`bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent`).

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
- [DEV_260423.md](logs/DEV_260423.md) — **에러 처리 전체 감사** (CRITICAL/HIGH/MEDIUM/LOW 분류) / **약품 이미지 시스템 전면 수정** (J1~J5: nedrug 차단 시 ConnectDI 폴백, content-type 검증, 밀리그람 전략, pharm.or.kr dead code 23개 약품 0% 확인 후 제거) / **이미지 분석 bodyParser 10MB** / **멀티턴 이미지 분석 품질 저하 수정** (historyHasImage Google Search 오염 방지) / **세션 전환 시 입력창 비활성화 수정** (isTyping/loadingStatus 리셋 useEffect) / **스트림 에러 키 재시도 확장** (K1: INTERNAL/503/parse 에러 포함) / **DuckDuckGo 파싱 개선** (K2: Strategy 1 정규식 완화, Strategy 2 추가) / **chat.ts 다중 개선** (K3: unhandledRejection 가드, K4: Gemini 인라인 인용 `[1]` 스트리핑, K5: MFDS_NOT_FOUND 시스템 지시 누출 필터, K6: on_tool_end 출력 타입 핸들링)
- [DEV_260421.md](logs/DEV_260421.md) — **prompt.ts 성능 회귀 롤백** (날씨·URL/PDF 포맷 회귀 수정, cc04895 기준 복원) / **모델 gemini-2.5-flash 전면 통일** (`data_viz` flash-lite 오버라이드 제거, `vision.ts` flash-lite → flash) / **URL 요약 헤딩 다국어 재적용** (KO/EN/ES/FR `URL_SUMMARY_LABELS` 맵, `getSystemInstruction` 블록 함수 전환)
- [DEV_260420.md](logs/DEV_260420.md) — **URL 요약 `[1]` 인용 마커 제거** / **소스 텍스트 크기 18000→15000자 조정** / **다크모드 미드나잇 인디고 B+1 적용** / **한 줄 요약 blockquote 스타일 복원** / **모바일 사이드바 새 채팅 폰트 불일치 수정** / **PDF URL 요약 포맷 통일** / **날씨 이모지 누락 수정** / **URL 요약 헤딩 다국어 대응** (언어별 주입)
- [DEV_260419.md](logs/DEV_260419.md) — **모바일 YouTube 요약 연결 끊김 수정** (`fetch-transcript` Edge 런타임 제거 → Node.js 전환 + 타임아웃 10s/8s → 25s/15s) / SSE Heartbeat 15s→8s + `X-Accel-Buffering: no` 헤더 추가 / `fetchYoutubeTranscript` 프론트 45s 타임아웃 명시
- [DEV_260418.md](logs/DEV_260418.md) — **URL 요약 첫 시도 빈 응답 버그 수정** (`[FETCH_ERROR]` 감지 → `[URL_CONTENT]` 태그 미부착 → Google Search 자동 대체) / **Lighthouse 70점 성능 분석** (TBT forced reflow, ChatMessage 워터폴, 미사용 JS 281KB — 향후 수정 예정)
- [DEV_260417.md](logs/DEV_260417.md) — **DrugRenderer null crash 수정** / **drug-info-tool PARTIAL_DATA 제거** / **fetch-url 콘텐츠 추출 개선** / **chat.ts API 키 소진 에러 분류** / **MFDS 미등록 약품 출처 칩 미표시 수정** / **URL 요약 품질 개선** / **Lighthouse TBT 개선** + **캐시 버그 3건** / **URL 요약 3-part 구조화** / **fetch-url 중첩 div 본문 잘림 수정** / **테이블 포맷 안정화 지침** / **URL 기반 PDF 세션 크래시 수정** / **YouTube 세션 크래시 3종 수정** — follow-up 재분석 차단·lite→standard 모델 변경·빈 응답 에러 throw / **generator.ts multimodal 500 smart retry** — forceTextOnly + Google Search 자동 활성 재시도 / **maxOutputTokens 8192→16384** — YouTube 요약 잘림 수정·MAX_TOKENS 감지 로그 / **[미수정] useChatStream lastActiveDoc YouTube 오염 버그**
- [DEV_260416.md](logs/DEV_260416.md) — **전체 코드 보안 취약점 감사** — IDOR(auth/sessions), SSRF(fetch-url), bucket 화이트리스트 미적용(upload/create-signed-url), 에러 노출, fetch timeout 미적용(fetch-url/sync-drug-image) / **약품 카드 이미지 미표시(모바일) 수정** — sync-drug-image·proxy-image·DrugRenderer 전 fetch timeout 추가 / **채팅 이전 대화 AI 응답 누락 수정** — chat.ts DB 저장 fire-and-forget → await 변경 / **MFDS 장애 시 ConnectDI 폴백** — nedrug 404 시 drug_name 기반 ConnectDI 자동 검색·캐시. parseMedList + scoreNameMatch 기반 정확 매칭. 기존 drug_list 파싱 버그도 함께 수정
- [DEV_260415.md](logs/DEV_260415.md) — **에러 처리 전체 감사 + 1~4라운드 적용 완료** / **SDK 스트리밍 중복 응답 버그 수정** / **`drug-info-tool.ts` timeout 3곳** / **`responseText` 스코프 버그 수정**
- [DEV_260413.md](logs/DEV_260413.md) — **이미지 분석 Latency & 세션 종료 버그 수정** (Router fast-path, 공개 URL 이중 fetch 제거, Supabase fire-and-forget, SSE heartbeat)
- [DEV_260407.md](logs/DEV_260407.md) — **의약품 이미지 미표시 버그 3차 수정** (sync 실패 시 proxy fallback 무시 버그), **mapDbMessage attachment 복원 수정**, **useChatStream URL 처리 블록 try-catch 추가**
- [DEV_260406.md](logs/DEV_260406.md) — 예외처리 플로우 전체 검토 (P1~P5), 의약품 이미지 버그 발견 (#1 race condition, #2 scope bug)
- [DEV_260405.md](logs/DEV_260405.md) — 시각화 카드 전체화면 팝업 계획 정리, 세션 race condition 버그 수정, UI 폴리시 2차, 스트리밍 실시간 전송 버그 수정, 웰컴화면 질의 미표시 버그 수정, 사이드바 ⋯ 드롭다운 메뉴, **Lighthouse 성능 개선 계획**, **auth 에러 무한 LoadingScreen 수정**, **헤더 모델명 좌측 패딩 축소**, **App.tsx 오케스트레이션 훅 분리 리팩토링**, **응답 대기 bouncing 도트 인디고 컬러**, **사이드바 새채팅/검색 폰트·높이 축소**
- [DEV_260404.md](logs/DEV_260404.md) — 약품검색 Strategy 3 버그 수정, ConnectDI URL 정규화, searchWebTool 소스칩, 에이전트 9-intent 오케스트레이션 설계 및 구현, 멀티턴 버그 수정, Lighthouse 측정, **UI 글래스모피즘 개선 구현**
- [DEV_260403.md](logs/DEV_260403.md) — 타이레놀 검색 오매칭 수정, pharm.or.kr 각인 검증 강화

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
- **Code Splitting**: 모든 시각화 컴포넌트 동적 import (Bio, Chemical, Diagram, Constellation, Chart, Drug)
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
| 2026-05-06 | `medical_qa` Google Search Grounding 강제 활성화. thinkingBudget 3,000 상한. 외부 공공 API 7종 통합 기획 수립 (약국·병원·문화행사·논문·학교·법령) |
| 2026-05-21 | 3.5 Search two-track 보정 및 renderer intent Search 기본 비활성화. 약품 이미지 식별은 비전 JSON을 `contextInfo`에 노출하지 않고 `state.pillData` 기반 서버 직접 DB 조회로 전환. `vision` 노드의 내부 JSON 스트림도 SSE에서 제외해 raw JSON 응답 노출 방지. 3.5 Flash에서 직접 DB 조회 이후 추가 tool bind로 발생하던 LangGraph recursion을 차단. `match_type !== exact` 후보는 카드화하지 않고 약학정보원 상세 링크가 포함된 후보 표만 반환하도록 변경. 2.5/3.5 Flash 모두 non-exact 후보에서 동일한 표 반환 확인 |
