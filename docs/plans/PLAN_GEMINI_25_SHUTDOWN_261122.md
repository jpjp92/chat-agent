# PLAN_GEMINI_25_SHUTDOWN_261122 — gemini-2.5-flash 종료(12-01) 대응

> 2026-11-22 작성. 상태: **측정 완료(§6·§8·§8-1~§8-7) · 다음 = 도구 의도 실측(§10) · 경로 전수 §7 · 적용 계획 §9(11-24 결정) · 다음 = 구현 · 🔴 기한 2026-12-01**. 코드 변경 없음. 작업은 dev 기준.
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

## 7. 경로 전수 조사 (2026-11-23, 코드 변경 없음)

판정 원리: 12-01 부터 `gemini-2.5-flash` 이름 요청이 3.5 Flash-Lite 로 가지만 코드는 여전히 2.5 로 알고 설정을 만든다(`model-thinking.ts` 2.5 = budget, `isThreeXFlash` 밖) → `thinkingBudget: 0` 이면 400(§6-1), 3.5 FL 이 못 하는 일을 맡긴 곳은 실패.

### 7-1. 400 이 나는 곳(`thinkingBudget: 0`)

| # | 경로 | 위치 |
|---|---|---|
| A1 | 라우터(매 턴) | `nodes/router.ts:239` |
| A2 | LangChain 도구 경로(약국·병원·동물병원·영화·법령·날씨) | `nodes/langchain-path.ts:91·99` |
| A3 | 알약 각인 판독 | `drug-info-tool.ts:174·179` |
| A4 | 2.5 핀 생성(YouTube·URL 요약·이미지/영상) | `nodes/generation-config.ts:65` `resolveThinkingConfig` |
| A5 | 검색 강등·재시도 호출 | `nodes/generator.ts:439·474·585·635` |
| — | 제목 생성 2순위 | `app/api/summarize-title/route.ts:55`(1순위 2.5 FL 실패 때만) |

medical_qa 는 `thinkingBudget: 3000`(`generator.ts:439·474`) — 512 는 통과, 3000 미확인.

### 7-2. 2.5 로 내리던 폴백

| # | 폴백 | 위치 | 12-01 뒤 |
|---|---|---|---|
| B1 | 🔴 무료 키 검색 턴 강등(`SEARCH_FALLBACK_MODEL`) | `generator.ts:179·393·427` | 3.5 FL 무료 검색 불가 → 게스트 검색 턴 실패 |
| B2 | 🔴 약 검색(`DRUG_SEARCH_MODEL`) | `drug-info-tool.ts:36·65` | B1 과 같음 |
| B3 | 3.x 503·timeout·전 키 429 → 2.5 강등(`unavailableDowngrade`) | `generator.ts:732~` | 2.5 식 설정으로 3.5 FL 호출 → 400 |
| B4 | 무거운 미디어 timeout 1회 강등 | `generator.ts:704` | B3 과 같음 |
| B5 | MALFORMED 함수 호출 재시도 | `generator.ts:570~585` | budget 0 → 400 |
| B6 | tool_code 환각 재시도 | `generator.ts:621~635` | budget 0 → 400 |
| B7 | 업로드 URL fileData·URL 요약·YouTube 핀(`MODEL_CAPS` 2.5 행) | `generator.ts:144~162` | 3.x 임의 URL fileData 429 이력(DEV_260808) — 실측 필요 |
| B8 | GPT PDF 링크 실패 → 2.5 재시도 | `generator.ts:250~256` | B7 과 같음 |

### 7-3. 400 은 아니지만

- 법령 질의 해석(`law-tool.ts:140`)·약 이미지 판독(`nodes/vision.ts:82`) — temperature 만(무시). 향후 400 대비 정리.
- 라우터 키 — 게스트는 무료 로테이션(`router.ts:148`). 3.x 무료 티어 throughput 이력 → **라우터 유료 키 고정**.
- 서버 허용 목록에 2.5 가 남아 예전 클라이언트가 보내면 A4 경로.

### 7-4. 수정 방향

