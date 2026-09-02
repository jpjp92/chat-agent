# 검색 요청이 사라지던 두 경로 — 남의 API 제약과 논문 오라우팅

> 날짜: 2026-09-02
> 범위: 검색 게이트 공급자 인지([search-gate.ts](../../../../server/agent/nodes/search-gate.ts)), 라우터 논문 분기([router.ts](../../../../server/agent/nodes/router.ts)), 산출물 가드([intentRules.ts](../../../../server/agent/intentRules.ts)), 논문 종합단계 웹검색([search-signals.ts](../../../../server/agent/search-signals.ts) · [generator.ts](../../../../server/agent/nodes/generator.ts))

## 1. 최종 결론

사용자 화면 두 장에서 **"검색해"라고 말했는데 검색이 안 되는** 두 장면이 왔다. 증상이 비슷해 한 결함처럼 보였지만 **원인이 완전히 다르다.**

| # | 증상 | 원인 | 층 |
|---|---|---|---|
| 1 | *"지금은 실시간 검색 없이 학습된 지식 기준으로만 답할 수 있어요"* | **Gemini 의 물리 제약(TIER 400)이 OpenAI 턴에도 걸렸다.** 대화에 이미지가 한 번이라도 있으면 그 뒤 모든 턴에서 사용자의 명시 요청(300)이 눌린다 | 검색 게이트 |
| 2 | `클로드 skills 관련된 레포 검색` → **arXiv 논문 카드** | 라우터가 `paper_search`+`arxiv` 로 보냈고, 그 순간 웹으로 빠져나갈 구멍이 **하나도 없었다** | 라우터 + OpenAI 도구 배선 |

넷을 고쳤다. ① 게이트에 공급자를 알린다(원인) ② 라우터 프롬프트에 "문헌 vs 산출물" 부정 앵커 ③ 결정론적 산출물 가드(프롬프트가 뚫릴 때의 바닥) ④ 논문 카드 + 명시 요청이면 종합 단계에 웹 검색(가드까지 뚫릴 때의 2차 방어).

🔴 **두 결함 모두 "각 층은 제 일을 정확히 했는데 합이 틀린" 모양이다.** 400 은 진짜 물리 제약이고, `useWebSearch = !localFunctionTool && …` 는 툴 혼용 금지라는 옳은 정책이다. 어느 줄도 그 자체로는 버그가 아닌데, **자기 전제가 성립하지 않는 곳까지 따라갔다.**

## 2. 증상

두 장 모두 모바일 `chat-agent-dev.vercel.app`, **선택 모델이 GPT 계열**이다(5.4 mini / 5.6 luna). 이게 두 결함의 공통 조건인 줄 알았지만 아니었다 — ①만 OpenAI 전용이고 ②는 공급자와 무관하다.

1. 직전 턴이 이미지 분석인 대화에서 `ㅇㅇㅇ 저기 저장소 검색해서 확인해봐` → *"지금은 실시간 검색 없이 학습된 지식 기준으로만 답할 수 있어요."*
2. `클로드 skills 관련된 레포 검색` → *"arXiv에서는 Claude Skills 관련 GitHub 레포지토리를 직접 찾을 수 없습니다 … [1]"* — 사용자는 GitHub 를 물었는데 답변 근거가 arXiv 하나였다.

## 3. 원인 추적 ① — 없는 제약에 눌린 검색

### 3.1 400 은 정책이 아니라 물리 사실이다

[search-policy.ts](../../../../server/agent/search-policy.ts) 의 계층은 이렇게 적혀 있다.

> `400 이 300 보다 위인 것은 의도적이다 — 이미지가 붙어 있으면 사용자가 검색을 요청해도 Gemini API 가 grounding 을 거부한다. 물리적 사실이 사용자 의사보다 위다(정책이 아니라 제약).`

맞는 설계다. 문제는 **그 문장의 주어가 "Gemini API"라는 것**이다. OpenAI Responses 는 `input_image` 와 `web_search` 를 한 요청에 같이 보낸다([chat.ts](../../../../server/openai/chat.ts) `toInputContent` · `hostedWebSearch`). 그쪽엔 이 제약이 없다.

### 3.2 OpenAI 경로에는 탈출구가 아예 없었다

