# Gemini 3.8 도입 전 프로브

프로덕션 모델 등록을 바꾸지 않고 앱 연결 상태와 공급자 호환성을 별도로 검사한다.
`npm test`에는 포함하지 않는다. 결과는 기본 `/tmp` 경로 또는 `--out`으로 지정한 파일에 저장한다.

## 오프라인 연결 상태

```bash
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/check-integration.mts --out /tmp/gemini-3-8-integration.json
```

실제 서버/UI 허용목록, capability·thinking 함수와 기본값을 import한다. 환경변수·네트워크를 사용하지 않는다.
준비됨은 종료 코드 0, 누락은 2다. 현재 미등록이므로 2가 정상적인 **차단 결과**이며 도입 테스트 통과가 아니다.
`threeXSamplingPolicy`는 현재 구현 연결을 검사한다. 향후 sampling 정책을 다른 구조로 바꾸면 이 검사도 조정한다.

## 제한된 라이브 호환성

```bash
# 호출 없이 사례와 예산만 확인
node --import tsx tests/manual/gemini-3-8/live-compat.mts --suite extended
# API_KEY_TIER1 하나로 실행
node --import tsx tests/manual/gemini-3-8/live-compat.mts --suite extended --tier paid --live
# 기존 기본 키 풀에서 이름순 첫 유효 키 하나로 실행
node --import tsx tests/manual/gemini-3-8/live-compat.mts --suite extended --tier free --live
# 비교 모델은 별도 파일에 저장
node --import tsx tests/manual/gemini-3-8/live-compat.mts --model gemini-3.7-flash --suite smoke --tier paid --out /tmp/gemini-3-7-smoke.json --live
```

`--live`를 명시해야 `.env.local` → `.env`를 읽고 API를 호출한다. 이미 설정된 환경변수를 덮어쓰지 않는다.
`paid`/`free`는 **키 선택 이름**이다. 프로젝트의 실제 결제 상태를 조회하지 않으므로 무료 제공을 증명하지 않는다.
키 누락 시 요청 없이 종료한다. 키 값·원문 SDK 오류·헤더는 출력하지 않는다.

- smoke 4회: 명시적 low, 현재 프로덕션 thinking 설정, JSON 스키마, 강제 함수 호출.
- extended 최대 9회: minimal 거부, budget 0 수용, 실제 앱 차트 프롬프트, 12턴/약 1만 토큰 합성 히스토리, 설치된 LangChain의 low 설정.
- 요청당 입력 직렬화 100,000자 이하·출력 4,096토큰 이하·45초 제한. 재시도/키 회전 없음.
- 401/403/404/429 또는 통신 오류면 즉시 중단하고 `complete: false`로 기록한다. 중단 이후 사례는 미검증이다.
- 검색·실제 외부 도구 실행·업로드는 없다. 함수는 인자 생성까지만 검증한다.
- 모든 사례가 예상 결과면 종료 0, 실패·미완주면 1, 키가 없으면 2.
- 성공한 SDK 호출은 `modelVersion`을 기록한다. LangChain 메타데이터에 모델명이 없으면 null로 남긴다.
- 결과에는 합성 입력에 대한 출력·usage·elapsedMs가 포함된다. fixture를 개인정보나 실제 대화로 교체하지 않는다.

현재 프로덕션 설정은 순수 함수를 직접 호출해 얻는다. 차트도 `getSystemInstruction`·`getRendererSections`·
`getIntentFocusHint`를 import한다. 단, 이 프로브는 전체 generator 상태 조립·그래프·HTTP·SSE·렌더링을 실행하지 않는다.
명시적 low 사례는 **후보 설정 실험**이며 현재 앱이 3.8에서 low를 쓴다는 의미가 아니다.
차트는 JSON과 데이터 보존만, 긴 히스토리는 합성 키 회수만 검사한다. 종합 품질·지연 분포·미디어·검색은 별도 검증이 필요하다.

## 스크립트 타입 검사

```bash
node_modules/.bin/tsc --noEmit --skipLibCheck --target ESNext --module ESNext --moduleResolution bundler --esModuleInterop tests/manual/gemini-3-8/*.mts
```

결과: [2026-09-06 로그](../../../docs/logs/2026/09/DEV_260906.md).

## 인텐트·실제 그래프 멀티턴