1. 역할별 모델 상수 — 라우터 3.5 FL(유료 키) · 도구·vision·핀·강등 3.5 FL(B7 은 T1 로) · **무료 키 검색 B1·B2 = 2.5 Flash-Lite**(T2 로, 안 되면 게스트 검색도 유료 키).
2. `model-thinking.ts` 에 3.5 FL 행(budget 불가 · 최저 `minimal`), 직접 `thinkingBudget` 쓰는 9곳을 공통 함수로.
3. `isThreeXFlash` 에 3.5 FL — sampling 제거.
4. 하니스 — 위 경로가 3.5 FL 에 `thinkingBudget` 을 보내지 않는지 정적 검사.

### 7-5. 진행 단계

T1·T2 측정 → 결과로 7-4 확정 → 구현(모델 상수 → thinking 공통 함수 → sampling → 하니스) → dev 배포·실화면(게스트 검색·도구 카드·YouTube·업로드) → 12-01 로그 감시.

## 8. T1·T2 결과 (2026-11-23, `tests/manual/probe-35-flash-lite-compat.mts`, 13회 · 각 1회 표본)

| 3.5 Flash-Lite · 유료 키 | 결과 |
|---|---|
| `thinkingBudget: 3000`(medical_qa) | ✓ 5.5s · 생각 토큰 633 — 받지만 느리다 |
| `minimal` + googleSearch | ✓ 1.5s · 출처 2 |
| `minimal` + 함수 호출 | ✓ 0.6s · functionCall 반환 |
| `minimal` + 인라인 이미지 | ✓ 1.5s |
| `minimal` + YouTube fileData | ✓ 1.8s |
| `minimal` + **임의 URL fileData(PDF)** | ✓ 1.2s — 3.x 의 429 이력과 달리 정상(작은 공개 PDF 1건, 업로드 영상은 미확인) |
| `temperature: 0` + JSON(법령) | ✓ 0.5s |
| `temperature/topP/topK` + `minimal` | ✓ 1.2s(무시) |
| `thinkingBudget: 0` | ✗ **400 재확인** |

| 무료 키 | 결과 |
|---|---|
| 3.5 FL + googleSearch | ✗ **429** RESOURCE_EXHAUSTED(무료 검색 불가 확인) |
| 3.5 FL 검색 없음 | ✗ 503 UNAVAILABLE 3.7s(표본 1 — 혼잡) |
| **2.5 Flash-Lite** + googleSearch, budget 0 | ✓ 2.3s · 출처 3 |
| **2.5 Flash-Lite** + googleSearch(약 검색형) | ✓ 3.6s · 출처 9 · 933자 |

**확정**
- 400 원인은 `thinkingBudget: 0` 하나 — `minimal` 로 바꾸면 도구·이미지·YouTube·URL fileData·JSON·검색 모두 통과.
- medical_qa 는 budget 3000 이 통하지만 5.5s — `minimal`(또는 `low`) 로 바꿀지 구현 때 품질 비교.
- **게스트 검색 강등(B1)·약 검색(B2) = 2.5 Flash-Lite** — 무료 검색 grounding 정상. 3.5 FL 무료 키는 검색 429.
- 3.5 FL 무료 키는 검색 없이도 503 이 났다 → 라우터·도구 경로 등 3.5 FL 호출은 **유료 키 우선**이 안전(무료 throughput 은 T2 확장으로 추가 확인).
- 남은 확인: 업로드 영상(Storage URL fileData)·LangChain 래퍼 경로(T4) — 구현 후 dev 실화면에서.

### 8-1. 역할별 2.5 Flash(현행 설정) vs 3.5 FL(`minimal`) — 유료 키 (2026-11-23, `probe-25-vs-35fl-roles.mts`, 48회 · 역할당 3회)

