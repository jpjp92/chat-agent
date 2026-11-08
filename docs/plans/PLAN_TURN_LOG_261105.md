# PLAN_TURN_LOG_261105 — 요청당 구조화 로그(`[turn]`)

> 작성 2026-11-05 · 상태: **L0 구현·운영 확인(11-05)** · 관련 TODO §0-i "의도·`json:diagram` 생성 여부 구조화 로그"(Codex P1)
> 배경: [DEV_261105](../logs/2026/11/DEV_261105.md) — 차트 블록 누락(검색 on), 인용 제거가 JSON 배열을 지움, 값 부족 차트 숨김이 모두 **응답 200** 으로 끝나 로그로는 성공처럼 보였다. 사용자가 원문을 붙여 줘서야 찾았다.

---

## 1. 목표

요청 하나가 끝날 때 **"무엇을 하려 했고 실제로 무엇이 나갔는지"** 를 한 줄로 남긴다. 응답 200 과 기능 성공을 구분하고, 다음 결정을 숫자로 내린다.

| 알고 싶은 것 | 판정 |
|---|---|
| 시각화 의도인데 블록이 빠진 비율 | `intent ∈ 렌더러` · `blocks` 비었음 |
| 그게 검색 때문인지 | 위 + `search=on` |
| 블록이 있는데 JSON 이 깨진 비율 | `ok < n` |
| 규칙·가드가 LLM 판정을 덮어쓴 비율 | `intentFrom ≠ router` |
| 통계 차트의 검색 비율(출처 C안 필요성) | `intent=data_viz` · `search=on` |
| 검색 때문에 모델이 강등된 비율 | `model ≠ 요청 모델` |

**비목표:** 대화 내용 분석, 사용자 단위 추적, 실시간 대시보드. DB 테이블 저장은 로그로 써 본 뒤 집계가 번거로우면 따로 판단(§7).

## 2. 형식

```
[turn] {"v":1,"intent":"data_viz","intentFrom":"router","provider":"gemini","model":"gemini-3.8-flash","modelDowngraded":false,"search":"on","searchBy":"router-llm","sources":6,"blocks":{"chart":{"n":1,"ok":1}},"chars":812,"ms":7210,"outcome":"ok"}
```

- 접두어 `[turn]` + `JSON.stringify` 한 줄. Vercel 로그 검색은 `[turn]`, 집계는 JSON 부분만 자른다.
- `v`: 형식 버전 — 필드가 바뀌면 올린다(집계 스크립트가 섞인 버전을 구분).

| 필드 | 타입·값 | 출처 |
|---|---|---|
| `traceId` | 턴 ID(UUID v4) — 아니면 `null`. 매 턴 새 무작위 값, LangSmith 루트 run ID·`chat_messages.trace_id` 와 같다. **유일한 식별자 예외**(11-08 결정 — 사용자·세션 ID 는 여전히 금지) | route.ts `crypto.randomUUID()` · [PLAN_TRACE_ID_261108](PLAN_TRACE_ID_261108.md) |
| `intent` | `IntentType` 열거값 | `st.detectedIntent` |
| `intentFrom` | `rule` · `router` · `guard` · `fallback` | router 가 상태에 기록(**신규**) |
| `provider` | `gemini` · `openai` | 실제 응답 경로 |
| `model` | 서버 모델 ID 허용 목록 중 하나 | generator 실제 사용 모델(**신규**) |
| `modelDowngraded` | boolean | 검색 턴 강등 여부(**신규**) |
| `search` | `on` · `off` | search-gate 판정(**신규** — 지금은 `[SearchPolicy]` 문자열뿐) |
| `searchBy` | 신호 source 열거값(`router-llm`·`renderer`·`user-explicit`·`medical-qa`·`multimodal`·`url-content`·`doc-content`·`followup-guard`·…) | search-gate `winner.source`(**신규**) |
| `sources` | 정수 | `st.allSources.length` |
| `blocks` | `{ [종류]: { n, ok } }` — 종류는 허용 목록(`chart`·`diagram`·`smiles`·`bio`·`constellation`·`drug`·`weather`·…) | 완성 본문을 한 번 훑음 |
| `chars` | 정수 | `fullAiResponse.length` |
| `ms` | 정수 | route 시작~종료 |
| `outcome` | `ok` · `empty` · `error` · `url_fetch_failed` | route 각 종료 경로 |
| `errCode` | 공급자 오류의 `status`/`code` 중 허용 목록 값, 아니면 `other` | catch 경로만 |

## 3. 보안·개인정보 원칙 (구현 체크리스트)

