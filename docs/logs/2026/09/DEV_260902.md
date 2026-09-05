# 검색 요청이 사라지던 두 경로 — 남의 API 제약과 논문 오라우팅

> 날짜: 2026-09-02
> 범위: 검색 게이트 공급자 인지([search-gate.ts](../../../../server/agent/nodes/search-gate.ts)), 라우터 논문 분기([router.ts](../../../../server/agent/nodes/router.ts)), 산출물 가드([intentRules.ts](../../../../server/agent/intentRules.ts)), 논문 종합단계 웹검색([search-signals.ts](../../../../server/agent/search-signals.ts) · [generator.ts](../../../../server/agent/nodes/generator.ts))

## 1. 최종 결론

사용자 화면 두 장에서 **"검색해"라고 말했는데 검색이 안 되는** 두 장면이 왔다. 증상이 비슷해 한 결함처럼 보였지만 **원인이 완전히 다르다.**

| # | 증상 | 원인 | 층 |
|---|---|---|---|
| 1 | *"지금은 실시간 검색 없이 학습된 지식 기준으로만 답할 수 있어요"* | **Gemini 의 물리 제약(TIER 400)이 OpenAI 턴에도 걸렸다.** 이미지 첨부 **직후 턴**에서 사용자의 명시 요청(300)이 눌린다 (⚠️ 범위는 §9.1 에서 실측으로 정정됨 — 처음엔 "대화 내내"로 적었다) | 검색 게이트 |
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

게다가 그 호출에 넘기는 `hasMultimodalContent` 는 `buildSdkContents(state.messages, false)` 가 **히스토리 전체**를 훑어 낸 값이다. 신호 이름은 `현재 턴 멀티모달` 인데 실제로는 서버가 받은 히스토리 전체다.

> ⚠️ **여기서 "그래서 이미지가 한 번 등장한 대화는 끝까지 검색이 꺼진다" 고 적었는데 틀렸다.** 히스토리에는 첨부가 최근 3턴(`mediaWindow`)까지만 미디어로 실린다 — 실제 범위는 **직후 1턴**이다. 실측과 정정은 §9.1.

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

- **Fix④ 는 OpenAI 경로 전용이다.** Gemini 경로는 LangChain 툴이 돌아 구조가 달라 같은 처리를 하려면 별도 작업이 필요하다. Fix②③ 이 두 경로 공통이라 1차 방어는 이미 걸려 있다. → **§9.3 에서 처리했다.**
- **`historyHasImage` 의 이름/실제 불일치**(§3.3 각주)는 남겨 두었다. 이번 수정으로 OpenAI 에서는 두 신호 모두 안 나오고, Gemini 에서는 `multimodal` 이 같은 일을 하므로 동작 차이가 없다. 손대면 Gemini 쪽 판정이 바뀔 수 있어 별도 확인이 필요하다. → **§9.4: 불일치가 아니라 완전한 데드코드였다.**

## 8. 남는 규칙

> **tier 는 "누가 더 센가"를 적은 것이지 "어디서 성립하는가"를 적은 것이 아니다.**
> 400 은 *Gemini 는 이미지와 grounding 을 한 요청에 못 담는다* 는 참인 문장이었고, 그 문장은 OpenAI 턴에서 참이 아니다. 계층에 **전제를 함께 적지 않으면** 전제가 사라진 곳까지 따라간다. 같은 형태가 `useWebSearch = !localFunctionTool && …` 에도 있다 — 툴 혼용 금지는 옳지만, 그게 *사용자의 검색 요청을 버려도 된다*는 뜻은 아니었다.
>
> DEV_260808 *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"* 의 사촌이다. 저쪽은 **이름**이 범위를 좁혔고, 이쪽은 **전제**가 범위를 넓혔다.


---

# 9. 후속 검토 — 멀티턴 재점검 (같은 날)

§7 의 미결 2건을 실제로 재보다가, **§3.2 에 내가 적은 범위가 틀렸다는 것**을 실측으로 확인했다. 네 건을 함께 적는다.

## 9.1 🔴 정정 — 검색이 꺼지는 범위는 "대화 내내"가 아니라 "직후 1턴"

`buildHistoryMessages`([history.ts](../../../../server/agent/history.ts))는 첨부를 **최근 `mediaWindow`(기본 3) 턴** 안에서만 실제 미디어로 싣고, 그 밖은 `[Attached File: …]` **텍스트로 강등**한다. 그래서 `hasMultimodalContent` 는 "대화 전체"가 아니라 "최근 3턴"만 본다.

프로덕션 함수를 그대로 태워 잰 값(네트워크 없음):

```
이미지 이후 0턴 경과 → 모델이 이미지를 봄=true   검색=OFF   (히스토리 3개)
이미지 이후 1턴 경과 → false                    검색=ON    (히스토리 5개)
이미지 이후 2턴 경과 → false                    검색=ON    (히스토리 7개)
이미지 이후 3턴 경과 → false                    검색=ON    (히스토리 9개)
```

`mediaWindow=3` 인데 1턴만에 빠지는 것은, 이 창이 **턴이 아니라 메시지 개수**로 세기 때문이다(user/model 이 각각 1개). 첨부 메시지가 뒤에서 4번째가 되는 순간 강등된다.

