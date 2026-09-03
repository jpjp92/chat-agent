# 보안 검토 — 인증 교체는 순개선, 남은 구멍은 이전부터 있던 두 개

> 날짜: 2026-09-03
> 범위: `dev` 브랜치 전체(218 files vs `main`) — 인증·인가([lib/supabase/route.ts](../../../../lib/supabase/route.ts) · [auth-mvp-schema.sql](../../../guide/db/auth-mvp-schema.sql)), 외부 fetch 라우트([fetch-url](../../../../app/api/fetch-url/route.ts) · [proxy-image](../../../../app/api/proxy-image/route.ts)), 게스트 한도([chat/route.ts](../../../../app/api/chat/route.ts) · [lib/limits.ts](../../../../lib/limits.ts))
> 검토 방식: 코드 정적 분석(읽기 전용). 익스플로잇 실행 없음. **코드는 수정하지 않았다.**

## 1. 최종 결론

**이번 브랜치가 새로 넣은 취약점은 없다.** 오히려 인증 축은 순개선이다 — 닉네임 기반 유사 인증이 Supabase Auth + RLS 로 교체되면서 **진짜 IDOR 하나가 사라졌다.**

남은 것은 둘 다 **이번 diff 소관이 아닌** 기존 결함이다. diff 는 이 파일들에서 User-Agent 리터럴을 [browser-ua.ts](../../../../server/browser-ua.ts) 상수로 바꾼 것뿐이다.

| # | 문제 | 위치 | 등급 | 이번 브랜치 소관 |
|---|---|---|---|---|
| 1 | 비인증 full-read SSRF — 호스트/프로토콜 완전 제어, 방어는 hostname **문자열** 정규식뿐 | `proxy-image:39`, `fetch-url:22,161` | **High** | ❌ 기존 |
| 2 | 게스트 메시지 한도 우회 — `session_id` 를 빼면 카운터가 안 오른다 | `chat/route.ts:132` | 쿼터(비용) | ❌ 기존 |

🔴 **두 문제 모두 "각 줄은 맞는데 전제가 어긋난" 모양이다.** SSRF 정규식은 사설 대역 목록으로는 정확한데 **IP 를 파싱하지 않는다는 전제**가 빠졌고, 게스트 카운터는 "메시지를 저장하면 센다"가 맞는데 **저장이 조건부라는 것**을 세지 않았다.

## 2. 통과한 것 — 인증 교체가 왜 개선인가

### 2.1 삭제된 `app/api/auth/route.ts` 가 진짜 IDOR 이었다

이전 구현은 **클라이언트가 준 `id`** 로 service-role 클라이언트에서 `users` 를 upsert/update 했다. 남의 id 를 보내면 남의 행을 쓸 수 있었다. 이 라우트가 통째로 사라지고 Supabase Auth 로 대체됐다.

[lib/supabase/route.ts:17](../../../../lib/supabase/route.ts) `createRouteClient` 는 **호출자의 JWT 를 실은 anon 키 클라이언트**다. PostgREST 가 서명을 검증하고 RLS 가 스코프를 강제한다. 클라이언트가 준 `user_id` 를 service-role 클라이언트에 넘기는 라우트는 이제 없다.

### 2.2 `userIdFromToken` 의 서명 미검증은 악용 불가 — 인가가 다른 층에 있다

[lib/supabase/route.ts:57](../../../../lib/supabase/route.ts) `userIdFromToken` 은 JWT 를 **서명 검증 없이** 디코드한다. 이것만 보면 위험해 보이지만 소비처를 따라가면 결론이 뒤집힌다.

소비처는 [create-signed-url:30](../../../../app/api/create-signed-url/route.ts) · [parse-document:79](../../../../app/api/parse-document/route.ts) 둘뿐이고, 값은 **Storage 키를 조합하는 데만** 쓰인다. 실제 인가는 [storage-user-prefix-rls.sql:49](../../../guide/db/storage-user-prefix-rls.sql) 의

```sql
(storage.foldername(name))[1] = auth.uid()::text
```

가 user-scoped 클라이언트 위에서 강제한다. **위조한 `sub` 는 RLS 가 거부하는 경로를 만들 뿐이다.** `sub` 는 36자 UUID 문자셋으로 제한돼 traversal·구분자 주입도 막힌다.

⚖️ 이건 "서명 검증 안 함 = 취약"이라는 패턴 매칭이 틀리는 자리다. **토큰의 값이 인가 결정에 쓰이는지, 아니면 인가받은 경로의 이름을 만드는 데만 쓰이는지**가 갈림길이다.

### 2.3 RLS 정책이 정확하다

[auth-mvp-schema.sql:270-321](../../../guide/db/auth-mvp-schema.sql) 을 항목별로 확인했다.