Gemini 경로에는 우회 가드가 있다([generator.ts](../../../../server/agent/nodes/generator.ts) `dropImageForSearch`) — 현재 턴에 이미지가 없고 사용자가 명시적으로 검색을 요청하면 `forceTextOnly` 로 미디어를 빼고 검색을 켠다. 그런데 OpenAI 분기는 그 자리에 **`false` 를 하드코딩**하고 있었다.

게다가 그 호출에 넘기는 `hasMultimodalContent` 는 `buildSdkContents(state.messages, false)` 가 **히스토리 전체**를 훑어 낸 값이다. 신호 이름은 `현재 턴 멀티모달` 인데 실제로는 대화 전체다 — 그래서 **이미지가 한 번 등장한 대화는 끝까지 검색이 꺼진다.**

### 3.3 같은 입력, 경로만 바꿔 재현

```
[SearchPolicy] OFF by multimodal(400) | trace: user-explicit=on(300), router-llm=on(100)
  OpenAI 경로  → useGoogleSearch=false
[SearchPolicy] ON by user-explicit(300)
  Gemini 경로  → useGoogleSearch=true
```

trace 가 결정적이다. 사용자의 명시 요청(300)과 라우터 판정(100)이 **둘 다 on 을 냈는데** 400 하나에 졌다.

> 부수 발견: [search-gate.ts](../../../../server/agent/nodes/search-gate.ts) 의 `historyHasImage` 는 `inlineData`/`fileData` 만 보고 `type: 'image_url'` 을 보지 않는다. 인라인 이미지는 이 신호에 안 걸리고 `multimodal` 이 대신 끄고 있었다 — 이름과 실제가 어긋나 있다. 이번 수정 범위 밖이라 그대로 두었다(400 자체를 공급자로 가르면 두 신호 모두 OpenAI 에서 안 나온다).

## 4. 원인 추적 ② — "레포 검색"이 arXiv 로 간 길

### 4.1 규칙이 아니라 라우터 LLM 이다

`레포`·`저장소`·`github` 는 레포 전체 어디에도 없다. [intentRules.ts](../../../../server/agent/intentRules.ts) 의 `paper_search` 폴백은 `(논문|연구|문헌|paper|study)` 를 요구하므로 이 발화는 규칙상 `general` 이다. 즉 판정을 내린 건 라우터 LLM 하나뿐이다.

### 4.2 프롬프트를 파일에서 그대로 뽑아 재현

router.ts 의 프롬프트 템플릿을 소스에서 슬라이스해 `ROUTER_MODEL`(gemini-2.5-flash)에 그대로 먹였다. temperature 0 · 2회씩:

| 발화 | intent | paper_source |
|---|---|---|
| **클로드 skills 관련된 레포 검색** | **paper_search** | **arxiv** |
| 클로드 skills 레포지토리 검색 | general | none |
| claude skills repo 검색 | general | none |
| 클로드 skills 관련 자료 검색 | general | none |
| 레포 검색 / 파이썬 레포 검색 | general | none |

**단일 토큰 버그가 아니라 조합이다.** `레포지토리`·`repo` 로 풀어 쓰면 정상이고 `레포` 단독도 정상인데, 축약형 `레포` 가 해소되지 않은 자리에서 `관련된 … 검색` 이 프롬프트 예시 `"관련 논문 찾아줘"` 와 같은 모양이 되고, 주제(AI)가 `paper_source` 의 arxiv 정의(*"algorithms and computing, machine learning"*)로 그대로 떨어진다.

### 4.3 왜 대가가 컸나 — 안전망이 둘 다 없다

1. **`isNonBiomedicalPaperTopic` 은 `arxiv_search` 에 일부러 적용하지 않는다.** 그 가드가 잡는 CS·공학 어휘는 arXiv 에서는 정답이기 때문이다(옳은 판단). 결과적으로 **arXiv 쪽에는 가드가 하나도 없었다.**
2. intent 가 `arxiv_search` 가 되면 [generator.ts](../../../../server/agent/nodes/generator.ts) 의 `useWebSearch = !localFunctionTool && searchRequested` 가 **항상 false** 다. `followupWebSearch` 는 `drug_info` 에만 켜져 있어 종합 단계에도 웹이 안 붙는다.

즉 라우터가 한 번 미끄러지는 순간 **사용자의 tier 300 요청이 통째로 사라지고** arXiv 만 남는다. 화면에 `[1]` 하나만 달렸던 이유다.

