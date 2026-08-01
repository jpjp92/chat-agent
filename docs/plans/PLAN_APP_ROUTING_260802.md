# PLAN — 앱 URL 라우팅 (세션별 주소)

> 작성: 2026-08-02
> 상태: **설계만. 착수 전** — 인증 프로덕션 컷오버([PLAN_AUTH_PROD_ROLLOUT_260719](PLAN_AUTH_PROD_ROLLOUT_260719.md)) 이후.
> 레퍼런스: `reference/cowork26` (App Router + `history.pushState` 선택 동기화)

## 문제

앱 전체가 `/` 하나다. 사이드바에서 대화를 바꿔도 주소가 그대로라:

- 새로고침하면 어떤 대화를 보고 있었는지 잃는다
- 특정 대화를 북마크할 수 없다
- 브라우저 뒤로가기가 대화 전환에 반응하지 않는다

`/privacy`·`/terms` 를 추가하면서 라우트가 생겼지만, **앱 본체는 여전히 단일 주소**다.

## 무엇에 URL 을 줄 것인가

URL 은 "장소"에 준다. 되돌아오고 싶고, 북마크하고 싶고, 뒤로가기가 의미 있는 것만이다.

| 대상 | URL | 판단 |
|---|---|---|
| 대화 세션 | ✅ `/c/[sessionId]` | 새로고침 복원 · 북마크 · 뒤로가기 전부 의미 있음 |
| 개인정보처리방침 · 약관 | ✅ (완료) | 진짜 페이지 |
| 설정 | ⏸ 보류 | 현재 "설정"은 사이드바 안 **언어 드롭다운 하나**다. 페이지가 될 덩치가 아니다. 항목이 늘면 `/settings` |
| AuthModal · Dialog · Toast | ❌ | 일시적 오버레이. URL 을 주면 뒤로가기로 모달이 되살아난다 |

> **`/c/[id]` 는 공유 링크가 아니다.** RLS 때문에 남이 그 주소를 열면 아무것도 못 본다. "내 대화로 돌아가는 주소"지 "남에게 보내는 주소"가 아니다. 공유가 필요하면 별도 설계(공개 스냅샷)가 필요하며 이 계획의 범위가 아니다.

---

## 설계

### 구조 — 레퍼런스와 동일

```
app/page.tsx            →  <App />                       (새 대화)
app/c/[sessionId]/page.tsx →  <App initialSessionId={id} />  (얇은 래퍼)
lib/chatRoute.ts        →  경로 ↔ 상태 변환 단일 소스
```

```ts
// lib/chatRoute.ts — reference/cowork26 의 lib/selection-route.ts 대응
export function getChatPath(sessionId?: string | null): string;      // null → '/'
export function readSessionIdFromPath(pathname: string): string | null;
```

경로 규칙을 한 곳에만 적는다. 지금 렌더러 목록이 `ChatMessage.tsx` 안에서 4번 중복 선언돼 문제인 것과 같은 실수를 처음부터 피한다([PLAN_CHATMESSAGE_REFACTOR](PLAN_CHATMESSAGE_REFACTOR_260801.md)).

### 🔴 `router.push` 가 아니라 `history.pushState` 를 쓴다

이건 취향이 아니라 **필수**다.

`router.push('/c/x')` 는 Next 라우트 전환을 일으켜 `App` 트리를 언마운트·리마운트한다. 그러면:

- **진행 중인 SSE 스트림이 끊긴다** — 답변 생성 중 대화를 바꾸면 깨진다
- `useChatSessions` 의 세션 목록·메시지 캐시와 `useChatStream` 상태가 날아간다

`history.pushState` 는 Next 가 모르는 채로 주소만 바꾸므로 트리가 유지된다. 레퍼런스도 같은 선택을 했다:

```ts
// reference/cowork26/hooks/use-selection-navigation.ts
const state = { ...window.history.state, coworkSelection: true }
if (history === 'push') window.history.pushState(state, '', path)
else window.history.replaceState(state, '', path)
```

자기가 만든 히스토리 항목에 **표식을 남겨** `popstate` 에서 남의 것과 구분하는 것까지 그대로 가져온다(우리는 `chatSelection: true`).

대신 감수하는 것: 서버의 `params` 는 **최초 로드(하드 내비게이션)에서만** 의미가 있다. 그게 우리에게 필요한 전부다.

### 동기화 지점

세션 변경이 전부 `useChatSessions` 를 지나므로 붙일 곳이 좁다.

