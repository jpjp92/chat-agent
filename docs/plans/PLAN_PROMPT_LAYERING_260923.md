# 프롬프트 계층화 — 전수 검토와 재배치 계획

> 작성일: 2026-09-23 (4판 — 외부 피드백 3회 반영. 캐시·조건부 비율은 실측으로 교체, 소스 축·지표 등급 정정)
> 상태: **설계 — 실행 전**
> 관련: [DEV_260922](../logs/2026/09/DEV_260922.md) · 가독성 개선 5건은 9/23 선반영(§11)

---

## 1. 이 문서의 결론 먼저

프롬프트 계층이 없는 게 아니다. **6층이 이미 있고, 그중 3층의 이름이 내용과 다르다.**
따라서 할 일은 새 프레임워크 도입이 아니라
**이미 있는 구조를 명시화하고 규칙을 Scope·Volatility 에 맞는 자리로 옮기는 리팩터링**이다.

초판~4판에서 **다섯 가지를 틀리게 적었고 §9 에 정정해 두었다.**
그중 5판(9/24)의 것이 가장 크다 — **작업 순서의 0단계가 실행 불가능했다**(§7-6).
특히 **계층화의 근거는 캐시가 아니다** — 실측해 보니 암묵 캐싱은 고정 prefix 에서도 6.7% 밖에 안 걸린다(§7-1).

---

## 2. 검토 방법

추정하지 않고 실행해서 쟀다.

- 계층 크기: `npx tsx` 로 `getSystemInstruction` · `getRendererSections` · `getIntentPolicy` 를
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


### 7-6. 🔴 조립 결과를 **관측할 수 없다** — 그리고 조립에 I/O 가 섞여 있다

2026-09-24 실행 가능성 점검에서 나왔다. **초판~4판이 세운 작업 순서를 무효로 만드는 발견이다.**

