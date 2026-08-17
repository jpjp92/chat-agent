# PLAN: 모델·API 레퍼런스 검토 (2026-08-17)

> 계기: 3.7 Flash 도입 검토 → `MODEL_CAPS` 실측 프로브 → Gemini 공식 가이드 6종 대조.
> 실측: `scripts/probe-model-caps.mts`(레포 미추적 — `probe-*`). **이 문서가 측정 결과의 출처다.**
> 관련: [PLAN_PRIORITY_260817](PLAN_PRIORITY_260817.md) · [TODO](../TODO.md)

---

## 0. 이 검토의 방법 — 문서와 실측을 **둘 다** 봤다

오늘 두 방향의 불일치를 모두 겪었다.

| 항목 | 문서 | 실측 | 이긴 쪽 |
|---|---|---|---|
| 3.7 `thinkingLevel: minimal` | 미지원으로 표기됨(찾기 전엔 몰랐다) | **400 거부** | 일치 |
| **2.5-flash `thinkingLevel`** | **low·medium·high 지원** | **넷 다 400 거부** | 🔴 **실측** |
| 3.x arbitrary URL `fileData` | 언급 없음 | 429 (무료·유료 양쪽) | 실측이 채움 |

> **문서만 믿었으면 2.5 를 `thinkingLevel` 로 통일해 깨뜨렸을 것이고,
> 실측만 했으면 429 의 진짜 이유(§3)를 못 찾았을 것이다.**

---

## 1. thinkingLevel — 모델마다 지원 집합이 다르다

**실측(TIER1) = 공식 문서 표와 3.x 에서 완전 일치.**

| 모델 | 기본 | 지원 레벨 | `thinkingBudget` |
|---|---|---|:--:|
| `gemini-2.5-flash` | On | 문서: low·medium·high / **실측: 없음** | ✅ |
| `gemini-2.5-flash-lite` | **Off** | 문서: low·medium·high | ✅ |
| `gemini-3.5-flash` | On (medium) | minimal·low·medium·high | ✅ |
| `gemini-3.6-flash` | On (medium) | minimal·low·medium·high | ❌ **거부** |
| **`gemini-3.7-flash`** | On (medium) | **low·medium·high** (minimal 없음) | ✅ |
| `gemini-3.5-flash-lite` | **On (minimal)** | minimal·low·medium·high | — |

### 🔴 현재 코드가 3.7 에서 깨진다

`generation-config.ts` 의 `resolveThinkingConfig` 는 **이분법**이다:

```ts
ctx.is3xModel ? { thinkingLevel: "minimal" } : { thinkingBudget: ... }
```

3.5·3.6 에서만 **우연히** 맞다. 3.7 을 추가하면:
- `isThreeXFlash` 에 넣으면 → `minimal` → **전 호출 400**
- 안 넣으면 → `thinkingBudget` 경로(동작은 함) + **2.5 용 sampling(`temperature 0.2`)까지 딸려온다**

> ⚠️ **`isThreeXFlash` 를 접두사 판정(`/^gemini-3\./`)으로 바꾸자던 제안은 폐기한다.**
> "수동 열거는 동기화를 잊는다"는 논리로 제안했는데, 여기서는 **열거가 방어막**이었다.
> 빠뜨렸을 때 `url_cache`·`mfds_pills` 는 **조용히 사라졌지만**, 여기서는 **다른 값이 적용**된다.
> → **"중복이 나쁜가"가 아니라 "빠뜨렸을 때의 기본값이 무엇인가"를 봐야 한다.**

### 대응 — 계열이 아니라 **모델별 실측표**

```ts
// server/models.ts
export const THINKING_MODE: Record<string, { levels: readonly string[]; budget: boolean }> = {
    "gemini-2.5-flash":  { levels: [],                                budget: true  },
    "gemini-3.5-flash":  { levels: ["minimal","low","medium","high"], budget: true  },
    "gemini-3.6-flash":  { levels: ["minimal","low","medium","high"], budget: false },
    "gemini-3.7-flash":  { levels: ["low","medium","high"],           budget: true  },
};
// 우리는 거의 모든 경로에서 **가장 낮은 사고 수준**을 원한다(속도). 그 값이 모델마다 다르다.
export const lowestThinkingLevel = (m: string) => THINKING_MODE[m]?.levels[0];
```

- 라우터를 `3.5-flash-lite` 로 바꾼다면 **명시적으로 `minimal` 을 넣어야 한다**(기본이 On).
  현재 `2.5-flash-lite` 는 기본 Off 라 우리 `thinkingBudget: 0` 은 중복이지만 무해하다.