⚖️ 그리고 arXiv 는 PubMed 와 마찬가지로 **빈손으로 실패하지 않는다**(§DEV_260830 에 이미 적혀 있다 — `한국어 통사론` → astro-ph *Korean VLBI Network*). 오라우팅이 조용히 통과한다.

## 5. 수정

### 5.1 게이트에 공급자를 알린다 (원인)

`decideGoogleSearch` 에 `provider?: 'gemini' | 'openai'` 를 추가하고, TIER 400 두 신호를 `provider === 'gemini'` 안으로 넣었다. 걷어내는 건 **400 뿐이다** — 200(URL·문서·영상 본문이 근거)·100(분류기)은 공급자와 무관한 판단이라 그대로 적용된다.

기본값을 `'gemini'` 로 둔 것은 기존 호출부의 동작을 한 글자도 바꾸지 않기 위해서다. OpenAI 분기에서만 `provider: 'openai'` 를 넘긴다.

> 여기서 검색을 **켜는 게 아니라 끄지 않는 것**이다. 400 이 빠지면 300/100 이 평소대로 판정한다 — 실제로 "이미지 있는 대화 + 가공형 후속"은 여전히 off 다(하니스 Step7 두 번째 케이스).

### 5.2 라우터 프롬프트 — 부정 앵커

`paper_search` 와 `paper_source` 양쪽에 "받고 싶은 것이 **문헌**인가 **소프트웨어 산출물**인가"를 넣었다.

🔴 **1차 문안은 과교정했다.** *"레포·깃허브·라이브러리를 찾는 건 general"* 이라고만 적었더니 `깃허브 코파일럿 생산성 논문 있나` 까지 `none` 으로 내려갔다 — 깃허브가 **주제로만** 등장한 진짜 논문 요청인데. 기준을 바꿔 다시 적었다:

> *judge what the user wants DELIVERED, not what the subject is about … The deciding question: would a repository satisfy them, or does only a paper?*

### 5.3 결정론적 산출물 가드

```ts
export const resolvePaperArtifactIntent = (llmIntent: IntentType, text: string): IntentType =>
    (llmIntent === 'paper_search' || llmIntent === 'arxiv_search') && wantsSoftwareArtifact(text)
        ? 'general' : llmIntent;
```

`wantsSoftwareArtifact` = 산출물 어휘(레포·저장소·깃허브·오픈소스·라이브러리·패키지·SDK·프레임워크·소스코드)가 있고 **논문 어휘가 없을 때**. `연구` 를 논문 쪽에 포함한 것은 의도적이다 — 빠뜨렸을 때의 손실(진짜 논문 요청이 general 로 강등)이 반대 방향보다 크다.

⚖️ **오탐 비용이 낮은 방향으로 기울였다.** 이 파일의 폴백 규칙들은 *"재현율보다 정밀도"* 인데 여기만 반대다. 이유가 있다 — 폴백 규칙은 오탐 시 **렌더러 스펙 주입 + 검색 OFF** 라 받아줄 곳이 없지만, 이 가드는 오탐해도 `general` = 검색 붙은 산문이 받는다. 반대로 놓치면 무관한 논문이 출처처럼 나간다.

`resolveClinicIntent`·`resolveWeatherStickiness` 와 같은 모양(순수 함수 · 하니스가 그대로 임포트)이다.

### 5.4 논문 카드 + 명시 요청 → 종합 단계 웹 검색

`withExplicitSearchFollowup(tool, latestUserText)` — 논문 두 intent 이고 사용자가 검색을 명시 요청했으면 `followupWebSearch: true` 를 얹어 돌려준다. 가드(5.3)가 1차 방어, 이건 그걸 뚫고 온 경우의 2차 방어다.

논문 두 intent 로만 좁혔다. 약국·병원·날씨 카드는 조회 결과가 곧 답이라 웹을 덧붙일 이유가 없고 레이턴시만 는다. 조회 단계는 여전히 로컬 함수 단독이라 **툴 혼용 금지 정책은 그대로**다(`followupPhase` 에서만 web_search 가 실린다).

🏠 **함수가 `search-signals.ts` 에 사는 이유.** 개념상 집은 `local-tool-registry.ts` 인데, 그 모듈은 도구 12종을 통해 Supabase 클라이언트 생성까지 끌고 와 **시크릿 없이는 임포트되지 않는다**(하니스 3조건 ⓐ 위반). 판정 자체는 텍스트 신호이므로(=이 파일의 주제) 여기 두고 도구 모양은 제네릭으로 받는다. 하니스가 프로덕션 함수를 그대로 실행한다.

