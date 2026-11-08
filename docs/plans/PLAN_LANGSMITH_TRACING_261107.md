# PLAN_LANGSMITH_TRACING_261107 — LangSmith 추적 (관측만 추가)

> 상태: L0·L1·L2·원문 모드 완료(11-07~08), L3 → PLAN_TRACE_ID, L4 일부 — 아래 "진행 현황" · 범위 dev 로컬 → `chat-agent-dev` 배포. 운영(Production) 제외.
> 출발점: 사용자 공유 안(GPT 검토, "Hybrid Tracing") — 이 문서는 그 안을 현재 코드에 대 보고 고친 확정안이다.

## 진행 현황 (11-08 기준)

| 단계 | 상태 |
|---|---|
| L0 정리 Client·스위치·응답 뒤 전송 | ✅ 11-07 |
| L1 노드 계층 | ✅ 실화면 확인(별도 작업 없음) |
| L2 SDK 직접 호출 9곳 span(모델·검색·토큰·출처 수·캐시 토큰) | ✅ 11-07, 배포 dev 확인 11-08 |
| 원문 모드(로컬·배포 dev — 브랜치 판정·허용 의도·앞 턴 생략·마스킹·정규화·꺼진 사유 로그) | ✅ 11-08, 배포 dev 연속 턴 실화면 확인 |
| L3 루트 메타데이터 | ➡️ [PLAN_TRACE_ID_261108](PLAN_TRACE_ID_261108.md) T1~T3 로 확장 — **미착수** |
| L4 배포·측정 | 🟡 env 등록·수집 확인·합성 벤치 3차(숨김 +1ms·원문 +6ms) 완료 / 실배포 켜기 전후 `[turn].ms`·`[trace]` 전송 실패 수 남음 |

남은 코드 작업: `retry_reason` 열거값(L2 완료 기준 중 재시도·강등 사유) · T1→T2→T3 · L4 실측(T1 뒤 — 턴 ID 로 로그와 trace 를 짝지어 비교).

### 사용자가 직접 할 일 (대시보드)

**Vercel — `chat-agent-dev` 프로젝트**
- [x] `CHAT_TRACING_RAW_ALLOW_DEPLOYED` **삭제 후 Redeploy**(11-08 완료) — 원문 모드 확인 끝(평소는 숨김). 다시 볼 때만 넣고 빼는 스위치.
- [x] `LANGSMITH_PROJECT` 값을 `chat-agent-dev-vercel` 로(11-08 완료) — 로컬 `chat-agent-dev` 와 분리.
- [x] (선택) `LANGSMITH_PROJECT_RAW` 를 `chat-agent-dev-vercel-raw` 로(11-08 완료) — 로컬 원문과 분리.
- [ ] (선택, **아직**) 스위치류(`CHAT_TRACING`·`CHAT_TRACING_RAW`·`CHAT_TRACING_RAW_ALLOW_DEPLOYED`)는 Sensitive 해제로 다시 저장 — 값이 보여야 이번처럼 `false`·오타를 바로 찾는다(키는 Sensitive 유지).
- [ ] env 를 바꾼 뒤엔 Redeploy. dev 푸시는 Preview 로 배포되므로 **Promote to Production** 해야 `chat-agent-dev.vercel.app` 에 반영.
- 운영 프로젝트 `chat-agent` 엔 추적 env 를 넣지 않는다(11-08 0개 확인).

**LangSmith**
- [x] 보관 기간 — `chat-agent-dev-raw` 는 **Base(14일 후 자동 삭제)** 확인(11-08). 조직(Personal) 기본 보관값도 **Base 14일** 확인(11-08) — 새 프로젝트(`chat-agent-dev-vercel`·`-vercel-raw`)도 14일. ⚠️ Base trace 도 피드백·주석 큐 등 기능을 쓰면 **180일(Extended)로 자동 승격**될 수 있다 — 원문 프로젝트에는 피드백·데이터셋 추가를 하지 않는다
- [ ] (권장) Settings → Trace Usage Limits **Spend limit** — 지금 Unlimited. 월 상한(예: $5)을 걸어 두면 샘플링 실수·트래픽 급증 때 과금이 막힌다
- [ ] 원문 프로젝트 접근은 본인 계정만(워크스페이스에 다른 멤버를 초대하지 않는다).
- [ ] (확인) Gemini run 의 비용 표시 — OpenAI 는 표시됨(입력 4,907 토큰 $0.0005). Gemini 가 안 나오면 모델 단가 등록이 필요할 수 있다.
- [ ] 원문 디버깅이 끝난 프로젝트는 필요 없으면 프로젝트째 삭제.