---

## 2. MODEL_CAPS — 실측 갱신 (3회 중앙값, 2026-08-17)

```ts
"gemini-2.5-flash": { freeTierSearch: true , fastMultimodal: true , fastLongInput: true , urlFileData: true  },
"gemini-3.5-flash": { freeTierSearch: false, fastMultimodal: true , fastLongInput: true , urlFileData: false },
"gemini-3.6-flash": { freeTierSearch: false, fastMultimodal: true , fastLongInput: true , urlFileData: false },
"gemini-3.7-flash": { freeTierSearch: false, fastMultimodal: true , fastLongInput: false, urlFileData: false },
```

**기존 8개 값이 전부 재확인됐다.** 표는 믿을 만했다.

### 측정에서 배운 것 둘

**ⓐ 대조군 없이는 429 를 읽을 수 없다.** 1차 실행에서 2.5 를 빼먹어 3.x 가 전부 429 인데
"모델 거부"인지 "무료 키 쿼터 소진"인지 가를 수 없었다. 2.5 를 넣자 즉시 갈렸다(2.5 검색 ✅ 5.2s).

**ⓑ 프로브가 프로덕션과 다른 설정으로 재면 그 숫자는 표에 못 넣는다.** 1차에서
`fastMultimodal` 을 `fileData`(URL)로 쟀는데 그건 `urlFileData` 와 **같은 경로**라 항상 false 였다.
앱은 이미지를 `inlineData` 로 보낸다 → 고치자 4.2s. `maxOutputTokens` 도 `generation-config` 값에 맞췄다.

### 🟡 3.7 `fastLongInput: false` 는 잠정값이다

실패 원인이 **지연이 아니라 503 "high demand"** 였다(3회 중 2회, 나머지 1회는 8.9s 로 최속).
멀티모달에서도 503 이 1회 났다 → **긴 입력 문제가 아니라 출시 직후 혼잡**으로 보인다.
앱에 503 강등 경로가 이미 있으므로 보수적으로 `false` 로 두되, **며칠 뒤 재측정할 것.**

---

## 3. 🔴 `urlFileData` 의 정체 — 우리가 문서에 없는 패턴을 쓰고 있다

`fileData.fileUri` 는 **Files API URI 와 YouTube URL** 을 위한 것이다.
임의의 공개 URL 을 넣는 패턴은 **어느 가이드에도 없다.** 이것이 관측을 전부 설명한다:

| 관측 | 설명 |
|---|---|
| 3.x 가 YouTube `fileData` 는 처리 ✅ | 특수 지원 대상 |
| 3.x 가 Storage URL `fileData` 는 429 ❌ | 애초에 지원 계약이 아니다 |
| 2.5 는 Storage URL 도 처리 ✅ | **구세대의 관대함** |

> **즉 `urlFileData:false` 는 3.x 의 결함이 아니라 2.5 가 유별나게 관대한 것이다.**
> 우리의 2.5 강등 우회는 **문서화되지 않은 동작 위에 서 있다** — 2.5 가 조여지면 조용히 깨진다.

### 429 가 쿼터가 아니라는 근거 4중

| 근거 | 배제하는 것 |
|---|---|
| 같은 키가 텍스트 호출엔 200 (DEV_260808) | 키 단위 소진 |
| 무료·TIER1 **양쪽** 429 | 무료티어 특성 |
| TIER1 대시보드 사용량이 한도의 **1% 미만** | RPM·TPM·RPD |
| **같은 실행에서 2.5 만 통과** | **spend 기반 포함 모든 프로젝트 단위 한도** |

마지막이 가장 강하다 — 공식 문서가 *"Rate limits are applied **per project**, not per API key"* 라고
명시하므로, 프로젝트 단위 한도는 2.5 만 통과시키고 3.x 만 막을 수 없다.

> ⚠️ `429 RESOURCE_EXHAUSTED` 라는 **이름이 원인을 오도한다.** 이름은 쿼터를 가리키는데 실제는 다르다.
> 참고: TIER1 에는 대시보드에 **안 보이는** spend 기반 한도가 있다(10분당 $10). 위 4번이 그것까지 배제한다.

### 🔴 확증 — 공식 입력 방식 목록에 "임의의 공개 URL"이 **없다**

이미지·영상 가이드가 지원 입력 방식을 명시적으로 나열하는데, 우리 방식은 거기 없다.

