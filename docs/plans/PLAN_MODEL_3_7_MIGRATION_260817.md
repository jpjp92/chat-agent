# PLAN: 기본 모델 3.6 → 3.7 전환 (2026-08-17)

> 근거: [PLAN_MODEL_API_REVIEW_260817](PLAN_MODEL_API_REVIEW_260817.md) 의 실측 4회차.
> 결론(2026-08-17 프로브 4회차 후): **차단 조건 ①(렌더러 JSON)은 통과, ②(무료 503)는 기존 핀으로 무력화.**
> → **§5-1·§5-2 는 지금 진행 가능.** 기본 전환(§5-3)은 **긴 히스토리 측정 1건**만 남았다.
> 🔴 **검색 폴백은 2.5 를 유지한다** — 이건 전환과 별개 축이고, 두 티어 모두에서 최적임이 확인됐다.

---

## 1. 왜 3.7 인가 — 같은 값에 더 빠르고 더 정확하다

TIER1 실측(2026-08-17):

| 축 | 3.6 | 3.7 | |
|---|---|---|---|
| Files API 이미지 이해 | 4.1s | **2.5s** | |
| 검색 grounding 응답 | 7.5~8.5s | **2.7~5.4s** | |
| 이미지 (media LOW) | 3.8s | **2.4s** | |
| `media_resolution` LOW 토큰 절감 | −55% | **−60%** | |
| **grounding 정답률** | **2/5** 🔴 | **5/5** | §2 |
| 입력/출력 단가 | $0.75 / $3.75 | **동일** | 2027-01-01 부터 $1.50 / $7.50 |
| 컨텍스트 캐싱 | 무료티어 무료 | 동일 | |

**비용이 같다.** 판단 기준은 성능·안정성뿐이고, 성능은 3.7 이 전 축에서 앞선다.

---

## 2. 3.6 의 grounding 결함 — 전환의 부수 이득

TIER1, `googleSearch` ON, `"2026년 8월 현재 대한민국 대통령은?"` × 5회:

| 모델 | 발동 | 정답 | 발행 검색어 |
|---|:--:|:--:|---|
| 2.5 | 5/5 | **5/5** | 1~2 |
| 3.5 | 5/5 | **5/5** | 1~5 |
| **3.6** | 4/5 | **2/5** 🔴 | **전부 1개** |
| 3.7 | 5/5 | **5/5** | 1~3 |

🔴 **오답 3회 중 2회는 `groundingMetadata` 가 붙어 있었다.** 검색이 돌아 chunk 를 받고도
모델이 학습 지식으로 답을 덮었다. 우리 UI 는 그 메타데이터로 **출처 칩을 그린다** —
**틀린 답에 신뢰 표식이 붙는다.** 미발동보다 나쁘다.

3.6 은 매번 검색어를 **1개만** 발행했다. 다른 모델은 필요에 따라 늘렸다. 증거가 얇으니 파라메트릭 기억이 이긴다.

### 🔴 우리가 기대는 안전장치가 우연이다 — 전환과 무관하게 고칠 것

프로덕션은 검색 턴을 2.5 로 보내므로 지금은 이 결함이 드러나지 않는다. 그 분기는:

```ts
const needsSearchFallback = !modelCaps(resolvedModel).freeTierSearch;   // generator.ts:191
```

**`freeTierSearch` 는 과금 사실이다** — pricing 문서의 *"Grounding with Google Search / Free Tier:
Not available"* 행 그대로다(2.5 만 `Free of charge, up to 500 RPD`). 우리는 그것을
**답변 품질 보호 장치로 쓰고 있다.** 두 축이 지금 우연히 겹쳐 있을 뿐이다.

TIER1 에서는 3.x 도 검색이 **된다**(15/15 발동). 유료 배포를 하며 플래그 이름을 문자 그대로 읽고
`3.6: freeTierSearch: true` 로 바꾸면 **강등이 사라지고 출처 칩 붙은 오답이 시작된다.** 에러 없이.

→ **축을 분리한다.** 동작은 하나도 바뀌지 않고, 다음 사람이 과금 축만 보고 뒤집는 것을 막는다.

```ts
//   groundingReliable : 검색이 발동해도 **모델이 그 결과를 실제로 반영하는가**
//   🔴 freeTierSearch(과금 사실)와 **다른 축**이다. 지금은 우연히 겹쳐 있다.
"gemini-3.6-flash": { …, groundingReliable: false },   // 실측 2/5
```
`needsSearchFallback = !caps.freeTierSearch || !caps.groundingReliable`

---

## 3. 🔴 차단 조건 ① — 렌더러 JSON 이 `minimal` 에 의존한다

`generation-config.ts` 가 이유를 적어놨다:

