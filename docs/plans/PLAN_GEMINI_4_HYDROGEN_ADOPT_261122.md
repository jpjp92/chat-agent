# PLAN_GEMINI_4_HYDROGEN_ADOPT_261122 — Gemini 4 Hydrogen 추가 · 3.6 내리기

> 2026-11-22 작성. 상태: **기획 — [2.5 Flash 종료 대응](PLAN_GEMINI_25_SHUTDOWN_261122.md)(기한 12-01) 뒤로**. 코드 변경 없음. 작업은 dev 기준.
> 무료 티어(공식 가격 페이지 11-22): 3.8 Flash·Hydrogen 모두 무료 티어 사용 가능, **무료 검색 grounding 은 둘 다 불가**(3.6 과 같음). 무료 티어 분당·일일 한도는 문서에 없고 AI Studio 화면에서만 보인다 → T0 은 "문서상 가능", 실호출로 확인만.
> 이어받는 문서: [PLAN_GEMINI_4_HYDROGEN_261113](PLAN_GEMINI_4_HYDROGEN_261113.md)(가격·thinking·11-15 A/B — 그때는 도입 보류) · 선례 [PLAN_MODEL_3_8_MIGRATION_260906](PLAN_MODEL_3_8_MIGRATION_260906.md) · 비용 [PLAN_PRODUCTION_READINESS_261115](PLAN_PRODUCTION_READINESS_261115.md) A3·C4

## 0. 목표

- 선택 목록에 **Gemini 4 Hydrogen** 을 넣는다 — "더 깊이 생각하는" 선택지.
- **Gemini 3.6 Flash 를 선택 목록에서 내린다** — 같은 단가의 3.8 이 있어 Gemini Flash 가 둘일 이유가 없다.
- 3.6 은 **숨김(hiddenFallback)** 으로 내리고 서버 허용 목록에는 남긴다 — 저장된 선택값·내부 강등 경로가 깨지지 않게(11-13 이전 모델 3종과 같은 방식).

## 1. 왜 지금 — 11-15 의 "보류"에서 바뀐 것

| 11-15 보류 이유 | 11-22 |
|---|---|
| 품질 차이가 안 보였다(쉬운 10문항이 천장) | 최신성 질문(공식 정답표)에서 **Hydrogen 은 힌트 없이 현행 세대**(아이폰 18·S26·픽셀 11, 5/5), Flash 는 0/6 — 검색어를 새 세대 이름으로 만든다([PLAN_WEB_SEARCH_QUALITY_261122](PLAN_WEB_SEARCH_QUALITY_261122.md) §3 W2) |
| 지금 3.8 의 2배 | 2027-01-01 부터 단가 같음(입력 $1.50 / 출력 $7.50). Gemini 4 중 가장 싸다(12월부터 Argon·Carbon 의 1/3, Neon 의 1/2) |
| 끌 수 없는 thinking → 1월 뒤에도 약 2.6배 | **그대로다** — 선택 옵션이어야 하는 이유. 기본 모델로는 쓰지 않는다 |

## 2. 사실(코드 조사 11-22, 과금 없음)

**3.6 은 지금 기본 모델이다** — `server/models.ts` · `src/lib/models.ts` 의 `DEFAULT_CHAT_MODEL`, `state.ts` 의 `model` 기본값. 내리면 **기본 모델을 바꿔야 한다.**

| 축(`MODEL_CAPS`) | 3.6 | 3.8 | 기본을 3.8 로 바꾸면 |
|---|---|---|---|
| `fastLongInput`(무료티어 URL 등 긴 입력) | **true** | false(**측정 전 보수값**) | 🔴 URL 요약 턴이 2.5 로 강등된다(`generator.ts` `pinUrl`). 3.8 무료티어 실측으로 뒤집을 수 있는지 먼저 본다 |
| `fastMultimodal` | true | true | 같음 |
| `freeTierSearch` | false | false | 같음(무료 키 검색 턴은 2.5 로) |
| `groundingReliable` | true | true | 같음 |
| thinking 최저 | `minimal` | `low` | 3.8 은 첫 글자가 조금 늦다(11-15: 3.8 `low` TTFT p50 2.5s) |

**3.6 을 가리키는 곳** — `SERVER_MODELS.FLASH_3_6`·`ChatModelId`·`isChatModelId`·`MODEL_CAPS`·`isThreeXFlash`(server/models.ts), `THINKING_MODE`(model-thinking.ts), `CHAT_MODELS`·선택 목록·**`hiddenFallback` 2곳(3.5·2.5 → 3.6)**(src/lib/models.ts), `drug-info-tool.ts` 주석. 하니스 5종(`test-chat-models`·`test-key-tier`·`test-model-labels`·`test-retry-reasons`·`test-thinking-config`).

**Hydrogen 이미 아는 것**(11-13·11-15·11-22)
- 모델 ID `gemini-4-hydrogen`, 입력 1,048,576 / 출력 65,536, 유료 키 접근, 명시적 캐싱 없음.
- thinking: `low`·`medium`·`high`·`xhigh`, 기본 `high`, `minimal` 400. `thinkingBudget` 은 받지만 안 꺼진다, `low`+`thinkingBudget` 같이 주면 400 → **끌 방법 없음, 최저 `low`**.
- 검색 grounding·함수 호출 정상(스모크). 10문항 품질은 3.8 과 동률, TTFT +0.7s, 비용 약 5배(1월 뒤 2.6배).
- 최신성 검색 질문 54~60s(출처 26~29개 — 검색을 많이 한다).

