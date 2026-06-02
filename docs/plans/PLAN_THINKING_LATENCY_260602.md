# 분석: 3.5 Flash 검색 질의 지연 — thinking 레벨 / grounding 구조 검증

> 작성일: 2026-06-02
> 상태: **1순위(Stage1 budget0) 적용 완료 (2026-06-02) — 그 외 항목 적용 대기**
> 기준 모델: Gemini 3.5 Flash (기본값)
> 트리거: "3.5 모델에서 간단한 날씨 질의에도 응답이 늦다"

---

## 1. 배경 / 문제

3.5 Flash 기본값에서 "오늘 서울 날씨" 같은 단순 검색 질의의 응답이 느림. 원인을 코드 추적 + 실측으로 규명.

### 코드 경로 (날씨 질의 기준)

1. `날씨` 키워드 → [intentRules.ts:98](../../server/agent/intentRules.ts#L98) 강한 ON 패턴 → `needsSearch=true` 확정 (무조건 검색 경로).
2. 3.5 Flash는 **무료티어에서 Google Search grounding 불가** → [generator.ts:406](../../server/agent/nodes/generator.ts#L406) **two-track** 분기.
3. 결과적으로 **순차 LLM 3회**:
   | 단계 | 모델 | 역할 |
   |---|---|---|
   | Router | 2.5-flash-lite | intent + needs_search 분류 |
   | Stage1 | 2.5-flash + grounding | 검색 + 생성 |
   | Stage2 | 3.5-flash (minimal) | Stage1 결과 종합(재작성) |
4. 추가로 **SDK 경로는 비스트리밍** — [generator.ts:707](../../server/agent/nodes/generator.ts#L707)에서 전체 응답을 한 번에 emit → 3회 합계가 끝날 때까지 백지(TTFT 악화).

### 최초 가설 (→ 검증 결과 일부 틀림)

- (가설) "Stage2의 3.5 재작성이 지연의 주범" → **실측 결과: 틀림** (3절 참조).

---

## 2. 검증 환경

- `.env.local`에 **`API_KEY_TIER1`(유료/결제연동)** 추가 → 3.5 grounding 활성화 가능.
- ⚠️ 주의: [config.ts:13](../../server/config.ts#L13)의 키 로더 정규식 `/^API_KEY\d*$/`는 **`API_KEY_TIER1`을 매칭하지 않음** → 현재 앱은 Tier1 키를 로딩조차 안 함(무료키 12개만 사용). 적용 시 별도 배선 필요.
- 테스트 스크립트(아래 6절)로 실측.

---

## 3. 측정 결과

### 3-1. 3.5 grounding 동작 / 과금 ([test-grounding-35-tier1.ts](../../scripts/test-grounding-35-tier1.ts))

- ✅ **Tier1 키로 3.5 + grounding 정상 동작** — 날씨·주가 실시간 데이터 + 출처(weather.go.kr, yna.co.kr 등) 정상.
- ✅ **무료키는 204ms 만에 429** → 무료티어 3.5 grounding 차단 = two-track의 전제 확인.
- 💰 **과금 구조**: `groundingMetadata` 존재 = "grounded 요청"으로 과금. 토큰 과금 + grounded 요청 건당 과금(별도). **내부 webSearchQueries 개수와 무관, 1 generateContent = 1 grounded 요청.**
- 현재 운영이 무료였던 이유: **무료키 12개 로테이션 + 2.5 grounding(무료티어 허용)**. "SDK라서 무료"가 아니라 "무료티어 2.5를 12키로 돌려 무료 유지".

### 3-2. 투트랙 vs 단일패스 속도 ([test-grounding-latency-compare.ts](../../scripts/test-grounding-latency-compare.ts))

생성 구간만(라우터 제외), ms:

| 쿼리 | A1 단일3.5(low) | A2 단일3.5(minimal) | B 투트랙(2.5→3.5min) |
|---|---|---|---|
| 날씨 | 6,165 (thoughts 251) | **5,222 (0)** | 6,238 (S1 4,227 + S2 2,011) |
| 주가 | **12,833 (thoughts 831)** | 6,468 (0) | 5,916 (S1 4,508 + S2 1,408) |

- **유료 단일패스 전환 = 속도 이득 사실상 0** (minimal 기준 투트랙과 ±1초). low면 오히려 더 느림.
- **Stage2(3.5 minimal)는 1.4~2.0초뿐** → "Stage2가 주범" 가설 기각.
- 진짜 병목 = ① **grounding 검색 라운드트립(~4~4.5초, 콜 수와 무관한 바닥비용)** + ② **thinking 토큰**(low면 주가 thoughts 831 → +6초 폭증).

### 3-3. minimal vs low 응답 품질 ([test-thinking-minimal-vs-low.ts](../../scripts/test-thinking-minimal-vs-low.ts))

| 유형 | 쿼리 | low | minimal | 판정 |
|---|---|---|---|---|
| 검색 사실 | 서울 날씨 | 5.1s/th299 | **4.3s/th0** | 동급 |
| 개념 설명 | MoE 모델 설명 | **12.8s/th1409** | **6.4s/th0** | 동급(구조·정확도 동일) |
| 최신 모델 | Gemini Omni 설명 | 15.3s/th809/src8 | **12.0s/th0/src12** | minimal이 더 충실(출처·디테일·출시시점 명시) |

- **검색·개념설명·최신정보 전반에서 minimal이 low와 동급 이상.** MoE에서 low가 thinking 1,409토큰을 쓰고도 품질 우위 없음 → thinking = 이 유형들에선 순수 낭비(지연+비용).

### 3-4. 렌더러 JSON 무결성 ([test-json-minimal-vs-low.ts](../../scripts/test-json-minimal-vs-low.ts))

실제 production 프롬프트(`getSystemInstruction`) + intent hint 사용, googleSearch off, 3.5:

| intent | 블록 | LOW | MINIMAL |
|---|---|---|---|
| chemistry | json:smiles | ✅ OK 4199ms | ✅ OK 3477ms |
| biology | json:bio | ✅ OK 4816ms | ✅ OK 2653ms |
| physics | json:diagram | ✅ OK 5238ms | ✅ OK 2653~4088ms |
| astronomy | json:constellation | ✅ OK 9180ms | ✅ OK 6078ms |
| data_viz | json:chart | ❌ 빈응답 | ❌ 빈응답 |

- **minimal에서 JSON 깨짐 0건.** 정상 4종 모두 파싱 성공 + 최상위 키 구조 low와 동일 + 더 빠름.
- 렌더러 intent는 **이미 production에서 minimal 사용** ([generator.ts:392-396](../../server/agent/nodes/generator.ts#L392-L396)) — low를 쓰는 건 `general`뿐.
- ⚠️ `json:chart`는 **low에서도 동일하게 빈응답** → thinking 레벨 무관한 **별도 기존 이슈**(minimal 회귀 아님).

---

## 4. 핵심 결론

1. **지연을 가르는 건 콜 수가 아니라 "grounding 검색 시간 + thinking 레벨"이다.**
2. **유료 단일 3.5 grounding 전환은 속도 이득이 ~0이고 비용만 추가.** 전환 명분은 속도가 아니라 "모델 일관성/품질"뿐.
3. **minimal은 검색·개념설명·최신정보·렌더러JSON 전반에서 low와 품질/무결성 동급 이상이고 더 빠름**(thinking 토큰 0). 단, **production 검색 경로(two-track Stage2)는 이미 minimal**이라 추가로 바꿀 곳이 없음(§5 정정 참조). 미적용 `low`(396행)는 비검색 general(코드/추론)이라 별도 검증 필요.
4. 비스트리밍은 TTFT 악화 요인이나, 본 분석의 1순위 레버는 thinking 최소화.

---

## 5. 적용 방향

우선순위:

> ⚠️ **2026-06-02 재검토 정정** — generator.ts thinking 지점 전수 매핑 결과, 초안의 "general 검색경로 low→minimal"은 **부정확**했다. 실제 코드:
> - **유일한 `thinkingLevel: "low"`는 [generator.ts:396](../../server/agent/nodes/generator.ts#L396) 한 곳뿐.** 이 경로는 `is3xModel + general + 단일패스`인데, **3.5+검색은 무조건 two-track**으로 가므로 396행 low는 **검색이 없는 general = 코드·작문·번역·추론** 질의를 지배한다. → minimal-vs-low 테스트(검색·개념설명)가 **검증하지 않은 영역**이라 **지금 바꾸면 안 됨**.
> - **two-track Stage2(3.5)는 [generator.ts:526](../../server/agent/nodes/generator.ts#L526)에서 이미 `minimal`.** 즉 날씨·뉴스 등 검색 답변의 3.5 종합은 **이미 minimal**이고 더 낮출 게 없다.
> - **결론: thinking 레벨 관점에서 지금 안전하게 바꿀 곳은 없다.** (검색=이미 minimal / 396 low=미검증 코드·추론 영역)

1. **[1순위 ✅ 적용완료 2026-06-02] Stage1(2.5 grounding) thinking → `thinkingBudget: 0`** — [generator.ts:421](../../server/agent/nodes/generator.ts#L421)·[458](../../server/agent/nodes/generator.ts#L458)·[584](../../server/agent/nodes/generator.ts#L584) 3곳 적용. `thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 }` (이전: 비-medical은 thinkingConfig 미지정=dynamic).
   - **검증** ([test-stage1-thinking-budget.ts](../../scripts/test-stage1-thinking-budget.ts), 날씨·주가·뉴스 × dynamic/0/512):
     - budget0이 **평균 8,536ms → 4,470ms (~48% 단축)**, 3쿼리 전부 일관.
     - **grounding 품질 저하 없음**: 출처 수 동등(평균 4=4), 숫자 데이터 budget0이 오히려 많음(17 vs 12), 텍스트 동등/더 최신.
   - **추가 발견**: 실제 production 시스템 프롬프트(~41KB)가 dynamic thinking을 폭증시킴(thoughts 147→879, 4.2s→8.5s). 초안의 "Stage1 ~4초" 추정은 프롬프트 누락 탓 과소평가였고, **실 production Stage1은 ~8.5s**. budget0은 프롬프트 크기와 무관하게 thoughts=0.
   - **적용 범위**: 비-medical Stage1 한정. medical_qa Stage1은 budget 3000 의도적 유지. Stage1 빈응답 재시도([454](../../server/agent/nodes/generator.ts#L454))·폴백([578](../../server/agent/nodes/generator.ts#L578))도 동일 변경 대상.
   - budget512는 어정쩡(7,079ms, thoughts 558 잔존) → **budget0 채택 권장**.
   - **스트레스 검증** ([test-stage1-budget0-stress.ts](../../scripts/test-stage1-budget0-stress.ts), 순위표·비교·시계열·스포츠순위·정밀단일·다중홉 × dynamic/budget0):
     - **빈응답 0/6**, 평균 9,312ms → 4,745ms(~49% 단축), 출처 동등(5=5).
     - 6개 중 **5개에서 budget0 동등~우수** (시총표 컬럼 추가, EPL은 budget0만 완전한 순위표 생성, 다중홉은 dynamic이 thinking 2549토큰 쓰고 **자기모순** → budget0가 더 정확).
     - 유일한 약점: "이번 주 흐름 정리"류 **장문 요약에서 budget0가 덜 상세**(그래도 정확). Stage1은 Stage2 입력이라 비치명적.
     - 결론: **까다로운 grounding(순위 완전성·비교·표 생성)도 budget0로 충분히 처리됨. thinking이 grounding을 항상 돕지 않으며 때론 해침.**
   - **적용 후 e2e 회귀검증** ([test-generator-budget0-e2e.ts](../../scripts/test-generator-budget0-e2e.ts), 실제 generator 노드 직접 호출 = 3.5→두-트랙 경로):
     - 날씨·주가·뉴스(general) + 타이레놀(medical_qa) **4/4 정상, 빈응답 0**. 출처 수집(1/4/6/15), 표 생성·medical 상세(15출처/1672자) 전부 무손실.
     - medical_qa는 budget3000 경로 유지 확인(최다 출처·최장 응답). **적용이 두-트랙을 깨지 않음을 확인.**
     - ⚠️ 절대 latency(콜드 tsx + free-tier 두-트랙 2콜)는 production warm 기준 아님 — budget0 속도이득은 위 격리 측정(~48%)이 정확한 신호.
2. **[보류] 396행 `low` → minimal** — 코드·수학·다단계 추론 질의에서 minimal 품질 검증(별도 테스트) **선행 필수**. 검증 전 변경 금지.
3. **[2순위] SDK 경로 스트리밍 전환** — TTFT 개선(과거 renderer 블록 깨짐 리스크 → 별도 검증 필요).
4. **[3순위/선택] Tier1 3.5 단일패스 grounding** — 속도 이득은 없으나 모델 일관성/품질 원하면. **비용 발생** 전제 + config.ts 키 배선 필요.
5. **[보조] 단순 검색 질의 출력 토큰 상한 축소** — 현재 검색이면 최소 8192 강제([generator.ts:355](../../server/agent/nodes/generator.ts#L355)). 날씨는 1~2k면 충분.

---

## 6. 검증 스크립트 (재현용)

| 스크립트 | 검증 내용 |
|---|---|
| [scripts/test-grounding-35-tier1.ts](../../scripts/test-grounding-35-tier1.ts) | 3.5 grounding 동작 + 과금 신호 + 무료키 대조 |
| [scripts/test-grounding-latency-compare.ts](../../scripts/test-grounding-latency-compare.ts) | 투트랙 vs 단일패스 속도 |
| [scripts/test-thinking-minimal-vs-low.ts](../../scripts/test-thinking-minimal-vs-low.ts) | minimal vs low 응답 품질 |
| [scripts/test-json-minimal-vs-low.ts](../../scripts/test-json-minimal-vs-low.ts) | 렌더러 JSON 무결성 |
| [scripts/test-stage1-thinking-budget.ts](../../scripts/test-stage1-thinking-budget.ts) | Stage1 thinking budget(dynamic/0/512) 속도·grounding 품질 |
| [scripts/test-stage1-budget0-stress.ts](../../scripts/test-stage1-budget0-stress.ts) | Stage1 budget0 스트레스(순위·비교·시계열·다중홉) 처리 충분성 |
| [scripts/test-generator-budget0-e2e.ts](../../scripts/test-generator-budget0-e2e.ts) | **적용 후** generator 노드 직접 호출 e2e 무손실 회귀(general+medical) |

실행: `npx tsx scripts/<파일명>.ts` (⚠️ grounding 호출 발생)
- e2e는 generator.ts가 `server-only`를 import하므로 shim 필요: `npx tsx --import ./scripts/_loader-server-only-shim.mjs scripts/test-generator-budget0-e2e.ts`

---

## 7. 미해결 / 후속 과제

- [ ] **`json:chart` 빈응답** — low/minimal 공통, thinking 무관 기존 이슈. data_viz가 googleSearch off라 EV 판매량 등 수치를 내부지식으로 생성해야 하는데 빈응답. 원인 규명 필요.
- [ ] **코드·수학·다단계 추론에서 minimal 영향** 미검증 — minimal 일괄 적용 전 별도 테스트 필요.
- [ ] **비용 규모 추정** — Tier1 전환 시 일 검색 질의 건수 × grounded 요청 단가. (Google Cloud Billing 콘솔 확인 필요)
- [ ] 스트리밍 전환 시 renderer 블록/표 sanitize 회귀 검증.
