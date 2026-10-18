# 공개 API 라우트 인증 — 전수조사와 수정 계획

> 작성: 2026-10-17 · 상태: **구현 완료(dev, 커밋 전)** — 기록 [DEV_261017](../logs/2026/10/DEV_261017.md)
> 근거: 외부 보안 리뷰(origin/dev 기준)를 dev 코드와 대조한 뒤 `app/api` 11개 라우트를 전수조사
> 상위 계획: [PLAN_HARDENING_260822 §6](PLAN_HARDENING_260822.md#6-작업-순서) 순서 4(남은 공개 비용 라우트)를 먼저 떼어 낸 것. 쿼터·공통 Guard 는 그 계획에 남는다

## 1. 결론

- 인증이 없거나 **위조 토큰이 통과하는** 라우트 4개에 같은 확인(`requireProfile`)을 붙이고, 헤더를 붙일 수 없는 `proxy-image` 는 호스트 허용목록으로 닫는다.
- `sync-drug-image` 의 inflight 누수(MEDIUM-3)는 보안과 무관한 **실제 버그**라 먼저, 따로 고친다.
- 새 구조(middleware·공통 Guard)와 호출 제한(쿼터)은 이번에 만들지 않는다. 인증만으로는 익명 계정을 반복 생성하는 비용 공격을 막지 못한다 — §7 남는 위험.
- **dev 기준으로만 진행한다.** main 은 나중에 dev 로 통째로 교체할 예정이라 따로 맞추지 않는다.

## 2. 전수조사 — `app/api` 11개 라우트 (2026-10-17, dev)

**판단 기준은 "위조 토큰이 실제로 걸러지는가"다.** `createRouteClient`·`userIdFromToken`([lib/supabase/route.ts](../../lib/supabase/route.ts))은 서명을 검증하지 않는다(매 요청 auth 왕복을 피하려는 설계). 뒤에 user-scoped DB·Storage 호출이 있어야 PostgREST/Storage 가 JWT 를 검증한다. service_role 로만 쓰거나 DB 를 거치지 않는 경로는 **검증이 한 번도 일어나지 않는다.**

| 라우트 | 호출부 | 현재 인증 | 위조 토큰 | 쓰기 · 비용 | 판정 |
|---|---|---|---|---|---|
| `chat` | geminiService | Bearer + `profiles` 조회 | 걸러짐 | LLM | ✅ |
| `sessions` | geminiService | Bearer + RLS 쿼리 | 걸러짐 | — | ✅ |
| `speech` | geminiService | Bearer + 쿼터 RPC(공급자 호출 전) | 걸러짐 | TTS | ✅ |
| `summarize-title` | geminiService | Bearer + `profiles` 조회 | 걸러짐 | LLM | ✅ |
| `create-signed-url` | ChatInput · geminiService | Bearer + Storage 호출 | 걸러짐 | — | ✅ |
| `parse-document` Storage 경유(>4MB) | ChatInput | Bearer + Storage download | 걸러짐 | CPU | ✅ |
| `client-log` | client-error | 없음(의도) | — | 서버 로그 | ✅ 로그인 실패도 보내야 해서 공개. scope 허용목록·2KB·줄바꿈 제거 |
| **`fetch-url`** | geminiService | **없음** | — | service_role `url_cache` upsert · browserless · ScrapingBee · OpenAI | 🔴 HIGH-1 |
| **`sync-drug-image`** | DrugRenderer | **없음** | — | service_role 공개 버킷 upsert · 외부 fetch | 🔴 HIGH-2 |
| **`parse-document` 직행(≤4MB)** | ChatInput | Bearer **형태만** — JWT 를 디코드만 하고 DB 를 거치지 않고 파싱 | **통과** | CPU(HWP·Office 파싱) | 🔴 외부 리뷰에 없던 신규 |
| `showtimes` | MovieRenderer(`fetch`) | 없음 | — | browserless | 🟡 MEDIUM-5 |
| `proxy-image` | DrugRenderer `<img src>` | 없음 | — | 대역폭 · CDN 캐시 24h | 🟡 MEDIUM-6 — 오픈 프록시 |

서버 코드에서 이 라우트들을 부르는 곳은 없다(검색에 걸린 서버 쪽 언급은 모두 주석).

## 3. 수정 대상

| # | 대상 | 위치 | 수정 |
|---|---|---|---|
| A | MEDIUM-3 inflight 누수 | [sync-drug-image:74](../../app/api/sync-drug-image/route.ts#L74) · [:91](../../app/api/sync-drug-image/route.ts#L91) | 캐시 히트 return 전에 `completeInflight` |
| B | HIGH-1 `fetch-url` | [route.ts:26](../../app/api/fetch-url/route.ts#L26) · [:108](../../app/api/fetch-url/route.ts#L108) | `requireProfile` + 호출부 `authedFetch` |
| C | HIGH-2 `sync-drug-image` | [route.ts:23](../../app/api/sync-drug-image/route.ts#L23) | `requireProfile` + 호출부 `authedFetch` |
| D | `parse-document` 직행 | [route.ts:77-79](../../app/api/parse-document/route.ts#L77) | `requireProfile`(Storage 경유는 이미 검증되나 같은 헬퍼로 통일) |
| E | `showtimes` | [route.ts](../../app/api/showtimes/route.ts) · [MovieRenderer.tsx:248](../../components/MovieRenderer.tsx#L248) | `requireProfile` + 호출부 `authedFetch` |
| F | `proxy-image` | [route.ts:39-42](../../app/api/proxy-image/route.ts#L39) | 약품 이미지 호스트 허용목록 |

## 4. 설계

### 4-1. `requireProfile(req)` — 서버 공통 확인

[summarize-title](../../app/api/summarize-title/route.ts)이 이미 쓰는 방식을 헬퍼로 뽑는다.

```ts
// lib/supabase/route.ts
export async function requireProfile(req: Request):
    Promise<{ db: SupabaseClient; userId: string } | { res: Response }>
```

- user-scoped 클라이언트로 `profiles.select('id').maybeSingle()`:
  - 토큰 없음 → 401
  - 위조·만료 토큰 → PostgREST 오류 → 401
  - **오류 코드가 `isAuthError` 에 안 걸리는 경우도 500 이 아니라 401 로 닫는다** — 이번 대상은 인증 확인이 목적이라 판단 불가 = 거부. 원문은 서버 로그
  - anon 키를 Bearer 로 → 오류 없이 0행 → 401
- 반환한 `userId` 는 `profiles.id`(DB 가 검증한 값)라 `userIdFromToken` 과 달리 인가에 써도 된다.
- summarize-title 도 이 헬퍼로 바꾼다(동작 동일). `chat` 은 `is_guest·message_count` 를 함께 읽어 그대로 둔다.
- **위치: 본문 파싱·캐시 조회보다 앞.** `fetch-url` 은 캐시 히트도 인증 뒤 — 캐시 응답만으로도 공개 프록시처럼 쓸 수 있다.
- 비용: 요청당 PostgREST 1회(수십 ms 예상, 구현 후 측정).
- 쓰지 않는 대안: `auth.getClaims()` 는 프로젝트가 비대칭 JWT 키일 때만 로컬 검증이다. 키 방식을 확인하기 전에는 쓰지 않는다. `getUser()` 는 매 요청 auth 서버 왕복이다.

### 4-2. 클라이언트

- B·C·E 호출부를 `fetch` → 기존 [`authedFetch`](../../services/geminiService.ts) 로. D 는 이미 토큰을 붙인다.
- `authedFetch` 는 세션이 없으면 던진다. 세 기능 모두 로그인 이후에만 실행되므로(링크 요약은 전송 시, 약·영화 카드는 대화 기록을 불러온 뒤) 정상 사용에서 던질 일은 없다.
- **401 은 조용히 실패한다**(§6 ②) → `client-log` 에 scope `auth.route` 를 추가해 401 을 남긴다.

### 4-3. `proxy-image` 허용목록

- `<img src>` 라 헤더를 붙일 수 없다 → 인증 대신 **호스트 허용목록**으로 오픈 프록시를 닫는다.
- 목록은 sync-drug-image 의 `ALLOWED_DRUG_HOSTS` 를 `server/drug-image-hosts.ts` 한 곳으로 옮겨 **두 라우트가 공유**(두 벌이면 어긋난다 — 인라인 viz 블록 목록 3벌과 같은 문제).
- **검사 대상은 최종 URL** — `dthumb-phinf.pstatic.net?src=` 는 `src` 를 풀어 다른 호스트로 바꾼다([route.ts:31-36](../../app/api/proxy-image/route.ts#L31)). 처음 URL 만 보면 `src` 로 아무 호스트나 우회된다. 거부는 403.
- 리다이렉트는 `safeFetch` 가 hop 마다 내부 주소를 막는다. 리다이렉트 목적지의 허용목록 재검사는 하지 않는다(약품 이미지 CDN 리다이렉트를 깨뜨릴 수 있어 측정 후 결정).

### 4-4. inflight 누수(A)

캐시 히트 return 직전에 `completeInflight({ publicUrl, pillVisual })`. 함수 안의 **모든 return 경로**(오류·폴백·400)가 `completeInflight` 를 지나는지 함께 점검한다. 가능하면 `try/finally` 한 곳으로 모아 경로가 늘어도 빠지지 않게 한다.

## 5. 진행 순서

| 단계 | 내용 | 확인 |
|---|---|---|
| 0 | dev DB 에서 `profiles` 없는 사용자 수 확인(§6 ③). 운영 DB 는 main 을 dev 로 교체할 때 같은 쿼리로 다시 본다 | 0 |
| 1 | A 커밋 | 같은 약 두 번 조회 시 두 번째가 즉시 |
| 2 | `requireProfile` 헬퍼 + summarize-title 전환 | 제목 생성 정상 |
| 3 | B·C·D·E + 클라이언트 `authedFetch` + `client-log` scope | §8 수동 1~4 |
| 4 | F + 허용목록 상수 공유 | §8 수동 5 |
| 5 | 하니스 · 문서 | `npm run verify` |
| 6 | dev 배포 → 확인 | 새로고침한 탭에서 확인(§6 ④) |

롤백: 2~4 는 커밋 단위로 revert 하면 이전 동작(무인증)으로 돌아간다. DB 변경 없음.

## 6. 이 계획의 위험

| # | 위험 | 근거 | 대응 |
|---|---|---|---|
| ① | **ConnectDI 약품은 이미지 폴백이 없다** — sync 가 실패하면 이미지 자체가 사라진다 | `isSearchOrEntryPage` 면 `proxiedImageUrl = null`([DrugRenderer.tsx:190-195](../../components/DrugRenderer.tsx#L190)) | 수동 확인에 ConnectDI 1건 필수 |
| ② | **401 이 화면에 드러나지 않는다** — `fetchUrlData` 는 401 도 빈 본문으로 돌려 링크 없이 답하고, 약 이미지는 폴백·없음으로, 상영시간은 오류 표시로 끝난다 | [geminiService.ts:148](../../services/geminiService.ts#L148) | `client-log` 보고(§4-2) |
| ③ | **`profiles` 행이 없는 사용자는 전부 막힌다** — 링크·약 이미지·상영시간·문서 파싱 | 판정이 "행 존재" | 0단계 쿼리. 0 이 아니면 행부터 채운다. summarize-title 이 이미 같은 방식이라 해당 사용자는 지금도 제목 생성이 실패하고 있을 수 있다 |
| ④ | **배포 직후 열려 있던 탭** — 예전 번들이 토큰 없이 불러 새로고침 전까지 실패 | — | 막지 않는다(일시적). 배포 확인은 새로고침한 탭에서 |
| ⑤ | **proxy-image 허용목록이 정상 이미지를 막을 수 있다** — 약 카드가 목록 밖 호스트 이미지를 줄 때 | 목록은 sync-drug-image 기준이고 proxy-image 는 지금까지 목록 없이 동작 | 구현 전 최근 약 카드의 `image_url` 호스트를 모아 목록과 대조. 거부는 서버 로그로 남겨 배포 후 확인 |
| ⑥ | 요청당 PostgREST 1회 추가 | 약 카드 여러 장이면 장마다 | 외부 이미지 fetch 보다 짧아 체감 없음 예상 — 구현 후 측정 |

```sql
-- 0단계: profiles 행이 없는 auth 사용자 수 (0 이어야 한다) — dev DB
select count(*) from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
```

## 7. 이번에 하지 않는 것 (남는 위험)

| 항목 | 이유 | 다음 |
|---|---|---|
| 사용자·IP 별 호출 제한 | 익명 로그인을 반복하면 인증은 통과한다. 비용 공격을 완전히 막지 못함 | PLAN_HARDENING 순서 1·4 의 쿼터 설계 |
| MEDIUM-4 `sync-drug-image` 생 `fetch` → `safeFetch` | 인증과 독립. 허용 호스트의 리다이렉트로 내부 주소 도달 가능성 | 다음 단위(작음) |
| LOW — `SUPABASE_KEY` 대체 사용 · API 키 끝 6자 로그 · CGV 서명값 하드코딩 | 이번 범위와 독립 | PLAN_HARDENING 잔여 |
| service_role 사용 자체 | 사용자 간 공유 캐시라 필요. 인증을 앞에 세우는 것으로 충분 | — |
| middleware · 공통 Guard | PLAN_HARDENING P0-1. 구조 개편을 이번 수정의 선행 조건으로 두지 않는다. 대신 §8 하니스가 새 무인증 라우트를 막는다 | — |

## 8. 검증

> 결과(2026-10-17): 자동·curl·유효 토큰 호출은 모두 통과 — [DEV_261017 §3](../logs/2026/10/DEV_261017.md#3-검증). 브라우저 화면 확인만 남음.

- `npm run verify`(타입 + 하니스), `npm run build`
- **하니스 추가** — 무인증 라우트 소스 계약: `app/api/*/route.ts` 중 `client-log`·`proxy-image` 만 인증 없이 허용, 나머지는 `requireProfile` 또는 user-scoped DB·Storage 호출을 가져야 한다. 새 라우트가 인증 없이 생기면 실패한다(middleware 없는 구조의 보완).
- 로컬 수동:
  1. 링크 첨부 요약 — 게스트·회원 각 1회
  2. 약 카드 이미지 — MFDS 1건 + **ConnectDI 1건**, 같은 약 두 번 조회 시 두 번째가 즉시(A)
  3. 영화 카드 상영시간, HWP·DOCX(≤4MB 직행) 파싱
  4. curl — `fetch-url`·`sync-drug-image`·`showtimes`·`parse-document`(multipart) 각각에 토큰 없음 / anon 키를 Bearer 로 / **서명 없는 가짜 JWT**(`x.<base64 {"sub":"<uuid>"}>.y`) → 모두 401, 공급자 호출 로그 없음
  5. `proxy-image?url=https://example.com/a.png` → 403, `dthumb-phinf.pstatic.net?src=<목록 밖 호스트>` → 403, 약품 호스트 이미지 정상

## 9. 커밋 단위

1. `fix: sync-drug-image 캐시 히트 시 inflight 정리 누락`
2. `refactor: requireProfile 헬퍼 — summarize-title 전환`
3. `fix(security): fetch-url · sync-drug-image · showtimes · parse-document 직행 인증`
4. `fix(security): proxy-image 약품 호스트 허용목록(최종 URL 기준)`
5. `docs:` 작업 로그 · PLAN_HARDENING · TODO 갱신
