# REF_ErrorCodes — 에러·결과 코드 한곳 정리

> 2026-11-10 작성. 코드가 여러 파일에 흩어져 있어 "이 코드가 어디서 정해지고 어디에 남는가"를 한 장에 모았다.
> 코드의 **출처는 각 파일**이다 — 값을 바꾸면 이 문서도 같이 고친다.
> 흐름(누가 throw 하고 누가 잡는가)은 [PLAN_ERROR_HANDLING](../plans/PLAN_ERROR_HANDLING.md), 로그 필드 전체는 [PLAN_TURN_LOG_261105](../plans/PLAN_TURN_LOG_261105.md).

## 0. 표기 규칙

- **코드 값은 snake_case** — `rate_limit`, `medical_qa`, `insufficient_quota`. 로그·LangSmith 필터·외부 API(OpenAI·Gemini) 코드와 같은 모양으로 검색되게.
- **JSON 필드 이름은 camelCase** — `errCode`, `retryReasons`, `intentFrom`(TypeScript 객체 키 관례). 단 LangSmith 루트 메타데이터에서 펼친 키는 snake_case(`sources_official`, `retry_rate_limit`).
- 화면 문구는 코드가 아니다 — 코드로 고른 뒤 언어별 문장을 보낸다. **코드 자체는 브라우저로 나가지 않는다.**
- 열거값 밖의 값은 `other` — 공급자 오류 문구를 그대로 찍지 않는다(로그 주입·내용 유출 방지).

## 1. 코드 종류 한눈에

| 종류 | 값 | 정하는 곳 | 남는 곳 |
|---|---|---|---|
| ① 사용자 에러 분류 | §2 | `server/chat-error-policy.ts` `classifyChatError`·`forGuest` | 화면 문구만(`app/api/chat/route.ts` `CHAT_ERRORS`, ko·en·es·fr) |
| ② 로그 에러 코드 `errCode` | `timeout`·`rate_limit`·`openai_quota`·`keys_exhausted`·`unavailable`·`safety`·`bad_request`·`auth`·`server`·`other` | `server/agent/turn-log.ts` `errCodeOf` | `[turn]`(outcome=error 일 때만) · LangSmith 루트 `errCode` |
| ③ 턴 결과 `outcome` | `ok`·`empty`·`error`·`url_fetch_failed` | route.ts 종료 경로 | `[turn]` · LangSmith 루트 |
| ④ 재시도·강등 사유 | `rate_limit`·`timeout`·`unavailable`·`auth`·`media_error`·`empty`·`malformed_call`·`tool_code`·`primary_failed` | `turn-log.ts` `RETRY_REASONS`, generator `noteRetry` | `[turn].retryReasons`·`retries` · LangSmith 루트 `retry_<사유>: true` · 재시도 span `retry_reason` |
| ⑤ OpenAI 내부 코드 | 할당량 5종(§3) · `key_missing`·`timeout`·`network_error`·`tool_policy_conflict`·`unknown_function_call`·`invalid_function_arguments`·`function_execution_error`·`invalid_function_output` | `chat-error-policy.ts` `OPENAI_QUOTA_ERROR_CODES` · `server/openai/chat.ts` `OpenAIChatError` | 분류 입력으로만 쓴다(①·② 로 바뀌어 남음) |
| ⑥ LangSmith 전송 상태 `[trace]` | `send:"paused"` + `status:429` 또는 `error:"timeout"`·`"network"` · `flush:"timeout"` · `raw` + `why` | `server/agent/tracing.ts` | Vercel 로그 `[trace]` 줄 |
| ⑦ 원문 모드 꺼진 사유 `why` | `on`·`off`·`switch_value`·`allow_missing`·`allow_value`·`branch_missing`·`branch_other` | `tracing.ts` `rawModeWhy` | `[trace] {"raw":…,"why":…}` 인스턴스당 1줄 |

## 2. 사용자 에러 분류(①) — 화면 문구

| 분류 | 조건(위에서부터 먼저 걸리는 것) | 화면(ko) 요지 |
|---|---|---|
| `safety` | `error.safetyBlock`(Gemini SAFETY) | 안전 정책으로 응답 불가 |
| `openai_quota`¹ | OpenAI 할당량 코드 5종 · `type: insufficient_quota` | GPT 토큰 할당량 소진 |
| `rate_limit`¹ | 429 · `RESOURCE_EXHAUSTED` · "No API key available"·"All API keys" | 요청이 많아 지연, 잠시 후 |
| `daily_exhausted`¹ | 위와 같은 조건 + Gemini 일일 한도 소진 판정 | 오늘 사용량 소진, 내일 |
| `unavailable` | 타임아웃 오류(`TimeoutError`·`AbortError`) · 503·504 · `UNAVAILABLE`·`DEADLINE_EXCEEDED` | 서버 일시 불안정, 잠시 후 |
| `auth` | 401·403 | 인증 오류 |
| `guest_capacity`¹ | 게스트 + (`rate_limit`·`daily_exhausted`·`unavailable`) | 무료 이용량 포화, 로그인하면 계속 |
| `generic` | 그 밖 전부(빈 응답 포함) | 응답 생성 중 문제 |

