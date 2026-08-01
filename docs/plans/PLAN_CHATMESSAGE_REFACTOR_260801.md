# PLAN — ChatMessage.tsx 분리

> 작성: 2026-08-01
> 상태: **설계만. 착수 전** — 인증 프로덕션 컷오버([PLAN_AUTH_PROD_ROLLOUT_260719](PLAN_AUTH_PROD_ROLLOUT_260719.md))를 끝낸 뒤 시작한다.
> 근거: [DEV_260801](../logs/2026/08/DEV_260801.md) §3-4 · §3-4-1 · [REF_Architecture](../guide/REF_Architecture.md#client-rendering-pipeline)

## 왜 지금 이 파일인가

924줄이라서가 아니다. **오늘 하루에 이 파일에서 결함이 두 건 나왔고 둘 다 회귀 스크립트를 통과했다.**

- §3-4 — 한글 조사 앞 `**` 미닫힘. 원인은 파서 플러그인 조합.
- §3-4-1 — 인접 강조를 깨뜨리는 전처리 정규식. **§3-4 를 고친 직후에도 화면은 그대로였다.**

두 번째가 핵심이다. 회귀 테스트(`scripts/test-markdown-emphasis.mjs`)가 `ChatMessage.tsx` 의 전처리를 **import 할 수 없어서**, 스크립트 안에 `preprocess()` 를 손으로 복붙해 두었다. 복붙본과 실물이 어긋나는 순간 테스트는 조용히 통과한다 — 실제로 그렇게 됐다.

> 목표는 "짧게 만들기"가 아니라 **테스트가 진짜 코드를 지나가게 만들기**다. 줄 수 감소는 부수 효과다.

## 현재 구조

| 구간 | 줄 | 줄수 | 성격 |
|---|---|---|---|
| import · lazy 렌더러 13종 · `AttachmentImage` · 타입 | 1–59 | 59 | — |
| state · i18n · 핸들러(복사·TTS·롱프레스·컨텍스트메뉴) | 60–220 | 160 | 부수효과 |
| `MarkdownComponents` | 221–312 | 92 | 순수 뷰 |
| `formatFileSize` · `renderSingleAttachment` · `renderAttachments` | 315–431 | 117 | 순수 뷰 |
| **`renderContent` — 파싱** | **433–568** | **136** | **순수** |
| `renderContent` — 렌더 (`parts.map`) | 569–714 | 146 | 뷰 |
| 레이아웃 JSX | 717–924 | 208 | 뷰 |

`renderContent` 안에서 파싱과 렌더가 한 함수에 붙어 있다. **경계는 569행(`return (` / `parts.map`)으로 깨끗하다.**

파싱부의 클로저 의존은 **`content` 와 `isStreaming` 둘뿐**이다(확인함). state·i18n·language를 전혀 읽지 않는다 — 그래서 순수 함수로 뽑는 데 걸리는 것이 없다.

## 분리 설계

```
lib/markdown/parseMessageBlocks.ts     ← 파싱 (순수, 테스트 대상)
components/chat/markdownComponents.tsx ← MarkdownComponents
components/chat/MessageAttachments.tsx ← 첨부 3종 + AttachmentImage
components/chat/useMessageActions.ts   ← 복사·TTS·롱프레스·컨텍스트메뉴 + i18n
components/ChatMessage.tsx             ← 조립 + 레이아웃 (~150줄)
```

### 1단계 — `parseMessageBlocks` 추출 (**단독으로도 가치 있음**)

```ts
export type MessagePart =
  | { type: 'text'; content: string }
  | { type: RendererKind; data: any }
  | { type: 'chart_loading' };

/** 스트림 텍스트 → 렌더 파트 목록. 부수효과 없음. */
export function parseMessageBlocks(content: string, isStreaming: boolean): MessagePart[];

/** 파서에 넘기기 전 텍스트 정규화. 테스트가 이 함수를 직접 import 한다. */
export function preprocessText(text: string): string;
```

- `preprocessText` 를 **export 하는 것이 이 단계의 핵심**이다. 지금 세 군데(비스트리밍 / 스트리밍 visible / remaining)에 같은 치환이 중복돼 있는데, 오늘 정규식 2줄을 지울 때도 세 곳을 각각 지워야 했다.
- 현재 남은 치환은 `<br>` → ` · ` 와 `1~10` → `1&#126;10` 둘뿐이다(§3-4-1 에서 볼드 보정 정규식 제거).
- 마친 뒤 `scripts/test-markdown-emphasis.mjs` 의 복붙 `preprocess()` 를 **삭제하고 import 로 교체**한다. 이게 1단계의 완료 조건이다.
- `RendererKind` 는 현재 `blockRegex` 의 13종 캡처와 `parts` 유니온에 두 번 적혀 있다. 한 곳으로 모은다.

### 2단계 — 뷰 조각 분리

`markdownComponents.tsx`, `MessageAttachments.tsx`. 둘 다 state를 안 쓰므로 props 전달만으로 끝난다. `language` 만 넘기면 된다.

### 3단계 — `useMessageActions` 훅

복사·TTS·롱프레스·컨텍스트메뉴는 state 5개와 `useEffect` 2개를 함께 쓴다. 훅으로 묶되 **동작 변경 없이 이동만** 한다.

## 착수 순서와 판단

1. **1단계만 해도 목적의 8할이 달성된다.** 오늘 두 번 데인 지점이 정확히 여기고, 변경 범위가 좁아 UI 회귀 위험이 거의 없다(순수 함수 이동).
2. 2·3단계는 가독성 개선이다. 급하지 않다.
3. **인증 머지 전에는 하지 않는다.** dev→main 머지가 이미 16커밋·61파일이고 인증 컷오버 검증이 걸려 있다. 리팩토링 디프를 섞으면 문제가 생겼을 때 원인 분리가 어려워진다.

## 검증

| 단계 | 확인 |
|---|---|
| 1 | `test-markdown-emphasis.mjs` 가 **import 로** 통과 · `tsc --noEmit` · `npm run build` |
| 1 | 렌더러 13종이 화면에 그대로 뜨는지 (차트·날씨·영화 최소 3종 육안) |
| 2 | 첨부 이미지/파일 카드, 마크다운 표·코드블록 육안 |
| 3 | 복사·TTS·롱프레스 메뉴 동작 |

**순수 함수 이동이라도 육안 확인은 뺄 수 없다.** 오늘 "고쳤다고 생각했는데 화면은 그대로"가 두 번 나왔다.

## 하지 않을 것

- **레이아웃 JSX(717–924) 분해** — `hasPharmacyBlock` 등 블록 유무에 따라 `outerMaxWidth` 가 달라지는 로직이 얽혀 있다. 쪼개면 조건이 여러 파일로 흩어져 오히려 읽기 어려워진다.
- **파싱을 정규식에서 remark 플러그인으로 교체** — 더 "올바른" 방향이지만, 스트리밍 중 미완성 펜스 처리(`chart_loading`, 미완성 `$$` 절단)를 다시 설계해야 한다. 이번 목적(테스트 가능성)에 필요하지 않다.