```bash
# 계획만 출력(26개 라우팅 사례 / 12개 생성 턴)
node --import tsx tests/manual/gemini-3-8/live-intents-multiturn.mts --suite routing --router candidate
node --import tsx tests/manual/gemini-3-8/live-intents-multiturn.mts --suite graph
# 실제 라우터 로직 + 3.8 후보 모델 평가
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/live-intents-multiturn.mts --suite routing --router candidate --live
# 현재 router(2.5) + 실제 생성 그래프(선택 3.8) + 프로덕션 stream dispatcher
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/live-intents-multiturn.mts --suite graph --live
# 특정 시나리오만 재검증. 쉼표로 여러 필터 지정 가능
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/live-intents-multiturn.mts --suite graph --filter memory-correction --out /tmp/gemini-3-8-memory.json --live
# 현재 router 기준선: --router current (기본값)
```

`API_KEY_TIER1` 하나만 사용하고 프로브 프로세스의 기본 키 풀도 그 키 하나로 제한한다.
라우팅은 최대 30회, 그래프는 최대 36회의 **실제 HTTP 요청**을 허용한다. 앱 내부 재시도도 횟수에 포함한다.
요청당 출력 4096토큰, 직렬화 입력 150,000자, 실행 전체 입력 2,000,000자, HTTP 45초/턴 70초 상한.
프로덕션이 더 낮은 출력 상한을 지정하면 그것을 유지한다. 이 출력 상한은 테스트 개입이므로 무제한 프로덕션 성능과 동일시하지 않는다.

프로브의 fetch 경계는 Gemini 생성 엔드포인트만 허용하고 실제 검색·외부 도구 네트워크는 차단한다.
통신/HTTP 실패·예산 초과·검색 요청이 생기면 이후 네트워크 요청을 막고 BLOCKED로 기록한다.
정상 요청의 모델 ID, thinking 설정, 응답 스트림의 `modelVersion`을 기록하며 키·URL·원문 오류는 출력하지 않는다.
기존 코드의 로그는 민감값 노출 방지를 위해 원문을 숨기고 fallback 여부만 기록한다.

- **routing/current:** 실제 `routerNode`와 현재 router 모델. 3.8 모델 평가는 아니다.
- **routing/candidate:** 실제 `routerNode`의 프롬프트·후처리·후속 판정은 유지한다. 전송 경계에서 모델만 3.8로,
  thinking을 LOW로 바꾼 **후보 router 실험**이다. 프로덕션 router 교체 완료를 의미하지 않는다.
- **graph:** 실제 `compileAgentGraph`, `buildHistoryMessages`, `createStreamDispatch`를 호출한다.
  실제 응답을 다음 턴에 넣고, 앞 턴이 실패하면 그 시나리오의 후속 턴을 중단한다.
  3.8 capability/thinking을 임시 등록하지 않으므로 **현재 미등록 상태의 생성 설정**을 그대로 측정한다.
  HTTP 인증/허용목록과 브라우저 화면은 거치지 않는다.
- **PASS의 의미:** 정해진 intent/값 보존/JSON 구조 조건 통과. graph는 generator에서 호출한 모든 모델이
  3.8이고 응답 모델명도 확인되어야 한다. 다른 모델/모델명 미확인은 `OTHER_MODEL_OR_UNVERIFIED`.
- 알약 이미지는 `drug_id` fast-path의 합성 메타데이터만 검사한다. 실제 이미지나 Vision 호출은 없다.
- biology/chemistry/physics/astronomy의 JSON 블록 존재는 실제 렌더링·과학적 정확성의 증명이 아니다.
- 연도가 들어간 월드컵 질문은 기존 router의 연도 필터 정책상 general이다. 현재 대회 sports 질의와 구분한다.

### 판정기와 저장 결과 재검사

```bash
node --import tsx tests/manual/gemini-3-8/test-scenarios.mts
node --import tsx tests/manual/gemini-3-8/review-results.mts /tmp/gemini-3-8-graph-current.json /tmp/gemini-3-8-graph-memory-recheck.json /tmp/gemini-3-8-routing-candidate.json /tmp/gemini-3-8-routing-extra.json
```

판정기 10건은 밑줄 코드·LaTeX/유니코드 분자식의 유효 표현과 잘못된 값·바뀌지 않은 차트·JSON 파손을 대조한다.
재검사는 API를 호출하지 않으며 원본 판정·출처를 보존한 `/tmp/gemini-3-8-reviewed.json`을 만든다.
나중 입력의 동일 사례가 이전 사례를 대체한다. 이는 모델 재실행이 아니며, 빠진 사례가 있으면 전체 통과로 해석하지 않는다.

