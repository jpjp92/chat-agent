# PLAN_CODE_HYGIENE_261018 — 주석 언어·메모성 주석·데드코드 정리

> 작성일: 2026-10-18 · 상태: 1~3·5·6단계 완료(10-18 — [DEV_261018 §14·§15](../logs/2026/10/DEV_261018.md#15-메모성-주석--로그-이전--이모지-제거)) · 4·7단계(규칙 명문화·재발 방지 도구) 미착수
> 범위: git 추적 소스 244개(`app` `components` `server` `src` `lib` `utils` `services` `tests` 등, `docs`·`public` 제외)
> 선행 정리: [DEV_260829_DEADCODE](../logs/2026/08/DEV_260829_DEADCODE.md)(fetch-transcript·pill-search 삭제)

---

## 1. 조사 결과 요약

| 항목 | 수치 | 판단 |
|---|---|---|
| 소스 줄 수 / 주석 줄 수 | 41,538 / 6,673 (16%) | 핵심 판정 파일은 30~45% — 주석이 코드만큼 길다 |
| 주석 언어 | 한국어 5,411줄(81%) · 영어 1,169줄(18%) | **한국어가 기본**. 영어는 오래된 렌더러·유틸에 몰림 |
| 파일 단위 | 혼합 110 · 한국어만 98 · 영어만 27 | 같은 파일 안에서 섞인 경우가 가장 많다 |
| 메모성 주석(날짜·DEV/PLAN·§·🔴🟡⚠️·측정·회귀) | 1,251줄, 소스(tests 제외) 이모지 표지 316개 · DEV/PLAN 참조 58개 | 일부는 "왜"라 남길 가치, 다수는 개발 일지 |
| 데드 파일 | 2개(126줄) | 삭제 |
| 미사용 지역 변수·import | 30개(`tsc --noUnusedLocals`, tests 제외) | 삭제 |
| 외부에서 안 쓰는 export | 함수·상수 24 · 타입 약 60 | 파일 안에서는 쓰임 → `export` 만 제거(선택) |
| 테스트에서만 쓰는 export | 약 45 | **정상**(하니스용 순수 함수) — 유지 |

측정 방법: 주석 줄 정규식 집계(스크립트는 일회성), `npx knip@5`, `npx tsc --noEmit --noUnusedLocals`. knip 은 `tests/` 를 진입점으로 모르기 때문에 "unused files 91 · exports 40" 은 부풀려진 값이다 — 아래는 `git grep` 으로 다시 거른 것이다.

---

## 2. 주석

### 2-1. 언어

- 영어 위주 파일(영어 비율 40% 이상, 주석 8줄 이상): `components/ConstellationRenderer.tsx`(109/109) · `DiagramRenderer.tsx` · `ChartRenderer.tsx` · `Header.tsx` · `DrugRenderer.tsx` · `ChatMessage.tsx` · `utils/celestialMath.ts` · `utils/astronomyHelper.ts` · `server/config.ts` · `server/agent/nodes/sdk-contents.ts` · `retry.ts` · `graph.ts` · `app/api/fetch-url/route.ts`(80/147) · `app/layout.tsx` 외
- 혼합의 전형: [langchain-path.ts](../../server/agent/nodes/langchain-path.ts) 는 한 줄 한국어 주석 바로 아래 영어 JSDoc 블록(이관 당시 작성)

**제안: 주석은 한국어로 통일.** 이미 81% 이고 docs·커밋·로그가 모두 한국어다. 예외는 둘만 둔다.
- 외부 API 필드명·스펙 문구 인용(`regnGrpNm`, HTTP 헤더 등)은 원문 그대로
- 천문 계산(`celestialMath`·`astronomyHelper`)처럼 공식·논문 용어가 영어인 곳은 용어만 영어

### 2-2. 메모성 주석

지금 주석에는 세 종류가 섞여 있다.

| 종류 | 예 | 처리 |
|---|---|---|
| **불변식·이유**(지우면 다시 같은 실수) | "`new URL()` 정규화 덕에 숫자 IP 가 막힌다", "per-call 타임아웃 일률 적용 금지 — YouTube 는 30~48s 정당" | **남긴다**. 짧게, 결론 먼저 |
| **경위·일지**(무엇이 언제 어떻게 바뀌었나) | generator.ts:28~50 의 "25s 원래 근거 → 57 → 90" 이력, "aa9d701 이전엔…", "(extracted from generator.ts, 3-A — move-only)" | **DEV 로그로 보내고** 주석은 한 줄 + 링크 |
| **틀린 주석**(코드와 어긋남) | 아래 2-3 | **즉시 고친다** |

규칙(안):
1. 주석은 **지금 코드가 왜 이런지**만. 과거 값·실험 경위·측정 표는 `docs/logs` 에.
2. 근거 링크는 `→ DEV_YYMMDD §N` 한 줄. 날짜·이모지 표지는 그 링크로 대신한다.
3. 주석에 이모지를 쓰지 않는다. 깨지기 쉬운 불변식은 `주의:` 로 시작한다(10-18 결정).
4. 주석 블록 15줄 넘으면 문서로 옮길 후보(현재 `fetch-url` 91줄, `probe-layer-conflict` 47줄, `intent-rules` 27줄 등).

### 2-3. 지금 틀린 주석 — "Vercel 60s 캡"

`/api/chat` 은 `maxDuration = 300` 이다(60s 는 우리가 건 리터럴이었고 이미 정정됨). 그런데 소스 주석 9곳이 여전히 60s 를 한계로 설명한다.

- [langchain-path.ts:22](../../server/agent/nodes/langchain-path.ts#L22) "Vercel 60s 캡 아래에서 빠른 실패"
- [generation-config.ts:11·39](../../server/agent/nodes/generation-config.ts#L11) "fit within Vercel 60s"
- [generator.ts:135·158·294](../../server/agent/nodes/generator.ts#L135) "60s 캡을 넘겨"
- [drug-info-tool.ts:173](../../server/agent/drug-info-tool.ts#L173)
- generator.ts:28·44 와 generation-config.ts:91 은 정정 경위를 적은 것 → 2-2 규칙대로 한 줄로 축약

같은 종류의 stale 설명이 TODO 에도 하나 있다: `router.ts` intent 수 주석·`in Seoul`([TODO.md:743](../TODO.md)).

---

## 3. 데드코드

### 3-1. 삭제 — 확실

| 대상 | 근거 |
|---|---|
| `server/agent/worldcup-tool.ts` · `lib/sports/football-data.ts` (126줄) | 어디서도 import 안 함. 스포츠 의도는 2026-10-04 제거([DEV_261004](../logs/2026/10/DEV_261004.md)) |
| 연관 잔재 | `.env.example` `SPORTS_API_KEY`, [privacy/page.tsx:60](../../app/privacy/page.tsx) "스포츠는 대회명(football-data.org)" — **개인정보처리방침 문구라 함께 고쳐야 한다**, langchain-path.ts:79 주석, `tests/manual/openai-6-luna/compare-tools.mts` 참조 |
| 미사용 지역 변수·import 30개 | `generator.ts` `markKeyDailyExhausted`·`isDailyQuotaError`, `langchain-path.ts` `systemInstructionBase`, `search-gate.ts` `dropImageForSearch`, `weather-followup.ts` `TIME_SHIFT`·`REQUEST_VERB`·`CITY_ONLY_REASK`, `lib/weather` `isPrecipCondition`, `ConstellationRenderer` 5개, `useChatStream` `urlFetchError`·`hasError`, `App.tsx` 2개, dev 미리보기 `React` 3개 등 |
| 주석 처리된 코드 | `Header.tsx:113` `// showToast(...)` — 소스 전체에서 이 한 곳뿐 |

⚠️ 미사용 변수 중 **판정·키 로테이션 쪽**(`isDailyQuotaError`, `markKeyDailyExhausted`, `TIME_SHIFT` 등)은 "지워도 된다" 가 아니라 **"쓰려다 빠진 것"** 일 수 있다. 지우기 전에 해당 커밋을 `git log -S` 로 한 번 보고, 의도한 동작이 빠진 거면 버그로 따로 기록한다.

### 3-2. 정리 — 선택

- **외부에서 안 쓰는 export**: `isPaidFirstEnabled`, `wantsSoftwareArtifact`, `detectCityMention`, `resolveTtsProviders`, `OPENAI_MODEL_CAPS`, 타입 약 60개 등. 파일 안에서는 쓰이므로 동작 영향 없음. `export` 를 떼면 공개 표면이 줄어 다음 knip 결과가 깨끗해진다. 우선순위 낮음
- **중복 export**: `HospitalRenderer`·`LawRenderer`·`MovieRenderer`·`PharmacyRenderer`·`VetRenderer`·`WeatherRenderer` 가 named + default 둘 다 — import 쪽에 맞춰 하나로
- **`zod` 미선언 의존성**: 도구 10개가 `zod` 를 직접 import 하는데 `package.json` 에 없다(LangChain 전이 의존). 직접 의존으로 추가 권장 — 상위 버전이 바뀌면 깨진다

### 3-3. 유지 — 데드코드 아님

- 테스트에서만 쓰는 export 약 45개(`paper-tool` 9개, `arxiv-tool` 4개, `ssrf`, `text-repair` 등) — 하니스용 순수 함수
- `tests/manual/**` — 수동 프로브. 다만 `tests/manual/gemini-3-8/` 16개 파일은 3.8 전환이 끝났으므로(10-18) 보관 여부 결정 필요

---

## 4. 진행 순서(안)

| 단계 | 내용 | 위험 | 검증 |
|---|---|---|---|
| 1 | 월드컵 파일·잔재 삭제, privacy 문구 수정, 틀린 60s 주석 수정 | 낮음 | `npm run build`, 하니스 전체 |
| 2 | 미사용 변수·import 30개 — 판정 쪽은 `git log -S` 확인 후 | 낮음~중간 | `tsc --noUnusedLocals` 0건 |
| 3 | `zod` 직접 의존 · 중복 export 정리 | 낮음 | build |
| 4 | 주석 규칙(2-2)을 `CLAUDE.md`/기여 규칙에 명시 | — | — |
| 5 | 주석 정리 — **파일 단위, 그 파일을 고칠 때 같이**. 먼저 메모 밀도 상위(`generator.ts` · `router.ts` · `intent-rules.ts` · `prompt-assembly.ts` · `card-followup.ts` · `stream-dispatch.ts` · `fetch-url`) | 낮음(동작 무관) | diff 에 코드 변경 없음 확인 |
| 6 | 영어 주석 번역 — 렌더러·유틸 | 낮음 | 〃 |
| 7 | 재발 방지: `knip` 설정(`tests/**` 진입점 포함) + `noUnusedLocals` 를 tsconfig 에 켜기 | 낮음 | CI/verify 에 추가 |

주석 정리는 한 번에 몰아서 하면 diff 가 수천 줄이 돼 리뷰가 안 되고 다른 작업과 충돌한다. **1~3 은 한 번에, 5~6 은 "건드리는 파일부터"** 가 현실적이다.

## 5. 결정할 것

- ~~주석 언어~~ → **한국어 통일**(10-18 결정·적용). 주석은 "왜"만, 경위는 로그로(10-18 결정)
- `tests/manual/gemini-3-8/` 보관(아카이브 폴더) vs 삭제
- `noUnusedLocals` 를 tsconfig 에 켤지(켜면 이후 같은 잔재가 빌드에서 막힌다)