- 모든 정책이 `to authenticated` **+ 소유권 술어**. 스키마 주석(§3, 255~258행)이 스스로 경고한 함정 — *"익명 유저도 `authenticated` 롤을 갖는다"* — 을 실제로 피했다.
- `UPDATE` 에 `WITH CHECK` 존재 → 행의 `user_id` 를 타인으로 재지정 불가.
- `chat_messages` 는 세션 소유권을 **양방향(USING·WITH CHECK)** 으로 검사.
- `profiles` 는 컬럼 단위 `GRANT (display_name, avatar_url)` → `is_guest`·`message_count` 는 트리거만 쓴다. 사용자가 자기 한도를 못 고친다.
- `SECURITY DEFINER` 함수 전부 `set search_path = ''` + 스키마 한정 → search_path 하이재킹 차단.
- `anon` 롤에 grant 없음.
- `url_cache`·`mfds_pills` 는 RLS on + 정책 0개 → `service_role` 만 쓴다. **캐시 오염 → 간접 프롬프트 주입** 경로가 닫혀 있다.

### 2.4 신규 코드에서 확인했으나 문제없던 것

| 카테고리 | 확인 결과 |
|---|---|
| 신규 아웃바운드 fetch SSRF | [paper-tool:45](../../../../server/agent/paper-tool.ts) · [arxiv-tool:120](../../../../server/agent/arxiv-tool.ts) · [hospital-hours:69,97](../../../../server/agent/hospital-hours.ts) · [vet-tool](../../../../server/agent/vet-tool.ts) · [law-tool:82](../../../../server/agent/law-tool.ts) · [weather/index](../../../../server/lib/weather/index.ts) · [openai/url-fetch](../../../../server/openai/url-fetch.ts) — **전부 하드코딩 base + `URLSearchParams`.** 공격자는 path/query 만 제어, 호스트·프로토콜은 못 건드린다. OpenAI URL 폴백은 호스트 게이트(`isOpenAIUrlFallbackHost`) + 기본 OFF |
| XSS | 앱 코드에 `dangerouslySetInnerHTML`·`innerHTML` 0건. 렌더러 7종 전부 React 기본 이스케이프 |
| 코드 실행 | `eval`·`new Function`·`child_process` 0건(배포 코드) |
| SQL/PostgREST 주입 | 사용자 입력으로 만든 `.or()`·`.filter()` 필터 문자열 0건 |
| 시크릿 노출 | 하드코딩 크리덴셜 없음. `NEXT_PUBLIC_` 로 새는 서버 시크릿 없음 — Supabase URL + anon key 만이고 설계상 공개값(RLS 전제) |
| 토큰 유출 | 클라이언트 `authedFetch` 는 항상 same-origin 상대경로만 호출 → 액세스 토큰이 서드파티로 안 나간다 |
| 프롬프트 주입 | 요청 바디의 카드 컨텍스트가 시스템 지시로 들어가기 전 [card-tool-output.ts:29](../../../../server/agent/card-tool-output.ts) `sanitizeCardContexts`·`sanitizeActiveCards` 로 정규화 |
| service-role 사용 | [sync-drug-image:19](../../../../app/api/sync-drug-image/route.ts) 이 비인증 라우트에서 service-role `upload(upsert:true)` 를 하지만 경로가 항상 `drug-cache/<md5>.jpg`(hex 고정 접두사, traversal 불가) + 소스 호스트 허용목록(`:106`). 기존에도 실질 service-role 이었고 이번엔 의존을 **명시화**했을 뿐 — 권한 상승 없음 |

## 3. 결함 ① — 비인증 full-read SSRF (High, 기존)

**위치:** [proxy-image/route.ts:39](../../../../app/api/proxy-image/route.ts) · [fetch-url/route.ts:22,161](../../../../app/api/fetch-url/route.ts)

### 3.1 방어가 IP 를 파싱하지 않는다

두 라우트 모두 **인증이 없다**(`Authorization`·`getUser` 참조 0건). 공격자가 URL 의 **호스트와 프로토콜을 완전히 제어**하고, 유일한 방어는 hostname **문자열** 정규식이다.

```js
/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i
```

사설 대역 **목록 자체는 정확하다.** 문제는 `hostname` 을 IP 로 해석하지 않고 **문자열로만 본다**는 것이다. 그래서 전부 통과한다:

| 우회 | 예시 | 실제 대상 |
|---|---|---|
| 10진 정수 표기 | `http://2130706433/` | 127.0.0.1 |
| 16진 / 8진 | `http://0x7f000001/` · `http://0177.0.0.1/` | 127.0.0.1 |
| IPv4-mapped IPv6 | `http://[::ffff:169.254.169.254]/` | 링크로컬 메타데이터 |
| **DNS 이름** | 공격자 도메인의 A 레코드를 `169.254.169.254` 로 지정 | 정규식은 DNS 결과를 안 본다 |
| 프로토콜 | `http(s):` 화이트리스트 없음 | — |

### 3.2 blind 가 아니라 full-read 다

`proxy-image` 는 **응답 본문을 그대로 클라이언트에 반환**한다. `fetch-url` POST 도 `{ content }` 로 본문을 돌려주고 결과가 `url_cache` 에 남는다. 내부 응답을 눈으로 회수할 수 있다.