## 3.7 vs 3.8 공정 비교

```bash
# 기본 dry-run: 12사례 × 2모델 × 3반복 = 72회
node --import tsx tests/manual/gemini-3-8/compare-models.mts
node --import tsx tests/manual/gemini-3-8/compare-models.mts --rounds 3 --live
node --import tsx tests/manual/gemini-3-8/summarize-comparison.mts /tmp/gemini-3-7-vs-3-8.json
```

두 모델 모두 같은 API_KEY_TIER1, 명시적 LOW, 출력 4096토큰, 요청별 45초 상한이다.
12개 사례의 실제 앱 프롬프트를 사용하고, 모델별 실행 순서를 번갈아 배치한다.
멀티턴은 어느 모델의 출력도 기준으로 삼지 않은 **공통 합성 히스토리 재생**이다.
따라서 입력 해시가 같은 쌍을 비교할 수 있다. 각 모델이 자기 답변을 이어가는 자연 멀티턴 평가는 위 graph 프로브의 별도 역할이다.

라우터·외부 도구·검색·미디어·UI를 제외해 생성 모델 차이를 분리한다.
인텐트는 고정값이므로 인텐트 분류 정확성을 채점하지 않는다. JSON/값 보존, 실제 응답 모델,
정상 종료 여부를 검사하고 첫 텍스트 시간·전체 완료 시간·입력/출력/사고 토큰을 기록한다.
HTTP/통신 실패 시 중단하며 키 회전·재시도·다른 모델 fallback은 없다.
`--rounds`는 1~3만 허용한다. 결과에는 합성 질의에 대한 원문 출력이 포함된다.

요약은 모든 실패를 별도로 남기고 성공 표본의 중앙값·최댓값 및 양쪽 모두 통과한 쌍의 시간 비율을 계산한다.
작은 표본으로 p95·통계적 우월성을 주장하지 않는다. usage 미보고 수를 확인하며 미보고 토큰을 실제 0으로 해석하지 않는다.
단가·캐싱·사고 토큰 정책까지 확정하지 않았으므로 총 토큰 차이를 청구 금액 차이로 단정하지 않는다.

---

## 3.6 vs 3.7 vs 3.8 정답률 비교 (intent별)

앞 절들이 "3.8이 동작하는가"를 물었다면 이 두 suite는 **"셋 중 어느 것이 더 맞히는가"** 를 묻는다.
LLM 심판 없이 결정론적 정답으로만 채점한다. 기본 모델은 현재 3.6이므로 현직이 비교에 포함된다.

### 채점기 먼저

```bash
node --import tsx tests/manual/gemini-3-8/test-tc-intents.mts
```

`tc-intents.mts`의 14개 TC와 채점기를 검증하는 **32개 대조검사**다. 정답을 받는지뿐 아니라
**지정된 오답을 거부하는지**까지 검사한다 — 650이 65로, `4HHB`의 4가 사슬 수 4로,
잘못된 분자식이 정답으로 새지 않는지. 정답률이 결론인 실험이므로 채점기가 먼저 통과해야 한다.

채점기의 두 가지 규칙:
- **산문과 렌더러 블록을 분리해 채점한다.** diagram의 magnitude나 chart의 데이터에만 있는 숫자는
  모델이 답을 말한 것으로 치지 않는다.
- 숫자는 단어 경계로 추출해 수치 비교한다. 문자열 포함 검사가 아니므로 650이 65를 만족시키지 않는다.

TC는 `server/agent/prompt.ts`가 **예시로 들고 있는** 분자·별자리를 피한다(에탄올 `CCO`, 오리온자리).
프롬프트를 복사만 해도 통과하는 문항은 지식을 측정하지 못한다.

### Suite A — 비검색 생성 정답률

```bash
# dry-run: 14 TC × 3모델 × 2조건 × 3회 = 252회
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/compare-three.mts
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/compare-three.mts --rounds 3 --live
```

`general`·`data_viz`·`chemistry`·`physics`·`biology`·`astronomy`·`medical_qa` 7종 × 2 TC.
이 7종이 3.x 생성기에 실제로 도달하는 intent다. 나머지는 검색 턴이 2.5로 강등되거나
(`generator.ts`의 `needsSearchFallback`) 외부 도구를 타므로 모델 선택과 무관하다.