| 역할 | 2.5 Flash 성공 · 지연 중앙 · 길이 | 3.5 FL 성공 · 지연 중앙 · 길이 |
|---|---|---|
| 일반 생성(2.5 기본 thinking) | 3/3 · 9.8s · 1114자(생각 1159토큰) | 3/3 · **1.9s** · 606자 |
| 의학(budget 3000 ↔ minimal) | 3/3 · 12.0s · 1822자 | 3/3 · **3.5s** · 1408자 |
| 검색 grounding | 3/3 · 4.2s · 492자 · 출처 4 | 3/3 · **1.9s** · 161자 · **출처 2** |
| 함수 호출 | 3/3 · 0.8s | 3/3 · 0.8s |
| 이미지 판독 | 3/3 · 3.3s | 3/3 · 2.1s |
| YouTube fileData | 3/3 · 3.7s | 3/3 · 2.0s |
| URL fileData(PDF) | 3/3 · 3.9s | 3/3 · 1.7s |
| JSON(법령 해석) | 3/3 · 1.4s | 3/3 · 0.8s |

- 실패 0 — 3.5 FL 은 모든 역할에서 같거나 빠르다(생각 토큰 0 이라 같은 단가에 비용도 낮다).
- **답이 짧다** — 일반 ~55% · 의학 ~77% · 검색 ~33%(출처 4 → 2). 길이는 품질이 아니지만, 검색 강등(B3·B5·B6)·의학 경로는 답변 품질 비교(judge 또는 사람)가 필요하다. 도구·vision·미디어 핀·JSON 은 바로 교체 가능.

### 8-2. 답변 품질 — 2.5 Flash(현행 설정) vs 3.5 FL, 유료 키 (2026-11-24, `probe-25-vs-35fl-quality.mts`)

운영 시스템 프롬프트 + 같은 질문 18개(일반·의학·검색 각 6), gpt-6-luna 블라인드 채점(A/B 무작위, 10점). 생성 36 + 채점 18, 의학 추가 2팔 36.
(첫 실행은 채점 요청이 400 — json_object 는 입력에 "json" 단어가 필요 — 인데 빈 객체를 승패로 읽어 무효. 고쳐 다시 돌렸다.)

| 종류 | 평균 2.5 / 3.5 FL | 승(2.5 : 3.5 FL : 무) | 지연 중앙 |
|---|---|---|---|
| 일반(3.5 FL `minimal`) | 8.2 / 7.8 | 3 : 1 : 2 | 8.1s / **2.5s** |
| 의학(`minimal`) | **8.0 / 6.8** | 6 : 0 : 0 | 3.6s / 2.6s |
| 의학(**`low`**) | 7.5 / **7.2** | 4 : 2 : 0 | 3.3s / **2.1s** |
| 의학(`medium`) | 7.8 / 6.7 | 4 : 1 : 1 | 3.8s / 4.1s |
| 검색(`minimal`) | 3.0 / 2.7 | 4 : 2 : 0 | 5.4s / 3.1s · 출처 합 43 / 20 |

- 일반은 거의 동등(답이 짧고 3배 빠르다). 의학은 `minimal` 로는 밀리고 **`low` 면 근접** — `medium` 은 이득 없이 느리다.
- 3.5 FL 이 세 설정 모두 약했던 문항: "아이 열 39도 · 해열제 먹여도 안 내려가"(5·5·4) — 소아 고열 안전 안내.
- 검색 채점은 두 모델 모두 1~4점 — 채점 모델이 2026 최신 사실을 확인하지 못해 감점한 것으로 보여 **판단 불가**. 출처 수는 3.5 FL 이 절반.

## 9. 적용 계획 (2026-11-24 — 게스트도 유료 키, 범위 A)

> 11-24 정정: medical_qa `low` → `medium` (§8-4·§8-5). 나머지는 `minimal` 유지 — 일반 `medium` 은 이득 없음(§8-5).

**결정** — 2.5 Flash 가 맡던 호출은 회원·게스트 구분 없이 **유료 키 우선**(무료 키는 유료 429 때 보조). 게스트 본 답변(3.6·3.8)은 지금처럼 무료 키(범위 B 는 게스트 한도 A3 와 함께 결정).

