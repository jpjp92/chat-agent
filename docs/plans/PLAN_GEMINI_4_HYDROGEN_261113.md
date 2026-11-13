# PLAN_GEMINI_4_HYDROGEN_261113 — Gemini 4 Hydrogen A/B 검토

> 2026-11-13 작성. 상태: **계획만** — 유료 호출은 아직 없다(모델 목록 조회·공식 문서 확인까지).
> 원칙: 운영 라우터·Generator·모델 선택 UI·키 로테이션은 건드리지 않는다. `tests/manual/` 독립 프로브, 합성 질문만. 모델 추가는 A/B 결과를 본 뒤 결정.
> 실행 전 호출 수·비용을 말하고 승인받는다. 유료 키(`API_KEY_TIER1`)로 한다.

## 1. 확인한 사실(11-13, 과금 없음)

**접근** — 모델 목록 API(`GET /v1beta/models`)로 확인.

| 모델 ID | 입력 한도 | 출력 한도 | 비고 |
|---|---|---|---|
| `gemini-4-hydrogen` | 1,048,576 | 65,536 | 유료 키로 접근됨. 3.8 Flash 와 같은 한도 |
| `gemini-4-argon` · `gemini-4-carbon` | 1,048,576 | 32,768 | — |
| `gemini-3.8-flash`(비교 기준) | 1,048,576 | 65,536 | `createCachedContent` 있음 — Gemini 4 세 모델은 목록에 없다(우리는 명시적 캐싱을 안 써 영향 없음) |

**할당량** — AI Studio `Gemini-Model-Test` 프로젝트 Tier 2(사용자 화면): Hydrogen RPM 2,000 · TPM 3M · RPD 100K, 3.6·3.8 Flash 와 같다. 한도는 키가 아니라 **프로젝트 단위**이고, 무료 제공량이 아니다.

**가격** — 공식 가격 페이지, 유료 등급, 100만 토큰당(USD).

| 모델 | 입력 | 출력(thinking 포함) |
|---|---|---|
| Gemini 4 Hydrogen | 1.50 | 7.50 |
| Gemini 3.8 · 3.6 Flash | 0.75(12-31 까지) → **1.50(2027-01-01~)** | 3.75 → **7.50** |
| Gemini 4 Argon · Carbon | 2.00(11-30 까지) → 4.00 | 10.00 → 20.00 |

**thinking** — 공식 문서.
- Hydrogen: `low`·`medium`·`high`·`xhigh`, **기본 `high`**. `minimal` 미지원.
- thinking 을 끌 수 있는지·`thinkingBudget` 수용 여부는 문서에 없다 → 프로브로 확인.

**검색 grounding** — Gemini 3 이상 모델이 **함께 쓰는** 무료 월 5,000회, 넘으면 1,000회당 $14, 일일 상한 1,500회. 무료 등급에는 없다.

## 2. 판단에 영향을 주는 점

1. **가격 차이는 기한이 있다.** 지금 Hydrogen 은 3.8 Flash 의 2배지만, 3.8·3.6 이 2027-01-01 에 같은 값으로 오른다. 그 뒤에는 "같은 가격의 상위 모델". 🔴 별건으로, **기본 모델(3.6)의 비용이 1월에 2배**가 된다 — Hydrogen 과 무관하게 비용 계획에 반영.
2. **기본 thinking 이 `high`.** 설정 없이 부르면 첫 토큰이 늦고 thinking 토큰이 과금된다. 넣는다면 [model-thinking.ts](../../server/model-thinking.ts) 표에 등록해 `low` 를 명시해야 한다(미등록 모델은 budget 경로로 가서 틀린 값이 조용히 적용된다).
3. **검색 테스트는 공용 월 한도를 깎는다** — 호출 수를 작게.
4. 화면의 한도는 처리량 보장이 아니다(공식 문서) — 실제 지연·오류율은 측정으로 본다.

## 3. 테스트 계획(유료 — 실행 전 승인)

기존 자산을 재사용한다: `tests/manual/probe-gemini-38.mts`(모델명을 인자로 받는다), `tests/manual/gemini-3-8/`(비교·시나리오 스크립트).

| 단계 | 내용 | 호출 수 | 예상 비용 |
|---|---|---|---|
| 0. 스모크 | thinking 레벨 5종(`minimal` 거부 확인 포함)·`thinkingBudget` 수용·검색 1·함수 호출 1 | 약 9(검색 1) | $0.05 미만 |
| 1. A/B | 한국어 질문 10개 × 3구성(3.8 `low` · Hydrogen `low` · Hydrogen `medium`). TTFT·전체 시간·입력/출력/thinking 토큰·추정 비용 | 30 | $0.5 안팎, 최대 $1 |
| 2. 호환성 | 날씨·논문·약 도구 호출 · 검색 근거 5 · 이미지·PDF 입력 | 약 12(검색 5) | $0.3 미만 |

- 비용 가정: 호출당 입력 1천·출력+thinking 2~3천 토큰. `medium` 에서 thinking 이 길면 늘어난다.
- 검색은 합쳐 6회 — 월 5,000회에 영향 없음.
- **중단 조건**: 0단계에서 400 이 나거나 `low` 지연이 3.8 대비 크게 길면 1단계 전에 멈추고 보고.
- `high`·`xhigh`·장기 멀티턴은 1단계에서 품질 차이가 보일 때만.

## 4. 보는 것

| 영역 | 기준 |
|---|---|
| 응답 성능 | TTFT p50/p95 · 전체 생성 시간(둘을 따로 — thinking 이 첫 토큰을 늦춘다) |
| 한국어 Q&A | 자연스러움·정확도·환각 |
| 비용 | 요청당 추정 비용(지금 가격 / 1월 이후 가격 둘 다) |
| 검색 | API 에서 켜지는지 · 근거가 실제로 붙는지 · 답에 반영되는지를 **따로** 확인 |
| 도구 호출 | 날씨·논문·약 — 호출 이름·인자 형식 |
| 오류 | 400·429·503 원인 기록 |

## 5. 결과가 좋을 때 손댈 곳(지금은 안 건드린다)

- [server/model-thinking.ts](../../server/model-thinking.ts) `THINKING_MODE` — 프로브로 잰 레벨·budget 수용 여부
- [server/models.ts](../../server/models.ts) `SERVER_MODELS`·`MODEL_CAPS`(검색·멀티모달·URL fileData·grounding 신뢰도 — 각 축을 실측으로)
- [src/lib/models.ts](../../src/lib/models.ts) 선택 목록 · [server/agent/nodes/generator.ts](../../server/agent/nodes/generator.ts) 강등 분기
- 선례: [PLAN_MODEL_3_8_MIGRATION_260906](PLAN_MODEL_3_8_MIGRATION_260906.md)