**① 이음매가 없다.** [generator.ts:75](../../server/agent/nodes/generator.ts#L75) 의 `finalInstruction` 은
`createGeneratorNode` 안 클로저의 지역 변수다. export 도 return 도 없다:

```ts
export const createGeneratorNode = (systemInstructionBase, …) => {
    return async (state) => {
        let finalInstruction = systemInstructionBase;   // ← 밖으로 나가지 않는다
```

관측하려면 노드를 실제로 돌려야 하고, 돌리면 곧바로 네트워크 호출로 간다.
**즉 스냅샷을 뜰 수 없고, `before === after` 수용 기준이 성립하지 않는다.**

**② 조립이 순수하지 않다.** 조립 구간(75~206행) 안에 `await` 이 하나 있다:

```
151: const status = … ? await fetchHospitalOpenStatus(named, areaCodes, now) : null
```

**프롬프트를 만드는 도중에 심평원 API 를 친다.** 그냥 떼어내면 `assemblePrompt()` 가 네트워크를
타는 함수가 되고, 골든 테스트가 돌 때마다 외부 API 에 의존한다.

§8 이 층으로는 이미 갈라 뒀다 — **Runtime Context(사실·I/O)** 와 **Turn Policy(규칙·순수 문자열)**.
**코드에서 그 둘이 한 자리에 엉켜 있다는 사실**을 §6 에 적지 않았던 것이 누락이다.

→ 처방: 이음매를 만들 때 **사실 수집(async)과 규칙 조립(pure)을 가른다.** 심평원 조회는 호출부에
남기고 결과만 인자로 넘긴다. 그래야 `assemblePrompt` 가 순수 함수가 되고 골든 테스트가 성립한다.

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

| 5 | 초판~4판: Snapshot 이 0단계, 위험 **"매우 낮음"** | **실행 불가능했다.** `finalInstruction` 이 클로저 지역 변수라 뜰 수 없고(§7-6), 2·7단계의 `before === after` 가 전부 거기 매달려 있었다. **이음매 만들기가 0단계**가 되고 그 단계만은 바이트 동일로 증명할 수 없다(§10-2). 덤으로 조립 안에 심평원 API 호출이 섞여 있다 — 떼어내면 골든 테스트가 외부 API 에 의존한다 |

정정 5 는 **계획을 코드에 대 보기 전에는 안 보였다.** §6 인벤토리는 "무엇이 얼마나 있나"를 셌고
그건 전부 맞았는데, "그걸 **꺼내 볼 수 있나**"는 묻지 않았다. 세는 것과 만지는 것은 다른 질문이다.

정정 3·4 는 외부 피드백이 "단정을 낮추라"고 지적한 곳이다. **낮추는 대신 쟀다** — 결과는 양쪽 다
원래 주장보다 약하지만, 숫자가 붙으면서 **결론이 바뀌었다**(캐시는 근거에서 빠지고, Step 7 은 줄 단위 분해가 된다).

피드백에서 받아들이지 않은 것 하나: `prompt.ts ≈ 45KB` 는 실제 **69,309 bytes** 다(`generator.ts` 73,987 은 맞다).
결론에는 영향이 없지만 그 문서의 수치가 일부 추정임을 뜻하므로, 나머지도 그대로 인용하지 않았다.

---

## 10. 작업 순서

| 단계 | 작업 | 위험 | 수용 기준 |
|---:|---|---|---|
| **0** | ✅ **2026-09-24 완료** — **이음매 만들기** — 조립을 `assemblePrompt(state, facts)` 로 추출. **사실 수집(async)과 규칙 조립(pure)을 가른다**(§7-6) | 낮음 **(코드 변경)** | 순서·문자열 **일절 미변경**. 검증은 행위 수준 — §10-2 |
| 1 | ✅ **2026-09-24 완료** — Snapshot 확보 (`tests/test-prompt-assembly.mts`, 골든 41건) | 매우 낮음 | `baseHash`·`rendererHash`·`intentPolicyHash`·`turnPolicyHash`·`runtimeContextHash` + **`neutralHash`·`geminiFinalHash`·`openaiFinalHash`** |
| 2 | 인라인 턴 규칙 6개를 **도메인별** 순수 함수로 추출 ✅ **2026-09-24 완료** | 낮음 | 조립 결과 바이트 동일 |
| 3 | 각 턴 빌더에 contract test ✅ **2026-09-24 완료** | 낮음 | 하니스가 문구를 직접 검사 |
| 4 | Renderer / Intent 경계 정리 (`sports` 등) ✅ **2026-09-24 완료** | 낮음 | §10-3 의 판정 기준을 따른다 → **§10-5** |
| 5 | `INTENT_FOCUS_HINTS` → `INTENT_POLICIES`, 대형 의도는 독립 파일 ✅ **2026-09-24 완료** | 중 | 이름과 내용 일치 → **§10-6** |
| 6 | `paper_search` 정책 분리 — **줄 단위** 전역/전용 판별 ✅ **2026-09-24 판정 완료(이동 없음)** | 중 | 전역 후보는 다른 의도 적용 가능성을 먼저 검증 → **§10-7** |
| 7 | base → `integrity.ts` / `response.ts` 분리 ✅ **2026-09-24 완료** | 중 | **4개 언어 전부 바이트 동일** → **§10-8** |
| 8 | 조건부 블록을 소스 축으로 이동 (§7-2) — **줄 단위 분해** | 중~높음 | 블록 통째 이동 금지. 전역 줄은 남기고 조건부 줄만 옮긴다 · 영상·URL 턴 회귀 측정 동반 |
| 9 | 시각 블록 위치 + Runtime/Turn 배치 A/B (§7-1) | **높음** | 프롬프트 위치가 응답을 바꾼다 — 별도 실험 |
| 10 | 장문 코퍼스 기반 가독성 평가 | 낮음 | §11 |

> 🔴 **초판~4판은 Snapshot 을 0단계로 두고 "위험 매우 낮음"이라 적었다. 불가능한 순서였다**(§7-6).
> 뜰 수 없는 스냅샷에 2·7단계의 `before === after` 가 매달려 있었다. 순환이다:
>
> ```
> 턴 규칙 추출 검증  ←  스냅샷  ←  이음매  ←  코드 변경(= 추출이 하려던 일)
> ```
>
> 그래서 **이음매가 0단계**가 되고, 그 단계만은 바이트 동일로 증명할 수 없다(§10-2).

### 10-2. 0단계는 무엇으로 검증하나 — 부트스트랩

바이트 동일을 증명할 수단을 **만드는 단계**라 그 수단을 쓸 수 없다. 둘을 함께 건다:

1. **기계적 이동만 한다.** 순서·문자열·조건을 일절 손대지 않고 코드만 옮긴다. diff 가 이동으로만
   읽혀야 하며, 한 줄이라도 문구가 바뀌면 그건 0단계가 아니다.
2. **행위 수준으로 잰다.** [live-paper-multiturn.mts](../../tests/manual/live-paper-multiturn.mts) 를 전후로 돌린다
   (2026-09-23 에 오탐 2건을 고쳐 둔 그 프로브다 — §13). 바이트가 아니라 **계약이 유지되는지**를 본다.
   ⚠️ 이 프로브는 실패가 흔들린다. **전후 각 7회 이상** 돌리고 비율로 비교한다.
   🔴 처음엔 "3회 이상"으로 적었다가 **2026-09-24 PR1 에서 부족하다는 게 드러났다** — 변경 후 첫 3회가
   전부 같은 검사에서 깨져 회귀처럼 보였는데, 4회를 더 돌리니 전부 통과해 **3/7 로 변경 전(3/10)과 같은
   수준**이었다. 앞 3회 연속 실패가 우연이었다. 3회로는 이런 연속이 오판을 부른다.

### 10-3. `sports` 판정 기준 (4단계)

4판은 *"의도적 부재인지 누락인지 Step 3 에서 판정"* 이라고만 적고 **무엇으로 가를지 안 적었다.**
기준은 이렇게 둔다 — **그 의도에서만 참인 규칙이 있는가**:

| 물음 | 예 → 정책 필요 | 아니오 |
|---|---|---|
| 그 의도의 도구 결과를 다룰 때만 적용되는 규칙이 있나 | 논문의 철회·초록없음 처리 | 표현 형식뿐이면 렌더러 스펙으로 충분 |
| 그 도메인에서만 금지되는 추론이 있나 | 법률의 확정 판단 금지 | 전역 규칙으로 이미 덮이면 불필요 |

`sports` 는 실시간 스코어 추측 금지가 **이미 `[ANTI-HALLUCINATION DIRECTIVE]` 에 전역으로 있다.**
따라서 현재 0자는 **정상일 가능성이 높다** — 다만 `worldcup-tool` 결과 해석 규칙이 필요한지는
4단계에서 도구 출력을 보고 확정한다.

> 🔴 **해시는 층별로 남긴다(1단계).** 최종 프롬프트 해시 하나만 두면 회귀가 났을 때
> *"프롬프트가 달라졌다"* 에서 끝난다. 층별로 남기면 `renderer unchanged · intent unchanged · turn changed`
> 까지 바로 좁혀진다. **공급자별 최종 해시를 따로 남기는 이유가 여기 있다** — 문제 자체가 최종 조립 경로가
> 둘로 갈린다는 것이므로(§4), `neutral unchanged · openai final changed` 를 한 줄로 읽을 수 있어야 한다.

### 10-5. 4단계 결과 (2026-09-24)

**코드 변경 없음.** 19개 의도를 전수로 재서 경계가 이미 일관됨을 확인했고, 그 일관성을
하니스에 고정했다. 4단계는 "고칠 게 있으면 고친다"가 아니라 **"경계가 맞는지 판정한다"** 였다.

**전수 측정** — 의도 정책이 `json:X` 를 요구하는데 그 턴에 X 스펙이 안 실리는 경우:

| 의도 | 요구 | 스펙 실림 | 판정 |
|---|---|---|---|
| `drug_id` | drug | ✅ | 맞음 |
| `biology` | bio, smiles | ✅ ✅ | 맞음 |
| `chemistry` | smiles | ✅ | 맞음 |
| `physics` | diagram | ✅ | 맞음 |
| `astronomy` | constellation | ✅ | 맞음 |
| 나머지 14개 | (긍정 요구 없음) | — | 맞음 |

**고아 0건.** `INTENT_POLICIES` 와 `INTENT_RENDERERS` 는 서로를 모르는 두 파일인데
한쪽만 고치면 **스키마 없이 블록을 만들라고 시키는** 상태가 되고, 그 증상은 응답이
그럴듯한 오류 JSON 이 되는 것이라 조용하다. `tests/test-prompt-assembly.mts` 에 검사로 걸었고
`astronomy: []` 로 변조해 **실제로 빨개지는지 확인**했다(경계 검사 + 골든 2건 red).

#### `sports` 판정 — **0자는 누락이 아니라 배치다**

§10-3 의 물음에 답하면 *"그 의도에서만 참인 규칙이 있나"* → **있다**:
팀명 한국어 표기, `[NOT_DETERMINED]` 처리, 순위·숫자 변형 금지.

그런데 그 규칙들은 **이미 존재한다** — [worldcup-tool.ts](../../server/agent/worldcup-tool.ts) 의
`INSTRUCTION` 이 도구 결과 뒤에 붙여 보낸다. 프롬프트로 올리면:

- **중복**이 된다 (도구 결과에도 그대로 남으므로)
- 도구를 **안 탄 sports 턴**(과거 월드컵 질문은 라우터가 `general` 로 되돌린다 — `router.ts:453`)
  에까지 규칙이 걸린다

→ **현행 유지.** 다만 0자는 이제 **하니스가 고정한다.** 누가 나중에 채우면 거기서 깨지고,
그때 *"도구 출력의 것과 중복 아닌가"* 를 반드시 되묻게 된다. 0자를 주석으로만 적어 두면
아무도 안 읽는다.

> 🔴 곁다리 발견: **스포츠 순위 표를 끝까지 출력하라**는 규칙은 `sports` 가 아니라
> **`general` 정책**에 있다. 잘못된 위치처럼 보이지만 아니다 — 박스오피스·리그 순위 같은
> 비월드컵 순위표가 `general` 로 가고, `sports` 턴은 도구 지시가
> *"표 전체를 보여주거나, 필요한 부분만 뽑아"* 로 **부분 답변을 의도적으로 허용**한다.
> 두 규칙이 충돌하므로 합치면 안 된다.

#### 골든을 5개 -> 19개로

기존 5개만 박아 두면 6~8단계(`paper_search` 줄 단위 분리, base 2분할, 조건부 블록 이동)가
**고정되지 않은 14개 의도를 조용히 바꾼다** — 그 단계들이 건드리는 게 정확히 전역 블록이라
모든 의도에 걸린다. 넓히면서 **기존 5개 값은 한 글자도 안 바뀌었다**(= 넓힘 자체는 무해).
골든 개수와 의도 개수가 어긋나면 깨지는 검사도 함께 걸었다.

### 10-6. 5단계 결과 (2026-09-24)

**개명** — `INTENT_FOCUS_HINTS` → `INTENT_POLICIES`, `getIntentFocusHint` → `getIntentPolicy`.
참조 8곳(서버 2 · 하니스 1 · 수동 프로브 5) 전부. "hint" 는 참고사항처럼 읽히는데 내용은
`You MUST call the weatherTool` 같은 **강제 규칙**이다 — 이름이 내용을 속이면 다음 사람이
여기에 참고사항을 더 넣는다. 7-4 가 지적한 그 문제다.

**분할** — `paper_search`·`arxiv_search` 를 [intent-policy-paper.ts](../../server/agent/intent-policy-paper.ts) 로.
이 둘이 10,710자로 **의도 정책 전체의 절반을 넘는다**. 나머지 17개가 스크롤 아래로 밀려 있었다.
`drug_info`(1,706) · `medical_qa`(1,083) 는 남겼다 — 파일로 뺄 만한 크기가 아니다.

#### 🔴 옮기다 발견: 1,693자가 두 정책에 글자 그대로 중복

두 정책의 **9번째 줄부터 14줄이 완전히 동일**했다 — 산문 3문단 규칙 + 인용 번호 규칙.
`PAPER_PROSE_AND_CITATION` 으로 합쳤다. **합치는 것은 바이트를 바꾸지 않는다**(같은 자리에
같은 문자열을 보간할 뿐) — 5개가 아니라 19개 골든이 박혀 있으니 그게 증명된다.

위험은 자수가 아니라 **한쪽만 고치게 되는 것**이었다. 근거: 그 구간에 이미
*"PubMed and arXiv sort by their own relevance"* 처럼 **두 DB 를 함께 말하는 문장**이 있다 —
애초에 공유가 의도였는데 두 벌로 복사돼 있었다. 다음 수정에서 갈라질 자리였다.

검증: 공유 상수에서 `Renumbering is silently wrong` 한 곳을 고치니
**`paper_search`·`arxiv_search`·`turn/paperFollowup` 3건이 함께 빨개졌다** — 공유가 실재한다.
분리된 채로였다면 한 건만 깨졌을 것이고, 그게 바로 조용히 갈라지는 증상이다.

DB 고유 규칙은 각 정책 꼬리에 남겼다 — PubMed 는 철회 목록·`summaryKind`·초록없음,
arXiv 는 프리프린트 고지. 이건 공유하면 **틀린다**.

#### 🔴 예정에 없던 수확: 소스 grep 35건이 한꺼번에 드러났다

정책을 파일로 옮기자 **문구는 한 글자도 안 바뀌었는데 `test-paper-card.mts` 35건이 빨개졌다.**
`prompt.ts` 를 **소스 텍스트로 읽고** 있었기 때문이다. 2026-09-23 에 11건을 결과 검사로
바꿔 뒀는데(§13) 이 파일은 남아 있었다 — **골든이 아니라 "파일 이동"이 찾아냈다.**

전부 export 된 정책 문자열(`getIntentPolicy`)을 보도록 바꿨다. 정규식이 `` \` `` 처럼
**TS 소스에서만 참인 이스케이프**를 쓰고 있던 것도 3건 나왔다 — 런타임 문자열엔 그냥 백틱이다.
그 3건은 "프롬프트를 검사한다"고 적혀 있었지만 실은 **소스 파일의 철자를 검사**하고 있었다.

그리고 그 과정에서 **조용히 통과하던 검사**를 찾았다:

```
prompt.indexOf('[RETRACTED PAPERS]') < prompt.indexOf('[PROSE RULES — CRITICAL]')
```

`[RETRACTED PAPERS]` 를 **통째로 지워도 통과한다** — `-1` 이 제일 작다. 순서를 지키려던 검사가
블록 소멸을 못 잡는다. `comesBefore()` 로 존재를 먼저 요구하게 고쳤고, 변조 시험으로
**1건 red -> 2건 red** 가 되는 것을 확인했다.

> 이게 소스 grep 의 두 얼굴이다: **텍스트가 움직이면 거짓으로 깨지고**(35건),
> **내용이 사라지면 조용히 통과한다**(순서 검사). 앞의 것은 시끄러워서 고치게 되지만
> 뒤의 것은 아무도 모른다.

#### 곁다리: 주석이 사실과 달랐다

`getIntentFocusHint` 주석은 *"Returns empty string for general intent"* 라고 적혀 있었다.
**틀렸다** — `general` 은 순위표 완전 출력 규칙 331자를 갖는다. 빈 것은 `sports` 뿐이다(§10-5).
개명하면서 바로잡았다.

### 10-7. 6단계 결과 (2026-09-24) — **옮기지 않는다**

`paper_search` 정책 42줄을 줄 단위로 갈랐다. 수용 기준이 *"전역 후보는 다른 의도 적용
가능성을 **먼저 검증**"* 이었고, 검증했더니 **옮기면 안 되는 것**으로 나왔다.

| 구분 | 줄 | 판정 |
|---|---|---|
| 두 논문 의도 공유 | 4·6~8·10·12·14~21 | ✅ 5단계에서 이미 상수로 분리(1,693자) |
| PubMed 전용 | 23~27(철회) · 29~33(`summaryKind`) · 40~41(수록 범위) | 전용 — arXiv 에 적용하면 **틀린다** |
| arXiv 전용 | 프리프린트 고지 | 전용 |
| **전역 후보** | 35(식별자 변조) · 37(반환값만) · 38(0건) · **39(장애≠없음)** | 아래 |

#### 39번 줄 — 전역인데 **옮길 수 없다**

먼저 전수로 쟀다. "장애를 없음으로 말하지 말라"는 **19개 의도 중 논문 2개에만** 있다.
다른 카드 도구(약국·병원·동물병원·법령·날씨)는 전부 실패할 수 있으니 공백처럼 보였다.

**두 번 검증해서 둘 다 뒤집혔다:**

1. **문구를 그대로 올리면 발동하지 않는다.** 39번 줄은 *"if the tool result carries an
   `error` field"* 라고 조건을 단다. 그런데 약국·병원·동물병원·법령은 실패를 `error` 필드가
   아니라 **`count: 0` + 한국어 `notice` 문자열**로 낸다 — 0건과 **구조가 완전히 같다.**
   조건이 맞는 필드가 없으니, 옮겨 놓으면 **한 번도 켜지지 않는 규칙**이 된다.
   커버리지처럼 보이는데 아닌 것은 규칙이 없는 것보다 나쁘다.

2. **이미 있다 — 다른 계층에.** [`buildEmptyCardRules()`](../../server/agent/card-followup.ts) 가
   **턴 계층**에서 같은 말을 한다:
   *"조회가 오류로 실패했다면 확인하지 못했다고 밝히세요. 실패를 결과 없음으로 바꿔 말하지 마세요."*
   `cardHasResults()` 가 카드 종류를 가리지 않으므로(`payload.error` 또는 `count === 0`)
   **모든 카드 의도에 이미 걸려 있고, 필요한 턴에만 걸린다.** 의도 계층으로 올리면 결과가
   멀쩡한 턴에도 실린다 — §7 이 지적한 "조건부를 전역으로 올리는" 바로 그 실수다.

→ **현행 유지.** 39번 줄은 중복이 아니라, 논문 턴에만 필요한 영어 문맥의 보강이다.

#### 🔴 대신 발견: 두 계층이 **같은 턴에 반대 방향으로** 말한다

PubMed 장애 턴(`error` + `count: 0`)을 실제로 조립해 봤다. 한 프롬프트 안에 **792자 간격**으로
둘 다 실린다:

| 계층 | 문구 | 방향 |
|---|---|---|
| 턴(한국어) | *"실패 안내만으로 끝나서는 안 됩니다. 사용자가 물은 주제에 대해 **아는 내용을 반드시 함께 주세요**"* | 기억으로 답하라 |
| 의도(영어) | *"never turn an outage into a verdict about the evidence"* | 근거 없이 판단하지 마라 |

정면 모순은 아니다 — "일반 지식 제공"과 "근거 판정"은 다르다. 그러나 **턴 규칙은
약국·법령용으로 쓰였다**("울릉도 약국"에 아는 걸 말해주는 건 무해하다). 그게 지금
**의학 근거 질문에도 발동한다.** 위험이 가장 큰 자리에서 압력이 반대로 걸린다.

⚠️ **측정한 것은 프롬프트 내용이지 응답이 아니다.** 모델이 실제로 틀린 답을 낸다는 관측은
없다 — 이걸 결함이라고 부르지 않는다(단발 관측으로 세 번 틀렸던 이력이 있다, §13).
확인 방법은 싸다: 논문 도구가 `error` 를 내도록 강제하고 프로브를 7회 돌린다(§10-2).
**응답이 바뀔 수 있으므로 PR5 로 뺀다.**

#### 곁다리로 메운 구멍

장애/0건을 가르는 검사가 **병원·약국에만** 있었다(2026-08-24 광진구 사건에서 생긴 것).
**동물병원·법령도 같은 모양**인데 빠져 있어 같은 루프에 넣었다. 타입이 아니라 한국어
문장이 구분자이므로, 검사가 없으면 리팩터링에서 조용히 합쳐진다.

### 10-8. 7단계 결과 (2026-09-24)

base 21,208자를 둘로 갈랐다 — [prompt-integrity.ts](../../server/agent/prompt-integrity.ts)(사실·출처·누설)와
[prompt-response.ts](../../server/agent/prompt-response.ts)(길이·서식·코드·언어).
`prompt.ts` 는 625 -> 479줄.

가른 기준은 주제가 아니라 **변경 속도**다. 응답 형태는 가독성 실험(§11)이 반복해 손대는 자리고,
무결성은 함부로 못 건드리는 자리다. 한 파일에 있으면 **표현을 고치다 무결성을 스친다.**

#### 순서는 조각이 아니라 조립부가 선언한다

`getSystemInstruction` 이 배열 하나로 순서를 선언하고, 조각은 두 파일에서 온다.
조각이 스스로 순서를 주장하면 조립부가 둘로 갈린다 — §4 가 지적한 바로 그 문제라 되풀이하지 않는다.

**`REFORMAT` 과 `VIDEO ANALYSIS` 는 일부러 `prompt.ts` 에 남겼다.** 무결성도 응답 형태도 아니라
**조건부**이기 때문이다(재구성 턴만 / 영상 턴만 — §7-2·7-3). 억지로 둘 중 하나에 넣으면 8단계에서
다시 꺼내야 한다. **남은 자리가 곧 다음 작업 목록**이다.

#### 검증 — 4개 언어 바이트 동일

| 언어 | 골든 | 결과 |
|---|---:|---|
| Korean | 21,208 | ✅ |
| English | 21,272 | ✅ |
| Spanish | 21,280 | ✅ |
| French | 21,294 | ✅ |

의도 19개 + 턴 6개 골든도 전부 불변. 배선이 실재하는지는 변조로 확인했다 —
`prompt-response.ts` 에서 한 단어(`plain prose` -> `plain text`)를 고치니 **29건이 빨개졌다**.

#### 또 소스 grep 3건

`test-chat-models.mts` 의 "한 줄 요약 서식" 검사가 `prompt.ts` 를 **소스로 읽고** 있었다.
블록이 파일을 옮기자 문구는 그대로인데 깨졌다 — **5단계와 같은 일이 또 났다**(§10-6).
조립된 base 를 보도록 바꿨고, 예시 검사는 소스의 `${lbl.summary}` 가 아니라 **실제로 찍히는
라벨**(`한 줄 요약`)을 보게 했다.

고치면서 하나 강화했다: `한 곳에 정의돼 있다` 는 검사가 실은 `.includes()` 였다 —
**두 곳에 있어도 통과한다.** 이름이 말하는 대로 등장 횟수를 세게 했다.

> 소스 grep 이 세 번째로 같은 방식으로 드러났다(11건 -> 35건 -> 3건). 공통점은
> **"프롬프트를 검사한다"고 적고 실제로는 파일의 철자를 검사"** 한 것이다. 남은 곳이 있는지는
> 다음 이동 때 또 드러날 것이고, 그때 고친다 — 미리 전수로 뒤지는 것보다 싸다.

**0~4 는 내용·순서를 바꾸지 않고 구조만 바꾼다.** 여기까지가 안전 구간이다.
5 이후부터는 응답이 바뀔 수 있으므로 측정을 동반한다.

### 10-4. PR 분할

한 PR 에 다 넣으면 결과가 달라졌을 때 원인을 못 좁힌다. 단계 경계 = PR 경계로 간다.

| PR | 범위 | 성격 |
|---|---|---|
| PR1 | 0단계 — 이음매 추출(사실/규칙 분리) | **구조만** · 행위 수준 검증(§10-2) |
| PR2 | 1~3단계 — 스냅샷 + 턴 규칙 추출 + contract test | behavior-preserving · 바이트 동일 |
| PR3 | 4~5단계 — renderer/intent 경계 · `INTENT_FOCUS_HINTS` → `INTENT_POLICIES` 개명·분할 | behavior-preserving(개명) |
| PR4 | 6~7단계 — `paper_search` 줄 단위 분리 · base 2분할 | 경계 이동 |
| PR5 | 8단계 — 조건부 소스 블록을 `SOURCE_SECTIONS` 로 | **behavior-changing** |
| PR6 | 9단계 — 배치 A/B 실험 | **behavior-changing · 실험** |

🔴 **PR1 을 반드시 혼자 보낸다.** 이음매 추출은 바이트 동일로 증명할 수 없는 유일한 단계라
(§10-2), 다른 변경과 섞이면 나중에 응답이 달라졌을 때 **원인을 이 PR 로 좁힐 수 없다.**

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