**Fix① 이 불필요했다는 뜻은 아니다.** 꺼지는 그 1턴이 정확히 사용자가 *"이미지 보고 검색해봐"* 라고 말하는 턴이고, OpenAI 에는 애초에 없는 제약이었다. 다만 **원인 범위를 부풀려 적었고**, 그 문장이 DEV_HISTORY·README·`search-gate.ts` 주석·계획서까지 네 곳에 복제돼 있었다.

⚖️ 진짜 문제는 남는다 — **경계가 조용하다.** 같은 요청이 턴 거리만으로 갈리는데 사용자도 로그도 그 사실을 모른다. 그래서 §9.5 에서 전환 지점에 로그를 남긴다.

## 9.2 `dropImageForSearch` 가 `general` 에만 걸린다

```ts
const dropImageForSearch = state.intent === 'general' && !_currentTurnHasImage && …
```

SDK 경로를 타는 나머지 의도(`medical_qa`·`biology`·`chemistry`·`physics`·`astronomy`·`data_viz`)에는 탈출구가 없다. 특히 `medical_qa` 는 게이트에서 **tier 100 검색 강제 ON** 인데 400 에 눌린다 — *"의약 질의는 출처 기반으로 답한다"* 는 정책이 이미지 직후 1턴 동안 조용히 무효가 된다.

렌더러 4종은 **일부러 제외한다.** 그쪽은 히스토리 이미지가 답의 **대상**일 수 있고(`이 사진 속 분자 구조 그려줘`), tier 200 `renderer` 신호로 어차피 off 다. 이미지를 빼면 얻는 것보다 잃는 게 크다.

## 9.3 Gemini 경로 논문 의도에는 웹 탈출구가 **아예** 없다

§7 에 "별도 작업 필요"로 남겼는데, 실제로는 OpenAI 경로보다 나빴다:

```ts
} else if (state.intent === "paper_search") { allTools = [paperTool];
} else if (state.intent === "arxiv_search") { allTools = [arxivTool];
```

`drug_info` 는 `[searchDrugInfoTool, searchWebTool]` 로 웹을 함께 주는데 논문만 단일 도구다. LangChain 경로는 grounding 도 쓰지 않는다. 즉 라우터가 미끄러지면 **Gemini 에서는 어떤 경로로도 웹에 못 간다.**

⚠️ 그냥 `[paperTool, searchWebTool]` 로 바꾸면 안 된다 — 바로 아래 `forceDomainTool` 이 `allTools.length === 1` 을 요구한다. 도구를 둘 주는 순간 강제가 풀려 **모델이 논문 도구를 아예 안 부를 수 있다**(그 강제가 존재하는 이유가 *"Gemini 가 실제로 지원하는 요청도 자체 판단으로 거절한다"* 이다). → **단계로 가른다**: 1차 호출은 논문 도구 단독·강제, `ToolMessage` 이후 종합 단계에서만 `searchWebTool` 을 더한다. OpenAI 의 `functionPhase: 'followup'` 과 정확히 같은 구조다.

## 9.4 `search-gate` 의 `historyHasImage` 는 데드코드였다

§7 에는 "이름/실제 불일치"로 적었는데 더 심하다:

```ts
const historyHasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((p) =>
    p.inlineData || (p.fileData && !p.fileData.fileUri?.includes('youtube'))));
```

인라인 이미지는 히스토리에 `type: 'image_url'` 로 들어온다(`buildHistoryMessages`) — 이 술어에 안 걸린다. `fileData` 케이스는 `hasMultimodalContent` 가 이미 잡는다. **어떤 입력으로도 이 tier 400 신호는 발동하지 않는다.** §9.1 실측에서 OFF 를 만든 것도 전부 `multimodal` 이었다.

술어를 고치는 선택지도 있었지만, 고쳐도 `multimodal` 과 같은 값을 내는 중복 신호다. 두 신호가 같은 일을 하면 다음 사람이 *"둘 중 어느 게 진짜인가"* 를 또 묻는다 — 지운다.

## 9.5 조용한 전환에 로그를 남긴다

§9.1 의 경계는 고칠 대상이 아니다(`mediaWindow` 는 토큰 예산을 지키는 정상 장치다). 문제는 **관측 불가**다. 첨부가 미디어에서 텍스트로 강등되는 순간을 한 줄 남겨, 다음에 "왜 이 턴만 검색이 됐지"를 로그로 답할 수 있게 한다.


## 9.6 검증

### 종단 재현 — 프로덕션 함수 체인을 그대로 태운다

`buildHistoryMessages` → `shouldDropImageForSearch` → `buildSdkContents` → `decideGoogleSearch`.
네트워크·시크릿 없음. 시나리오: 이미지 첨부 후 *"저기 저장소 검색해서 확인해봐"*.

```
### intent=general
  0턴 경과 | 히스토리이미지=true  drop=true  검색=ON  | ON by user-explicit(300)
  1턴 경과 | 히스토리이미지=false drop=false 검색=ON  | [History] 첨부 미디어 → 텍스트 강등 (mediaWindow 3 밖): a.jpg

### intent=medical_qa                     ← §9.2 로 새로 열린 경로
  0턴 경과 | 히스토리이미지=true  drop=true  검색=ON  | ON by user-explicit(300)
  1턴 경과 | 히스토리이미지=false drop=false 검색=ON  | [History] 첨부 미디어 → 텍스트 강등 …
```

`medical_qa` 의 0턴이 **OFF → ON** 으로 바뀐 것이 §9.2 의 성과다. 그리고 1턴 경과 지점에
`[History]` 한 줄이 생겨, 판정이 뒤집힌 이유가 로그에 남는다(§9.5).

