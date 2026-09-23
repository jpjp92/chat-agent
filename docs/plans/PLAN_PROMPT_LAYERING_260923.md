# 프롬프트 계층화 — 전수 검토와 재배치 계획

> 작성일: 2026-09-23 (4판 — 외부 피드백 3회 반영. 캐시·조건부 비율은 실측으로 교체, 소스 축·지표 등급 정정)
> 상태: **설계 — 실행 전**
> 관련: [DEV_260922](../logs/2026/09/DEV_260922.md) · 가독성 개선 5건은 9/23 선반영(§11)

---

## 1. 이 문서의 결론 먼저

프롬프트 계층이 없는 게 아니다. **6층이 이미 있고, 그중 3층의 이름이 내용과 다르다.**
따라서 할 일은 새 프레임워크 도입이 아니라
**이미 있는 구조를 명시화하고 규칙을 Scope·Volatility 에 맞는 자리로 옮기는 리팩터링**이다.

초판(같은 날 오전)과 2판에서 **네 가지를 틀리게 적었고 §9 에 정정해 두었다.**
특히 **계층화의 근거는 캐시가 아니다** — 실측해 보니 암묵 캐싱은 고정 prefix 에서도 6.7% 밖에 안 걸린다(§7-1).

---

## 2. 검토 방법

추정하지 않고 실행해서 쟀다.

- 계층 크기: `npx tsx` 로 `getSystemInstruction` · `getRendererSections` · `getIntentFocusHint` 를
  4개 언어 × 19개 의도로 직접 호출
- 인라인 규칙: `generator.ts` 의 `finalInstruction` 대입/누적 지점 14곳을 행 단위로 추출해 리터럴 길이 측정
- 프롬프트 표면: `server/`·`app/api/` 전체에서 모델에 문자열을 넘기는 지점을 grep 후 개별 확인

---

## 3. 프롬프트 표면 — 두 종류를 섞어 세지 않는다

**A. 독립 모델 호출 표면** — 각자 다른 모델 호출을 만든다. 계층화 대상은 A①뿐이지만, "전수"라면 목록에 있어야 한다.

