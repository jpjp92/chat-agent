# 회귀 하니스

```bash
npm test        # 17종 전부
npm run verify  # typecheck + test
```

2026-08-18 에 `scripts/` 에서 옮겨왔다. 예전에는 `.gitignore` 에 하니스마다 `!scripts/test-*.mts`
예외를 한 줄씩 달았는데, **버릴 것과 남길 것이 한 폴더에 섞여 있던 게 원인**이었다.
폴더를 나눠서 예외를 없앴다 — `scripts/` 는 이제 통째로 무시되는 일회성 습작 전용이다.

## 여기 둘 자격 — 셋 다 만족

① 시크릿·환경변수를 안 읽는다 ② 네트워크를 안 탄다 ③ **프로덕션 로직을 import 해서 잰다**

③ 이 가장 중요하다. 정규식이나 문구를 **복사해 두면 프로덕션이 바뀐 뒤에도 하니스는 계속 초록**이다.
실제로 그런 하니스가 있었다(`test-search-rules.mjs`).

**복사만 위험한 게 아니라 재구현도 위험하다.** 2026-08-31 에 카드 6종(약국·병원·동물병원·법률·
영화·날씨)이 통째로 화면에 도달하지 않는 회귀가 배포됐는데 하니스 16종이 전부 초록이었다.
원인은 SSE 이벤트 루프가 `route.ts` 의 `ReadableStream` 안에 인라인이라 **import 가 불가능**해서,
하니스 3종이 각자 루프를 흉내 냈던 것이다. 흉내 낸 루프에는 실제 결함이 사는 **else-if 분기
순서**가 없었다. 루프를 `server/agent/stream-dispatch.ts` 로 빼고 `test-stream-dispatch.mts` 가
진짜 함수를 태우게 하자 같은 회귀를 재주입했을 때 11건이 동시에 빨개졌다.
→ **import 가 안 돼서 흉내 내고 있다면, 하니스가 아니라 프로덕션 코드를 옮겨야 한다.**

## `manual/` — 수동 네트워크 프로브

`tests/manual/`은 외부 공급자·실사이트 상태를 재현하는 수동 진단 도구다. 환경변수와 네트워크를
사용할 수 있지만 `npm test`에는 포함하지 않는다. 자동 회귀 하니스의 위 세 조건과 섞지 않으며,
실행 시 외부 API 크레딧이 소모될 수 있다.

- `npm run audit:wikidocs-puppeteer -- <URL>`: Browserless Puppeteer와 Cheerio 결과 비교
- `npm run audit:url-openai -- <URL>`: `OPENAI_API_KEY_TIER1`로 장애 표본의 웹 검색과 정확한 URL 출처 확인
- `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/live-paper-card.mts [모델] [질의]`: 그래프를 실제로 돌려
  논문 카드가 나오는지 확인(PubMed·arXiv 양쪽 — 질의 주제에 따라 라우터가 고른다).
  **식별자(PMID/arXiv ID·DOI·URL·제목)와 근거 등급/심사여부를 도구 출력과 대조**한다 —
  모델이 카드를 다시 쓰던 시절 3개 모델 중 1개만 통과했고, 그래서 카드를 코드가 고정하게 바꿨다.
  🔴 **`TIER1=1` 을 붙여라** — 무료 키가 일일 쿼터로 마르면 라우터가 폴백해 비의생명 논문 질의가
  `general` 로 강등되고, 코드는 멀쩡한데 라우팅 회귀처럼 보인다(실측으로 3회 오진했다).
  하니스가 폴백을 감지하면 경고를 찍는다
- `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/live-paper-routing.mts [반복수]`: 논문 라우팅 3분기(pubmed·arxiv·없음)
  누수율 측정. 🔴 **`TIER1=1` 을 붙여 유료 키로 돌려야 한다** — 무료 키 12개로 45회를 돌리면
  라우터가 429 로 죽고 규칙 폴백(→ general)으로 떨어져 측정이 통째로 오염된다(실측)
- `TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/live-paper-multiturn.mts [모델]`:
  논문 카드 **멀티턴** 7턴을 실제 그래프로 이어 돌린다. 단발 하니스가 못 보는 자리다 —
  후속 설명이 재조회하는가 · 번호가 대화 너머로 유지되는가(LLM 변별 판정기) · 새 주제는 재조회되는가 ·
  다른 도메인(날씨)을 납치하지 않는가 · 지난 턴 카드 번호가 새 카드에 흘러들어오는가.
  🔴 route.ts 의 마커 처리를 **같은 함수로** 재현한다 — 복제하면 사용자가 보지 않는 글을 검사하게 된다