### 하니스

| 하니스 | 신규 | 결과 |
|---|---|---|
| [test-search-policy.mts](../../../../tests/test-search-policy.mts) **Part E** | `shouldDropImageForSearch` 8종 · `shouldAddWebSearchToPaperFollowup` 6종 · **배선 4종** | 18/18 |
| [test-paper-card.mts](../../../../tests/test-paper-card.mts) | arXiv 배선 계약 갱신 + **"조회 1차 호출은 단일 도구"** 신규 | 전부 통과 |

`npm run verify` exit 0 · `npm run lint` 에러 30건으로 **수정 전후 동일**.

🔴 **하니스가 죽은 신호를 가리고 있었다.** Part C 의 `IMAGE_PART` 픽스처가 `{ inlineData: … }`
였는데, `buildHistoryMessages` 는 인라인 이미지를 `{ type: 'image_url' }` 로 만든다 —
**프로덕션이 만들지 않는 모양**이었다. 그 픽스처 덕에 `historyHasImage` 가 초록을 유지했고,
지웠을 때 비로소 케이스가 빨개졌다. 픽스처를 실제 모양으로 바꾸고 `hasMultimodalContent` 를
production 이 계산하는 값과 맞췄다.

> [tests/README](../../../../tests/README.md) 의 *"통과하는 테스트는 공짜다"* 가 여기서 한 번 더 맞았다.
> 이번엔 "실패할 수 없는 테스트"가 아니라 **"실제로 존재하지 않는 입력으로만 통과하는 테스트"** 였다.
> 새 케이스를 넣을 때 픽스처가 프로덕션이 만드는 모양인지도 함께 봐야 한다.

## 9.7 배선 검사를 규칙으로 굳혔다

Part E 의 마지막 4케이스는 판정이 아니라 **호출부 연결**을 본다:

```ts
e('배선: generator 가 shouldDropImageForSearch 를 호출한다', /shouldDropImageForSearch\s*\(/.test(genSrc), true);
e('배선: generator 에 옛 인라인 조건이 남아 있지 않다', /state\.intent === 'general' && !_currentTurnHasImage/.test(genSrc), false);
```

DEV_260830 §6.22·§6.25 에서 **"판정은 맞는데 아무 일도 안 일어나는"** 실수를 이틀 만에 두 번
냈고, 그때 *"순수 함수를 새로 빼면 호출부 연결을 같은 커밋에서 검사한다"* 를 규칙으로 적었다.
이번에 순수 함수를 둘 더 뺐으므로 그 규칙을 적용했다 — **옛 조건이 남아 있지 않은지**까지 함께
보는 것이 핵심이다. 새 함수를 호출하면서 옛 코드를 지우지 않으면 둘 다 초록이 된다.


---

> 📋 이 작업으로 확인해야 할 **테스트 질의는 [REF_SearchRouting §2](../../../guide/REF_SearchRouting.md) 로 뽑아 두었다.**
> 로그는 "왜 그렇게 고쳤는가"를, 그쪽은 "무엇을 눌러 보면 되는가"를 맡는다.


---

# 10. 후속 — 카드가 관련 없는 논문으로 채워지던 결함 (09-03)

## 10.1 증상과 첫 오진

`트랜스포머 논문 찾아줘` → arXiv 카드 5건 중 **관련 1건**. 원 논문(Attention Is All You Need)은
없고 베이즈 필터·음향 인식이 올라왔다. 그리고 산문이 카드에 **없는** 논문 셋을 `[1](url)`
링크형으로 인용했다.

🔴 **나는 이걸 "조작된 인용"으로 적었다가 철회했다.** 사용자가 *"응답 잘 나온거 아니야?"* 라고
되물어 arXiv API 로 직접 확인하니 1706.03762 · 2103.00112 · 1805.00631 은 **전부 실재하고
내용도 맞는** 논문이었다. 모델은 지어내지 않았다 — **쓸모없는 카드를 버리고 자기 지식으로
답한 것**이다. 결함은 인용이 아니라 **카드 품질**이었고, 인용 이탈은 그 증상이었다.

> 화면에서 이상해 보이는 것에 이름을 먼저 붙이면 원인을 그 이름에 맞춰 찾게 된다.
> "조작"이라고 적는 순간 검증 대상이 *모델의 정직성* 으로 바뀌어, 정작 볼 곳(도구 입력)을 늦게 봤다.

## 10.2 원인 — 모델이 덧붙인 범용어가 AND 교집합을 끌고 간다

도구 입력이 `{"query": "transformer neural network"}` 였다. `buildArxivSearchQuery` 는 이걸
`all:transformer AND all:neural AND all:network` 로 묶는다(§DEV_260830 §6.13 의 AND 조립).
**AND 자체는 옳다** — OR 이 무관 논문을 올리던 걸 고친 장치다. 문제는 **사용자가 말하지 않은
두 단어**가 교집합의 순위를 자기 쪽으로 끌어당긴다는 것이다.

| 검색어 | 총건수 | 상위 5건 관련 |
|---|---|---|
| `transformer neural network` | 41,674 | **1/5** |
| `transformer` | 177,323 | **5/5** |

## 10.3 🔴 내가 넣은 수정이 회귀였다 — 프로브가 잡았다

범용어 목록(`GENERIC_TERMS`)을 만들어 AND 조립에서 빼는 코드를 넣었다. `transformer neural
network` 는 1/5 → 5/5 로 나아졌다. 그래서 **다 됐다고 판단했다.**