이 로그는 Vercel 런타임 로그로 나가고, 프로젝트 접근 권한이 있는 사람은 볼 수 있다. **"남겨도 되는 것만 고르는" 허용 목록 방식**으로 만든다 — 빼야 할 것을 고르는 방식은 새 필드가 생길 때 새어 나간다.

1. **사용자 내용 0.** 질문·답 본문·첨부 이름·URL·출처 제목/URL·검색어·도구 인자를 넣지 않는다. 길이·개수만.
2. **식별자 0.** `session_id`·사용자 ID·이메일·IP·User-Agent 를 넣지 않는다(해시도 넣지 않는다 — 세션 해시는 같은 사람의 요청을 이어 붙일 수 있다). 요청 묶음 분석이 필요해지면 그때 따로 검토.
3. **모든 문자열 필드는 열거값으로 강제.** `intent`·`searchBy`·`model`·블록 종류·`errCode` 는 허용 목록에 없으면 `"other"`. LLM·외부 API 가 만든 문자열(모델이 쓴 펜스 이름 `json:<임의>`, 공급자 오류 메시지)을 그대로 찍으면 **로그 주입**(줄바꿈·가짜 `[turn]` 줄)과 내용 유출 통로가 된다.
4. **오류는 코드만.** `error.message` 는 공급자가 프롬프트 일부를 되돌려 주는 경우가 있다 — `status`(숫자)와 허용 목록 `code` 만.
5. **직렬화는 `JSON.stringify` 하나로.** 템플릿 문자열로 조립하지 않는다(줄바꿈·따옴표 주입 방지). 숫자는 `Number.isFinite` 확인 후, 아니면 `null`.
6. **블록 파싱은 판정만, 결과는 버린다.** `JSON.parse` 성공 여부만 `ok` 에 센다. 파싱한 객체·에러 메시지는 로그에 안 넣는다. 본문 크기 상한(예: 200KB) 넘으면 파싱 생략 · `ok` 는 `null` — 악의적으로 큰 응답이 로그 단계에서 CPU 를 잡지 않게.
7. **로그 실패가 응답을 망치지 않는다.** 전체를 `try/catch` 로 감싸고 실패하면 `[turn] {"v":1,"logError":true}` 만.
8. **비밀값 경로 차단.** 함수 인자는 필요한 값만 받는다(`state` 통째로 받지 않음) — 상태에 키·토큰·첨부 base64 가 섞여 있어도 닿을 수 없게.
9. **하니스로 고정.** PII 가 들어간 입력(이메일·전화번호·URL·줄바꿈·`[turn]` 문자열을 담은 본문과 펜스 이름)을 넣어도 출력 줄에 그 문자열이 **없음**을 검사. 필드 키 집합이 허용 목록과 같은지도 검사.

### 기존 로그 정리(같은 원칙, 별도 커밋)
조사 중 발견 — 사용자 질문에서 나온 검색어를 그대로 찍는 곳이 있다.
- `server/agent/paper-tool.ts:356` 재시도 검색어 `"${query}" → "${broader}"`
- `server/agent/tools.ts:36` searchWebTool 0건 시 질의
→ 길이·건수만 남기도록 바꾼다(디버깅 가치는 로컬 개발에서만 원문 — `NODE_ENV !== 'production'` 분기).

### 운영에 남는 warn·error 로그 검토(11-05)
운영 빌드는 `console.log/info/debug` 를 지우고 `warn`·`error`(101곳)만 남긴다. 사용자 내용이 섞일 수 있는 4곳의 도입 경위를 git 이력으로 확인했다.

| 로그 | 도입 | 의도 | 판단 |
|---|---|---|---|
| `[Chat API] Model request failed` — 공급자 `error.message` 원문 (`app/api/chat/route.ts`) | 08-23 `9056a2a` | **의도적** — [DEV_260823 §9](../logs/2026/08/DEV_260823.md) 오류 공개 정책(원문은 서버 로그, UI 는 4개 언어 안내만). `chat-error-policy.ts` 분류가 메시지 문자열에 의존해 오진 시 원문이 필요 | **유지 + 300자 제한**(11-05 적용) |
| `[weatherTool] 조회 실패:` 도시 이름 (`weather-tool.ts:31`) | 07-06 `2214f55` | 일반 디버그 — 어느 도시에서 지오코딩이 실패하는지가 단서 | **유지**(도시 단위·실패 때만) |
| `Vision Node JSON parse failed` 응답 앞 100자 (`vision.ts:108`) | 05-26 `2240f21` | JSON 파싱 실패 디버그 | **유지**(각인·색 — 개인정보 아님) |
| `User/Assistant message save error` — Supabase 오류 객체 전체 (`route.ts`) | 05-26 `2f488cb` | 일반 오류 로그 | **정리**(11-05 적용, `dbErrorSummary`) — `details` 에 제약 위반 값(`Key (session_id)=(…)`)이 들어간다. `code`·`message`·`hint` 만 |

