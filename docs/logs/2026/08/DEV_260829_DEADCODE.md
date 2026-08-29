# 레거시·데드코드 전수 점검과 1차 제거

> 날짜: 2026-08-29
> 범위: 소스 130개 파일 · top-level export 340개 전수 · 고아 API 라우트 · 문서↔코드 드리프트
> 계기: [`services/geminiService.ts` 검토](#0-왜-시작했나) 중 "이름과 실제가 다른 파일"이 나와 레포 전체로 넓혔다

## 0. 왜 시작했나

OpenAI 모델(`gpt-5.4-mini`·`gpt-5.6-luna`)까지 확장된 뒤 `services/geminiService.ts` 가 어떻게 쓰이는지 확인하다 출발했다. 결론부터: **그 파일에는 Gemini SDK 가 없다.** `@google/genai` import 0건, 공급자 분기 0건 — 실체는 브라우저 → 자체 API 라우트 façade 이고, 이름만 브라우저가 Gemini 를 직접 호출하던 시절의 유물이다. 그래서 OpenAI 확장으로 **깨진 곳은 없었다.** 다만 "이름이 실제를 잘못 말하는" 사례가 하나 나왔다는 건 다른 데도 있다는 뜻이라, 레포 전체를 훑었다.

## 1. 점검 방법

기계적으로 세 축을 돌렸다. 결과는 전부 수동 확인했다 — 아래 §2 의 오탐 항목들이 그 이유다.

| 축 | 방법 | 결과 |
|---|---|---|
| 임포트되지 않는 파일 | 파일명 기준 역참조 카운트 | 0건 (`server/lib/weather/index.ts` 는 디렉터리 import 오탐) |
| 죽은 export | export 340개 각각을 **자기 파일 밖 참조 0** + **자기 파일 안 참조 0** 으로 이중 판정 | 13건 |
| 미사용 npm 의존성 | `package.json` 전 항목 소스 역참조 | 0건 |
| 고아 API 라우트 | `app/api/*` 별 `/api/<name>` 클라이언트 참조 카운트 | 2건 |

🔴 **"밖에서 안 쓰임"만으로 판정하면 안 된다.** 1차 스캔은 68건을 뱉었는데 그중 55건은 자기 파일 안에서 쓰이는 타입·상수(`MODEL_CAPS`, `OPENAI_MODELS`, `numericValue` 등)였다. 이건 죽은 게 아니라 `export` 만 과한 것이고, 지우면 컴파일이 깨진다. 두 번째 판정(자기 파일 안 참조)을 붙여 13건으로 좁혔다.

## 2. 제거한 것

### 2.1 고아 API 라우트 2개

둘 다 **호출하는 클라이언트 코드가 레포 전체에 0건**이었고, 마지막 수정이 2026-05-26 이다.

- `app/api/fetch-transcript/route.ts` — 이미 `Transcript extraction is disabled` 만 반환하는 **비석(tombstone)** 이었다. YouTube 는 Gemini `fileData` 네이티브 분석으로 넘어간 지 오래다(DEV_HISTORY 226줄).
- `app/api/pill-search/route.ts` — `searchPill()` 을 HTTP 로 노출하던 창구. 알약 식별은 지금 `server/agent/tools.ts` 의 에이전트 도구 경로로만 간다. **`searchPill()` 자체는 남긴다** — 도구가 쓴다.

🔴 둘 다 **인증 검사 없이 배포된 채 살아 있었다.** 안 쓰는 라우트는 코드 부피가 아니라 공격면이다.

### 2.2 죽은 export 13개

| 파일 | 심볼 | 왜 죽었나 |
|---|---|---|
| [services/geminiService.ts](../../../../services/geminiService.ts) | `fetchUrlContent` | `fetchUrlData` 로 이관 완료(DEV_260521) |
| [server/agent/prompt.ts](../../../../server/agent/prompt.ts) | `composeInstruction` | §3 참조 |
| " | `getPillWarnFallback` | TODO.md 에 다국어화 항목으로만 남음 |
| [server/agent/nodes/generator.ts](../../../../server/agent/nodes/generator.ts) | `YOUTUBE_CALL_TIMEOUT_MS` | 스스로 `@deprecated`, 참조가 **주석에만** 있었다 |
| [server/agent/weather-followup.ts](../../../../server/agent/weather-followup.ts) | `mentionsCityWeather` | 스스로 `@deprecated`, 호출자 0 |
| [server/agent/intentRules.ts](../../../../server/agent/intentRules.ts) | `isPastReference` | 계획서에만 등장 (`PAST_REF_PATTERN` 은 살아 있어 유지) |
| [server/agent/lang.ts](../../../../server/agent/lang.ts) | `DEFAULT_LANG_CODE` | 정의만 |
| [server/agent/local-tool-registry.ts](../../../../server/agent/local-tool-registry.ts) | `LOCAL_FUNCTION_TOOL_INTENTS` | 정의만 |
| [server/models.ts](../../../../server/models.ts) | `ServerModelId` | 타입 정의만 (`ChatModelId` 이 실제 계약) |
| [lib/movieContext.ts](../../../../lib/movieContext.ts) | `hasMovieContext`, `clearMovieContext` | 정의만 |
| [lib/theaters.ts](../../../../lib/theaters.ts) | `findDefaultBranch` | `defaultsForRegion` 이 대체 (§3) |
| [utils/celestialMath.ts](../../../../utils/celestialMath.ts) | `sphericalToCartesian` | `ConstellationRenderer` 는 다른 5개만 import |

`@deprecated` 표시가 붙은 둘이 그대로 살아 있었다는 게 눈에 띈다 — **표시는 삭제 예약이 아니라 삭제되지 않았다는 증거**로 남는다.

### 2.3 flash-lite 반쪽 잔재 (클라이언트만)

`gemini-2.5-flash-lite` 는 **서버에선 살아 있다** — [`ROUTER_MODEL`](../../../../server/models.ts) 과 `SUMMARY_MODELS` 가 쓴다. 죽은 건 **사용자에게 모델로 노출하던 쪽**뿐이라 그쪽만 걷었다.

- `src/lib/models.ts` — `CHAT_MODELS.FLASH_LITE` 상수와 주석 처리된 옵션 블록
- `components/Header.tsx` — `model25FlashLite`·`model25LiteDesc` 라벨 8줄(4개 언어 × 2키)

⚖️ 예전에 flash-lite 를 골라 `localStorage` 에 남긴 사용자가 있다면 `isChatModelId()` 가 이제 false 를 주고 기본 모델(3.6)로 떨어진다. 옵션이 이미 주석 처리돼 **선택 자체가 불가능했던** 상태라 실질 영향은 없다고 봤다.

## 3. 문서↔코드 드리프트 — 이번 점검의 진짜 수확

`composeInstruction` 은 단순한 미사용 함수가 아니었다. [REF_Architecture.md](../../../guide/REF_Architecture.md) 와 [REF_App2_Agent.md §8](../../../guide/REF_App2_Agent.md) 이 **시스템 인스트럭션 조립을 이 함수가 한다고 기술**하고 있었는데, 실제 프로덕션은 이렇게 돈다:

```
route.ts:84          getSystemInstruction(langName)        → base 를 그래프 상태에 실음
   ↓ (라우터가 intent 확정)
generator.ts:171,177 getRendererSections(intent, langName) → 렌더러 스펙
                     getIntentFocusHint(intent)            → 의도 힌트
```

조립 **순서는 같지만 지점이 둘로 나뉘어** 있다. 의도가 확정돼야 렌더러 스펙을 고를 수 있으니 라우터 뒤로 밀린 것이고, 구조적으로 맞다. `composeInstruction` 은 셋을 한 번에 합치던 옛 래퍼가 호출자 없이 남은 것이다.

🔴 **문서만 읽고 판단하면 틀리는 상태였다.** 데드코드의 비용은 바이트가 아니라 이것이다 — 죽은 코드가 문서에 인용되면 그 문서를 읽은 다음 사람이 없는 경로를 근거로 결정한다. 현행 문서(REF_Architecture)는 실제 두 지점 구조로 고쳤고, 과거 기록(REF_App2_Agent §8, 2026-08-01)은 **기록이므로 지우지 않고** 당시와 현재가 다르다는 주석을 달았다.

같은 이유로 두 건 더 고쳤다.

- `REF_Movie.md` — `lib/theaters.findDefaultBranch()` 가 지점을 고른다고 적혀 있었으나 실제는 `defaultsForRegion()` 이다. 단순 개명이 아니라 **동작이 다르다**: 사용자가 말한 지역에 그 체인 지점이 없으면 `defaultsForRegion` 은 `null` 을 넣어 카드가 "지점 없음"을 표시하게 한다(DEV_260801 §3-3 회귀 방지). 옛 이름으로 적혀 있으면 그 안전장치가 문서에서 사라진다.
- `REF_Drug.md` — `/api/pill-search` 를 "legacy path 를 아직 쓴다"로 기술 → 제거 사실과 도구 경로만 남는다는 사실로 교체.
- `README.md` — 디렉터리 트리에서 `pill-search/route.ts` 행 제거.

## 4. 검증

```
npm run typecheck   → 통과 (오류 0)
npm test            → 12종 전부 통과 (15·26·11·53·20·79·15·25, 실패 0)
```

제거만 한 변경이라 새 하니스는 만들지 않았다. 타입체커가 "밖에서 안 쓰임" 판정의 사실상 검증이고, 하니스 12종은 제거가 **살아 있는 경로**를 건드리지 않았음을 확인한다.

변경 규모: **코드 15개 파일에서 순수 삭제 103줄, 추가 0줄** (고아 라우트 2개 25줄 + 죽은 심볼 13개 68줄 + flash-lite 클라 잔재 10줄). 여기에 문서 정정 5개 파일(README·REF 4종)이 붙는다.

## 5. 남긴 것 — 왜 지금 안 했나

| 항목 | 상태 | 이유 |
|---|---|---|
| 모델 번역 문자열 이중 관리 | ✅ **완료 (§7)** | [Header.tsx](../../../../components/Header.tsx)(모바일)와 [ChatInput.tsx](../../../../components/ChatInput.tsx)(데스크톱)에 4언어 × 14키가 통째로 중복이다. **둘 다 살아 있어 데드코드가 아니다** — 모델을 추가할 때 한쪽만 고치면 조용히 어긋나는 유지보수 위험이라, 지우기가 아니라 `src/lib/models.ts` 옆으로 뽑는 리팩터링 건이다 |
| `types.ts:39` `image?` 하위호환 필드 | ✅ **완료 (§8)** | [ChatMessage.tsx](../../../../components/ChatMessage.tsx) 가 `attachment \|\| image` 로 여전히 읽는다. **DB 에 옛 레코드가 남아 있으면 살아 있는 코드**다 — 코드만 보고 지우면 과거 대화의 이미지가 사라진다. `chat_messages` 를 세어보고 판단한다 |
| `export` 만 과한 심볼 55개 | 보류 | 죽지 않았고 `export` 만 떼면 되는 건이라 우선순위가 낮다. 파일 경계를 좁히는 이득 대비 diff 가 크다 |
| `scripts/` 를 가리키는 문서들 | ✅ **완료 (§9)** | `scripts/` 는 `.gitignore §62` 로 통째로 제외되는 로컬 디렉터리인데(현재 156개 파일) 문서 여럿이 `scripts/test-prompt-sections.ts` 같은 경로를 가리킨다. 하니스는 `tests/` 로 이전됐으므로(2026-08-18) **문서 쪽 경로를 일괄 정리**해야 한다. 범위가 넓어 별건으로 뺀다 |
| `services/geminiService.ts` 분할 | 별건 | 이름이 실제를 잘못 말하고(§0) 인증·세션 CRUD·업로드·채팅 SSE·URL·TTS 6개 관심사가 한 파일에 있다. 임포트가 5곳뿐이라 지금이 싼 시점이지만, 데드코드 정리와 성격이 다르다. **TTS/오디오만 진짜 Gemini 전용**(24kHz raw PCM)이라 그것만 떼면 나머지는 공급자 중립이 된다 |

## 7. 이어서 — 모델 번역 문자열 이중 관리 정리

§5 에서 "다음 라운드"로 미뤘던 건을 같은 날 이어서 했다. 데드코드가 아니라 **중복**이었으므로 접근이 달랐다: 지우는 게 아니라 합치는 것이고, 합치는 과정에서 **화면에 나가는 문자열이 하나도 바뀌지 않았음을 증명**해야 했다.

### 7.1 무엇이 문제였나

`Header.tsx`(모바일)와 `ChatInput.tsx`(데스크톱)에 **4개 언어 × 15키 = 60개씩, 총 120개**의 모델 문자열이 통째로 중복돼 있었다. 레지스트리(`src/lib/models.ts`)는 `labelKey` 라는 **키 이름만** 갖고 실제 문자열은 컴포넌트에 있는 구조라, 모델 하나를 추가하려면 **세 파일**을 고쳐야 했다. 그리고 한 곳을 빠뜨려도 `t[option.labelKey]` 가 `undefined` 로 조용히 렌더될 뿐 **아무것도 막아주지 않았다.**

측정해보니 120개 중 **실제 번역 콘텐츠는 28개뿐**이었다. 제품명(`Gemini 3.7 Flash`·`GPT-5.4 mini`·`Google Gemini`·`OpenAI`)은 4개 언어 값이 동일해서, 나머지 92개는 같은 문자열을 8번씩 베껴 쓴 것이었다.

### 7.2 순서 — 계약을 먼저 고정하고 리팩터링했다

**⓵ 특성화 하니스 → ⓶ 리팩터링 → ⓷ 같은 하니스로 재검증** 순으로 갔다. 리팩터링 후에 테스트를 쓰면 "바뀐 결과"를 정답으로 굳히게 되므로 순서가 뒤집히면 안 된다.

`tests/test-model-labels.mts` 를 먼저 만들고, GOLDEN(섹션 3 + 모델 6 × 4개 언어 × 라벨/설명)을 **현재 소스에서 뽑아** 박았다. 이때 문자열이 React 컴포넌트 안에 있어 import 가 불가능했으므로 **컴포넌트 소스를 파싱**해 읽었다 — `test-gemini-citations.mts` 6그룹이 route.ts 에서 정규식을 뽑아 쓰는 것과 같은 이유다. 값을 하니스에 베껴두면 컴포넌트가 되돌아가도 통과해버린다.

🔴 골든을 처음 적을 때 `gemini-2.5-flash` 의 프랑스어 설명을 손으로 잘못 옮겼는데 하니스가 **양쪽 파일에서** 잡아냈다. 골든이 장식이 아니라 실제로 대조되고 있다는 증거다.

리팩터링 전 하니스로 실패 모드 둘을 확인했다.

| 되돌린 상황 | 검출 |
|---|---|
| ChatInput 영어 설명만 한 단어 수정 | §2 골든 불일치 + §3 드리프트 — **2건** |
| 번역 없이 레지스트리에 모델 추가 | §1 집합 + §4 미해석 키 — **3건** |

두 번째가 바로 당시 구조가 못 막던 사고다. 부수적으로 **두 파일의 60쌍이 전부 일치**한다는 것도 확인했다 — 아직 어긋나지 않았으니 손대기 좋은 시점이라는 근거가 됐다.

### 7.3 무엇으로 바꿨나

`labelKey` 인디렉션을 없애고 문자열을 옵션 옆에 직접 뒀다. 핵심은 **번역이 필요한 것과 아닌 것을 타입으로 구분**한 것이다.

```ts
type Localized = string | Record<Language, string>;

export const pickLabel = (value: Localized, language: Language): string =>
  typeof value === 'string' ? value : (value[language] ?? value.ko);
```

제품명은 문자열 그대로(`label: 'Gemini 3.7 Flash'`), 번역문만 객체로(`description: { ko, en, es, fr }`) 적는다. 전부 `Record<Language, string>` 으로 통일했다면 `"Gemini 3.7 Flash"` 를 네 번 반복해야 했고, 반대로 전부 문자열이면 번역을 못 한다. 유니온이라서 **"이건 제품명이라 번역 대상이 아니다"가 코드에 드러난다.**

⚖️ 얻은 것: 언어 하나만 빠져도 **tsc 가 잡는다**. 실제로 `es` 까지만 적고 `fr` 을 빼고 모델을 추가해보니 `error TS2322: Type '{ ko: string; en: string; es: string; }' is not assignable to type 'Localized'` 로 컴파일이 멈췄다 — 리팩터링 전에는 이걸 잡아주는 게 아무것도 없었다.

### 7.4 하니스는 §READER 만 갈아끼웠다

GOLDEN 과 검사 의도는 그대로 두고, "값을 어디서 읽는가"만 **컴포넌트 소스 파싱 → 프로덕션 코드 직접 import** 로 바꿨다. 이제 `pickLabel` 을 그대로 호출해 재므로 하니스가 화면과 같은 코드를 통과한다.

§3 은 성격이 바뀌었다. 예전엔 "두 파일의 값이 같은가"를 물었지만, 이제 드리프트는 **구조적으로 불가능**하므로 그 구조 자체를 지킨다 — **컴포넌트 소스에 모델 문자열이 다시 나타나면 실패**한다. 실제로 `Header.tsx` 에 `modelSectionGemini: "Google Gemini"` 를 되돌려 넣어보니 2건이 잡혔다.

### 7.5 결과

| 지표 | 전 | 후 |
|---|---|---|
| UI 문자열 리터럴 | **120개** (2파일 중복) | **36개** (1파일) |
| 모델 추가 시 고칠 파일 | 3개 | **1개** |
| 언어 누락 감지 | 없음 (화면에 `undefined`) | **tsc 컴파일 오류** |

`npm run typecheck` 통과, `npm test` **13종 전부 통과**(하니스 40건). GOLDEN 은 한 글자도 바뀌지 않았다 — 화면에 나가는 문자열이 리팩터링 전과 정확히 같다는 뜻이다.

🔴 문구는 손대지 않았다. `gemini-2.5-flash` 영어 설명만 다른 모델과 달리 짧은 형태(`Fast & balanced`)인데, **문구 변경을 리팩터링 커밋에 섞지 않기 위해** 그대로 뒀다. 바꾸려면 GOLDEN 을 함께 고치는 별도 변경이어야 한다.

## 8. `Message.image` 하위호환 필드 — DB 를 보고 지웠다

§5 에서 "DB 확인 후"로 미뤄둔 건. `types.ts` 의 `image?: MessageAttachment` 는 "하위 호환성을 위해 유지" 주석과 함께 남아 있었고 `ChatMessage.tsx` 가 두 곳에서 `attachment || image` 로 읽었다. **코드만 보고 지우면 안 되는 종류**다 — DB 에 옛 레코드가 있으면 지우는 순간 과거 대화의 이미지가 사라진다.

네 갈래로 확인했고 전부 같은 답이 나왔다.

| 확인 | 결과 |
|---|---|
| **실제 DB 스키마** (문서 아님) | `chat_messages` 컬럼 7개 — `id·session_id·role·content·attachment_url·grounding_sources·created_at`. **`image` 컬럼이 없다** (메시지 784건, 첨부 있는 메시지 35건) |
| DB → Message 변환 | [`mapDbMessage`](../../../../src/hooks/useChatSessions.ts) 가 유일한 경로인데 `attachment` 만 설정한다 |
| localStorage | 메시지를 캐시하지 않는다 — `writeSessionsCache` 는 `messages: []` 인 메타만 저장하고 "DB 가 메시지의 단일 출처"라고 주석에 못박혀 있다 |
| git 이력 | `src`·`components`·`App.tsx` 에서 `image:` 로 **값을 쓴 커밋이 0건** |

즉 `message.image` 는 런타임에 절대 truthy 가 될 수 없다. 필드와 두 폴백을 제거했다.

🔴 **DB 스키마는 문서가 아니라 DB 에게 물었다.** `REF_DB.md` 에도 `image` 컬럼은 없지만, §3 에서 본 것처럼 이 레포는 문서가 코드보다 뒤처진 전례가 있다. 확인 스크립트는 `tests/manual/check-legacy-image-field.mts` 로 남겼다 — Supabase 자격증명이 필요해 `npm test` 에는 넣지 않는다.

## 9. `scripts/` 를 가리키는 문서 정리

`scripts/` 는 `.gitignore §62` 로 통째로 제외되는 로컬 디렉터리다(현재 156개 파일). 레포를 클론한 환경에는 **없으므로 링크로 걸면 항상 깨진다.** 이 규칙은 이미 [DEV_HISTORY](../../../DEV_HISTORY.md) 머리말에 적혀 있었는데, 그 정책 이전에 쓰인 문서들이 지키지 않고 있었다.

### 9.1 scripts/ 링크 54건

| 분류 | 처리 | 건수 |
|---|---|---|
| 실제로 이전된 파일 | 새 경로로 **재연결** — `scripts/sql/auth-mvp-*.sql` → `docs/guide/db/` | 2 |
| 로컬 전용 (gitignore) | 정책대로 **인라인 코드로 강등** | 52 |

문서 14개가 바뀌었다. 치환은 링크 하나 단위로만 했다 — `[`code`](link)` 형태가 흔해서 파일 전체 백틱 후처리를 하면 무관한 링크까지 망가진다.

### 9.2 스윕하다 나온 같은 병 — 깨진 상대 링크 50건

`scripts/` 만 보고 끝낼 일이 아니어서 **모든 마크다운 상대 링크가 실제로 존재하는지** 전수 확인했다.

- **42건: 상대 깊이가 한 칸씩 틀림.** `docs/logs/2026/07/` 에서 `../../TODO.md`(→ `docs/logs/TODO.md`)처럼 월 디렉터리가 한 겹 더 생긴 걸 반영하지 못한 링크들이다. 레포 안에서 같은 꼬리를 가진 파일이 **정확히 하나**일 때만 그 경로로 고쳤다(0개거나 2개 이상이면 손대지 않음 — 추측 교정은 더 나쁘다). `#L108` 같은 프래그먼트는 보존했다.
- **8건: 대상이 레포에 아예 없다** — `reference/news/…`(외부 참조 레포), `preview/`, `docs/superpowers/specs/`, 삭제된 `app/api/upload/route.ts`, 홈 디렉터리의 `CLAUDE.md`. `scripts/` 와 같은 이유로 인라인 코드로 강등했다.

🔴 자동 검사에서 `[1](A)`·`[N](url)` 같은 **인용 마커 예시**가 대량으로 깨진 링크처럼 잡혔다. 문서가 인용 포맷을 설명하는 본문이지 링크가 아니다 — 경로처럼 생긴 것만 거르지 않으면 이런 스윕은 노이즈에 묻힌다.

**결과: 레포 전체 깨진 상대 링크 0건.**

### 9.3 README 정합성

링크만 고치고 끝내면 본문이 거짓말하는 건 그대로 남는다. `README.md` 를 현재 코드와 대조해 세 곳을 고쳤다.

- **회귀 하니스 "10종" → 13종** (2곳: §5-4 명령 주석과 "폴더가 곧 정책" 안내). 그동안 하니스가 늘어도 이 숫자는 따라오지 않았다.
- **`tests/` 트리에 9종만 적혀 있었다** — `test-card-followup`·`test-drug-fallback`·`test-gemini-citations`·`test-model-labels` 누락. `manual/` 도 트리에 없어 추가했다.
- **`src/lib/models.ts`** 에 "클라 모델 레지스트리 + 선택 UI 문자열(단일 소스)" 주석 추가 — §7 로 역할이 바뀌었다.

대조해서 맞는 걸 확인한 것: 렌더러 12종, `components/` 25개, 사용자 선택 모델 6종(flash-lite 는 라우터 전용이라 원래 목록에 없다), lint 에러 30건, `/api/` 트리(§2.1 에서 고아 라우트 2개를 이미 지웠다).

## 6. 교훈

- **"밖에서 안 쓰임"은 데드코드의 필요조건이지 충분조건이 아니다.** 자기 파일 안 참조를 같이 봐야 68 → 13 으로 줄었다.
- **`@deprecated` 는 삭제 예약이 아니다.** 두 개가 표시만 붙은 채 남아 있었다. 표시할 때 지울 시점을 같이 정하지 않으면 표시가 곧 영구 상태가 된다.
- **데드코드의 진짜 비용은 문서다.** `composeInstruction` 은 호출자가 없는 채로 아키텍처 문서 두 곳에서 "현재 구조"로 인용되고 있었다. 코드는 컴파일러가 지켜주지만 문서는 아무도 안 지킨다.
- **반쪽만 죽는다.** flash-lite 는 서버에서 살아 있고 클라이언트에서만 죽었다. 모델·기능을 내릴 때 "어느 층에서 내렸는가"를 명시하지 않으면 반대쪽 잔재가 남는다.