| 역할 | 모델 · 생각 수준 |
|---|---|
| 라우터·도구 경로·vision·YouTube/URL/업로드 핀·법령 JSON·제목 폴백 | 3.5 FL · `minimal` |
| 검색 강등(게스트 검색 턴)·약 검색 | 3.5 FL(유료 검색) · `minimal` — 무료 키 2.5 Flash-Lite 우회 불필요 |
| 503·timeout 강등 · MALFORMED · tool_code 재시도 | 3.5 FL · `minimal`, **medical_qa 는 `medium`** |
| medical_qa 가 2.5 로 가던 곳(budget 3000) | 3.5 FL · **`medium`** (11-24 §8-4 정정 — `low` 는 이 경로에서 생각 토큰 0) |

구현 순서: ① `SERVER_MODELS` 에 3.5 FL, 2.5 Flash 역할 상수 교체 ② `model-thinking.ts` 3.5 FL 행(`minimal`·`low`·…, budget 불가) · 3.5 Flash 행 실제(3.6 라우팅) 반영 ③ 직접 `thinkingBudget`·sampling 쓰는 곳을 `resolveThinkingConfig` 계열로 ④ 유료 키 우선 선택 함수(역할 호출 전용) ⑤ 하니스: 3.5 FL 호출에 `thinkingBudget`·sampling 없음, 역할 상수가 2.5 Flash 를 가리키지 않음 ⑥ verify·knip·build·typecheck 각각 ⑦ dev 배포·실화면(게스트 검색·도구 카드·YouTube·업로드·알약).

### 8-3. 폴백 3자 비교 — 2.5 · 3.5 FL · 3.6 `minimal` (2026-11-24, `probe-fallback-3way.mts`, 48회)

세 답을 무작위 순서로 한 번에 블라인드 채점(gpt-6-luna). 3.5 FL 은 §9 설정(일반 `minimal`·의학 `low`). 일반 1문항은 2.5 가 500 으로 제외.

| 종류 | 2.5 Flash | 3.5 FL | 3.6 `minimal` |
|---|---|---|---|
| 일반(5) | 8.4 · 7.0s | **8.6** · **2.5s** | 7.8 · 3.9s |
| 의학(6) | **7.7** · 3.2s | 6.8 · **1.8s** | 6.5 · 4.4s |

- **3.6 `minimal` 은 3.5 FL 보다 낫지 않다** — 일반·의학 모두 낮고 느리며 단가는 2.5배(1월부터 5배). 품질용 폴백으로 3.6 을 쓸 이유가 없다 → §9 그대로 3.5 FL.
- 의학은 2.5 가 앞선다(+0.9). 3.x 둘 다 "아이 열 39도·해열제 안 들음"이 가장 낮다(3.5 FL 5 · 3.6 3, 2.5 7) — 모델보다 소아 고열 안내(프롬프트) 쪽 과제로 본다(별건).
- 3.5 FL 의학 `low` 는 §8-2 7.2 → 이번 6.8 — 6문항 표본이라 실행 간 흔들림 ±0.4 수준.

### 8-4. 의학 재측정 — 운영 medical_qa 경로 (2026-11-24, `probe-medical-35fl.mts`, 30회)

§8-2·§8-3 의학 비교는 **검색·medical_qa 지침 없이** 돌아 운영을 재현하지 못했다(운영은 검색 강제 ON, `search-gate.ts` tier 100 + `INTENT_POLICIES.medical_qa`). 이번엔 같은 6문항을 운영 조건으로, 항목별 점수·감점 사유를 받았다.

| | 2.5 (budget 3000) | 3.5 FL `low` | 3.5 FL `medium` |
|---|---|---|---|
| 종합 | 6.2 | 6.0 | **6.3** |
| 응급·진료 신호 | 5.5–6.2 | **4.5** | 5.5 |
| 근거 | 3.7–4.0 | 3.7 | 4.2 |
| 출처 / 검색어 | 12.2 / 3~5 | 6.7 / 1~2 | 5.8 / 1 |
| 생각 토큰 | 258 | **0** | 967 |