> Renderer intents (astronomy/data_viz/etc): **"minimal"** — structured JSON output;
> **"low" budget can be exhausted by JSON reasoning → empty response**

**`low` 에서 빈 응답이 나서 `minimal` 로 옮긴 것이다.** 그런데 **3.7 의 하한이 `low`** 다.
그때의 실패 조건으로 되돌아갈 수 있다. 렌더러 12종이 전부 이 경로이고, 빈 응답은
사용자에게 **빈 화면**(A등급)이다.

### 복구 사다리도 같이 깨진다

```ts
// generator.ts (~438)
if (!responseText && is3xModel && thinkingConfig.thinkingLevel !== 'minimal') {
    // … minimal 로 재시도
}
```
3.7 에서 그 재시도는 **400**(`Thinking level MINIMAL is not supported`)이다.
**사다리의 마지막 칸이 없다.** → 재시도 목표를 `minimal` 리터럴이 아니라
**그 모델의 최저 레벨**로 바꿔야 한다(§5-1).

### 측정 — 프로브 A

`scripts/probe-renderer-thinking.mts`. **프로덕션과 같은 프롬프트**(`composeInstruction`)로
5개 렌더러 인텐트 × {3.6 minimal(기준선), 3.7 low, 3.7 medium} × N회.
판정: 빈 응답·`json:` 블록 누락·JSON 파싱 실패가 **기준선과 동등**해야 통과.
TIER1 으로 재서 **용량 문제(503)를 배제하고 사고 예산 효과만 분리**한다.

### ✅ 결과 — 통과 (2026-08-17, TIER1, 셀당 3회)

| 조합 | data_viz | chemistry | biology | physics | astronomy | 합계 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| 3.6 minimal (기준선) | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **15/15** |
| **3.7 low** | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **15/15** |
| 3.7 medium | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **15/15** |

빈 응답 0 · `json:` 블록 누락 0 · JSON 파싱 실패 0 · thought-only 0.
**`low` 예산 소진 우려가 재현되지 않았다.** 그 문제는 3.5·3.6 의 `low` 에서 났던 것이고,
3.7 의 `low` 는 **그 모델의 하한으로 조정된 값**이라 다르게 동작하는 것으로 보인다.

> ⚠️ **적용 범위를 좁게 적는다.** 셀당 3회다. "예산 소진이 구조적으로 안 난다"는 확인됐지만
> **5% 빈도의 실패까지 배제하지 못한다.** 배포 후 빈 응답 로그를 볼 것.
> (8/16 에 "재서술 중 왜곡 없음"을 넓게 적었다가 하루 밀림을 놓친 적이 있다.)

---

## 4. 🔴 차단 조건 ② — 무료티어 503

2차 프로브에서 3.7 이 **무료 키**로 긴 입력 3/3, 멀티모달 1회 **503 "high demand"** 를 맞았다.
TIER1 에서는 P1~P6 전부 무사했다 → **용량 문제이고 무료티어에 국한**된다.

그런데 이 앱은 **기본이 무료 키 12개 풀**이고 TIER1 은 선택적이다(`YT_USE_TIER1`).
즉 무료티어 503 이 **주 경로의 가용성**이다.

- 503 은 기존 `unavailableDowngrade` 가 2.5 로 강등해 자가 회복하므로 **치명적이지는 않다.**
  다만 강등이 잦으면 3.7 로 바꾼 의미가 사라진다.
- 출시 직후 혼잡일 가능성이 높다 → **며칠 뒤 재측정 대상**이다.

### 측정 — 프로브 B

무료 키로 3.6 vs 3.7 × {짧은 텍스트, 긴 입력} × 10회. 판정: **503 5% 이하**.

### 🟡 결과 — 갈렸다 (2026-08-17, 무료 키, 각 10회)

| 모델 | 짧은 텍스트 | 긴 입력 |
|---|---|---|
| 3.6 | 10/10 · 중앙값 **10.6s** | 10/10 · 중앙값 10.4s |
| **3.7** | 10/10 · 중앙값 **2.0s** 🎉 | **7/10** (503×2, 429×1) · 3.6s |

**짧은 텍스트가 5배 빠르다**(10.6s → 2.0s). 일반 대화가 트래픽의 대부분이므로 체감이 크다.
긴 입력은 **30% 실패**로 기준(5%)을 넘겼다.

### 그런데 긴 입력은 **이미 2.5 로 핀된다**

```ts
generator.ts:160  const pinUrl = hasUrlContentForModel && !selCaps.fastLongInput;
generator.ts:173  const resolvedModel = (pinYoutube || pinUrl || pinUrlFileData) ? SERVER_MODELS.FLASH : sel;
```