- `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-retraction.mts`: 실제 PMID 4건으로
  PubMed 응답을 직접 본다 — 철회 판정(40323973), 통짜 초록의 꼬리 제거(27055821), 초록 자체가
  없는 논문(23306139·24468694). 오프라인 하니스는 규칙을 보고 이건 **데이터**를 본다
- `npx tsx --env-file=.env tests/manual/probe-paper-tool.mts [검색어]`: 프로덕션 `paperTool` 을 실호출해 `json:paper` 카드가
  제대로 나오는지 확인 (필수 필드·등급·DOI 보유율)
- `TIER1=1 npx tsx tests/manual/live-intent-routing.mts [반복수]`: 의도 분류 **정확도와 지연**을 함께 잰다.
  라우터 모델을 바꿀 때 전후를 같은 자로 재는 용도다 — 라우터는 매 턴 serial-blocking 이라 정확도만
  보고 올리면 안 된다. 실측 오분류 7종 + 막으면 회귀인 진짜 조회 12종 (§6.28)
- `TIER1=1 npx tsx tests/manual/live-card-suction.mts [반복수]`: 화면 카드가 **다음 턴의 무관한 질의를
  끌어당기는지** 를 대조군(카드 없음)과 나란히 잰다. 카드 7종 × 질의 8. `intent` 만이 아니라
  `needsSearch` 와 카드 후속 플래그를 함께 본다 — 의도는 맞고 근거만 조용히 바뀌는 결함이 있다(§6.22).
  `TIER1=1` 없이 돌리면 429 → 규칙 폴백으로 전부 `general` 이 돼 측정이 무의미해진다
- `npx tsx --env-file=.env tests/manual/probe-paper-relevance.mts [--arxiv] [--subject] [질의부분일치]`: 카드에 **주제와
  무관한 논문**이 섞이는 비율을 잰다. 두 지표의 분리력을 비교한다 — 평면 용어 커버리지(실측상 **못 쓴다**:
  무관 75% vs 관련 50%)와 주제어 존재(코퍼스 수록량이 가장 적은 용어). 필터를 넣은 뒤로는 0건이 정상이라
  회귀 감시용이 됐다(5/50 → 0/49, §6.23). `--subject` 는 **개입어가 질병어보다 흔한 질의**를 더한다 —
  거기서 주제어가 뺏겨 fail-open 이 발동한다(18질의 중 2종, §6.27). 대안 규칙 ③의 분리력도 함께 찍는다
- 🔴 **논문 도구의 스키마·설명을 만졌으면 `live-paper-card.mts` 를 두 공급자 모두에서 돌린다.**
  Gemini(LangChain)와 OpenAI(strict function calling)는 파라미터 정의를 공유하지 않았던 적이 있어,
  한쪽만 고친 회귀가 2026-09-03 에 `gpt-5.6-luna` 에서만 보였다(Gemini 는 정상이었다).
- `npx tsx tests/manual/live-arxiv-query.mts [질의…]`: arXiv 검색어 조립을 **실제 API 로** 태워
  상위 5건의 관련도를 잰다(11케이스, 케이스당 2회 호출 · 3초 간격이라 ~80초). 조립을 만졌으면
  이걸 돌리기 전에는 판단할 수 없다 — 실제로 이 프로브가 *"범용어를 AND 에서 뺀다"* 는 수정이
  `graph neural network` 를 0/5 로 무너뜨리는 걸 잡아 되돌리게 했다.
  ⚠️ **숫자만 보지 말고 제목을 읽을 것** — 관련도는 정규식 근사고, 느슨한 정규식이 회귀를 숨긴 적이 있다.
- `npx tsx --env-file=.env tests/manual/probe-paper-apis.mts`: PubMed E-utilities·CrossRef 가 실제로 검색되고
  DOI·인용 URL 을 주는지 검증 (NCMIK OpenAPI 는 `kwd` 를 무시해 폐기했다 — 그 판정을 재현한다).
  `NCBI_KEY` 없이도 돌지만 §4 에서 429 가 난다