**운영(Production) 적용 전** — 개인정보처리방침에 LangSmith(미국) 처리 위탁·국외 이전·보관 기간 고지(문구 초안은 요청 시 작성), 그 뒤 별도 스위치·샘플링.

## 0. 요약

- **바꾸지 않는다:** LangGraph 노드·엣지, `@google/genai`·OpenAI Responses 직접 호출, grounding·인용, SSE, 키 로테이션·강등·재시도, `[turn]` 로그.
- **더한다:** LangSmith 로 노드별 시간·모델 호출·재시도·강등을 본다. 원문은 보내지 않는다.
- **원 안과 다른 점:** ① 오류 문자열은 env 숨김이 안 덮는다 → 직접 만든 Client 로 강제 ② 전송은 응답 **뒤** `after()` 로 마무리(동기 flush 금지) ③ 직접 호출은 8곳을 하나씩 감싸지 않고 공통 지점에서 ④ L3 메타데이터는 `buildTurnLog` 결과를 재사용.

## 1. 현재 코드 — 자동 추적 범위

| 경로 | 위치 | `LANGSMITH_TRACING=true` 만으로 |
|---|---|---|
| 그래프 실행 | `app/api/chat/route.ts:214` `graph.streamEvents` | ✅ 노드 4개(router·vision·generator·tools) — **입출력 = 상태 전체**(메시지·첨부 base64·webContent) |
| LangChain 모델 | `nodes/langchain-path.ts`, `nodes/vision.ts`, `drug-info-tool.ts`, `law-tool.ts` | ✅ — **프롬프트 원문** |
| Gemini 직접 | `nodes/router.ts:214`, `nodes/generator.ts` 7곳(`generateContent` 407·441·479·508·552·601·762) | ❌ 안 보임 |
| OpenAI 직접 | `server/openai/chat.ts`(fetch) | ❌ 안 보임 |

→ 켜기만 하면 **원문이 나가는 쪽(①②)은 자동, 정작 보고 싶은 쪽(모델·재시도·강등)은 안 보인다.** L0 은 막는 것, L2 가 보이게 하는 것이다.

설치: `langsmith@0.7.10` 은 `@langchain/core` 를 통해 이미 있다. `traceable`·`Client` 를 직접 import 하므로 **직접 의존성으로 추가**(knip).

## 2. 개인정보 — 원칙과 구멍

보내지 않는다: 질문·답 원문, 시스템 프롬프트, 첨부·base64, 검색 쿼리·grounding URL·출처 제목, 사용자 ID·이메일·세션 ID, 키·토큰, 공급자 오류 원문.

| 구멍 | 근거 | 대응 |
|---|---|---|
| **오류 필드** | `LANGSMITH_HIDE_*` 는 inputs/outputs 만(`langsmith/dist/client.js:792`). 공급자 오류엔 프롬프트 일부가 섞일 수 있다(`turn-log.ts` 가 메시지를 안 읽는 이유) | 직접 만든 `Client` — `hideInputs`·`hideOutputs` 를 함수로 강제하고, run 의 `error` 를 코드(`errCodeOf`)로 바꿔 보낸다 |
| 메타데이터·태그 | LangGraph 가 붙이는 값(노드명·step 외)이 무엇인지 미확인 | L0 에서 실제 페이로드를 보고 허용 목록 확정 |
| 켜는 순간 전송 | 위 §1 ①② | 코드가 들어가기 전엔 `LANGSMITH_TRACING=false`(env 기본값으로 둠, 11-07) |

## 3. 서버리스 전송

- `@langchain/core` 는 콜백을 백그라운드로 보낸다 → Vercel 은 응답 종료 뒤 함수가 멈출 수 있어 누락 위험.
- 원 안의 "마지막 SSE 전 동기 flush" 는 사용자 지연을 늘린다 → **스트림을 닫은 뒤 `after(() => awaitPendingTraceBatches())`**(Next 내장 `next/server` `after`, Fluid Compute). 지연 0, 누락만 막는다.
- 측정: 켜기 전후 응답 시간(`[turn].ms`) · 대시보드 누락률.