| 영상 입력 방식 | 최대 크기 |
|---|---|
| **File API** | **20GB(유료) / 2GB(무료)** |
| Cloud Storage 등록 | 2GB (GCS 전용 — 우리는 Supabase라 해당 없음) |
| Inline Data | <100MB. 단 *"요청 총합이 20MB 를 넘으면 **항상** Files API 를 쓰라"* |
| YouTube URL | — (프리뷰, 무료. 무료티어 하루 8시간 제한) |

이미지도 같다 — **inline(base64) 또는 Files API** 둘뿐이고 inline 은 **요청 총합 20MB** 제한.
오디오도 동일(20MB 초과 시 Files API).

> **네 방식 어디에도 "공개 URL 을 `fileData` 로" 가 없다.** 3.x 의 거부가 규격이고 2.5 가 예외다.

### 대안 셋 — 검토 필요 (지금 하지 않음)

| 안 | 지원 | 영상 | 비고 |
|---|---|:--:|---|
| **Files API** | 전 모델 | ✅ | **무료**, 48h 보관, 업로드를 모델 호출과 분리(지연·대역폭↓). 문서가 "URL 의 대용량 PDF"에 권장하는 바로 그 패턴 |
| `url_context` 도구 | 2.5·3.5·3.5L·3.6·3.7 | ❌ | URL 20개/요청, URL당 34MB, image/PDF 지원. 유료장벽·YouTube·비디오 미지원 |
| 현행 2.5 강등 | — | ✅ | 동작하지만 **문서에 없는 동작에 의존** |

**Files API 가 가장 유력하다** — 영상까지 커버하고 무료다. DEV_260808 의 영상 업로드 실패가
"3.6 의 한계"가 아니라 **잘못된 전송 방식**이었을 가능성이 있다.

#### 왜 우리 구조에 잘 맞나 — Vercel body 캡이 무관해진다

지금 Storage 공개 URL 을 쓰는 이유는 **Vercel 4.5MB body 캡**이다(브라우저가 서명 URL 로 직접
Storage 에 올리고, 서버는 URL 만 받는다). Files API 로 가면 **서버가 Storage 에서 받아 Google 로
올린다** — 파일이 요청 본문을 타지 않으므로 캡이 애초에 무관하다. 무료티어도 **영상 2GB** 까지다.

- 비용: 서버 측 다운로드+업로드 지연이 추가된다(10MB 기준 수 초 예상)
- 대체하는 것: DEV_260808 의 **12키 × ~12s ≈ 144s 를 태우고 실패**하던 경로
- 보관 48시간이므로 **재사용 캐시로도 쓸 수 있다**(같은 첨부를 멀티턴에서 다시 안 올려도 된다)

- [ ] 미확인: 가이드가 참조하는 **"File input methods"** 문서에 *external URLs* 항목이 있다.
      우리가 쓰던 방식이 거기 규격으로 존재하는지 확인할 것(있다면 §3 의 해석이 바뀐다).

---

## 4. 🔴 아키텍처 전제 하나가 흔들린다 — 도구 조합

이 레포의 핵심 전제: **"`googleSearch` 는 호출 가능한 도구가 아니라 요청 모드라서 `bindTools` 와
절대 공존하지 않는다"** → `LANGCHAIN_INTENTS` 와 앞단 라우터가 존재하는 **이유 자체**다.

그런데 검색 가이드가 이렇게 적는다:

> Gemini 3 models also support combining these built-in tools with **custom tools (function calling)**.

### 다만 장애물이 있다 — Thought Signatures

> Built-in tools such as Google Search can carry their own distinct signatures on the call/result blocks.
> **In stateless mode, you must also resend these tool result signatures** in subsequent turns.
> You should **NOT** remove or modify thought blocks from the history.

우리는 `generateContent`(stateless)를 쓰고 히스토리를 **`chat_messages` 의 텍스트에서 재구성**한다
(`server/agent/history.ts`). **signature 를 보존하지 않는다.**
→ 도구 조합은 라우터를 걷어내는 것으로 끝나지 않고 **저장 스키마까지 닿는다.**

- [ ] 프로브 A: `tools: [{googleSearch:{}}, {functionDeclarations:[…]}]` 를 3.5/3.6/3.7 TIER1 로.
      400 이면 전제 유지, 200 이면 **단발 턴 한정**으로 가능 — 멀티턴은 signature 설계가 선행이다

---