그 판단을 고정하려고 [live-arxiv-query.mts](../../../../tests/manual/live-arxiv-query.mts) 를 만들었는데,
프로브가 만들어지자마자 자기를 만든 수정을 부쉈다:

| 질의 | 조립 전 | 조립 후(내 수정) |
|---|---|---|
| `graph neural network` | 5/5 | `all:graph` → **0/5** (그래프 이론) |
| `convolutional neural network` | 5/5 | `all:convolutional` → **1/5** (부호이론) |

`neural network` 는 어떤 질의에서는 군더더기지만 어떤 질의에서는 **개념의 절반**이다.
단어만 보고는 그 둘을 가를 수 없다 — 가르는 건 문맥이고, 문맥은 모델만 안다. **되돌렸다.**

⚠️ 더 나쁜 건 **첫 측정에서 내가 5/5 로 봤다는 것**이다. 관련도 정규식이 `/graph/i` 였는데
그래프 이론 논문에도 당연히 `graph` 가 있다. 프로브의 판정을 조이고, 파일 머리에
*"숫자만 보지 말고 제목을 읽을 것"* 을 남겼다.

> **남는 규칙: 측정 도구를 만든 사람이 그 도구의 첫 피험자다.** 통과를 확인하는 데 쓰지 말고
> 내 수정이 무엇을 부수는지 보는 데 먼저 쓴다.

## 10.4 실제 수정 — 조립이 아니라 도구 설명에서 막는다

문맥 판단이 필요하면 문맥을 가진 쪽에 규칙을 준다. `search_arxiv` 의 `query` 스키마 설명에
넣었다([arxiv-tool.ts](../../../../server/agent/arxiv-tool.ts)):

> 사용자가 말한 주제어만 넣는다 — 말하지 않은 범용어(neural network, model, deep learning,
> method, system 등)를 덧붙이지 않는다. `'트랜스포머 논문'` 은 `transformer` 이지
> `transformer neural network` 가 아니다. 다만 `'graph neural network'`·`'convolutional
> neural network'` 처럼 **그 자체가 하나의 개념이면 통째로 넣는다.**

마지막 문장이 핵심이다 — 금지만 적으면 모델이 반대로 과교정해 복합 개념을 쪼갠다(§5.2 의
라우터 부정 앵커에서 이미 한 번 겪었다).

## 10.5 검증 — 실모델 종단

`트랜스포머 논문 찾아줘`(Gemini 3.7 Flash) 재실행:

| | 수정 전 | 수정 후 |
|---|---|---|
| 도구 입력 | `transformer neural network` | **`transformer`** |
| 카드 관련도 | 1/5 | **5/5** |
| 산문 ↔ 카드 대응 | 0/5 (카드 밖 논문 인용) | **5/5 위치 일치** |
| 인용 형태 | `[1](arxiv.org/…)` 링크형 | 맨 마커 `[1]` |

카드 5건(PyramidTNT 2201.00978 · Learning to Cluster Faces via Transformer 2104.11502 ·
MLP Can Be A Good Transformer Learner 2404.05657 · Music Transformer 1809.04281 ·
Transformer in Transformer as Backbone for Deep RL 2212.14538)은 프로브가 예측한 상위 5건과 일치한다.

**링크형 인용 이탈이 재현되지 않았다.** 카드가 제 역할을 하니 모델이 나갈 이유가 없어졌다 —
10.1 의 재해석이 맞았다는 증거다.

## 10.6 고치지 않은 것 — 정직하게

🔴 **`Attention Is All You Need` 는 여전히 카드에 없다.** arXiv `sortBy=relevance` 는 인용수·
영향력을 보지 않아, `all:transformer` 상위에 원 논문이 안 올라온다. 즉 **"5/5 관련"과
"사람이 원한 답"은 다르다.** 역설적으로 카드가 망가졌던 수정 전 답이 이 지점에서는 나았다
(모델이 카드를 버리고 원 논문을 짚었으니까). 정렬 축을 바꾸는 건 별건이라 남긴다.

⚠️ **`published` 배지와 산문의 어긋남.** 산문이 *"이들은 모두 아직 정식 출판되지 않은
프리프린트"* 라고 단정했는데 Music Transformer 는 ICLR 2019 게재작이다. arXiv 메타데이터가
`journal_ref=None, doi=None` 이라 **우리 판정은 데이터대로 정확**하다 — 새는 곳은 산문이
그걸 *세계에 대한 사실 주장* 으로 옮겨 적는 지점이다(카드 배지는 "확인되지 않음"인데 산문은
"출판되지 않았다"로 읽힌다). [REF_Paper](../../../guide/REF_Paper.md) 의 *근거 등급을 추정하지
않는다* 와 같은 종류의 결함이 렌더러가 아니라 프롬프트 쪽에 남아 있다.

⚠️ **링크형 `[N](url)` 은 여전히 `dropMarkersOutsideRange` 를 우회한다**(`(?!\()` 부정 전방탐색).
지금은 증상이 없지만 안전망 구멍은 그대로다 — 모델이 다시 카드 밖으로 나가면 범위 검사가
못 잡는다. 이번 결함이 카드 품질로 밝혀지면서 우선순위는 내려갔다.

## 10.7 검증 자산