## 4. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **L0** | 직접 의존성 · 추적 Client 모듈(숨김·오류 코드화·키 없으면 꺼짐) · `after()` 마무리 | 합성 질문 3개(인사·`y=x²`·환율)로 대시보드에 trace 생성. **페이로드 점검: 입력·출력·오류·메타데이터·태그에 원문·URL·식별자 없음** |
| **L1** | 노드 계층 확인 | router→generator(→tools) 부모·자식, 노드별 시간, SSE 정상 |
| **L2** | Gemini·OpenAI 직접 호출 span — 호출 지점 8곳이 아니라 **공통 래퍼 한 곳**(없으면 만든다). 반환값·grounding 메타데이터 그대로, 호출 중복 없음 | 모델(요청/실제)·검색·지연·토큰·재시도 횟수·강등 사유(열거값) |
| **L3** | 루트 run 메타데이터 = `buildTurnLog` 결과(이미 허용 목록) — **11-08 확장: 턴 ID 로 세 시스템 연결 → [PLAN_TRACE_ID_261108](PLAN_TRACE_ID_261108.md)** | `sourceKinds`·차트 블록·searchBy 를 trace 에서 필터 |
| L4 | 배포·샘플링 | `chat-agent-dev` 에만 env · 지연·누락·사용량 기록 |

## 5. 테스트

- 하니스(키·네트워크 없음): 추적 Client 의 숨김 함수가 원문·URL·이메일·base64 를 남기지 않음, 오류 → 코드, `LANGSMITH_TRACING≠true` 또는 키 없음이면 전송 객체를 만들지 않음.
- 수동: 원 안 LS-01~12 중 LS-01·02·03·05·07·08·10·11 을 L0~L2 에 나눠 확인. **LS-11(실제 페이로드) 은 L0 완료 조건.**

## 6. 결과

### L0 (11-07) — 완료
- `server/agent/tracing.ts`: 정리 Client(inputs·outputs 비움 · error → 이름 · `events`·`serialized` 제거 · 메타데이터·태그 허용 목록) + 그래프에만 직접 넘기는 추적기 + `after(flushTraces)`. 스위치는 **`CHAT_TRACING`** — `LANGSMITH_TRACING` 은 항상 false(켜면 그래프 밖 LangChain 호출에 정리 안 거친 기본 추적기가 붙는다).
- 하니스 `tests/test-tracing.mts` 19: 가짜 전송으로 실제 멀티파트 본문(7,024자)을 받아 질문·이메일·URL·스트리밍 토큰·오류 메시지 0, inputs·outputs `{}`, 오류 이름만.
- 실화면(합성 질문): LangGraph 9.87s → router 1.26s → generator 8.51s, Input·Output "No inputs/outputs", 태그 `graph:step:n`, 메타데이터 `langgraph_*`. langsmith 가 정리 뒤 `LANGSMITH_*` env(키·secret·token 이름 제외)를 메타데이터에 붙인다 — 무해, 잡음.
- 도구 경로(`langchain-path.ts`, 영화 질문)는 자동으로 안쪽까지 보인다: generator → ChatGoogleGenerativeAI(`ls_model_name: gemini-2.5-flash`·`ls_temperature`·`ls_max_tokens`) → tools → movieTool.
- **토큰 수**: 출력을 비우면 LangSmith 가 토큰을 못 센다 → 정리 단계에서 출력의 `usage_metadata`·`llm_output.tokenUsage` 숫자만 `metadata.usage_metadata` 로 옮긴다(하니스 23). 화면 표시 확인 남음.
- 아직 안 보임(L2): router·generator 안의 Gemini **직접** 호출(차트·일반 질문 경로)·검색·재시도·강등. OpenAI 호출.

### L2 (11-07) — 완료
- `llmSpan`·`traceGemini`(tracing.ts) 로 SDK 직접 호출 9곳을 감쌌다 — router 1(`gemini.router`), generator 7(`stage1`·`stage1_retry`·`single`·`single_retry`·`malformed_retry`·`ground_retry`·`fallback`), OpenAI `request()`(`openai.openai_initial`·`followup`). 재시도·강등·키 로직은 그대로, 꺼져 있으면 원래 함수 그대로 호출.
- 모델·검색 여부는 호출 인자에서 읽는다(호출부가 따로 적으면 어긋난다). 토큰은 Gemini `usageMetadata`·OpenAI `usage` → `usage_metadata`, grounding 은 개수만(`grounding_sources`, traceable 이 출력을 한 겹 감싸 재귀로 찾는다).
- 실화면(환율): `gemini.router` 2.5-flash 검색 off **3,269/53 토큰** · `gemini.single` 3.8-flash 검색 on 출처 2 **5,944/552 토큰**, 원문 없음. 라우터 입력 3.3천 토큰이 매 턴 고정 비용 — 비용 절감 때 볼 지점.