| 위치 | 동작 | 히스토리 |
|---|---|---|
| `selectSession(id)` ([:315](../../src/hooks/useChatSessions.ts#L315)) | 사용자가 대화를 고름 | **push** |
| `createNewSession()` ([:229](../../src/hooks/useChatSessions.ts#L229)) | 새 대화 | **push** |
| `removeSession(id)` ([:347](../../src/hooks/useChatSessions.ts#L347)) | 삭제 후 다음 세션으로 | **replace** — 지운 대화의 주소가 히스토리에 남으면 뒤로가기로 없는 대화에 닿는다 |
| `popstate` | 뒤/앞으로 가기 | URL → 상태 (반대 방향) |

### 🔴 함정 — `userId` 없을 때 URL 을 건드리면 안 된다

```ts
// useChatSessions.ts:303 — 현재 코드
if (!userId) {
  // userId null = auth 초기화 중인 transient 상태.
  setCurrentSessionId(null);
  return;
}
```

`/c/[id]` 로 처음 들어오면 **인증 초기화 중 `userId` 가 잠시 null** 이라 `currentSessionId` 가 null 로 떨어진다. URL 동기화를 "`currentSessionId` 를 그대로 반영"으로 짜면 **이 순간 딥링크가 지워진다.**

→ URL 은 `currentSessionId` 를 맹목적으로 미러링하지 않는다. **사용자 행동(선택·생성·삭제)에서만** 갱신하고, auth transient 전이는 무시한다.

> 같은 부류의 실수를 이미 했다 — 서버가 받는 히스토리 창(10개) 밖으로 카드가 밀리면 후속 판정이 꺼지던 문제를 "규칙이 부족해서"로 오진했다([DEV_260801 §9](../logs/2026/08/DEV_260801.md)). **상태가 잠시 비는 구간**을 계산에 넣지 않으면 같은 함정에 빠진다.

### 딥링크 해석 — 목록에 없는 세션

사이드바는 30개씩 불러온다. `/c/[id]` 의 세션이 그 안에 없을 수 있는데, 현재 `selectSession` 은 목록에 없으면 조용히 지나간다:

```ts
const session = sessions.find(item => item.id === id);
if (!session || session.messages.length > 0) return;   // ← 목록에 없으면 아무 일도 안 일어남
```

→ 딥링크 전용 해석 경로가 필요하다. 레퍼런스의 `standalonePageIdRef` / `tryActivateStandalonePage` 와 같은 역할이다.

1. 목록에 있으면 평소대로
2. 없으면 그 세션만 단건 조회
3. 없거나 권한 없음(RLS 로 0행)이면 **`/` 로 replace** + 안내 토스트

### 색인

- `/privacy`·`/terms` — 색인돼야 한다(Google 동의 화면 심사에서 접근 필요, [PLAN_AUTH_PROD_ROLLOUT §5-1](PLAN_AUTH_PROD_ROLLOUT_260719.md))
- `/c/[sessionId]` — **`noindex`**. 남이 열어도 RLS 로 빈 화면이지만 주소가 색인될 이유가 없다

---

## 단계

| 단계 | 내용 | 위험 |
|---:|---|---|
| 1 | `lib/chatRoute.ts` + `app/c/[sessionId]/page.tsx` 래퍼 + `App` 이 `initialSessionId` 수용 | 낮음 |
| 2 | `useChatSessions` 에 URL 갱신(push/replace) — **사용자 행동에서만** | 중 |
| 3 | `popstate` → 상태 반영 (표식 확인) | 중 |
| 4 | 딥링크 단건 조회 + 실패 시 `/` replace | 중 |
| 5 | `noindex` 메타 | 낮음 |

1~2 만으로도 "새로고침하면 그 대화가 열린다"가 성립한다. 3~4 는 뒤로가기와 목록 밖 딥링크를 위한 것이다.

## 검증

- [ ] 대화 전환 → 주소가 바뀐다 / 새로고침하면 같은 대화가 열린다
- [ ] **답변 스트리밍 중 대화 전환 → 스트림이 끊기지 않는다** (이 계획의 핵심 제약)
- [ ] 뒤로/앞으로 가기가 대화 전환을 따라간다
- [ ] 대화 삭제 후 뒤로가기가 없는 대화로 가지 않는다
- [ ] 로그아웃 상태에서 `/c/[남의세션]` → 빈 화면이 아니라 `/` 로 보내고 안내
- [ ] **`/c/[id]` 직접 진입 시 auth 초기화 구간에서 딥링크가 지워지지 않는다**
- [ ] `/privacy`·`/terms` 는 그대로 열린다
- [ ] `tsc --noEmit` · `npm run build`

## 하지 않을 것

- **공유 링크** — `/c/[id]` 는 RLS 때문에 남에게 보낼 수 없다. 공유는 공개 스냅샷 테이블이 필요한 별건이다.
- **`/settings` 라우트** — 지금 설정은 언어 드롭다운 하나다. 항목이 늘어난 뒤에 판단한다.
- **모달의 URL 화**(AuthModal·Dialog) — 뒤로가기로 모달이 되살아나는 동작을 만든다.
- **`router.push` 기반 전환** — 위 §설계 참조. 스트리밍이 끊긴다.

## 착수 시점

`App.tsx`·`useChatSessions` 를 건드리므로 **인증 컷오버와 같은 시기에 섞지 않는다.** 문제가 생겼을 때 원인 분리가 어려워진다. [PLAN_CHATMESSAGE_REFACTOR](PLAN_CHATMESSAGE_REFACTOR_260801.md) 와 함께 컷오버 이후 프론트 구조 작업으로 묶는다.