| 하니스 | 무엇 |
|---|---|
| [tests/manual/live-arxiv-query.mts](../../../../tests/manual/live-arxiv-query.mts) **신규** | 조립을 실제 arXiv 로 태워 **상위 5건 관련도**를 잰다. 10케이스 · 현재 10/10. `expectEmpty`(코퍼스에 없는 주제) · `upstreamGuarded`(질의 자체가 나쁜 케이스 — 조립으로 못 고침) 구분 |
| [test-paper-card.mts](../../../../tests/test-paper-card.mts) | `GENERIC_TERMS` 케이스를 **"왜 지우면 안 되는가"** 케이스로 교체 + 도구 설명 문안 정규식 검사 2종 |

`bridge seismic retrofit` 은 0건인데 이건 arXiv 가 토목을 거의 안 실어서다 — 라우터의
`paper_source` 는 *"공학이면 arxiv"* 라고 말한다. 프로브에 `expectEmpty` 로 기록해 뒀고,
0건이 정답인지 오라우팅인지는 별건으로 남긴다.


---

# 11. 제목으로 물으면 그 제목의 논문이 안 나온다 (09-03, §10 직후)

## 11.1 증상

§10 의 수정 뒤 사용자가 `가장 유명한 대표 논문은?` 으로 이어 물었다. 모델은 **정답을 알고**
`{"query": "Attention Is All You Need"}` 로 조회했는데, 카드에 올라온 건
*"Do You Even Need Attention? A Stack of Feed-Forward Layers…"* 였다. **제목을 그대로 물었는데
그 제목의 논문이 안 나온다.**

## 11.2 원인 — 불용어 제거가 제목을 분해한다

`STOPWORDS` 가 `is`·`all`·`you` 를 버려서 다섯 단어가 둘로 줄어든다:

```
"Attention Is All You Need" → all:Attention AND all:Need   (7,982건, 원 논문 상위 5건 밖)
```

불용어 제거 자체는 옳다 — arXiv 는 기능어를 색인하지 않아 AND 에 끼우면 **0건**이 된다
(위 실측에서 `all:Attention AND all:Is AND …` → 0건으로 재확인). 문제는 **제목은 키워드 묶음이
아니라 구절**인데 같은 규칙을 적용한 것이다.

## 11.3 🔴 닫아 둔 길이 답이었다 — 내 주석이 과일반화였다

`buildArxivSearchQuery` 주석에 *"따옴표 구문은 0건이라 대안이 못 된다"* 라고 적혀 있었다.
그 판단의 근거는 `all:"transformer attention optimization"` 하나였는데 — **그건 진짜 구절이
아니다.** 아무도 그 세 단어를 나란히 쓰지 않으니 0건이 맞다. 제목은 다르다:

| 조립 | 총건 | 1706.03762 순위 |
|---|---|---|
| `all:Attention AND all:Need` (기존) | 7,982 | **상위 5건에 없음** |
| `all:"Attention Is All You Need"` | 45 | **2위** |
| `ti:"Attention Is All You Need"` | 35 | 1위 |

한 사례로 기법 전체를 폐기하고, 그 판단을 주석으로 굳혀 **다음 사람(나)이 그 길을 다시 보지
않게** 만들어 뒀다. 주석을 정정했다.

> **남는 규칙: "X 는 안 된다"를 주석에 적을 때는 무엇으로 쟀는지 함께 적는다.**
> 근거가 붙어 있었으면 "그 하나가 대표성이 없다"를 바로 알아봤을 것이다.

## 11.4 한 번의 호출로 합치는 안은 **측정해서 버렸다**

`all:"…" OR (all:a AND all:b)` 로 합치면 호출이 한 번이라 매력적이었다. 실측:

```
all:"attention is all you need" OR (all:attention AND all:need)   총 7,982건
  1. Tool Attention Is All You Need …   2. RITA: Group Attention is All You Need …
  → 1706.03762 은 여전히 상위 5건 밖
```

**관련도 정렬이 구절 일치를 우대하지 않는다.** 그럴듯했고 틀렸다 — 재보지 않았으면 이걸
정답으로 넣었을 것이다.

## 11.5 수정 — 불용어가 **있을 때만** 구절을 먼저 친다

버려지는 불용어의 존재 자체가 신호다. 평범한 검색어(`graph neural network`,
`probiotics depression`, `bridge seismic design`)에는 불용어가 **하나도 없고**, 제목·구절에는 있다.

```ts
export const buildArxivQueryPlan = (query: string): string[] => { … }
// "Attention Is All You Need" → ['all:"Attention Is All You Need"', 'all:Attention AND all:Need']
// "graph neural network"      → ['all:graph AND all:neural AND all:network']   ← 계획 1개, 추가 호출 0
```

도구는 계획을 앞에서부터 시도해 **결과가 나오는 첫 항목**을 쓴다. 마지막까지 0건이면 그 0건이
답이다(OR 로 넓히지 않는 기존 설계 유지).

- 3단어 미만은 구절로 보지 않는다 — `based on` 같은 조각이 걸린다.
- 이미 arXiv 문법(`cat:`·`ti:`·`AND`)이면 손대지 않는다.
- 추가 호출은 **불용어가 있고 그 구절이 0건일 때만** 일어난다. arXiv 3초 간격 때문에 공짜가
  아니라 범위를 좁혔다.

## 11.6 검증

```
[arxivTool] 구절 조회 적중: all:"Attention Is All You Need" (45건)
  1. [2604.21816] Tool Attention Is All You Need …
  2. [1706.03762] Attention Is All You Need          ← 카드에 들어왔다
```