- 검색에 근거하면 차이가 사라진다 — 이전 격차는 Lite 의 기억 지식량 차이(측정 조건 탓)였다.
- **`low` 는 이 경로에서 생각하지 않는다**(6/6 생각 토큰 0) → 사실상 `minimal`. 의학은 `medium`.
- 두 모델 공통 감점: 응급 신호 누락(디스크 대소변 장애·식도염 삼킴 곤란/출혈·편두통 72시간), **아이 고열에 해열제 교차 복용 권고**(투약 오류), 불면증 CBT-I 누락 → 의학 지침에 "응급·진료 기준" 섹션·투약 안전 규칙 보강(별건). 근거 점수는 채점자가 본문만 봐서 낮다(앱은 출처 칩 별도).

### 8-5. 첫 글자 시간(TTFT)·비용 (2026-11-24, `probe-35fl-ttft.mts`, 36회, 스트리밍)

| | 첫 글자 평균 | 전체 평균 | 생각 | 토큰비/1천회 | 품질 |
|---|---|---|---|---|---|
| 의학 2.5 | 3.7s | 13.2s | 152 | $3.89 | — |
| 의학 3.5 FL `low` | 2.1s | 4.3s | 0 | $3.09 | — |
| 의학 3.5 FL `medium` | 4.5s | 6.1s | 919 | $5.24 | — |
| 일반 3.5 FL `minimal` | **0.8s** | 2.1s | 0 | $2.32 | 8.3 |
| 일반 3.5 FL `medium` | 2.5s | 3.6s | 556 | $3.77 | 8.3 |

- 단가는 두 모델 같다(입력 $0.30 · 출력+생각 $2.50 /1M). 검색 과금은 2.5 = 1,500 RPD 무료 뒤 $35/1천 요청, 3.x = 월 5,000 무료(3.x 공유) 뒤 **$14/1천 검색어** — 3.5 FL `medium` 은 요청당 1.3개라 한도 뒤 2.5 의 절반 수준.
- **일반은 `medium` 이득 없음**(같은 점수, 첫 글자 3배, 비용 +62%) → `minimal` 유지. 전체 `medium` 안 함.

### 8-6. 최종 구성 vs 2.5 (2026-11-24, `probe-final-vs-25.mts`, 48회, 스트리밍)

3.5 FL = medical_qa `medium` · 그 외 `minimal`. 2.5 = 운영 설정(일반 모델 기본 · 의학 3000 · 검색 0).

| | 일반 | 의학 | 검색 |
|---|---|---|---|
| 첫 글자 평균 | 3.0 → **1.0s** | 4.4 → 5.1s | 2.3 → **1.7s** |
| 전체 평균 | 6.8 → **2.5s** | 10.9 → **6.5s** | 5.7 → **2.4s** |
| 토큰비/1천회 | $4.53 → $2.48 | $4.46 → $5.58 | $2.52 → $1.96 |
| 품질 | **8.8 → 7.5 (2.5 6승)** | 6.7 → 6.8 (3:3) | 채점 안 함 |

- 의학 동률 — 문항별로 응급 신호 누락 여부가 승패를 가른다(고열 3/7, 디스크 8/5).
- 일반은 측정마다 방향이 바뀐다(§8-2 7.8/8.2 · §8-3 8.4/8.6 · 이번 8.8/7.5) — 6문항 1회로는 판단 불가. 이번엔 출력 876 대 488 토큰(답 길이)이 의심 → 일반 20문항 × 2회 확대 측정.

### 8-7. 일반 확대 — 20문항 × 2회 (2026-11-24, `probe-general-35fl.mts`, 120회)

2.5 = 운영 기본(모델 기본 thinking · sampling) · 3.5 FL = `minimal`. 블라인드 채점(gpt-6-luna, "길이로 가점 금지"). 1회차는 2회차 도중 네트워크 ETIMEDOUT 으로 중단돼 출력 로그로 집계, 2회차는 다시 돌림(호출 실패가 전체를 멈추지 않게 고침).