3.7 의 `fastLongInput: false` 면 **URL 본문 턴은 애초에 2.5 에서 돈다.**
즉 B 의 실패는 **프로덕션에서 3.7 이 받지 않는 경로**다 → 차단 조건에서 내린다.

### 🔴 다만 구멍이 있다 — 같은 이름 함정을 세 번째로 만난다

`pinUrl` 의 조건은 **`hasUrlContentForModel`** 이다. URL 본문 턴만 본다.
**긴 대화 히스토리**는 URL 이 아니어서 핀되지 않는다 → 히스토리가 길어진 턴은 3.7 에서
같은 429/503 을 맞을 수 있다.

> **DEV_260808 의 교훈이 여기에도 걸린다**: *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"*
> (`pinYoutube`·`YOUTUBE_CALL_TIMEOUT_MS` — 한 파일에서 같은 실수가 두 번).
> `fastLongInput` 은 **이름은 일반적인데 URL 턴에서만 조회된다.** 세 번째 사례다.

- [ ] **기본 전환 전에 측정**: 긴 히스토리 턴(첨부 없이 10턴 이상 누적)을 3.7 무료 키로 N회.
      실패율이 높으면 `pinUrl` 조건을 **입력 토큰 수 기준**으로 넓힌다(사례 이름이 아니라 크기로).

---

## 5. 전환 순서

### 5-1. ✅ 완료 (2026-08-22) — 동작 변화 0

> 🔴 **계획과 다르게 둔 것 하나**: 표를 `server/models.ts` 가 아니라 **`server/model-thinking.ts`**
> (순수 모듈)에 뒀고 `models.ts` 가 re-export 한다. 이유는 `models.ts` 가 `import 'server-only'`
> 라 **하니스가 임포트하면 throw** 하기 때문이다. 8/18 에 `image-flags.ts`·`ddg-parse.ts` 를
> 뽑아낸 것과 같은 이유다 — *"테스트할 수 없는 자리에 둔 규칙은 테스트되지 않는다."*
>
> **하니스가 실패할 수 있음을 확인했다**: 옛 구현(`/^gemini-3\./ → minimal`)으로 되돌리자
> **16건 빨간불**(3.7 경로 14 + 복구 2). 같은 조건에서 3.x·2.5 회귀 가드는 전부 초록 —
> 이것이 "동작 변화 0" 의 근거다.

- `needsSearchFallback` 진리값 대조: 3.6 `false||true`, 3.5 `false||true`, 2.5 `true&&true`
  → **세 모델 모두 이전과 동일**. 축만 갈렸고 동작은 그대로다.


**모델별 실측표로 계열 판정을 대체한다.** 3.7 을 추가하지 않아도 현재 동작이 동일하다.

```ts
// server/models.ts — 🔴 실측표. 문서가 아니라 프로브가 출처다(§0 of API_REVIEW).
export const THINKING_MODE: Record<string, { levels: readonly string[]; budget: boolean }> = {
    "gemini-2.5-flash":  { levels: [],                                budget: true  },
    "gemini-3.5-flash":  { levels: ["minimal","low","medium","high"], budget: true  },
    "gemini-3.6-flash":  { levels: ["minimal","low","medium","high"], budget: false },
    "gemini-3.7-flash":  { levels: ["low","medium","high"],           budget: true  },
};
export const lowestThinkingLevel = (m: string) => THINKING_MODE[m]?.levels[0];
```

- [x] `resolveThinkingConfig` 의 `"minimal"` 리터럴 → `lowestThinkingLevel(model)`
- [x] `generator.ts` 빈 응답 재시도 → `thinkingRetryLevel(model, current)` ([generation-config.ts](../../server/agent/nodes/generation-config.ts))
- [x] `MODEL_CAPS` 에 `groundingReliable` 축 신설, 3.6 = false (§2) — `needsSearchFallback` 이 두 축의 OR
- [x] `services/geminiService.ts` 의 `'gemini-3.5-flash'` 리터럴 → `DEFAULT_CHAT_MODEL` (호출부가 항상 넘겨서 dead default 였다)
- [x] 하니스 [`tests/test-thinking-config.mts`](../../tests/test-thinking-config.mts) — **통과 46**. 렌더러·YouTube·URL·미디어·medical_qa 7경로를 전부 훑는다(한 경로만 보면 놓친다)

> ⚠️ **`isThreeXFlash` 를 접두사 판정으로 바꾸지 않는다.** 한 번 그렇게 제안했는데,
> 3.7 에 적용하면 `minimal` 이 자동 주입돼 **전 호출 400** 이 된다.
> `url_cache`·`mfds_pills` 에서는 목록 누락이 **조용한 소멸**이었지만, 여기서는 **틀린 값의 확신 있는 적용**이다.
> → **"중복이 나쁜가"가 아니라 "빠뜨렸을 때의 기본값이 무엇인가"를 본다.**