¹ 11-10 snake_case 로 맞추기 전 이름: `openAIQuota`·`rateLimit`·`dailyExhausted`·`guestCapacity`.

## 3. 원인별 대응표 — 같은 원인이 각 코드에서 무엇이 되나

| 원인 | ① 화면 | ② `errCode` | ④ 재시도 사유 | 먼저 볼 것 |
|---|---|---|---|---|
| Gemini 429·RESOURCE_EXHAUSTED | `rate_limit`(게스트 `guest_capacity`) | `rate_limit` | `rate_limit` | 키 로테이션·유료 키 상태, `[turn].retries` 급증 여부 |
| 키 전부 소진("No API key"·"All API keys") | `rate_limit` 또는 `daily_exhausted`(게스트 `guest_capacity`) | `keys_exhausted` | — | 무료 키 RPD, 유료 키 우선 스위치 |
| OpenAI 할당량(`insufficient_quota` 등) | `openai_quota` | `openai_quota` | — | OpenAI 크레딧·프로젝트 한도 |
| 503·UNAVAILABLE | `unavailable` | `unavailable` | `unavailable` | 모델 혼잡 — 강등(2.5) 됐는지 `modelDowngraded` |
| 타임아웃(`TimeoutError`·`AbortError`·504·`DEADLINE_EXCEEDED`·OpenAI `code: timeout`) | `unavailable` | `timeout` | `timeout` | 무거운 미디어 턴인지, 함수 시간 상한 |
| 401·403(키 무효) | `auth` | `auth` | `auth` | 키 값·권한 |
| 400 | `generic` | `bad_request` | — | 요청 형식(모델 파라미터) |
| 안전 차단 | `safety` | `safety` | — | 의도된 동작 |
| 그 밖의 5xx | `generic` | `server` | `media_error`(멀티모달 500 재시도) | 공급자 상태 |
| 빈 응답 | `generic` / outcome `empty` | — | `empty` | `finishReason`(MAX_TOKENS·MALFORMED_FUNCTION_CALL) |
| URL 본문 못 가져옴 | — / outcome `url_fetch_failed` | — | — | `fetch-url` 차단·크기 |

화면 분류는 사용자에게 할 말(잠시 후·로그인·내일) 단위라 로그 코드보다 굵다 — 예: 타임아웃·503 은 화면에선 둘 다 `unavailable`, 로그에선 `timeout`·`unavailable` 로 갈린다.

## 4. 어긋남 — 11-10 고침

표를 처음 만들 때 같은 원인이 코드마다 다르게 남던 4곳(DEV_261110 §3):

1. 504·OpenAI 타임아웃이 로그에 `server` → **`timeout`**.
2. 타임아웃 오류가 화면에서 `generic`("응답 생성 중 문제") → **`unavailable`**("잠시 후 다시").
3. OpenAI 할당량이 로그에서 `rate_limit` 으로 합쳐짐 → **`openai_quota`**.
4. 안전 차단·키 전부 소진이 로그에 `other` → **`safety`**·**`keys_exhausted`**.

`errCodeOf` 는 메시지에서 고정 표지(`DEADLINE_EXCEEDED`·"No API key available"·"All API keys")가 있는지만 본다 — 문장은 값으로 나가지 않는다(하니스: 이메일·전화 섞인 메시지 → `other`).
11-10 이전 `[turn]` 로그와 비교할 때는 위 네 경우의 값이 바뀐 점을 감안한다.

## 5. HTTP 응답 오류(보조 라우트) — 코드 아님

`/api/speech`·`/api/parse-document`·`/api/proxy-image`·`/api/fetch-url`·`/api/sessions` 등은 `{ error: "Members only" }` 같은 **영어 문장**을 상태코드와 함께 돌려준다(코드 체계 없음). 클라이언트가 문장으로 분기하지 않는지 확인하고 바꿔야 한다 — 지금은 범위 밖.

## 6. 범위 밖이지만 같은 규칙 대상

- 날씨 조건 코드(`server/lib/weather/index.ts` — `highPop`·`currentRain`·`strongWind`…)는 에러가 아니라 카드 내용 코드다. camelCase 로 남아 있다.