### 원문 모드 (11-07)
- 로컬: `CHAT_TRACING_RAW=true` 하나. 배포: `CHAT_TRACING_RAW_ALLOW_DEPLOYED=true` 를 함께 둘 때만(dev 배포는 본인만 쓴다 — 다른 사람이 쓰게 되면 끈다). **Production(`VERCEL_ENV=production`)은 어떤 경우에도 무시.** 별도 프로젝트 `LANGSMITH_PROJECT_RAW`(기본 `chat-agent-dev-raw`) — 숨김 추적과 섞이지 않고 프로젝트째 지울 수 있다. 입출력·오류 원문 유지, base64·바이너리는 길이만, 2만 자 넘는 문자열은 앞부분만, `events` 는 제거(출력과 중복), 식별자(`sessionId`·`userId`·`email`·`thread_id`)는 `[id]`. 순환 검사는 조상 경로로 — LangChain 메시지가 같은 객체를 두 곳에서 가리켜 처음엔 `[circular]` 로 지워졌다(11-07 실화면). 문장 안 민감정보(이메일·전화·카드·주민번호·API 키·Bearer·JWT)도 형태만 남긴다(`redactText`, 11-08). 합성 질문에만 쓴다. 11-08: 모델 호출 span 에 **입력(호출 인자)** 도 원문 모드에서만 기록, 문자열 상한 6만, 검색 칩 HTML·HTTP 헤더·서명·`abortSignal` 제거, 리다이렉트 주소 `[redirect]`, 캐시 토큰 `input_token_details.cache_read`.

### 오버헤드 (11-07, `tests/manual/bench-tracing-overhead.mts`, 가짜 모델·전송 200턴)

| 모드 | 턴당 중앙값 | p95 | 응답 뒤 전송 마무리(200턴) |
|---|---|---|---|
| 끔 | 6.93ms | 16.40ms | 2ms |
| 숨김 | 12.36ms (**+5.4ms**) | 19.32ms | 42ms |
| 원문 | 14.68ms (**+7.8ms**) | 32.55ms | 78ms |

11-08 재측정(원문 모드 모델 입력 기록 포함, 실제 크기 지시 1.4만·3만 자 + 이전 대화 3턴, 2회):

| 모드 | 턴당 중앙값 | p95 | 응답 뒤 전송 마무리(200턴) |
|---|---|---|---|
| 끔 | 2.6~2.8ms | 4.8~5.0ms | 15ms |
| 숨김 | 3.6ms (**+0.9ms**) | 6.4~6.7ms | 134~181ms |
| 원문 | 4.8~5.1ms (**+2.2ms**) | 17~20ms | 324~532ms |

입력 기록이 더한 건 원문 모드 p95·전송 마무리(지시 복사·전송량)뿐이다.

11-08 3차(원문 모드 **보류·해제**·정규화·턴 판정 포함, `general` 턴이라 보류 후 원문 해제 경로, 2회): 숨김 +0.6~1.1ms · **원문 +5.6~5.8ms**(p95 22~46ms, 응답 뒤 전송 마무리 0.33s/200턴). 보류 해제는 루트 run 이 끝날 때 — 마지막 토큰을 보낸 뒤라 첫 응답(TTFT)엔 들어가지 않는다. 평소는 숨김, 원문은 필요할 때만. 실제 턴(수 초) 대비 무시할 수준. 전송은 백그라운드·응답 뒤라 사용자 지연에 들어가지 않는다.

### 환경변수 (11-07 확정)

| Name | 로컬 `.env`·`.env.local` | Vercel `chat-agent-dev`(**Production 환경** — 이 프로젝트는 dev 브랜치를 Production 으로 배포한다) |
|---|---|---|
| `CHAT_TRACING` | `true` | `true` |
| `LANGSMITH_API_KEY` | PAT | PAT(Sensitive) |
| `LANGSMITH_PROJECT` | `chat-agent-dev` | `chat-agent-dev-vercel`(로컬과 구분) |
| `LANGSMITH_TRACING` | **`false`** | **`false`** |
| `LANGSMITH_HIDE_INPUTS`·`HIDE_OUTPUTS` | `true` | `true` |
| `LANGSMITH_TRACING_SAMPLING_RATE` | `1.0` | `1.0` |