| # | 표면 | 위치 | 성격 |
|---|---|---|---|
| A① | 채팅 본문 | `prompt.ts` + `generator.ts` | 이 문서의 대상 |
| A② | 의도 분류 | [router.ts:224](../../server/agent/nodes/router.ts#L224) | **매 턴 serial-blocking** — 지연에 직접 기여 |
| A③ | 알약 비전 추출 | [vision.ts:27](../../server/agent/nodes/vision.ts#L27) | `drug_id` 전용 |
| A④ | 대화 제목 생성 | `app/api/summarize-title/route.ts` `TITLE_PROMPT` | 세션당 1회 |
| A⑤ | 법령 도구 내부 | [law-tool.ts:137](../../server/agent/law-tool.ts#L137) | `ai.models.generateContent` — 도구 안에서 별도 호출 |

**B. 채팅 프롬프트 조립 조각** — 별도 호출이 아니라 A① 의 instruction 뒤에 덧붙는다.

| # | 조각 | 위치 | 성격 |
|---|---|---|---|
| B① | 검색 공급자 고지 | [search-provider.ts:37](../../server/agent/search-provider.ts#L37) | `[ACTIVE_WEB_SEARCH]` 를 **맨 끝**에 append. 공급자마다 내용이 달라야 한다 — §4 |

## 4. 🔴 조립기가 하나가 아니라 둘이다

이 사실이 계획 전체를 좌우한다.

```
Gemini 경로   generator.ts    finalInstruction 을 그대로 systemInstruction 으로
OpenAI 경로   openai/chat.ts  options.instructions + extraInstructions 를 한 번 더 이어붙이고
                              withSearchProviderInstruction 으로 감싼다
```

[chat.ts:105-110](../../server/openai/chat.ts#L105-L110) 이 `extraInstructions`(빈 결과 규칙 등)를
**자기 쪽에서 별도로** 붙인다. 즉 같은 턴 규칙이 공급자에 따라 다른 위치에서 조립된다.

→ **`assemble.ts` 를 만들면 두 경로가 모두 그것을 통과해야 한다.** 한쪽만 고치면 지금의 암묵적 차이가
명시적 분기로 굳는다.

다만 `assemble.ts → 공급자` 의 단순 1단 구조로는 부족하다. `[ACTIVE_WEB_SEARCH]` 처럼 **공급자마다
내용이 달라야 하는 조각**이 있기 때문이다(B①). 경계를 두 단으로 나눈다:

```
              Prompt Assembly
                    │
       ┌────────────┴────────────┐
       ↓                         ↓
 provider-neutral          provider-specific
   instruction                additions
       └────────────┬────────────┘
                    ↓
              Provider Call
```

수용 기준은 **함수 경계로 못 박는다** — "두 공급자의 최종 문자열이 같아야 한다"가 아니다.
공급자별 도구 문법·instruction 제약이 생기면 최종 문자열은 원래 달라야 하기 때문이다.

```ts
const neutral = assembleNeutralPrompt(state);   // ← 이것만 바이트 동일을 보장한다
gemini = finalizeGemini(neutral);
openai = finalizeOpenAI(neutral);
```

지금은 이 경계가 없어서 `extraInstructions` 가 OpenAI 쪽에만 있다.

---

## 5. 실제 조립 순서 (초판 정정)

초판은 `base → 렌더러 → 의도 → 턴` 으로 적었다. **틀렸다.** 실제 순서는:

```
[CURRENT_SYSTEM_TIME]        ← base 앞에 prepend (generator.ts:87)
base (21,208자)
PROVIDED_SOURCE_TEXT / contextInfo
movieContext + 영화 후속 규칙
화면 상영작 검색 규칙
날짜 대응표 + 날씨 후속 규칙
DISPLAYED_CARD_SOURCE + 카드 후속 규칙 (1,292자)
빈 결과 규칙 / 논문 후속 규칙
재구성 요청 규칙
렌더러 스펙            ← 턴 규칙보다 뒤
의도 정책              ← 맨 뒤
[검색 공급자 고지]      ← OpenAI 경로에서 한 번 더
```

**턴 규칙이 렌더러·의도보다 먼저 들어간다.** 설계 의도(정적 먼저)와 반대다.

---

## 6. 계층 인벤토리 — 실측

### 6-1. base 내부 블록 (한국어 21,208자)

| 자수 | 블록 | Scope | 비고 |
|---:|---|---|---|
| 5,453 | `CORE DIRECTIVE: SOURCE ADHERENCE` | **조건부** | 제공 본문이 있을 때만 유효 |
| 5,203 | `FORMATTING & QUALITY` | global | |
| 2,951 | `VIDEO ANALYSIS DIRECTIVE` | **조건부** | 영상/YouTube 턴만 |
| 1,787 | `CRITICAL — NEVER FABRICATE SOURCES` | global | Integrity |
| 1,540 | `RESPONSE SHAPE — LENGTH & STRUCTURE` | global | 9/23 신설 |
| 1,430 | `CODE GENERATION STANDARDS` | global | §12 참조 |
| 1,119 | `REFORMAT REQUESTS` | **조건부** | 재구성 턴만 — §7-3 |
| 742 | `RESPONSE COMPLETENESS` | global | |
| 368 | `GROUNDING & CITATIONS` | global | |
| 216 | `LANGUAGE ENFORCEMENT` | global | |
| 207 | `NO INTERNAL LEAKS` | global | Integrity |

언어별: Korean 21,208 · English 21,272 · Spanish 21,280 · French 21,294.

### 6-2. 의도별 (자수)

| 의도 | renderer | policy | 의도 | renderer | policy |
|---|---:|---:|---|---:|---:|
| medical_qa | 9,563 | 1,083 | paper_search | 0 | **6,534** |
| drug_info | 6,075 | 1,706 | arxiv_search | 0 | **4,176** |
| physics | 6,124 | 289 | law_search | 0 | 1,031 |
| chemistry | 3,798 | 252 | law_qa | 0 | 787 |
| general | 3,486 | 331 | weather | 681 | 655 |
| astronomy | 2,166 | 241 | sports | 3,486 | **0** |

### 6-3. 턴 계층

| 형태 | 항목 | 자수 |
|---|---|---:|
| 순수 함수(검사 가능) | `buildEmptyCardRules` · `buildPaperFollowupRules` · `buildDateLadder` · `buildCardFollowupFacts` 등 6종 | 790 · 688 · … |
| **인라인 리터럴(미검사)** | 카드 후속 1,292 · 날씨 후속 364 · 영화 후속 356 · 재구성 338 · 상영작 검색 280 · 날짜표 안내 235 | **합 2,865** |

---

## 7. 발견 — 심각도 순

### 7-1. 🟡 캐시 프리픽스는 깨져 있다 — 다만 캐시 자체가 거의 안 걸린다

[generator.ts:87](../../server/agent/nodes/generator.ts#L87) 이 현재 시각을 **base 앞에 prepend** 한다.
`currentDateStr` 은 **분 단위**까지 포함하므로, **분이 바뀔 때마다 base prefix 재사용이 끊긴다.**

```ts
finalInstruction = `[CURRENT_SYSTEM_TIME (Timezone: ${tz}): ${currentDateStr}]\n` + … + finalInstruction;
```

**🔴 그런데 초판·2판은 여기서 "base 21,208자가 한 번도 캐시에 걸리지 않는다"고 단정했다. 틀렸다.**
9/22 코퍼스에 답이 있었다 — `usage.cachedContentTokenCount` 를 전수로 세면:

```
캐시 히트          17 / 252 회  (6.7%)
히트 시 캐시 토큰   4,074~4,077  (프롬프트 6,790~7,818 중 약 절반)
모델별 히트        3.7 → 9회 · 3.8 → 8회 · 3.6(기본 모델) → 84회 중 0회
```

그리고 이 프로브는 **시각 블록을 넣지 않는다** — [compare-three.mts:45](../../tests/manual/gemini-3-8/compare-three.mts#L45)
가 `getSystemInstruction + renderer + hint` 만 이어붙이므로 **prefix 가 호출마다 완전히 동일했다.**

> 즉 **9/22 고정-prefix 프로브에서 캐시 히트는 6.7% 에 그쳤다.** 프로덕션은 거기에 분 단위 시각까지
> 얹으므로 더 낮을 것으로 보이지만, **프로덕션 실측은 아직 없다** — 이 수치는 프로브 범위의 값이다.

**따라서 계층화의 정당화를 캐시에 두면 안 된다.** 근거는 다음 둘로 옮긴다:
① 턴 규칙을 순수 함수로 빼야 **회귀 검사가 가능**해진다(§7-5),
② 조건부 블록을 조건부로 주입해야 **문맥 오염과 토큰이 함께 준다**(§7-2 — 오염은 DEV_260731 §3-3 에 실측이 있다).

[generator.ts:196](../../server/agent/nodes/generator.ts#L196) 주석 *"base가 앞에 고정돼야 암묵 캐싱 프리픽스가
유지된다"* 는 **의도로만 참이고 코드에서는 이미 깨져 있다.** 게다가 prefix 를 지킨 프로브에서도 히트가 6.7% 였으므로
효과 기대치 자체가 낮다. 주석도 갱신 대상이다.

⚠️ 시각 블록 위치는 그래도 함부로 못 옮긴다. [generator.ts:84-86](../../server/agent/nodes/generator.ts#L84-L86)
주석에 *"주입만으로는 부족했다"* 는 실측(자정 직후 전날 기사를 "오늘"로 답함)이 있다 —
**위치가 효과의 일부일 수 있다**(§10 Step 8).

### 7-2. 🔴 base 의 약 35%가 조건부 규칙인데 무조건 들어간다 — 조건을 산문으로 쓰고 있다

`VIDEO ANALYSIS DIRECTIVE` 의 첫 줄이 이 문제를 그대로 보여준다:

> `THIS DIRECTIVE APPLIES ONLY WHEN: (1) the user's message contains an explicit YouTube URL, OR (2) the request parts contain a 'fileData' with a video MIME type.`

**이 조건들은 이미 코드에 불리언으로 존재한다** — `isYoutubeRequest`, `hasVideoData`, `state.webContent`.
즉 코드가 아는 조건을 모델에게 산문으로 판정시키고 있다.

**🔴 2판은 이를 "45%"로 적었다. 블록 단위로 세서 과했다.** `CORE DIRECTIVE: SOURCE ADHERENCE` 5,453자를
줄 단위로 분류하면 **조건부 3,323자 / 전역 2,070자 (62%)** 다 — 한 줄 요약 서식이나
`[ANTI-HALLUCINATION DIRECTIVE]`, `[TOOL AVAILABILITY]` 는 소스와 무관한 전역 규칙이다.

| 블록 | 전체 | 조건부 |
|---|---:|---:|
| `CORE DIRECTIVE: SOURCE ADHERENCE` | 5,453 | 3,323 (62%) |
| `VIDEO ANALYSIS DIRECTIVE` | 2,951 | 2,951 (100%) |
| `REFORMAT REQUESTS` | 1,119 | 1,119 (100%) |
| **합** | | **7,393 / 21,208 = 약 35%** |

→ **Step 7 도 블록 이동이 아니라 줄·하위섹션 단위 분해여야 한다.** `paper_search` 에 적용한 논리(§9-2)와 같다.

영상 규칙은 `CORE DIRECTIVE` 안에도 중첩돼(`[VIDEO ANALYSIS STRATEGY]`) **두 블록에 흩어져 있다.**

### 7-3. 🟡 재구성 규칙이 두 층에 중복돼 있다

base 의 `[REFORMAT REQUESTS]`(1,119자)와 [generator.ts:192](../../server/agent/nodes/generator.ts#L192)의
턴 규칙(338자)이 같은 주제다. 주석이 이유를 적어 뒀다:

> *정적 프롬프트의 `[REFORMAT REQUESTS]` 규칙만으로는 안 먹혔다 — 직전 턴이 빈 응답이었는데 제품 4개짜리 표를 만들어낸 사례가 있다.*

**전역 층이 실패해서 턴 층에 같은 규칙을 다시 넣은 것이다.** 계층화의 관점에서는 중복이지만,
단순 제거 대상이 아니다 — 실측으로 필요성이 증명된 중복이다. 재배치 시 **어느 쪽이 실제로 듣는지**를
먼저 재야 한다.

### 7-4. 🟡 `INTENT_FOCUS_HINTS` 가 힌트가 아니다 (피드백 §5 — 확인됨)

`paper_search` 정책 6,534자 내부 블록:

```
[INTENT FOCUS: RESEARCH PAPERS]                    → 의도 정책
[RETRACTED PAPERS]                                 → 의도 정책
[WHAT summary IS — READ summaryKind BEFORE QUOTING] → 의도 정책
[PROSE RULES — CRITICAL]                           → 혼재
```

이름이 담을 수 있는 범위보다 내용이 넓어, 갈 곳 없는 규칙이 전부 여기로 흘러든다.
`sports` 는 정책이 **0자**인데 `chart` 렌더러 3,486자를 받는다. 이건 결함의 증거가 아니라
**renderer 와 policy 가 독립 축이라는 증거**다 — 표현 형식만 필요하고 지켜야 할 도메인 규칙이 없는
의도는 정상적으로 존재할 수 있다.

⚠️ 다만 `sports` 가 **의도적으로 정책이 없는 것인지, 빠뜨린 것인지는 확인되지 않았다.**
실시간 스코어는 `[ANTI-HALLUCINATION DIRECTIVE]` 가 전역으로 다루고 있어 없어도 되는 것처럼 보이지만,
Step 3 에서 판정해야 한다.

### 7-5. 🟡 턴 규칙 6개가 회귀 검사를 못 받는다 (피드백 §7 — 확인됨)

인라인 리터럴 2,865자. 같은 파일에 정답 패턴이 이미 있다:

> [generator.ts:181](../../server/agent/nodes/generator.ts#L181) 주석 — *규칙 본문은 card-followup.ts 에 있다(하니스가 임포트해서 **문구 자체를 검사**한다. 소스 grep 은 문구가 바뀌면 조용히 통과한다).*

8개 중 3개만 이 패턴을 받았다. 나머지는 누가 문구를 바꿔도 `npm test` 가 초록이다.

---

## 8. 분류 기준 — Scope × Volatility

주제로 나누면 다시 섞인다. 두 축으로 가른다.

| 규칙 | Scope | Volatility | 귀속 |
|---|---|---|---|
| 출처 위조 금지 | global | static | Integrity |
| 표·코드·수식·Response Shape | global | static | Response Contract |
| chart JSON schema | intent | static | Renderer Contract |
| 철회 논문 처리 | intent | static | Intent Policy |
| 영상·URL·문서 분석 지침 | **source** | static | ⚠️ 축이 없다 — 아래 |
| 재구성 요청 규칙 | turn | dynamic | Turn Policy |
| 현재 시각 · 카드 데이터 | request | runtime | Runtime Context |

> 🔴 **영상·제공본문은 의도 축이 아니라 입력 소스 축이다.** `INTENT_RENDERERS` 로는 가를 수 없다.
> 새 축이 필요하고, 이게 §7-2 를 실제로 고치는 방법이다.
>
> 축 이름은 `ATTACHMENT` 가 아니라 **`SOURCE`** 로 잡는다 — **URL 은 첨부가 아니지만 같은 축**이다.
> 하위 구분은 발명하지 않고 `CORE DIRECTIVE` 가 **실제로 분기하는 태그 7종**을 그대로 쓴다:
>
> ```
> SOURCE_SECTIONS
> ├─ URL_CONTENT
> ├─ EXTRACTED_DOCUMENT_CONTENT · PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT
> ├─ CSV/XLSX DATA CONVERTED TO MARKDOWN TABLE
> ├─ YOUTUBE_VIDEO_INFO · VIDEO_ANALYSIS_SUMMARY
> └─ PAPER INFO
> ```
>
> 프롬프트가 이미 이 태그들로 분기하고 있다 — **산문으로 하던 분기를 코드로 옮기는 것**이지
> 새 분류를 만드는 게 아니다.

---

## 9. 초판 정정

| # | 초판 서술 | 정정 |
|---|---|---|
| 1 | 조립 순서가 `base → 렌더러 → 의도 → 턴` | **틀림.** 턴이 렌더러·의도보다 앞이다(§5). 파일 구조를 보고 추정했고 조립 지점을 순서대로 읽지 않았다 |
| 2 | `[RETRACTED PAPERS]` 를 전역 Integrity 로 이동 | **틀림.** 철회 논문 처리는 `paper_search` 전용이다. 전역으로 올리면 모든 의도가 PubMed 어휘를 진다. `PROSE RULES` 안에서도 *"identifier 를 지어내지 마라"* 만 전역이고 *"미분류 ≠ 저품질"*·*"PubMed 는 생의학만 색인"* 은 전용 — **블록이 아니라 줄 단위로 갈라야 한다** |

| 3 | 2판: *"base 21,208자가 한 번도 캐시에 걸리지 않는다"* | **증명되지 않은 단정.** 9/22 코퍼스를 세니 히트 **17/252(6.7%)** 가 있었다. 더 중요한 건 그 프로브가 **시각 블록 없이 완전 고정 prefix** 로 돌았다는 점이다 — **prefix 를 지켜도 6.7%** 이므로 캐시는 계층화의 근거가 못 된다(§7-1) |
| 4 | 2판: *"base 의 45%가 조건부"* | **블록 단위로 세서 과했다.** 줄 단위로 분류하면 `CORE DIRECTIVE` 는 62%만 조건부다. 실제 **약 35%**(§7-2) |

정정 3·4 는 외부 피드백이 "단정을 낮추라"고 지적한 곳이다. **낮추는 대신 쟀다** — 결과는 양쪽 다
원래 주장보다 약하지만, 숫자가 붙으면서 **결론이 바뀌었다**(캐시는 근거에서 빠지고, Step 7 은 줄 단위 분해가 된다).

피드백에서 받아들이지 않은 것 하나: `prompt.ts ≈ 45KB` 는 실제 **69,309 bytes** 다(`generator.ts` 73,987 은 맞다).
결론에는 영향이 없지만 그 문서의 수치가 일부 추정임을 뜻하므로, 나머지도 그대로 인용하지 않았다.

---

## 10. 작업 순서

| 단계 | 작업 | 위험 | 수용 기준 |
|---:|---|---|---|
| 0 | Snapshot 확보 (4개 언어 × 19개 의도 × 대표 턴) — **계층별 해시 포함** | 매우 낮음 | `baseHash`·`rendererHash`·`intentPolicyHash`·`turnPolicyHash`·`runtimeContextHash` + **`neutralHash`·`geminiFinalHash`·`openaiFinalHash`** |
| 1 | 인라인 턴 규칙 6개를 **도메인별** 순수 함수로 추출 | 낮음 | 조립 결과 바이트 동일 |
| 2 | 각 턴 빌더에 contract test | 낮음 | 하니스가 문구를 직접 검사 |
| 3 | Renderer / Intent 경계 정리 (`sports` 등 축 어긋남) | 낮음 | |
| 4 | `INTENT_FOCUS_HINTS` → `INTENT_POLICIES`, 대형 의도는 독립 파일 | 중 | 이름과 내용 일치 |
| 5 | `paper_search` 정책 분리 — **줄 단위** 전역/전용 판별 | 중 | 전역 후보는 다른 의도 적용 가능성을 먼저 검증 |
| 6 | base → `integrity.ts` / `response.ts` 분리 | 중 | **4개 언어 전부 바이트 동일** |
| 7 | 조건부 블록을 첨부 축으로 이동 (§7-2) — **줄 단위 분해** | 중~높음 | 블록 통째 이동 금지. 전역 줄은 남기고 조건부 줄만 옮긴다 · 영상·URL 턴 회귀 측정 동반 |
| 8 | 시각 블록 위치 + Runtime/Turn 배치 A/B (§7-1) | **높음** | 프롬프트 위치가 응답을 바꾼다 — 별도 실험 |
| 9 | 장문 코퍼스 기반 가독성 평가 | 낮음 | §11 |

> 🔴 **Step 0 의 해시는 층별로 남긴다.** 최종 프롬프트 해시 하나만 두면 회귀가 났을 때
> *"프롬프트가 달라졌다"* 에서 끝난다. 층별로 남기면 `renderer unchanged · intent unchanged · turn changed`
> 까지 바로 좁혀진다. **공급자별 최종 해시를 따로 남기는 이유가 여기 있다** — 문제 자체가 최종 조립 경로가
> 둘로 갈린다는 것이므로(§4), `neutral unchanged · openai final changed` 를 한 줄로 읽을 수 있어야 한다.

**1~3 은 내용·순서를 바꾸지 않고 구조만 바꾼다.** 여기까지가 안전 구간이다.
4 이후부터는 응답이 바뀔 수 있으므로 측정을 동반한다.

### 10-1. PR 분할

한 PR 에 다 넣으면 결과가 달라졌을 때 원인을 못 좁힌다. 단계 경계 = PR 경계로 간다.

| PR | 범위 | 성격 |
|---|---|---|
| PR1 | Step 0~2 — 턴 규칙 추출 + contract test | behavior-preserving |
| PR2 | Step 3~4 — renderer/intent 경계 · `INTENT_POLICIES` 개명·분할 | behavior-preserving(개명) |
| PR3 | Step 5~6 — `paper_search` 줄 단위 분리 · base 2분할 | 경계 이동 |
| PR4 | Step 7 — 조건부 소스 블록을 `SOURCE_SECTIONS` 로 | **behavior-changing** |
| PR5 | Step 8 — 배치 A/B 실험 | **behavior-changing · 실험** |

파일명에 `01-`·`02-` 를 넣지 않는다 — 순서를 파일명에 박으면 재배치가 어렵다.
**순서는 `assemble.ts` 가 선언**하고, §4 대로 **두 공급자 경로가 모두 그것을 통과**해야 한다.

---

## 11. 측정

### 11-1. 골든 테스트

4개 언어(Korean·English·Spanish·French) 전부. 리팩터링 단계(1·6)의 수용 기준은 `before === after`.

### 11-2. 가독성은 아직 한 번도 측정된 적 없다

9/22 코퍼스(252건)는 TC 답변이라 쓸 수 없다:

```
본문 길이 평균 264자 / p90 554 / 최대 840 · 제목 없는 장문(>800자) 0건
```

→ **장문 코퍼스 20~30건**이 따로 필요하다. 구성: 기술 비교 · 긴 설명 · 문서 분석 · 코드 생성 ·
배포 절차 · 연구 조사 · 표+분석 · 다단계 의사결정.

**지표를 3단계로 나눈다.** 2판은 이걸 hard/warning 둘로 적었는데, hard 쪽에 넣은 것들이
사실은 **판정 기준이 아니라 측정값**이었다 — `table 수 = 0` 은 정상 답변에서도 얼마든지 나온다.

| 등급 | 뜻 | 항목 |
|---|---|---|
| **metric** | 세기만 한다. 합격·불합격 없음 | 총 길이 · 문단 수 · heading 수 · list 수 · table 수 · heading/1000자 |
| **warning** | 임계값을 넘으면 경고. 사람이 본다 | 최장 문단 > 임계 · p90 문단 > 임계 · bold 밀도 과다 · 항목 2개 이하 목록 |
| **contract fail** | 깨진 출력. 빨갛게 죽인다 | 닫히지 않은 코드블록 · 잘린 표 · 렌더러 JSON 파싱 실패 · 단일 `$` 누출 |

**contract fail 만 CI 를 막는다.** metric 은 추세로 보고, warning 은 리뷰 재료다.
이렇게 갈라야 "가독성 하니스가 늘 빨갛다"는 상태를 피할 수 있다 —
`lint` 를 `verify` 에 넣지 않은 이유([README §5-4](../../README.md))와 같은 판단이다.

### 11-3. 프롬프트 검증에 모델을 섞지 않는다

```
모델 고정 · 코퍼스 고정 · thinking 고정  →  OLD prompt vs NEW prompt
```

3.6/3.7/3.8 비교와 **분리한다**. 9/22 측정에서 배운 규율과 같다 — 두 변수를 함께 움직이면 무엇이
원인인지 말할 수 없다.

---

## 12. 이번에 하지 않을 것

**코드 의도 신설.** [state.ts:5-24](../../server/agent/state.ts#L5-L24) 의 `IntentType` 에 `code`·`sql` 이 없어
코드 요청은 전부 `general` 로 들어온다. `[CODE GENERATION STANDARDS]`(1,430자)를 의도 층으로 내리면
**정작 필요한 곳에서 사라진다.** 하려면 라우터에 의도를 추가해야 하고, 그건 프롬프트 정리가 아니라
**라우팅 변경**이라 별건이다.

---

## 13. 9/23 선반영된 가독성 개선 5건

계층화와 무관한 **내용 수정**이다. 검증: `npm run typecheck` exit 0 · `npm test` 전부 통과.

| # | 대상 | 내용 |
|---|---|---|
| 1 | [ChatMessage.tsx](../../components/ChatMessage.tsx) `li` | `break-all` 제거 — 넘치지 않아도 아무 글자에서나 끊었다 |
| 2 | [ChatMessage.tsx](../../components/ChatMessage.tsx) `td` | `whitespace-nowrap` 해제 — 긴 셀 하나가 표 전체를 가로 스크롤로 만들었다. `th` 는 유지 |
| 3 | `prompt.ts` | `[RESPONSE SHAPE]` 신설 — 기본은 산문, 불릿은 병렬 3개 이상, 제목은 섹션 2개 이상, 답부터 |
| 4 | `prompt.ts` | `[RESPONSE COMPLETENESS]` 모순 해소 — 간결함은 산문을, 완전성은 실행·데이터 산출물을 지배 |
| 5 | `prompt.ts` | 중복 `[TABLE FORMATTING]` 블록을 `[TABLE STYLE GUIDE]` 로 흡수 |

🔴 **효과는 측정되지 않았다.** 회귀 하니스는 라우팅·정책 계약만 본다(§11-2).
