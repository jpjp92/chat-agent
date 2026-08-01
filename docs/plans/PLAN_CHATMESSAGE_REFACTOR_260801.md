# PLAN — ChatMessage.tsx 분리

> 작성: 2026-08-01 (v2 — 분리 축·순서 재정리)
> 상태: **설계만. 착수 전** — 인증 프로덕션 컷오버([PLAN_AUTH_PROD_ROLLOUT_260719](PLAN_AUTH_PROD_ROLLOUT_260719.md))를 끝낸 뒤 시작한다.
> 근거: [DEV_260801](../logs/2026/08/DEV_260801.md) §3-4 · §3-4-1 · [REF_Architecture](../guide/REF_Architecture.md#client-rendering-pipeline)

## 분리 기준: "용도"가 아니라 **"무엇이 언제 바뀌는가"**

924줄이라서 쪼개는 게 아니다. 판단 기준은 두 가지다.

1. **반복 작업의 비용** — 이 파일에서 가장 자주 하는 일은 *렌더러 추가·수정*이다. 지금은 그게 한 파일 안에서만 8곳을 건드린다.
2. **테스트가 진짜 코드를 지나가는가** — 오늘 결함 2건이 회귀 스크립트를 통과했다. 스크립트가 `ChatMessage.tsx` 의 전처리를 **import 할 수 없어** 손으로 복붙해 뒀기 때문이다(§3-4-1).

줄 수 감소는 부수 효과다.

---

## 측정값

### 렌더러 목록이 한 파일 안에서 4번 따로 선언돼 있다

| 선언 위치 | 줄 | 항목 수 |
|---|---:|---:|
| lazy 컴포넌트 import | 20–32 | 13 |
| `parts` 유니온 타입 | 435 | 14 |
| `blockRegex` | 436 | 13 |
| `hasIncompleteViz` 정규식 | 512 | 13 |
| `visibleText.split` 정규식 | 518 | 13 |
| `else-if` 분기 (fence → part) | ~470–500 | 13 |
| 렌더 분기 (part → 컴포넌트) | 582–714 | 13 |
| `hasWeatherBlock` 등 레이아웃 판정 | 717–724 | 4 |

> **현재 드리프트는 0건이다** — 네 목록이 정확히 일치한다(2026-08-01 확인). 지금 버그가 있다는 뜻이 아니라, **새 렌더러를 추가할 때 네 곳을 빠짐없이 고쳐야 하고 하나만 빠져도 조용히 깨진다**는 뜻이다.

### fence 이름과 part 타입이 1:1이 아니다

`smiles` → `chemical`, `treemap` → `chart`. 이 매핑이 **else-if 체인 안에 코드로만** 존재한다. 데이터로 적혀 있지 않아 한눈에 안 보인다.

### fence 이름이 파일 밖에도 흩어져 있다

- `src/hooks/useChatStream.ts` — `'```json:movie'`, `'```json:weather'` (카드 표시 판정)
- `server/agent/nodes/router.ts` — 히스토리 내 카드 스캔
- `app/api/chat/route.ts` — fast-pass 스트리밍 블록 매칭

### 구간별 성격

| 구간 | 줄 | 줄수 | 성격 | 언제 바뀌나 |
|---|---|---:|---|---|
| import · lazy 렌더러 · `AttachmentImage` · 타입 | 1–59 | 59 | 혼재 | 렌더러 추가 시 |
| state · i18n · 핸들러(복사·TTS·롱프레스·컨텍스트메뉴) | 60–220 | 160 | 부수효과 | 상호작용 변경 시 |
| `MarkdownComponents` | 221–312 | 92 | 순수 뷰 | 디자인 변경 시 |
| 첨부 렌더 3종 | 315–431 | 117 | 순수 뷰 | 디자인 변경 시 |
| **`renderContent` — 파싱** | **433–568** | **136** | **순수** | 렌더러 추가 · 파싱 버그 |
| `renderContent` — 렌더 (`parts.map`) | 569–714 | 146 | 뷰 | 렌더러 추가 |
| 레이아웃 JSX | 717–924 | 208 | 뷰 | 디자인 변경 시 |

파싱부의 클로저 의존은 **`content` 와 `isStreaming` 둘뿐**이다(확인함). state·language·userProfile을 전혀 읽지 않아 순수 함수로 뽑는 데 걸리는 것이 없다. 파싱/렌더 경계는 **569행(`return (` / `parts.map`)에서 깨끗하게 갈린다.**

---

## 분리 설계

```
lib/renderers.ts                        ← ① 렌더러 레지스트리 (데이터)
lib/markdown/parseMessageBlocks.ts      ← ② 파싱 (순수, 테스트 대상)
components/chat/markdownComponents.tsx  ← ③ 뷰
components/chat/MessageAttachments.tsx  ← ③ 뷰
components/chat/useMessageActions.ts    ← ④ 부수효과
components/ChatMessage.tsx              ← 조립 + 레이아웃 (~150줄)
```

### ① `lib/renderers.ts` — 렌더러 레지스트리

**렌더러의 정체를 코드가 아니라 데이터로 적는다.**

```ts
export const RENDERERS = [
  { fence: 'chart',   part: 'chart',    load: () => import('../components/ChartRenderer') },
  { fence: 'treemap', part: 'chart',    load: () => import('../components/ChartRenderer') },
  { fence: 'smiles',  part: 'chemical', load: () => import('../components/ChemicalRenderer') },
  // …13종
] as const;

export type RendererPart = typeof RENDERERS[number]['part'];
export const FENCE_NAMES = RENDERERS.map(r => r.fence);
export const fenceRegex = (flags = 'gi') => new RegExp(`\`\`\`json\\s*:\\s*(${FENCE_NAMES.join('|')})`, flags);
export const partOfFence = (fence: string) => …;
```

- 정규식 3개·유니온 타입·else-if 체인·lazy import 13줄이 **전부 여기서 파생**된다.
- `treemap`→`chart` 같은 비자명 매핑이 **테이블에 보인다**. 지금은 분기 코드 속에 숨어 있다.
- 새 렌더러 추가 = **이 배열에 한 줄**. 렌더 분기만 별도(컴포넌트 props가 제각각이라 자동화 불가 — 억지로 통일하지 않는다).

### ② `lib/markdown/parseMessageBlocks.ts` — 파싱

```ts
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: RendererPart; data: any }
  | { type: 'chart_loading' };