### 5-2. 3.7 을 선택지로 추가 (기본은 3.6 유지)

- [x] `FLASH_3_7` — `src/lib/models.ts`(`CHAT_MODELS`·`CHAT_MODEL_OPTIONS`·`isChatModelId`) (2026-08-23)
      · `server/models.ts`(`SERVER_MODELS`·`ChatModelId`·`MODEL_CAPS`)
- [x] i18n 4개 로케일 — `components/Header.tsx`·`components/ChatInput.tsx` (`model37Flash`/`model37FlashDesc`) (2026-08-23)
- [x] `MODEL_CAPS` 3.7 값(§2 of API_REVIEW). `fastLongInput` 은 **잠정 false**(503 때문, 지연 아님) (2026-08-23)

### 5-3. 프로브 A·B 통과 후 기본 전환

- [ ] `DEFAULT_CHAT_MODEL` = `FLASH_3_7` (client·server 양쪽)
- [ ] 3.6 은 **선택지로 남긴다**
- [ ] 🔴 **3.5 도 목록에서 빼지 않는다** — `generator.ts:659,683` 의 **YouTube 폴백이 3.5 하드코딩**이다.
      문서가 "legacy" 라 불러도 **모델 목록과 폴백 체인은 별개 축**이다.
- [ ] dev 배포 후 실그래프 검증 — 3.6 이 기본이 될 때 했던 것과 동급으로(DEV_260723 §11)

### 5-4. 전환하지 않는 것

- **검색 폴백 2.5 유지.** pricing 근거로 두 티어 모두 최적이다:
  무료티어에선 3.x grounding 이 **아예 제공되지 않고**, 유료티어에선 2.5 의 무료 할당이
  **1,500 RPD(≈45,000/월)** 로 3.x 의 **5,000/월** 보다 9배 크며, 토큰 단가도 절반 이하
  ($0.30/$2.50 vs $0.75/$3.75). 3.x 는 **검색 쿼리 단위 과금**($14/1,000)이고 요청당 1~5개를
  발행한다(실측) — 요청 단위 $35/1,000 인 2.5 와 실효 차이가 크지 않다.
- **`urlFileData` 강등** — Files API 전환(별도 작업)이 근본 해법이므로 여기서 건드리지 않는다.

---

## 6. 되돌리기

`DEFAULT_CHAT_MODEL` 한 줄이다. 3.6 이 선택지로 남아 있으므로 사용자 영향도 없다.
🔴 단 **`MODEL_CAPS`·`THINKING_MODE` 는 되돌리지 않는다** — 3.7 이 목록에 있는 동안은 필요하다.

---

## 7. 미해결

- [ ] 3.7 `fastLongInput` 실측 재확인 (503 이 잦아든 뒤). 현재 `false` 는 **지연이 아니라 가용성** 때문이다
- [ ] 3.7 이 검색 지원표에 없는 이유 — 실측은 **지원함**(15/15 발동, 5/5 정답)이므로 문서 누락으로 본다
- [ ] `low` 의 사고 토큰 비용 — `"1+1은?"` 기준 3.7 low **48 tok** vs 3.6 minimal **15 tok**.
      출력 과금에 사고 토큰이 포함되므로 **단가는 같아도 총액은 오를 수 있다.** 실사용 분포로 재볼 것

---

## 8. 2026-08-23 상태 업데이트

- [x] Gemini 3.7 Flash를 서버/클라이언트 허용 목록과 모델 선택 UI에 추가
- [x] 3.7은 `minimal`을 쓰지 않고 지원 하한인 `low`를 사용
- [x] 검색 필요 턴·URL 긴 입력·임의 URL fileData에 대한 2.5 capability fallback 유지
- [x] `test-thinking-config.mts`에서 3.7 지원 레벨과 재시도 하한 회귀 고정
- [ ] **기본 모델은 아직 3.6 유지** — 긴 히스토리/실사용 비용 측정 후 별도 전환
- [ ] 3.7의 tool intent별 2.5 fallback 필요 범위를 실환경에서 다시 확정
- [ ] OpenAI 모델 추가로 생긴 공급자별 초기 router 정책은 별도 계획에서 처리

멀티 공급자 라우팅 후속은 [PLAN_MULTI_PROVIDER_ROUTING_260823](PLAN_MULTI_PROVIDER_ROUTING_260823.md)을
기준으로 한다. 3.7 전환과 GPT 공급자 독립성은 서로 다른 작업이며 함께 묶어 배포하지 않는다.