## 5. 계보 변화 — 문서가 부르는 이름이 바뀌었다

| 모델 | 공식 문서의 표현 |
|---|---|
| **3.7 Flash** | *"our latest and most capable Flash model"* (퀵스타트 기본 예제) |
| 3.6 Flash | *"previous-generation"* |
| **3.5 Flash** | ***"legacy"*** |
| 3.5 Flash-Lite | *"low-latency high throughput **subagent** tasks"* (신규) |

- **기본 모델은 3.6 유지를 권한다.** 3.7 은 출시 직후 503 이 잦다(§2). 선택지로만 추가하고 며칠 뒤 재평가.
- 🔴 **3.5 는 "legacy" 라도 목록에서 뺄 수 없다** — `generator.ts:659,683` 의 **YouTube 폴백이 3.5 하드코딩**이다.
  **모델 목록과 폴백 체인은 별개 축이다.**
- `3.5-flash-lite` 는 설명이 라우터의 역할 그대로다(매 턴 blocking). 재볼 값이 있다 → TODO.

---

## 6. 부수 발견

- **PDF 한도는 50MB / 1000페이지**(inline·Files API 공통). 우리의 4.5MB(Vercel body)·1MB(inline 임계값)는
  **전부 우리 쪽 제약**이다 — Gemini 한계로 오해하지 말 것.
- **Gemini 3 는 `media_resolution` 을 미디어 파트별로** 지정할 수 있다. YouTube 에만 쓰던 `LOW`(DEV_260703)를
  PDF·이미지에도 적용할 수 있다 → 6.5MB PDF 지연([BACKLOG D3](PLAN_BACKLOG_260801.md)) 레버.
  **문서가 DEV_260703 실측을 정확히 뒷받침한다**: 프레임당 `low` **66 토큰** vs 기본 **258 토큰**,
  초당 약 **100 vs 300 토큰**. 당시 측정한 315,695 → 110,243(-65%)과 비율이 맞는다.
  이미지는 양변 384px 이하면 258 토큰, 크면 768×768 타일마다 258 토큰.
- 영상은 Files API 사용 시 **1 FPS 로 저장**되고 오디오는 1Kbps 단일 채널. 1M 컨텍스트면
  기본 해상도 **1시간**, low 로 **3시간** 처리 가능. 권장: **요청당 영상 1개**.
- **Gemini 3 는 PDF 의 네이티브 텍스트 토큰을 과금하지 않는다.** 페이지 이미지 토큰은 `IMAGE` 모달리티로 집계된다.
- **문서 비전은 PDF 만 의미 있게 이해한다** — 다른 타입은 순수 텍스트로 추출된다.
  HWP→Markdown 후 텍스트로 넘기는 현재 방식이 맞다.
- 검색 지원 표에 **3.7 이 없다**(3.6·3.5·3.5L·2.5 계열은 있다). 문서 누락인지 실제 미지원인지 미확인 —
  프로브 C(TIER1 검색, 3.6 vs 3.7)로 갈린다.

---

## 7. 실행 목록

**즉시 (실측 완료, 위험 낮음)**

- [ ] `THINKING_MODE` 신설 + `resolveThinkingConfig` 를 `lowestThinkingLevel(model)` 로 전환
- [ ] `MODEL_CAPS` 에 3.7 추가(§2 값)
- [ ] `FLASH_3_7` 레지스트리 + i18n 4개 로케일 — **기본은 3.6 유지**
- [ ] `services/geminiService.ts:220` 의 `'gemini-3.5-flash'` 리터럴 → `DEFAULT_CHAT_MODEL`
- [ ] `scripts/test-thinking-config.mts` 하니스 — **3.7 에 `minimal` 이 들어가면 즉시 빨간불**

**검토 (별도 세션)**

- [ ] 프로브 A — 도구 조합(§4). 결과에 따라 라우터의 존재 이유가 바뀐다
- [ ] 프로브 B — `url_context` 로 Storage 이미지(§3)
- [ ] 프로브 C — TIER1 검색, 3.6 vs 3.7(§6)
- [ ] **Files API 전환 검토**(§3) — 영상 업로드 실패의 진짜 해법일 수 있다
- [ ] `media_resolution` 을 PDF 에 적용(§6) — BACKLOG D3
- [ ] 라우터를 `3.5-flash-lite` 로(§5) — **기본 thinking On 이라 명시적 minimal 필요**
- [ ] 3.7 `fastLongInput` 재측정(§2) — 503 이 잦아든 뒤