- `npx tsx tests/manual/check-legacy-image-field.mts`: `chat_messages` 실제 컬럼과 첨부 저장 형태를 조회해 `Message.image` 하위호환 필드 제거 가능 여부 판단 (Supabase 자격증명 필요)
- `npx tsx tests/manual/check-real-broken-citation.mts`: 생 URL 이 노출됐던 실제 DB 답변에 정리 규칙을 적용해 마커 보존/노출 0 확인 (Supabase 자격증명 필요)
- `npx tsx --env-file=.env.local --tsconfig tests/tsconfig.probe.json tests/manual/live-citation-followup.mts [model] [후속발화]`:
  그 대화를 히스토리로 재생해 **실제 그래프**로 후속 검색 턴을 돌리고 생 URL 노출 여부 확인 (Gemini 키 소모)

2026-08-23 네트워크 실측 요약:

- Wikidocs direct/Jina/일반 Puppeteer는 Cloudflare challenge로 실패
- ScrapingBee `render_js=true + premium_proxy=true + country_code=kr`는 신규 글 200·5.66s·12,460자
- GPT-5 mini와 GPT-5.6 Luna는 신규·미색인 Wikidocs 글 실패; 과거 색인 글은 일부 성공
- GeekNews는 Chrome/141 direct 200·169ms·7,604자, browserless도 200·4.4s·동일 7,604자
- Brunch 실주소 캐시 우회 요청은 `scrapingbee-static` 200·8.89s·4,507자

전체 판정과 URL별 수치는 [`DEV_260823`](../docs/logs/2026/08/DEV_260823.md)에 고정한다.

## 하니스가 실제로 잡는지 확인할 것

**통과하는 테스트는 공짜다. 실패할 수 있는 테스트만 값이 있다.**
2026-08-18 오전에 "레거시 첨부 이미지가 보이는가"를 최우선 롤백 기준으로 세웠는데,
그 경로는 공개 URL 직행이라 **RLS 와 무관해서 애초에 실패할 수 없는 테스트**였다.
→ 새 케이스를 넣을 땐 **고친 코드를 잠깐 되돌려 실패하는지 보고** 넣는다.

## 목록

| 파일 | 무엇을 지키나 |
|---|---|
| `test-intent-rules.mts` | 의도 분류 룰 — 잡아야 할 것 / 잡으면 안 될 것 양방향 + **논문↔소프트웨어 산출물 가드**(`레포 검색` 이 arXiv 카드로 가지 않는가 / 진짜 논문 요청은 유지되는가) |
| `test-search-policy.mts` | 검색 on/off 판정 + **공급자별 tier 400**(Gemini 의 이미지+grounding 제약을 OpenAI 턴에 적용하지 않는다 — 대조군으로 `provider` 미지정 시 기존 동작 고정) |
| `test-weather-followup.mts` | 날씨 후속 발화 + 날짜 경계(KST 자정) |
| `test-card-followup.mts` | 약국·병원·동물병원·법률 카드 후속 판정 + fast-pass 내부 지시문 차단 + Gemini 도구 강제 + 약국 현재 영업 상태 계약 |
| `test-storage-name.mts` | 업로드 파일명 정규화 — 확장자 보존은 `parse-document` 가 의존하는 계약 |
| `test-pill-messages.mts` | 알약 응답 문구·파싱·웹 폴백 게이트·라우터 지름길 |
| `test-ddg-parse.mts` | 웹 검색 HTML 파싱 — 실제 응답 조각을 픽스처로 고정 |
| `test-thinking-config.mts` | Gemini 모델별 thinking level/budget 하한과 강등 규칙 |
| `test-openai-url-fetch.mts` | OpenAI URL 폴백 모듈 + 기본 OFF 기능 플래그 + ScrapingBee 선행 배선 + **논문 카드 종합단계 웹검색**(명시 검색 요청일 때만·논문 intent 만·과거참조 제외, 그리고 실제로 `web_search` 툴이 실리는지 배선까지) |
| `test-chat-models.mts` | 모델 레지스트리·Responses 멀티턴·strict function calling·카드 fast-pass/약품 합성·Gemini `googleSearch`/OpenAI `web_search` 매핑·실제 `url_citation` 번호화·quota/UI 오류 정책 |
| `test-drug-fallback.mts` | 약품 제품명/성분명 분기·Search 모델 2.5·키 회전·내부 MFDS/쿼터 fallback 비노출 |
| `test-gemini-citations.mts` | Gemini 인용 — 히스토리에 마커 되먹임 금지(근본 원인)·본문 생 redirect URL 비노출·한글 바이트 오프셋 삽입·스트리밍 청크 경계 |
| `test-paper-card.mts` | 논문 카드 — 근거 등급 판정(추정 금지)·초록 결론 추출과 꼬리 보일러플레이트 제거·철회 판정(정반대 값 구분)·검색어 붕괴 방어·인용할 수 없는 논문의 분리·**멀티턴 후속 판정**(재조회 vs 카드 대화)·**카드 범위 밖 인용 마커 제거**(스트림 배선 포함)·프롬프트 계약·배선. **소스를 정규식으로** 본다 |
| `test-stream-dispatch.mts` | **SSE 이벤트 루프** — 가짜 이벤트를 넣고 나온 프레임을 본다. 카드 8종이 각자 나가는가, **else-if 체인에서 앞 분기가 뒤를 삼키지 않는가**, law_qa 억제, sports 게이트, generator 밖 토큰 차단, 청크 경계 인용, 출처 중복 제거. 모델도 네트워크도 없다 | §9 는 **빈 카드 선전송 금지** — 카드를 먼저 보내면 `fullAiResponse` 가 채워져 생성기의 산문이 통째로 폐기된다(§6.30)
| `test-theaters.mts` | **상영관 지역 매칭** — `"성남"` 이 CGV **울산성남**(울산 남구)을 물어온 게 계기다. 다른 도시 지점 배제 4건, 같은 도시 안 비접두 매칭 유지(동수원·북포항), 별칭, 시·도 단위 질의 차단. 데이터는 `data/theater-branches.json` 이라 네트워크 없다 |
| `render-paper-card.mts` | 논문 카드 — **실제로 렌더한 HTML** 을 본다. 철회/초록없음 칸이 정말 그려지는가, 두 칸이 섞이지 않는가, 4개 언어 문구, 빈손 분기, 옛 카드 하위호환. 위 하니스와 겹치지 않는다(정규식은 "코드가 파일에 있다" 까지만 말한다) |
| `test-model-labels.mts` | 모델 선택 UI 문자열 — **리팩터링 전 골든** 대조(섹션 3 + 모델 6 × 4개 언어 × 라벨/설명), 컴포넌트로 문자열이 되돌아오지 않는 구조 보장, 빈 값·언어 폴백, 렌더 지점 배선 |