## 6. 검증

### 6.1 하니스 (시크릿·네트워크 없음)

| 하니스 | 신규 케이스 | 결과 |
|---|---|---|
| [test-search-policy.mts](../../../../tests/test-search-policy.mts) Part C Step7 | provider 인지 4종 — OpenAI+이미지+명시요청 on / 요청 없으면 off / 200 은 그대로 off / **provider 미지정 대조군은 기존대로 off** | 4/4 |
| [test-intent-rules.mts](../../../../tests/test-intent-rules.mts) §5 | 산출물 가드 11종 — 강등 5 · 진짜 논문 유지 4 · 논문 의도가 아니면 미발동 2 | 11/11 |
| [test-openai-url-fetch.mts](../../../../tests/test-openai-url-fetch.mts) | Fix④ 판정 6종 + **배선 2종**(종합 단계에 web_search 가 실리는가 / 조회 단계는 함수 단독인가) | 8/8 |

`npm test` 전체 exit 0, `tsc --noEmit` 클린. `npm run lint` 에러 30건으로 **수정 전후 동일**.

**대조군을 같이 넣었다** — `provider 미지정(기본 gemini)은 기존대로 off`. 이게 없으면 "400 을 없앴다"와 "400 을 공급자로 갈랐다"를 구분할 수 없다.

### 6.2 프롬프트 수정은 하니스로 안 잡힌다 — 실모델로 잰다

5.2 는 문자열 변경이라 회귀 하니스가 못 본다. router.ts 에서 프롬프트를 슬라이스해 `ROUTER_MODEL` 에 먹이고 **router.ts 의 후처리까지 재현**했다(`paper_source` → intent 파생 → 산출물 가드). 14 케이스 × 2회 = **28/28**.

| 묶음 | 케이스 | 결과 |
|---|---|---|
| 산출물 → general | 레포 검색 / 오픈소스 프로젝트 / 라이브러리 추천 / 자료 검색 / 저장소 어디야 | 5종 전부 `general` |
| 진짜 논문 유지 | 트랜스포머 논문 / 확산모델 연구 / **깃허브 코파일럿 생산성 논문** / **오픈소스 라이선스 연구** | 4종 전부 `arxiv_search` |
| PubMed 유지 | 고혈압 임상시험 / 장내미생물·우울증 논문 | 2종 전부 `paper_search` |
| 두 DB 밖 · 무관 | 인상주의 회화 연구 / 서울 날씨 / 퀵소트 구현 | 기존대로 |

굵게 표시한 둘이 5.2 의 과교정을 잡아낸 케이스다. **회귀 케이스를 같은 표에 넣지 않았다면 프롬프트를 고치면서 다른 걸 부순 줄 몰랐다.**

## 7. 남긴 것

- **Fix④ 는 OpenAI 경로 전용이다.** Gemini 경로는 LangChain 툴이 돌아 구조가 달라 같은 처리를 하려면 별도 작업이 필요하다. Fix②③ 이 두 경로 공통이라 1차 방어는 이미 걸려 있다.
- **`historyHasImage` 의 이름/실제 불일치**(§3.3 각주)는 남겨 두었다. 이번 수정으로 OpenAI 에서는 두 신호 모두 안 나오고, Gemini 에서는 `multimodal` 이 같은 일을 하므로 동작 차이가 없다. 손대면 Gemini 쪽 판정이 바뀔 수 있어 별도 확인이 필요하다.

## 8. 남는 규칙

> **tier 는 "누가 더 센가"를 적은 것이지 "어디서 성립하는가"를 적은 것이 아니다.**
> 400 은 *Gemini 는 이미지와 grounding 을 한 요청에 못 담는다* 는 참인 문장이었고, 그 문장은 OpenAI 턴에서 참이 아니다. 계층에 **전제를 함께 적지 않으면** 전제가 사라진 곳까지 따라간다. 같은 형태가 `useWebSearch = !localFunctionTool && …` 에도 있다 — 툴 혼용 금지는 옳지만, 그게 *사용자의 검색 요청을 버려도 된다*는 뜻은 아니었다.
>
> DEV_260808 *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"* 의 사촌이다. 저쪽은 **이름**이 범위를 좁혔고, 이쪽은 **전제**가 범위를 넓혔다.