## 4. 구현 단계

| 단계 | 내용 | 파일 |
|---|---|---|
| 1 | 순수 함수 `buildTurnLog(input) → string` — 블록 세기·파싱 판정·열거값 강제·직렬화. 입력 타입은 필요한 필드만 | `server/agent/turn-log.ts`(신규) |
| 2 | 하니스 — 블록 n/ok(정상·깨진 JSON·임의 펜스 이름), 열거 밖 값 → `other`, PII·주입 문자열 미포함, 키 집합 고정, 크기 상한 | `tests/test-turn-log.mts`(신규, verify 편입) |
| 3 | 라우터가 `intentFrom` 기록 · generator 가 검색 판정(`search`·`searchBy`)·실제 모델·강등 여부를 출력에 담고 디스패치가 받아 둠 | `router.ts`·`state.ts`·`generator.ts`·`stream-dispatch.ts` |
| 4 | route 의 종료 경로 전부(정상·빈 응답·URL 실패·catch)에서 한 번씩 호출 — `finally` 한 곳에서 부르고 경로별 `outcome` 만 세팅 | `app/api/chat/route.ts` |
| 5 | 기존 검색어 로그 정리(§3 끝) | `paper-tool.ts`·`tools.ts` |
| 6 | 문서 — REF_Architecture 로깅 절, 집계 방법(§6) | `docs/guide/` |

비용: 요청당 본문 한 번 훑기 + 블록 수만큼 `JSON.parse`. 유료 API 호출 없음.

### 구현 메모(11-05)
- 생성기 → 디스패치는 내부 이벤트 `sendEvent({ turnMeta })` — 요청별 콜백이라 전역 상태 없음(동시 요청 섞임 없음). 디스패치 `trackingEvent` 가 받아 `st.turn` 에 병합하고 **클라이언트로 보내지 않는다**(하니스 고정). 폴백·재시도는 다시 보내 뒤 값이 이긴다.
- `intentFrom`: 라우터가 LLM 판정 값을 기억해 최종 의도와 비교(같으면 `router`, 다르면 `guard`, LLM 판정 없음 `rule`, 지름길 `shortcut`).
- `model` 은 `server/models.ts`(server-only) 를 하니스가 못 불러와 목록 대신 형태 `^(gemini|gpt)-[a-z0-9.-]{1,40}$` 로 제한 — 줄바꿈·따옴표·공백 불가.
- **운영 빌드 `removeConsole`** 이 `console.log` 를 지운다(error·warn 만 남김) → `[turn]` 은 `process.stdout.write`.
- 남은 점: 라우트의 `[Chat API] Model request failed` 오류 로그는 `error.message` 를 그대로 찍는다(§3-4 원칙과 다름). 공급자 메시지에 프롬프트 일부가 섞일 수 있어 다음에 정리 후보.

## 5. 검증

- `npm run verify`(새 하니스 포함).
- 로컬: 오늘 쓴 쿼리(출생아·y = x²·OS 파이·경사면·일반 질문·URL 요약·약 카드)로 각 경로의 한 줄 확인 — 서버 터미널 출력에 질문 문구·URL 이 없는지 눈으로도 확인.
- dev 배포 후 `vercel logs --project chat-agent-dev` 에서 `[turn]` 검색.

## 6. 집계(로그로 시작)

Vercel 로그를 기간으로 내려받아 `[turn]` 줄의 JSON 만 모아 세는 로컬 스크립트(`tests/manual/turn-log-stats.mts`) — 의도별 블록 누락률·파싱 실패율·검색 비율·강등 비율. 내려받은 로그 파일은 레포에 넣지 않는다(.gitignore 확인).

## 7. 장기 로드맵 (정리만 — 단계마다 착수 조건을 만족할 때 사용자 결정)

관측성은 "필요가 생긴 만큼만" 올린다. 각 단계는 앞 단계 데이터로 필요가 확인돼야 시작하고, §3 보안 원칙(허용 목록·내용 0·식별자 0)은 모든 단계에 그대로 적용한다.

