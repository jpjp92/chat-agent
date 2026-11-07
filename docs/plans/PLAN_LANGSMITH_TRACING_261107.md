# PLAN_LANGSMITH_TRACING_261107 — LangSmith 추적 (관측만 추가)

> 상태: 계획 · 범위 dev 로컬 → `chat-agent-dev` 배포. 운영(Production) 제외.
> 출발점: 사용자 공유 안(GPT 검토, "Hybrid Tracing") — 이 문서는 그 안을 현재 코드에 대 보고 고친 확정안이다.

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
| **L3** | 루트 run 메타데이터 = `buildTurnLog` 결과(이미 허용 목록) | `sourceKinds`·차트 블록·searchBy 를 trace 에서 필터 |
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

### 원문 모드 (11-07) — 로컬 전용
- `CHAT_TRACING_RAW=true` + `VERCEL` 없음일 때만. 별도 프로젝트 `LANGSMITH_PROJECT_RAW`(기본 `chat-agent-dev-raw`) — 숨김 추적과 섞이지 않고 프로젝트째 지울 수 있다. 입출력·오류 원문 유지, base64·바이너리는 길이만, 2만 자 넘는 문자열은 앞부분만, `events` 는 제거(출력과 중복). 합성 질문에만 쓴다.

### 오버헤드 (11-07, `tests/manual/bench-tracing-overhead.mts`, 가짜 모델·전송 200턴)

| 모드 | 턴당 중앙값 | p95 | 응답 뒤 전송 마무리(200턴) |
|---|---|---|---|
| 끔 | 6.93ms | 16.40ms | 2ms |
| 숨김 | 12.36ms (**+5.4ms**) | 19.32ms | 42ms |
| 원문 | 14.68ms (**+7.8ms**) | 32.55ms | 78ms |

실제 턴(수 초) 대비 무시할 수준. 전송은 백그라운드·응답 뒤라 사용자 지연에 들어가지 않는다.

### 환경변수 (11-07 확정)

| Name | 로컬 `.env`·`.env.local` | Vercel `chat-agent-dev`(Preview/Development만) |
|---|---|---|
| `CHAT_TRACING` | `true` | `true` |
| `LANGSMITH_API_KEY` | PAT | PAT(Sensitive) |
| `LANGSMITH_PROJECT` | `chat-agent-dev` | `chat-agent-dev-vercel`(로컬과 구분) |
| `LANGSMITH_TRACING` | **`false`** | **`false`** |
| `LANGSMITH_HIDE_INPUTS`·`HIDE_OUTPUTS` | `true` | `true` |
| `LANGSMITH_TRACING_SAMPLING_RATE` | `1.0` | `1.0` |

Production 에는 넣지 않는다(L4 에서 지연·누락 측정 후). `CHAT_TRACING_RAW`·`LANGSMITH_PROJECT_RAW` 는 로컬에만(`false`) — Vercel 에는 넣지 않는다(넣어도 코드가 무시).