**두 thinking 조건을 모두 돌린다.** "모델이 나쁜가"와 "우리 설정이 나쁜가"를 분리하기 위해서다.

| 조건 | 3.6 | 3.7 | 3.8 |
|---|---|---|---|
| `low` | `low` | `low` | `low` |
| `production` | `minimal` | `low` | 일반·렌더러 **미지정**, `medical_qa` **`budget 3000`** |

`production` 조건은 실제 `resolveThinkingConfig`를 호출해 얻는다. 두 가지가 여기서 드러난다:
- 3.8은 미등록이라 **2.5용 budget 경로로 떨어진다.** 3.6이 `thinkingBudget`을 거부하므로
  3.8도 거부하면 `medical_qa` 전량이 400이다. 그 400은 **결과로 기록하고 실행을 멈추지 않는다**
  (`invalid-request`). 인프라 장애만 중단 사유다.
- `low` 조건의 3.6 렌더러가 빈 응답을 내면, 그것은 2026-06-23 minimal 전환 결정의 독립 재확인이다.
  `emptyAnswers`로 오답과 따로 집계한다.

FAIL은 측정 결과이므로 **종료 코드를 1로 만들지 않는다**(미완주만 1). 앞 절의 `compare-models.mts`와
의도적으로 다르다 — 거기서는 FAIL이 호환성 결함이었고 여기서는 정답률 그 자체다.

### Suite B — grounding 정답률

```bash
# dry-run: 6질문 × 3모델 × 5회 = 90회
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/grounding-compare.mts
TSX_TSCONFIG_PATH=tests/tsconfig.probe.json node --import tsx tests/manual/gemini-3-8/grounding-compare.mts --live --confirm-expectations
```

[PLAN_MODEL_3_7_MIGRATION_260817 §2](../../../docs/plans/PLAN_MODEL_3_7_MIGRATION_260817.md)가 기록한
**3.6의 grounding 정답률 2/5**를 재검증한다. §2의 표본은 1질문 × 5회였다. 6질문 × 5회로 넓힌다.
§2가 쓴 네 축을 그대로 기록한다:

- `invoked` — 검색이 실제로 돌았는가
- `queryCount` — 발행 검색어 개수 (3.6은 매번 **1개**였다)
- `correct` — 확인된 사실을 담았는가
- `citedWrong` — **검색이 돌았는데 틀린 답.** UI가 그 메타데이터로 출처 칩을 그리므로
  **틀린 답에 신뢰 표식이 붙는다.** §2가 "미발동보다 나쁘다"고 적은 축이고, 이 suite의 핵심 지표다.

🔴 **기대값은 채워진 채로 커밋되지 않는다.** 정답이 시점에 의존하기 때문이다.
실행 전 사람이 파일 상단 `questions` 표의 `expect`와 `CONFIRMED_ON`을 1차 출처로 확인해 채우고,
`--confirm-expectations`로 그 사실을 명시해야 한다. 셋 중 하나라도 비면 **요청을 쓰지 않고 종료 2**다.
채점할 수 없는 호출에 비용을 쓰지 않는다. 확인 날짜와 출처는 날짜 로그에 남긴다.

질문은 **모델이 기억으로는 틀리고 검색해야 맞는 것**으로 고른다. 기억만으로 맞히는 질문은
grounding을 측정하지 못한다.

Suite A와 달리 이 suite만 Gemini `googleSearch`를 켠다. 앱의 무료티어 검색 강등(2.5) 경로는
타지 않으므로, 결과는 **유료 키의 3.x 직접 경로**를 설명한다.

### 집계

```bash
node --import tsx tests/manual/gemini-3-8/summarize-three.mts \
  /tmp/gemini-three-way.json /tmp/gemini-three-way-grounding.json
```

파일의 `suite` 필드로 종류를 판별하므로 인자 순서는 무관하고, 한쪽만 넘겨도 된다.
정답률을 먼저, 지연을 부수로 집계한다. **어느 검사가 실패했는지**(`failedChecks`)를 세므로
"왜 지는가"가 보인다 — 값 보존 실패인지, 블록 누락인지, 빈 응답인지.

- 셀당 관측이 42개(3회 × 14 TC)다. 정답률 차이의 **통계적 유의성을 주장하지 않는다.**
- 구조·값 보존 채점이므로 자유서술의 설명 품질·사실성은 측정하지 않는다.
- 단발 멀티턴·미디어·실제 외부 도구·브라우저 렌더링은 여전히 범위 밖이다.