**모르는 것** — 무료 키(게스트)로 호출되는지 · 무료티어 검색 · 이미지·PDF·URL fileData · 날씨·논문·약 도구 · 503 강등 경로 · 채팅 턴 지연 분포(검색 없는 턴/있는 턴).

## 3. 결정할 것

| # | 질문 | 제안 |
|---|---|---|
| D1 | 새 기본 모델 | **3.8 Flash** — 단가 같고 3.6 다음 세대. Hydrogen 은 기본으로 쓰지 않는다(thinking 비용·지연) |
| D2 | 3.8 `fastLongInput` | 무료티어 URL 요약 실측(§4 T1). 빠르면 true 로 뒤집어 기본 변경의 강등을 없앤다. 느리면 URL 턴만 2.5 핀을 받아들이거나 3.6 을 **내부 처리용으로 남긴다** |
| D3 | Hydrogen 라벨·설명 | `Gemini 4 Hydrogen` — "깊이 생각하는 모델 · 느리고 정확"(4개 언어, 짧게) |
| D4 | Hydrogen thinking 레벨 | `low`(최저, 기존 정책 "모델별 최저 레벨"과 같음). `medium` 은 측정에서 이득 없음 |
| D5 | 게스트(무료 키) | 무료 키로 안 되면 **회원 전용**(게스트 선택 시 3.8 로 바꿔 보내고 안내). 회원 한도(A3)와 같이 본다 |
| D6 | 최신성 | Hydrogen 은 힌트 없이 맞았다 — V3 힌트는 그대로 두되 Hydrogen 에서 회귀 없는지만 본다. V5(사전 조회)는 Flash 용 기획으로 남긴다 |
| D7 | 3.6 처리 | 선택 목록에서 숨김(`hiddenFallback: 3.8`), 3.5·2.5 의 `hiddenFallback` 도 3.8 로. 서버 허용 목록·`MODEL_CAPS`·thinking 표에는 남긴다 |

## 4. 테스트(유료 — 실행 전 호출 수·비용 확인)

| 단계 | 내용 | 호출 | 비용 |
|---|---|---|---|
| T0 | 무료 키로 Hydrogen 목록·1회 호출(게스트 가능 여부) | 2 | 0 |
| T1 | **3.8 무료티어 긴 입력**(URL 요약 3건 × 2) — `fastLongInput` 판정 | 6 | 0(무료) |
| T2 | Hydrogen 호환성(11-13 계획 2단계): 날씨·논문·약 도구 · 검색 근거 5 · 이미지·PDF | ~12 | ~$0.3 |
| T3 | 앱 경로 지연·비용 — 일반 5·검색 5 × 3.8/Hydrogen(`probe-chart-app-path` 방식) | ~20 | ~$0.3 |
| T4 | 최신성 E3 를 Hydrogen 으로(`probe-recency-app-path` MODELS=gemini-4-hydrogen) | 8 | ~$0.2 |

중단 조건: T0 에서 무료 키 불가 → D5 회원 전용으로 진행. T2 에서 도구·이미지 400 → 그 intent 는 3.8 로 강등 분기 후 진행. T3 에서 검색 턴 p50 이 30s 를 넘으면 라벨에 "느림"을 분명히 하고 회원 한도와 묶는다.

## 5. 손댈 곳(구현 단계)

- `server/model-thinking.ts` — Hydrogen `{ levels: ['low','medium','high','xhigh'], budget: false }`(budget 은 받지만 무효라 쓰지 않는다).
- `server/models.ts` — `SERVER_MODELS.HYDROGEN`, `ChatModelId`·`isChatModelId`, `MODEL_CAPS`(T0~T2 실측값), `DEFAULT_CHAT_MODEL` → 3.8, `isThreeXFlash` 는 계열 판정이라 Hydrogen 을 넣지 않되 503 강등·sampling 정책에서 Hydrogen 이 빠지지 않는지 확인.
- `src/lib/models.ts` — 옵션 추가(gemini 섹션), 3.6 숨김, `hiddenFallback` 3곳 → 3.8, `DEFAULT_CHAT_MODEL` → 3.8.
- `server/agent/nodes/generator.ts` — 강등 분기(무료 키·미디어·503)에서 Hydrogen 경로 확인. 게스트 회원 전용이면 선택 차단.
- 하니스 5종 갱신 + Hydrogen 라벨·기본 모델·숨김 fallback 검사.
- 문서: 모델 표가 있는 README·ARCHITECTURE.

## 6. 비용 메모

- 기본 3.6 → 3.8: **단가 같음**(지금 $0.75/$3.75, 1월부터 둘 다 2배). 3.8 은 `low` 최저라 thinking 토큰이 조금 더 붙을 수 있다(11-15 10문항에서는 0).
- Hydrogen 선택 턴: 출력 단가 같아도 thinking(문항당 260~390)이 붙어 1월 뒤 약 2.6배, 검색 많이 하는 질문은 더(최신성 질문 출력 ~2,000 + thinking).
- 검색 grounding 은 Gemini 3 이상 공용 월 5,000회 — Hydrogen 이 검색을 많이 하면(최신성 질문 출처 26~29개) 공용 한도를 빨리 쓴다. 회당 검색 요청 수를 T3 에서 본다.