**운영 프로젝트 `chat-agent` 에는 넣지 않는다**(L4 에서 지연·누락 측정 후). 11-08 정정: 처음엔 Preview/Development 만이라 적었으나 그러면 dev 배포에서 추적이 아예 안 켜진다.

**배포 dev 원문 모드(11-08 1단계)** — 관리 목적으로 dev 웹 대화도 마스킹해 보려는 것.
- 판정을 환경에서 **브랜치**로: `CHAT_TRACING_RAW=true` + `CHAT_TRACING_RAW_ALLOW_DEPLOYED=true` + `VERCEL_GIT_COMMIT_REF=dev`. `main`·브랜치 모름은 막는다(`chat-agent-dev` 도 `VERCEL_ENV=production` 이라 환경으로는 못 가른다).
- **턴 단위 허용 목록**(보안 검토 후 제외 목록 → 허용 목록): `general`·`data_viz`·`biology`·`chemistry`·`physics`·`astronomy`·`weather`·`movie_search`·`paper_search`·`arxiv_search` 만 원문, 나머지(건강·약·병원·약국·법률·동물병원·새 의도)와 첨부 있는 턴은 숨김. 대화 내역(`messages`·`contents`·`input`)은 **마지막 사용자 메시지부터만**(앞 턴 건강 상담이 일반 턴에 딸려 가지 않게), 앞 턴 출처 제목은 개수만, Storage 서명 URL 가림. 시스템 지시의 "이전 답 출처" 제목도 개수만(11-08 실화면에서 건강 턴 출처 제목이 다음 턴 지시에 남아 확인 후 수정) — 병명·사정은 형태 패턴으로 못 가린다. 의도는 라우터 뒤에야 나오므로 정리 Client 가 trace 를 **루트 run 이 끝날 때까지 보류**했다가 루트 출력(의도·첨부)으로 정해 한꺼번에 보낸다. 루트가 안 끝난 trace 는 10분 뒤(또는 보류 50개 초과 시) 숨김으로.
- 마스킹 추가: 일반 전화(02·031…), 주소(도로명 번호·지번·동호수).
- Vercel(`chat-agent-dev`, Production): `CHAT_TRACING_RAW=true`·`LANGSMITH_PROJECT_RAW=chat-agent-dev-vercel-raw` 상시, **`CHAT_TRACING_RAW_ALLOW_DEPLOYED=true` 를 실제 스위치로** — 볼 때만 넣고 뺀다. 원문 프로젝트 보관 기간은 짧게(14일).
- **배포 실화면 확인(11-08)**: `chat-agent-dev-raw` 에 날씨 턴 원문(라우터·OpenAI 입력·weatherTool). OpenAI 응답이 되돌려 주는 `instructions`·`tools` 는 원문 출력에서 제거, OpenAI 캐시 `cached_tokens` → `cache_read`.
- 원문 최소화(11-08 GPT 검토): LangChain 메시지 `{type, content}` 정규화(UUID·`lc_kwargs` 중복 제거, 도구 호출 관계는 유지), URL 쿼리 문자열 제거, 사용자 메시지 없는 대화 배열은 통째 생략(fail-closed), OpenAI 추론 블롭 제거.
- 켰는데 숨김으로 오면 Vercel 로그 `[trace] {"raw":false,"why":…}` 로 사유 확인(값은 안 찍는다). dev 푸시는 Preview → **승격**해야 `chat-agent-dev.vercel.app` 에 반영.
- 2단계(운영): L4 측정 → 개인정보처리방침에 LangSmith(미국) 처리 위탁·국외 이전·보관 기간 고지 → 별도 스위치·샘플링.

배포 확인(11-08, `chat-agent-dev` 숨김 모드): 루트·노드 입출력 `{}`, `gemini.router` 2.5-flash 3,267/52 토큰, `gemini.single` 3.8-flash 7,106/553 토큰 — 응답 뒤 `after()` 전송이 서버리스에서도 도착. 남은: `LANGSMITH_PROJECT` 를 `chat-agent-dev-vercel` 로(지금은 로컬과 같은 이름이라 섞인다).
