# 회귀 하니스

```bash
npm test        # 11종 전부
npm run verify  # typecheck + test
```

2026-08-18 에 `scripts/` 에서 옮겨왔다. 예전에는 `.gitignore` 에 하니스마다 `!scripts/test-*.mts`
예외를 한 줄씩 달았는데, **버릴 것과 남길 것이 한 폴더에 섞여 있던 게 원인**이었다.
폴더를 나눠서 예외를 없앴다 — `scripts/` 는 이제 통째로 무시되는 일회성 습작 전용이다.

## 여기 둘 자격 — 셋 다 만족

① 시크릿·환경변수를 안 읽는다 ② 네트워크를 안 탄다 ③ **프로덕션 로직을 import 해서 잰다**

③ 이 가장 중요하다. 정규식이나 문구를 **복사해 두면 프로덕션이 바뀐 뒤에도 하니스는 계속 초록**이다.
실제로 그런 하니스가 있었다(`test-search-rules.mjs`).

## `manual/` — 수동 네트워크 프로브

`tests/manual/`은 외부 공급자·실사이트 상태를 재현하는 수동 진단 도구다. 환경변수와 네트워크를
사용할 수 있지만 `npm test`에는 포함하지 않는다. 자동 회귀 하니스의 위 세 조건과 섞지 않으며,
실행 시 외부 API 크레딧이 소모될 수 있다.

- `npm run audit:wikidocs-puppeteer -- <URL>`: Browserless Puppeteer와 Cheerio 결과 비교
- `npm run audit:url-openai -- <URL>`: `OPENAI_API_KEY_TIER1`로 장애 표본의 웹 검색과 정확한 URL 출처 확인

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
| `test-intent-rules.mts` | 의도 분류 룰 — 잡아야 할 것 / 잡으면 안 될 것 양방향 |
| `test-search-policy.mts` | 검색 on/off 판정 |
| `test-weather-followup.mts` | 날씨 후속 발화 + 날짜 경계(KST 자정) |
| `test-card-followup.mts` | 약국·병원·동물병원·법률 카드 후속 판정 + fast-pass 내부 지시문 차단 + Gemini 도구 강제 + 약국 현재 영업 상태 계약 |
| `test-storage-name.mts` | 업로드 파일명 정규화 — 확장자 보존은 `parse-document` 가 의존하는 계약 |
| `test-pill-messages.mts` | 알약 응답 문구·파싱·웹 폴백 게이트·라우터 지름길 |
| `test-ddg-parse.mts` | 웹 검색 HTML 파싱 — 실제 응답 조각을 픽스처로 고정 |
| `test-thinking-config.mts` | Gemini 모델별 thinking level/budget 하한과 강등 규칙 |
| `test-openai-url-fetch.mts` | OpenAI URL 폴백 모듈 + 기본 OFF 기능 플래그 + ScrapingBee 선행 배선 |
| `test-chat-models.mts` | 모델 레지스트리·Responses 멀티턴·strict function calling·카드 fast-pass/약품 합성·Gemini `googleSearch`/OpenAI `web_search` 매핑·실제 `url_citation` 번호화·quota/UI 오류 정책 |
| `test-drug-fallback.mts` | 약품 제품명/성분명 분기·Search 모델 2.5·키 회전·내부 MFDS/쿼터 fallback 비노출 |

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