| | 2.5 | 3.5 FL `minimal` |
|---|---|---|
| 1회차 / 2회차 평균 | 7.75 / 8.05 | 8.05 / 8.00 |
| **40건 평균** | 7.90 | **8.03** |
| 승 | 17 | **20** (무 3) |
| 길이 · 지연(2회차) | 1546자 · 7.1s | 772자 · **2.5s** |

- **동등** — §8-6 의 8.8/7.5 는 6문항 표본 흔들림. 문항별 승패도 회차마다 바뀐다.
- 길이 편향 없음 — 승부 난 18건(2회차) 중 긴 답 승 44%.
- 2.5 반복 루프 1건("월급 300만원 예산" 19만 자 · 35s · 3점). 빼도 2.5 평균 8.0.
- → **§9 구성 확정**: medical_qa `medium` · 그 외 `minimal`.

## 10. 도구 의도 실측 계획 (2026-11-24 작성, 미실행)

§8-1~§8-7 은 일반·의학·검색만 품질을 봤다. **도구 의도 11개는 선택 모델과 무관하게 답변 생성 전체가 2.5 Flash**다([langchain-path.ts](../../server/agent/nodes/langchain-path.ts) `pathModel = isToolIntent ? SERVER_MODELS.FLASH`). 12-01 부터 이 11개 답을 전부 3.5 FL 이 쓴다. 지금까지 확인은 함수 호출 1문항(약국 3/3)뿐.

| 묶음 | 의도 | 2.5 설정(현행) |
|---|---|---|
| FAST_PASS(카드 + 짧은 안내) | pharmacy_search · hospital_search · vet_search · movie_search · law_search · weather | sampling + `thinkingBudget: 0` |
| SYNTH_TOOL(도구 결과로 산문·카드 합성) | drug_id · drug_info · law_qa · paper_search · arxiv_search | sampling, thinking 기본 |

**구현 전 발견** — `isThreeXFlash`(server/models.ts) 는 3.5/3.6/3.7/3.8 Flash **정확 일치**라 `gemini-3.5-flash-lite` 를 3.x 로 보지 않는다. 상수만 바꾸면 이 경로가 `thinkingBudget: 0` + sampling 을 보내 **400**. 3.x 분기(`thinkingLevel: LOW`)를 타게 하거나 `resolveThinkingConfig` 계열로 묶어야 한다(§9 ③).

**방법** — 운영 LangChain 경로·실제 도구 그대로, 모델만 2.5 vs 3.5 FL 로 바꿔 같은 질문을 보낸다(유료 키 TIER1).
- 3.5 FL 생각 수준: FAST_PASS `minimal` · SYNTH_TOOL `minimal` 과 `low` 둘 다(§8-4 처럼 `low` 가 생각 0 인지도 확인)
- 문항: 의도당 2~3 → 약 30문항, 합성 문장만(실제 상호·개인정보 없음). drug_id 는 합성 알약 설명 텍스트만(사진 없음)
- 판정
  1. **도구 정확성(자동)** — 맞는 도구 호출 여부 · 인자(law_qa 법령명·조문, drug_info `query_kind`, 지역명) · 도구 미호출(기억으로 답함) 건수
  2. **형식(자동)** — 카드 JSON 파싱(json:drug 등) · 도구 출력 그대로 가야 하는 의도(law_search 등)의 변형 여부
  3. **답 품질(블라인드)** — SYNTH_TOOL 만 gpt-6-luna 채점(도구 결과를 근거로 정확·완결한가)
  4. 지연(첫 글자·전체) · 오류 코드
- 외부 공공 API(약국·병원·식약처·법령·영화·논문) 문항당 1~2회 — 무료지만 일일 한도 있는 곳 주의, 두 모델이 같은 결과를 보게 도구 응답은 1회 받아 캐시해 재사용.
- 호출: 모델 약 60~90 + 채점 약 15~30 ≈ **$0.3~0.5**

**판단 기준** — 도구·형식 오류가 2.5 보다 늘지 않고, SYNTH_TOOL 품질이 2.5 와 ±0.5 안이면 §9 그대로. 아니면 의도별로 생각 수준을 올리거나 해당 의도만 선택 모델(3.6·3.8)로 보내는 안을 비교.
