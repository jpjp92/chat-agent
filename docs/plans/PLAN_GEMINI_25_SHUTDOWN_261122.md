# PLAN_GEMINI_25_SHUTDOWN_261122 — gemini-2.5-flash 종료(12-01) 대응

> 2026-11-22 작성. 상태: **T3(라우터 후보) 측정 완료 §6 · 🔴 기한 2026-12-01**. 코드 변경 없음. 작업은 dev 기준.
> 근거(공식, 11-22 확인): [Deprecations — Gemini 2.5 Flash models](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models) · [Migrate to gemini-3.5-flash-lite](https://aistudio.google.com/docs/whats-new-gemini-3.6#migrate-to-gemini-3-5-flash-lite) · [Pricing](https://aistudio.google.com/docs/pricing)
> 관련: [PLAN_GEMINI_4_HYDROGEN_ADOPT_261122](PLAN_GEMINI_4_HYDROGEN_ADOPT_261122.md)(기본 모델 3.6 → 3.8 — 같은 파일을 만진다)

## 0. 공지(원문 요지)

- "`gemini-2.5-flash` is deprecated … **Effective December 1, 2026, all API requests to `gemini-2.5-flash` will automatically route to `gemini-3.5-flash-lite`** and be billed at Gemini 3.5 Flash-Lite rates. **Review the breaking API changes** in the Gemini 3.5 Flash-Lite migration guide before December 1, 2026."
- "`gemini-2.5-flash-lite` is not deprecated and remains available through the API until further notice."
- 종료일은 "가장 이른 날짜"이고 정확한 날은 미리 알린다고 적혀 있다 — 12-01 로 잡고 움직인다.

## 1. 무엇이 바뀌나

| | 2.5 Flash(지금) | 3.5 Flash-Lite(12-01~) | 2.5 Flash-Lite(유지) |
|---|---|---|---|
| 유료 단가(입/출, 100만) | $0.30 / $2.50 | $0.30 / $2.50 — 같음 | $0.10 / $0.40 |
| **무료 티어 검색 grounding** | 무료 · 하루 500회(요약 기준) | **❌ 불가** | 무료 · 하루 500회(2.5 Flash 와 공유, 요약 기준) |
| 유료 검색 | 하루 1,500 무료 뒤 $35/1,000 | Gemini 3+ 공용 월 5,000 무료 뒤 $14/1,000 | 2.5 Flash 와 같음 |
| thinking | `thinkingBudget`(0 = 끔) | `thinking_level`, 기본 `minimal` — **`thinkingBudget` 수용 여부 문서에 없음** | `thinkingBudget`, 기본 Off |
| sampling | `temperature`·`topP`·`topK` | "**deprecated and ignored** … future generations return HTTP 400 — remove" | 그대로 |
| 기타(가이드) | — | 마지막 non-empty 턴이 `model` 이면 400 · `candidate_count` 미지원 · 함수 호출 점검(thought signature) | — |

## 2. 우리 코드에서 2.5 Flash 가 맡은 역할(11-22 전수, `SERVER_MODELS.FLASH`)

| # | 역할 | 위치 | 12-01 위험 |
|---|---|---|---|
| R1 | **라우터**(매 턴 의도·검색 판정) | `server/models.ts` `ROUTER_MODEL`, `nodes/router.ts:232` | 모델이 조용히 바뀐다 — Flash-Lite 계열의 카드 어휘 고정 오분류 이력(주석), 11-22 검색 판정 18/18 재검증 필요 |
| R2 | **무료 키 검색 턴 강등**(`SEARCH_FALLBACK_MODEL`) | `nodes/generator.ts:179` | 🔴 3.5 Flash-Lite 는 무료 검색 불가 → 게스트 검색 턴 429 또는 무검색 답 |
| R3 | **약 검색**(무료티어 검색이 되는 모델로 고정) | `drug-info-tool.ts:36·174` | 🔴 R2 와 같음 + `thinkingBudget: 0`·`temperature: 0` |
| R4 | YouTube 영상·URL 요약·업로드 fileData·OpenAI 미지원 미디어 **핀** | `generator.ts:161` | `thinkingBudget: 0`(YouTube — 2.5 에서 >0 이면 503 이라 끈 것) · 임의 URL fileData 를 3.5 가 받는지 미확인(3.x 는 429 이력) |
| R5 | OpenAI PDF 실패 재시도 | `generator.ts:255` | R4 와 같음 |
| R6 | **LangChain 도구 경로 전부**(약국·병원·동물병원·영화·법·날씨·약·논문) | `nodes/langchain-path.ts:91·99` | `temperature/topP/topK` + `thinkingBudget: 0`, 함수 호출(thought signature) |
| R7 | 법령 질의 해석 | `law-tool.ts:140·180` | `temperature: 0` + JSON 응답 |
| R8 | 알약 식별(vision) | `nodes/vision.ts:82` | `temperature: 0.1`, 이미지 입력 |
| R9 | 대화 제목 생성 폴백(`SUMMARY_MODELS` 2번째) | `app/api/summarize-title/route.ts` | 낮음 — 1번째가 2.5 Flash-Lite |
| R10 | 선택 목록의 숨김 모델·서버 허용 목록 | `src/lib/models.ts`·`server/models.ts` | 저장값이 2.5 인 사용자 → hiddenFallback |

**가장 큰 위험 — `thinkingBudget`.** → **11-22 확인: `thinkingBudget: 0` 은 400, `512` 는 정상, `temperature: 0` 은 무시만(§6-1).** 2.5 경로 대부분이 `thinkingBudget` 을 보낸다(0·3000). 같은 세대 3.6 은 budget 을 **거부**한다(`model-thinking.ts`). 3.5 Flash-Lite 도 거부하면 12-01 에 R3·R4·R5·R6 이 **전부 400** — 키 로테이션을 타고 실패한다. **이걸 먼저 잰다(T1).**

## 3. 테스트(12-01 전, 3.5 Flash-Lite 를 직접 불러 재현)

| 단계 | 내용 | 호출 | 비용 |
|---|---|---|---|
| **T1 호환성 스모크** | `gemini-3.5-flash-lite` 에 지금 우리가 2.5 로 보내는 설정 그대로 — `thinkingBudget: 0`·`3000`, `temperature/topP/topK`, `thinkingLevel: minimal`, 함수 호출 1, JSON 응답 1, 이미지 1, YouTube 1, 임의 URL fileData 1 | ~12 | <$0.05 |
| **T2 무료 키 검색** | 무료 키로 3.5 Flash-Lite + googleSearch → 429 인지 무검색 답인지 · 같은 질문 2.5 Flash-Lite 무료 검색 | 4 | 0 |
| **T3 라우터 후보 골든** | 기존 골든셋(178 · 30 · 12)과 11-22 검색 판정 18 — 3.5 Flash-Lite vs 2.5 Flash-Lite vs (참고) 3.8 Flash | 후보당 ~240 | 후보당 ~$0.1 |
| T4 도구 경로 앱 실측 | 약국·날씨·영화·약·법 각 2턴을 3.5 Flash-Lite 로(R6) | ~10 | ~$0.05 |

## 4. 대응안(테스트 결과로 고른다)

1. **모델을 명시적으로 바꾼다** — 12-01 자동 전환에 맡기지 않는다. `SERVER_MODELS.FLASH` 의 역할을 쪼갠다:
   - 라우터(R1): T3 로 고른 모델.
   - **무료 키 검색(R2·R3): `gemini-2.5-flash-lite`** — 무료 검색이 남고 폐기 예정 아님(단, 하루 500회 공유 — 원문 확인). 품질은 T2·T3 에서 본다. 안 되면 게스트 검색 턴을 유료 키로(회원 한도 A3 와 같이 결정).
   - 미디어 핀·도구 경로(R4~R8): 3.5 Flash-Lite 또는 3.8 Flash — T1 결과로.
2. **설정 정리** — 3.x 로 가는 호출에서 `temperature/topP/topK`·`thinkingBudget` 을 빼고 `thinkingLevel` 로(이미 `is3xModel` 분기가 일부 있다, `generator.ts:506`). `model-thinking.ts` 에 3.5 Flash-Lite 행 추가(T1 실측값).
3. **로그** — `[turn]` 에 실제 쓰인 모델이 이미 있다. 12-01 전후 비교용으로 R2(무료 검색 강등) 발생 수를 볼 수 있게.

## 5. 일정

| 날짜 | 할 일 |
|---|---|
| 11-23~24 | T1·T2(싸다, 가장 큰 위험) → 결과로 대응안 확정 |
| 11-25~27 | T3·T4, 구현(모델 상수 분리·설정 정리), 하니스 |
| 11-28~30 | dev 배포·실화면 확인(게스트 검색·YouTube·도구 카드) |
| 12-01 | 전환일 — 로그로 400·429 감시 |

Hydrogen 도입(3.6 → 3.8 기본 변경)은 같은 파일을 만지므로 **이 작업 뒤로** 미룬다.

## 6. 측정 결과 (2026-11-22~23)

### 6-1. 400 원인 분리 (curl 3회)

| 3.5 Flash-Lite 에 보낸 설정 | 결과 |
|---|---|
| `temperature: 0` + JSON | 정상(무시) |
| **`thinkingConfig: { thinkingBudget: 0 }`** + JSON | **HTTP 400** "Request contains an invalid argument" |
| `thinkingBudget: 512` | 정상 |

→ 3.5 Flash-Lite 는 **생각을 끌 수 없다.** 12-01 에 `thinkingBudget: 0` 을 보내는 경로가 전부 400: 라우터(`router.ts`), LangChain 도구 경로(`langchain-path.ts:99`), 약 검색(`drug-info-tool.ts:179`), 미디어·일반 생성의 2.5 경로(`generation-config.ts`, `generator.ts:439·474`). 의학 경로(`3000`)는 정상으로 예상(T1 에서 확인).

### 6-2. T3 라우터 후보 — `tests/manual/probe-router-shutdown.mts`

운영 `routerNode` 를 그대로 부르고 `fetch` 에서 모델·본문만 바꾼다. 골든 v1(89) + `SEARCH_GRAY`(15) × 2라운드 = 팔당 208회, 유료 키, 로컬 WSL 측정.

| 팔 | 의도 | 검색 최종 | p50 / p90 / 최대 | 오류 | 라우터 1만 턴(입력 ~3.3k) |
|---|---|---|---|---|---|
| A 2.5 Flash(현행) | 178/178 | 30/30 | 1044 / 1255 ms | 0 | ~$10 |
| B 3.5 Flash-Lite 본문 그대로(**12-01 재현**) | 114/178 | 14/30 | — | **400 전부** → 규칙 폴백 | — |
| **C 3.5 Flash-Lite 정리**(sampling 제거 · `thinkingLevel: MINIMAL`) | 177/178 | 27/30 | **970 / 1213 ms** | 0 | ~$10 |
| D gpt-6-luna `reasoning: none` | 178/178 | 30/30 | 1906 / 2423 / 4802 ms | 0 | ~$3.5 |
| E gpt-5.6-luna `reasoning: none` | 177/178 | 28/30(모델 30/30) | 1759 / 2054 / 3577 ms | 0 | ~$7 |

- C 오답: "고양이 토함" → medical_qa, "조선 건국" 검색 on 외 검색 2.
- E 의 검색 오답 "스트레스 해소 방법 추천" 은 모델은 off, 뒤 규칙이 on.
- D·E 는 정확도는 같거나 높지만 **매 턴 +0.8~0.9s**(공급자 왕복으로 보임). 라우터는 첫 글자보다 먼저라 체감 지연에 그대로 더해진다.
- D·E 의 "LLM 아닌 판정" 10건 — A·C 와 같은 규칙 지름길인지 미확인.

### 6-3. Decisions(GA) 재측정 — `tests/manual/probe-decisions-guide.mts`

공식 가이드(관찰 가능한 기준 · 관심사마다 질문 하나)대로 검색 판정을 predicate 4개(`current_info`·`asks_sources`·`recent_product`·`timeless`)로 나눴다. 조합 규칙은 실행 전 고정. 상세·이력은 [PLAN_DECISION_ROUTER_261019 §20](PLAN_DECISION_ROUTER_261019.md).

| Decisions 팔 | 의도 | 오답 중 확신 <0.7 | gray 15 | 검증 16(원판정) | p50 |
|---|---|---|---|---|---|
| 10-19 문구 | 166/178 | 12/12 | 16/30 | 16/32 | 257 ms |
| 가이드 + 메시지 배열 | 166/178 | 6/12 | 30/30 | 32/32 | 265 ms |
| **F 가이드 + 문자열 입력** | 166/178 | **12/12** | **30/30** | **32/32** | 262 ms |

### 6-4. 판단(제안)

- **12-01 전: 라우터 = C.** 비용·속도 현행 수준, 구조 변경 없음. 모든 사용자(게스트 포함) 라우터 호출을 유료 키로.
- 백업(3.5 Flash-Lite 400·503): D(gpt-6-luna) — E 보다 싸고 정확도 같거나 높다. 규칙 폴백(64%)까지 떨어지지 않게.
- **그 뒤: F 하이브리드**(Decisions 1회 ~0.26s, 의도 확신 <0.7 만 C) — 넘기는 비율·처리방침(매 턴 OpenAI 전송)·운영 shadow 가 먼저. 의도 정확도 개선은 PLAN_DECISION_ROUTER §20 다음.
- 별건: "영어 **현재**완료 시제 설명해줘" 를 키워드 규칙(`classifySearchNeed`)이 on 으로 — 모델은 off 로 맞혔다. 운영에도 있는 규칙 오판정.