/** 스트림 텍스트 → 렌더 파트 목록. 부수효과 없음. */
export function parseMessageBlocks(content: string, isStreaming: boolean): MessagePart[];

/** 파서에 넘기기 전 텍스트 정규화. 테스트가 이 함수를 직접 import 한다. */
export function preprocessText(text: string): string;
```

- `preprocessText` **export 가 이 단계의 핵심**이다. 현재 같은 치환이 세 군데(비스트리밍 / 스트리밍 visible / remaining)에 중복돼 있어, §3-4-1에서 정규식 2줄을 지울 때도 세 곳을 각각 지워야 했다.
- 남은 치환은 `<br>` → ` · ` 와 `1~10` → `1&#126;10` 둘뿐이다.
- **완료 조건**: `scripts/test-markdown-emphasis.mjs` 의 복붙 `preprocess()` 를 삭제하고 import 로 교체.

### ③ 뷰 조각

`markdownComponents.tsx` · `MessageAttachments.tsx`. 둘 다 state를 안 쓴다. `language` 만 props로 넘기면 끝난다.

### ④ `useMessageActions` 훅

복사·TTS·롱프레스·컨텍스트메뉴가 state 5개 + `useEffect` 2개를 함께 쓴다. **동작 변경 없이 이동만** 한다.

---

## 순서 — ① 레지스트리 먼저

> **v1에서 "파싱 먼저"라고 썼던 것을 뒤집는다.** 파싱부 안의 13분기 `else-if` 는 레지스트리로 사라질 코드다. 파싱을 먼저 옮기면 같은 코드를 두 번 만진다. 레지스트리를 먼저 하면 파싱 추출이 거의 자동으로 끝난다.

| 순서 | 작업 | 위험 | 이유 |
|---:|---|---|---|
| 1 | 레지스트리 | **중** — 렌더 분기까지 건드림, 육안 확인 필요 | 반복 작업 비용을 8곳 → 1곳으로 |
| 2 | 파싱 추출 | **낮** — 순수 이동 | 테스트가 진짜 코드를 지나가게 |
| 3 | 뷰 조각 | 낮 | 가독성 |
| 4 | 훅 | 낮 | 가독성 |

**트레이드오프를 명시해 둔다**: 순수하게 위험만 보면 ②를 먼저 하는 게 안전하다(UI를 안 건드림). 그럼에도 ①을 앞세우는 건 이 문서의 목표가 *장기 관리 비용*이기 때문이다. 인증 컷오버 직후처럼 검증 여력이 없는 시점에 시작한다면 ②→①로 뒤집어도 된다.

1·2만 해도 목적의 8할이다. 3·4는 가독성 개선이라 급하지 않다.

---

## 검증

| 단계 | 확인 |
|---|---|
| 1 | 드리프트 검사 스크립트로 **파생된 정규식이 기존과 동일**한지 대조 · 렌더러 13종 전부 화면 확인 |
| 2 | `test-markdown-emphasis.mjs` 가 **import 로** 통과 · `tsc --noEmit` · `npm run build` |
| 2 | 스트리밍 중 미완성 펜스(`chart_loading`)·미완성 `$$` 절단 동작 |
| 3 | 첨부 이미지/파일 카드, 마크다운 표·코드블록 육안 |
| 4 | 복사·TTS·롱프레스 메뉴 동작 |

**순수 함수 이동이라도 육안 확인은 뺄 수 없다.** 오늘 "고쳤다고 생각했는데 화면은 그대로"가 두 번 나왔다.

---

## 하지 않을 것

- **서버 프롬프트의 `RENDERER_SECTIONS`/`INTENT_RENDERERS` 통합** — 목적이 다르다(의도별 주입). **fence 이름 상수만** 공유하고(`lib/theaters.ts` 가 서버·클라 공유하는 방식) 스펙 본문까지 묶으면 프롬프트 변경이 클라이언트 번들에 얽힌다.
- **렌더 분기의 완전 자동화** — 컴포넌트마다 props 시그니처가 다르다(`chartData` / `data` / `language` 유무). 억지로 통일하면 각 렌더러가 쓰지 않는 props를 받는다. 분기는 남기고 **목록만** 레지스트리에서 가져온다.
- **레이아웃 JSX(717–924) 분해** — `hasPharmacyBlock` 등 블록 유무로 `outerMaxWidth` 가 갈리는 로직이 얽혀 있다. 쪼개면 조건이 여러 파일로 흩어져 오히려 읽기 어렵다.
- **파싱을 정규식에서 remark 플러그인으로 교체** — 더 "올바른" 방향이지만 스트리밍 중 미완성 펜스 처리를 다시 설계해야 한다. 이번 목적에 필요하지 않다.