## `server-only` 를 임포트하는 모듈 직접 돌리기

`server/**` 상당수가 `server-only` 를 끌어와 tsx 로 바로 안 돌아간다. 스텁으로 우회한다:

```bash
npx tsx --env-file=.env.local --tsconfig tests/tsconfig.probe.json <스크립트>
```

## OpenAI 채팅 모델 라이브 테스트

`gpt-5.4-mini`와 `gpt-5.6-luna`를 실제 Responses API로 한 번씩 호출한다.
API 비용이 발생하므로 일반 `npm test`에서는 실행하지 않는다.

```bash
npm run test:openai-live
```

`.env.local` 또는 `.env`에 서버 전용 `OPENAI_API_KEY_TIER1`이 필요하다.
테스트는 키 값을 로그에 출력하지 않는다.

2026-08-23 실측:

- GPT-5.4 mini 멀티턴: 성공, 약 1.41s
- GPT-5.6 Luna 멀티턴: 성공, 약 1.52s
- 자동 회귀 `test-chat-models.mts`: 66개 통과
- 라이브 `test-openai-chat-models-live.mts`: GPT-5.4 mini/GPT-5.6 Luna 각각 멀티턴 + strict function call 확인(실제 비용, 자동 테스트 제외)
- 자동 회귀 `test-drug-fallback.mts`: 15개 통과

자동 하니스는 `insufficient_quota` 외에도 `credit_balance_exhausted`, 조직/프로젝트 spend limit,
조직 usage limit을 영구 소진으로 분류하고, 일시적 429는 `rateLimit`으로 남는지 확인한다. 공급자
원문 오류 문자열이 SSE UI 경로에 직접 들어가지 않는 것도 함께 검사한다.

2026-08-18 에 **웹 검색이 전 검색에서 출처 URL 을 0건 반환하던 버그**를 이걸로 한 번에 잡았다
(DDG 가 속성 순서를 바꾸고 `uddg=` 리디렉션을 폐지 → 정규식 두 개가 동시에 죽어 있었다).
없었으면 로그 왕복으로 몇 바퀴 돌았을 것이다.