```bash
# 인터넷 누구나 호출 가능 — 앱 서버 IP 를 출발지로 하는 내부망 조회
curl 'https://<app>/api/proxy-image?url=http://[::ffff:169.254.169.254]/latest/meta-data/'
curl 'https://<app>/api/proxy-image?url=http://2130706433:6379/'
curl -X POST https://<app>/api/fetch-url -d '{"url":"http://internal-admin.vercel.internal/"}'
```

### 3.3 고치는 법

1. `new URL(target).protocol` 이 `http:`·`https:` 인지 **명시 확인**.
2. `dns.promises.lookup(hostname, { all: true })` 로 해석한 **모든** 주소를 IP 대역 판정에 통과시킨다 — 루프백·사설·링크로컬·CGNAT(`100.64/10`)·IPv4-mapped. `ipaddr.js` 의 `range()` 권장.
3. `redirect: 'manual'` 로 두고 **리다이렉트마다 같은 검증을 반복.** 현재는 `fetch` 기본 follow 라 첫 홉만 검사해도 무의미하다 — 허용 호스트가 302 로 내부를 가리키면 그대로 따라간다.
4. `proxy-image` 는 이미 referer 분기에 사실상 화이트리스트(`pstatic.net`·`nedrug.mfds.go.kr`·`connectdi.com`)를 갖고 있다. **그걸 허용 호스트 목록으로 승격**하는 게 가장 확실하고 코드도 가장 적다.

## 4. 결함 ② — 게스트 한도 우회 (쿼터, 기존)

**위치:** [chat/route.ts:132](../../../../app/api/chat/route.ts)

한도 강제는 서버에서 제대로 한다([chat/route.ts:60](../../../../app/api/chat/route.ts)):

```ts
if (profile?.is_guest && (profile.message_count ?? 0) >= GUEST_MESSAGE_LIMIT) { … 402 … }
```

`message_count` 는 컬럼 GRANT 로 사용자가 못 쓰고 증가 전용이라 **읽는 값 자체는 신뢰할 수 있다.** 문제는 그 값이 **오르는 조건**이다.

```ts
if (session_id) {                       // ← :132
  db.from('chat_messages').insert({ session_id, role: 'user', … })
}
```

`bump_message_count` 트리거는 `chat_messages` **insert 에** 걸려 있다([auth-mvp-schema.sql:248](../../../guide/db/auth-mvp-schema.sql)). 즉 **`session_id` 를 빼고 요청하면 저장도 안 되고 카운터도 안 오른다.** 게스트가 무제한으로 LLM 을 호출한다.

⚠️ 스키마 주석은 *"메시지를 세는 방식이면 세션 삭제로 리셋되니 증가 전용 카운터를 쓴다"* 고 적혀 있다. 리셋은 정확히 막았는데 **애초에 안 세는 경로**가 남았다.

🔴 이건 데이터 유출이 아니라 **비용 문제**다. [lib/limits.ts](../../../../lib/limits.ts) 주석이 목적을 명시한다 — *"회원 전환이 아니라 무료 Gemini 키의 일일 할당량(RPD) 방어. 소진되면 소유자 본인이 24시간 못 쓴다"*(DEV_260624 §7). 우회가 곧 그 장애다.

**고치는 법:** 카운팅을 메시지 저장에서 분리한다 — 게스트면 `session_id` 유무와 무관하게 LLM 호출 직전에 카운터를 올리는 RPC 를 부르거나, 게스트에게 `session_id` 를 필수로 요구한다.

## 5. 남긴 판단 근거

검토에서 **의도적으로 보고하지 않은** 것들 — 놓친 게 아니라 따져보고 뺐다는 기록.

- **`userIdFromToken` 서명 미검증** → §2.2. 값이 인가 결정에 안 쓰인다.
- **`sync-drug-image` 의 service-role** → §2.4 마지막 행. 쓰기 경로가 고정이라 권한 상승 없음.
- **DOS·자원 소진·레이트리밋** → 검토 기준상 제외. 단 §4 는 쿼터 문제지만 **비용이 실제로 걸려** 예외로 적었다.
- **의존성 CVE** → dependabot 이 별도 관리(이 브랜치에도 `browserslist`·`fast-uri` 범프 머지가 들어 있다).

## 6. 다음 할 일

| # | 작업 | 우선순위 |
|---|---|---|
| 1 | `proxy-image` 를 호스트 화이트리스트로 전환 (§3.3-4) — 가장 적은 코드로 가장 큰 축소 | 🔴 높음 |
| 2 | `fetch-url` 에 DNS 해석 후 IP 검증 + `redirect: 'manual'` 재검증 (§3.3-1~3) | 🔴 높음 |
| 3 | 게스트 카운팅을 `session_id` 의존에서 분리 (§4) | 🟡 중간 |
| 4 | ①②에 회귀 하니스 추가 — `2130706433`·`[::ffff:169.254.169.254]`·리다이렉트 체인을 입력으로 넣고 차단을 확인. 네트워크를 안 타므로 `npm test` 편입 조건(tests/README ⓐⓑⓒ)을 만족한다 | 🟡 중간 |