| 단계 | 내용 | 착수 조건 | 보안 추가 사항 |
|---|---|---|---|
| **L0 (이 계획)** | 요청당 `[turn]` 한 줄 · 기존 검색어 로그 정리 · 로컬 집계 스크립트 | 지금 | §3 |
| **L1 구간 시간** | 같은 줄에 `t: { router, search, firstToken, total }`(ms) | 지연 원인을 구간별로 나눠 봐야 할 때(체감 지연 불만·모델 교체 비교) | 숫자만 |
| **L2 클라이언트 결과** | 렌더러가 블록을 숨기거나 파싱에 실패한 경우를 클라이언트가 서버로 보고(`/api/client-event`, 열거값만) — 서버 `[turn]` 과 요청 ID 로 잇는다 | L0 에서 `ok` 인데 사용자 화면이 빈 사례가 확인될 때 | 요청 ID 는 서버가 만든 임의값(세션·사용자와 무관), 엔드포인트 rate limit·크기 상한·스키마 검증, 인증 사용자만 |
| **L3 저장·추이** | `turn_logs` 테이블(같은 허용 목록 필드), 주간 집계 뷰 | Vercel 로그 보존 기간(Hobby 약 30분)보다 긴 추이가 필요할 때 · 수동 집계가 주 1회 이상 될 때 | RLS: 서비스 키만 insert, 클라이언트 읽기 없음 · 보존 기간(예: 90일) 자동 삭제 · 개인정보처리방침에 "기능 품질 통계(내용 미포함)" 문구 확인 |
| **L4 경보** | 지표 임계값 경보 — 예: 렌더러 의도 블록 누락률 > 10%(일), 파싱 실패 > 2%, `outcome=error` 급증 | L3 이후, 배포 회귀를 사용자보다 먼저 알아야 할 때 | 경보 본문도 숫자·열거값만 |
| **L5 OpenTelemetry** | `@vercel/otel` + 수신 백엔드, 스팬: router·search-gate·tool·generation | 서비스 분리 · 도구 다회 호출의 호출별 시간 · 토큰·비용 장기 대시보드가 필요할 때 | 자동 계측의 프롬프트·응답 수집 **명시적으로 끔**, 스팬 속성은 L0 허용 목록만, 백엔드 리전·보존·접근 권한 검토, 하니스로 스팬 속성 키 고정 |

**하지 않을 것(장기에도):** 대화 원문 수집·샘플링 저장, 사용자 단위 행동 추적, 서드파티 분석 SDK 의 자동 수집. 품질 분석에 원문이 필요하면 운영 DB 를 사용자 승인 하에 **규칙 기반 개수만**(지금 방식) 센다.

**결정 기록 위치:** 단계 착수·보류 판단은 이 문서 §8 과 해당 날짜 DEV 로그에 남긴다.

## 8. 보류·결정 필요

- **DB 저장**: 로그 보존 기간이 짧아(Hobby 실측 약 30분 — 11-05) 장기 추이가 필요하면 `turn_logs` 테이블 — 그때 RLS(서비스 키만 insert, 읽기 없음)·보존 기간·같은 허용 목록 필드만. 지금은 하지 않는다.
- **샘플링**: 트래픽이 작아 전수. 늘면 비율 샘플링.
- **OpenTelemetry 도입 보류(11-05 결정).** 지금 질문은 요청 단위 결과 비율이라 로그 한 줄로 충분하다. OTel 은 SDK·수신 백엔드(계정·비용·보존)가 더 들고, LLM·LangChain 자동 계측이 **프롬프트·응답 원문을 기본 수집**하는 경우가 많아 §3 원칙과 정면으로 부딪친다(끄는 설정 하나 놓치면 대화가 외부로 나간다). 도입 시점: 구간별 지연을 요청마다 추적해야 할 때 · 서비스가 여러 개로 나뉠 때 · 모델 호출별 토큰·비용 장기 대시보드가 필요할 때. 그때도 같은 허용 목록을 스팬 속성으로 쓰고 자동 계측의 내용 수집은 끈다.
  - 필드 대응(옮길 때): `provider` → `gen_ai.system` · `model` → `gen_ai.request.model` · `intent`·`search`·`blocks` 등은 앱 고유 속성(`app.*`).
- **스팬 단위 로그도 보류.** 구간 시간이 필요해지면 같은 `[turn]` 줄에 `t: { router, firstToken, total }`(ms) 를 더한다 — 스팬·trace ID 구조 없이 "어느 구간이 느린가" 에는 충분하다. 도구 호출이 한 요청에 여러 번 도는 경로(약·논문)의 호출별 시간이 필요해질 때 다시 본다.
- **클라이언트 렌더 실패**(블록은 정상인데 렌더러가 숨김 — 값 부족 차트 등)는 서버에서 안 보인다. 필요하면 클라이언트 이벤트로 별도 계획.