`graph neural network`·`transformer attention optimization` 은 계획이 1개라 **출력과 호출 수가
모두 그대로**다(§10.3 에서 깨뜨렸던 바로 그 케이스들).

| 하니스 | 무엇 |
|---|---|
| [test-paper-card.mts](../../../../tests/test-paper-card.mts) | 계획 케이스 8종 + 배선 2종 + 주석 정정 검사 |
| [live-arxiv-query.mts](../../../../tests/manual/live-arxiv-query.mts) | **케이스 11종 · 11/11**. 제목 질의 신규(`minRelevant: 1` — 한 편을 찾는 게 목적인 케이스에 5건 중 4건 기준은 무의미하다) |

`npm run verify` exit 0.

🔴 **프로브도 같이 고쳤다.** `buildArxivSearchQuery` 만 부르고 있어서 **구절 폴백을 태우지
않았다** — 프로덕션이 하지 않는 일을 재는 도구가 될 뻔했다(§10.3 에서 적은 교훈이 하루 만에
같은 파일에서 재발했다). 계획을 순회하도록 바꿨다.

## 11.7 오진 하나 정정

카드 문구가 *"7,982건 중 관련도 상위 **1건**"* 이길래 "주제 관련도 필터가 4건을 떨궜다"고 적었다.
**틀렸다.** `arxiv-tool.ts` 에는 관련도 필터가 없다(그건 PubMed 쪽 `filterOffTopicAside` 다).
[PaperRenderer.tsx:69](../../../../components/PaperRenderer.tsx#L69) 의 `중 관련도 상위` 는 그냥
`papers.length` 를 적는 문구이고, 1건인 이유는 **모델이 `limit: 1` 로 불렀기 때문**이다.

⚠️ 다만 문구가 오해를 부른다 — `total` 과 `papers.length` 사이에 **필터가 있는 것처럼** 읽힌다.
실제로 그렇게 읽고 없는 필터를 찾으러 갔다. 문구 정리는 별건으로 남긴다.

## 11.8 곁가지 관찰 — 카드가 없을 때의 답은 건강하다

같은 세션에서 `대표적인 트랜스포머 논문 설명해줘` 는 논문 카드 없이 **웹 grounding** 으로
답했고 내용이 정확했다(근거 9개 전부 `grounding-api-redirect`). 즉 이번 결함은 카드 경로에
국한되고, 카드가 빠졌을 때의 폴백은 제 역할을 한다.

⚠️ 뒤집어 말하면 **카드 경로가 웹 폴백보다 못한 구간이 있다**. §10.6 의 `Attention Is All You
Need` 부재도 같은 방향이다 — arXiv 관련도 정렬은 인용수·영향력을 안 본다. "대표 논문"류 질의는
카드보다 웹이 나을 수 있고, 그 갈래를 라우팅으로 세울지는 별건이다.


---

# 12. 🔴 §10 의 수정이 **한쪽 공급자에만 걸려 있었다** (09-03, 확인 중 발견)

## 12.1 확인하려다 다른 걸 찾았다

§11 을 앱에서 눌러 보려고 `Attention Is All You Need 논문 찾아줘` 를 GPT-5.6 luna 로 보냈더니,
답은 정확한데 **카드가 없었다.** `의료 영상 분할을 위한 딥러닝 논문` 도 마찬가지로 표와 웹
링크만 나왔다. 즉 **오늘 고친 경로를 두 번 다 타지 않았다.**

⚠️ 화면만 보면 "잘 나왔다"로 넘어갈 수 있었다 — 내용이 맞았기 때문이다. 근거 칩이
`json:paper` 카드가 아니라 grounding 출처였던 게 유일한 단서였다.

## 12.2 라우터는 결백했다

먼저 라우터를 의심해 실모델로 쟀다(TIER1 단독, 4질의 × 2회):

```
"Attention Is All You Need 논문 찾아줘"  intent=arxiv_search   8/8 전부 arxiv_search
"의료 영상 분할을 위한 딥러닝 논문"       intent=arxiv_search
```

라우팅은 정상이다. 카드는 **그 아래에서** 사라졌다.

## 12.3 관측점이 출력만 찍고 있었다

그래프를 태우니 한 줄이 나왔다:

```
[OpenAI] local tool "search_arxiv" → 143자 · cardHasResults=false · synthesize(빈 카드 복구)
```

조회가 0건이라 빈 카드가 버려지고 모델이 자기 지식으로 답한 것이다(§6.31 의 복구 장치가
제대로 동작한 결과다 — 답이 좋았던 이유). **그런데 왜 0건인지는 이 로그로 알 수 없다.**
`cardHasResults=false` 는 결과만 말하고 **모델이 무엇으로 조회했는지**를 말하지 않는다.

로그에 인자를 넣었다([chat.ts](../../../../server/openai/chat.ts)):

```
[OpenAI] local tool "search_arxiv" ← {"query":"Attention Is All You Need Transformer architecture self-attention","limit":5}
```

한 줄에 다 나왔다. **모델이 범용어를 덧붙였다** — §10 에서 금지한 바로 그 행동이다.

> **남는 규칙: 도구 경로의 관측점은 입력과 출력을 함께 찍는다.** 카드가 비는 원인은 대개
> 도구가 아니라 **모델이 만든 검색어**에 있는데, 출력만 찍으면 그 지점이 통째로 안 보인다.

## 12.4 원인 — 같은 문안을 두 파일에 복제해 뒀다

§10 에서 나는 `arxiv-tool.ts` 의 **zod 스키마 설명**만 고쳤다. 그런데 OpenAI 경로는 그 스키마를
쓰지 않는다 — [local-tool-registry.ts](../../../../server/agent/local-tool-registry.ts) 가
strict function calling 용 **자기 사본**을 갖고 있다:

```ts
query: { type: 'string', description: 'arXiv 검색어. 한국어 질문이라도 학술 용어는 영어로 변환한다.' },
```

즉 §10 의 수정은 **Gemini 턴에만** 걸렸다. §5.1 에서 *"tier 는 어디서 성립하는가를 적은 게
아니다"* 를 배웠는데, 이번엔 **지시를 어느 공급자가 보는가**에서 같은 실수를 했다. 하루 만에
같은 모양이다 — 이 레포는 공급자별로 갈라지는 지점이 많고, 한쪽만 고치면 조용히 반쪽이 된다.

실제 피해는 카드 부재만이 아니었다. 덧붙인 질의로 조회하면:

```
all:Attention AND all:Need AND all:Transformer AND all:architecture AND all:self-attention
  1. PhD Thesis: Exploring the role of (self-)attention in cognitive …
  2. SpectFormer: Frequency and Attention is what you need in a Vision Transformer
  → 5건이 나오지만 1706.03762 은 없다
```

**0건이면 카드가 사라지고, 0건이 아니면 틀린 카드가 나간다.** 두 번의 재현에서 둘 다 봤다.

## 12.5 수정 — 문안을 상수 하나로 합쳤다

`ARXIV_QUERY_DESCRIPTION` 을 `arxiv-tool.ts` 에서 export 하고 두 경로가 함께 쓴다. 문안 자체도
보강했다 — **제목 질의**를 못박는 문장과 `architecture` 를 범용어 예시에 추가:

> 논문 제목을 물으면 **제목만** 넣는다 — 'Attention Is All You Need' 이지
> 'Attention Is All You Need Transformer architecture' 가 아니다.

## 12.6 검증 — 같은 모델, 같은 질의

```
[OpenAI] local tool "search_arxiv" ← {"query":"Attention Is All You Need","limit":5}   ← 제목만
  ✅ 본문에 json:paper 블록이 있다   ✅ 카드 JSON 파싱 — 논문 5건   ✅ 산문 3문단

[OpenAI] local tool "search_arxiv" ← {"query":"transformer","limit":5}                 ← 범용어 없음
  ✅ 본문에 json:paper 블록이 있다   ✅ 카드 JSON 파싱 — 논문 5건   ✅ 산문 4문단
```

하니스에 **문안이 두 벌로 갈라지는 걸 막는 검사** 4종을 넣었다(레지스트리가 사본을 갖지 않는가 ·
두 경로가 같은 상수를 쓰는가 · 제목 문장이 있는가 · 인자 로그가 있는가). `npm run verify` exit 0.

## 12.7 폴백 비용 — 재봤고, 내 테스트 케이스가 틀렸다

Gemini 3.7 로 `의료 영상 분할을 위한 딥러닝 논문` 을 다시 눌러 카드가 정상으로 나왔다
(5건, 산문이 `[1][2][3][5]` 를 카드 위치에 정확히 대응, `[4]` 는 주제가 비껴서 일부러 안 씀 —
프롬프트의 *"1번이 답이 아니면 인용하지 마라"* 가 동작했다).

🔴 **그런데 이 질의는 폴백을 타지 않는다.** 도구 입력이 `deep learning medical image
segmentation` — 모델이 한국어를 영어로 옮기면서 `위한`(for)이 사라져 **불용어가 하나도 없다.**
계획이 1개라 추가 호출이 없다. 내가 "폴백 비용 케이스"로 고른 질의가 그 경로를 안 지났다.

> 한국어 질의는 번역 단계에서 기능어가 자연히 떨어진다. 즉 **폴백은 생각보다 드물게 도는데,
> 그걸 확인하지 않고 "비용 케이스"라고 이름 붙였다.** 케이스를 고를 때도 경로를 먼저 확인할 것.

폴백이 실제로 도는 질의(불용어가 있고 그 구절이 arXiv 에 없는 것)로 격리 측정:

| 질의 | 계획 | 소요 |
|---|---|---|
| `deep learning medical image segmentation` | 1개 | **~20–300ms** |
| `Attention Is All You Need` (구절 적중) | 2개 | 1회로 끝 |
| `a survey on medical image segmentation methods` (구절 0건 → 폴백) | 2개 | **3,031ms** |

**폴백 비용은 약 3초이고 거의 전부가 arXiv 가 요구하는 `MIN_GAP_MS` 대기다**(2차 호출 자체는
수십 ms). 줄이려면 간격 규칙을 어겨야 하므로 줄이지 않는다. 드물게 도는 경로에 3초라 그대로 둔다.


---

# 13. 제목 질의가 여전히 틀린 논문을 답으로 냈다 — 그리고 내 진단이 어긋나 있었다 (09-03)

## 13.1 증상 — 같은 질의, 두 가지 실패

§12 를 확인하려고 `Attention Is All You Need 논문 찾아줘` 를 gpt-5.6-luna 로 두 번 눌렀다.
검색어는 이제 깨끗하다(`"query":"Attention Is All You Need"`, total 45) — **그 뒤가 문제였다.**

| 실행 | 카드 | 결과 |
|---|---|---|
| `limit: 1` | `2604.21816` 하나 | 🔴 **2026년 MCP 도구 게이팅 논문**을 *"이 논문은 …"* 이라며 답으로 설명 |
| `limit: 8` | 원 논문이 **2번** | 🔴 산문이 `[1](https://arxiv.org/abs/1706.03762)` — URL 은 맞고 **번호가 틀렸다**(1번은 다른 논문) |

## 13.2 🔴 정정 — 내가 우선순위도 진단도 틀렸다

어제 나는 링크형 `[N](url)` 우회를 *"지금 증상은 없고 안전망 문제"* 라고 적고 뒤로 미뤘다.
**증상이 생겼다.** 그리고 더 중요한 건 **내가 제안한 수정으로는 이 건을 못 잡는다**는 것이다 —
`dropMarkersOutsideRange` 는 1..count **밖**을 지우는데 여기서 `[1]` 은 범위 **안**이다.
범위가 아니라 **가리키는 대상**이 틀린 결함이라 범위 검사로는 원리적으로 닿지 않는다.

> **남는 규칙: "안전망에 구멍이 있다"와 "그 구멍으로 무엇이 새는가"는 다른 판단이다.**
> 구멍의 모양(`(?!\()`)만 보고 우선순위를 매겼고, 새는 것이 무엇인지는 보지 않았다.

## 13.3 원인 — arXiv 가 원 논문을 1위로 주지 않는다

두 실패가 같은 뿌리다. `limit` 이 1이면 1위만 담기고, 8이면 번호가 밀린다.
그리고 **답은 §11 에서 이미 재놓고 더 나쁜 쪽을 골랐다**:

| 조립 | 총건 | 1706.03762 |
|---|---|---|
| `all:"Attention Is All You Need"` (§11 에서 채택) | 45 | **2위** (1위는 2026년 `Tool Attention Is All You Need`) |
| `ti:"Attention Is All You Need"` | 35 | **1위** |

제목을 물었으면 제목 필드를 본다. §11 의 표에 두 줄이 나란히 있었는데 `all:` 을 골랐다.

## 13.4 수정 A — 계획의 첫 칸을 `ti:` 로

`buildArxivQueryPlan` 이 `['ti:"…"', AND]` 를 낸다.

⚖️ **가운데에 `all:"…"` 를 끼운 3단 계획을 만들었다가 뺐다.** 구절 6종을 재보니 **`ti:` 가 0이면
`all:"…"` 도 예외 없이 0**이었다(35/45 · 2/3 · 0/0 · 47/214 · 12/13 · 129/741). 단독으로 건진
경우가 하나도 없는데 최악 지연만 3초 → 6초로 늘린다(실측 8,573ms → 6,008ms). 뺐다.

## 13.5 수정 B — 번호를 URL 로 교정한다

`repairPaperMarkerLinks(prose, paperUrls)`. 판정 근거는 번호가 아니라 **URL** 이고, URL 은 카드가
갖고 있으므로 결정적으로 판정된다.

- URL 이 카드 M 번과 일치 → **`[M]` 으로 고친다**(맨 마커로 — 링크는 카드가 이미 준다)
- URL 이 arXiv/PubMed 인데 카드에 없음 → 마커만 뗀다(카드 순번 계약 위반)
- 🔴 **그 밖의 호스트는 손대지 않는다** — grounding 인용 링크다. 지우면 출처가 사라진다

순서가 중요하다: **교정이 먼저, 범위 검사가 뒤.** 반대로 하면 교정 전 번호로 범위를 잰다.

🔴 **청크 경계 보류도 함께 넓혔다.** `incompletecitation` 이 닫힌 `[1]` 까지만 붙잡고 있어서,
`[1](https://arxiv` 에서 잘린 청크는 그대로 흘러가 화면에 **생 URL** 이 남고 교정도 못 한다.
닫는 `)` 가 올 때까지 붙잡도록 고쳤다.

## 13.6 검증

```
gpt-5.6-luna     [arxivTool] 구절 조회 적중: ti:"Attention Is All You Need" (35건)
                 ✅ 인용 번호가 카드 순번과 맞는다 — 3개 문장 대조
gemini-3.7-flash ✅ 인용 번호가 카드 순번과 맞는다 — 2개 문장 대조 · ✅ 1706.03762 [프리프린트]
```

하니스 §4h 신규 11종(교정 7 + 배선 4). `npm run verify` exit 0.

## 13.7 남는 것

⚠️ **`limit: 1` 자체는 막지 않았다.** 모델이 1건만 요청하면 카드에 1위만 남는다. `ti:` 로 1위가
원 논문이 됐으니 제목 질의에서는 해결됐지만, **일반 질의에서 `limit:1` 이 오면 여전히 얇은
카드가 나간다.** 하한을 두는 게 맞는지는 별건이다.

⚠️ **동음이의 학술어**는 그대로다 — `graph`(GNN/그래프 이론) · `diffusion`(생성모델/확산방정식).
`확산모델 논문 추천해줘` 카드 5건 중 1건이 `math.AP` 개체군 모델이었고 산문이 그걸 성실히
요약했다. 블로클리스트로는 못 막는다(REF_Paper 에 이미 기록). 라우터의 `topic_field` 로 분류를
좁히는 방향이 원리적이지만 측정이 필요하다.
