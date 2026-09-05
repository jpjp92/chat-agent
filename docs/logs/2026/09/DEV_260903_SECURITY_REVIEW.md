# 보안 검토 — 인증 교체는 순개선, 남은 구멍은 이전부터 있던 두 개

> 날짜: 2026-09-03
> 범위: `dev` 브랜치 전체(218 files vs `main`) — 인증·인가([lib/supabase/route.ts](../../../../lib/supabase/route.ts) · [auth-mvp-schema.sql](../../../guide/db/auth-mvp-schema.sql)), 외부 fetch 라우트([fetch-url](../../../../app/api/fetch-url/route.ts) · [proxy-image](../../../../app/api/proxy-image/route.ts)), 게스트 한도([chat/route.ts](../../../../app/api/chat/route.ts) · [lib/limits.ts](../../../../lib/limits.ts))
> 검토 방식: 코드 정적 분석(읽기 전용). 익스플로잇 실행 없음. **코드는 수정하지 않았다.**
>
> ⚖️ **2026-09-04 개정(2차까지)** — §3 을 두 번 정정했다. **1차**(문서 재검증): ① `proxy-image` 는 full-read 가 아니다 ② 진짜 full-read 는 `fetch-url:452` ③ 메타데이터 크리덴셜은 Vercel(Lambda)에서 성립하지 않는다. **2차**(`docs/TODO.md` 대조 + Node 실측): ④ 🔴 **10진·16진·8진 IP 우회는 막힌다 — 초판의 우회표가 틀렸다** ⑤ 대신 **IPv6 차단 항목 4개가 전부 죽은 코드다**(대괄호). 등급 **High → Medium**, **1순위 결론은 철회**(§3.5). 경위는 §3.0.

## 1. 최종 결론

**이번 브랜치가 새로 넣은 취약점은 없다.** 오히려 인증 축은 순개선이다 — 닉네임 기반 유사 인증이 Supabase Auth + RLS 로 교체되면서 **진짜 IDOR 하나가 사라졌다.**

남은 것은 둘 다 **이번 diff 소관이 아닌** 기존 결함이다. diff 는 이 파일들에서 User-Agent 리터럴을 [browser-ua.ts](../../../../server/browser-ua.ts) 상수로 바꾼 것뿐이다.

| # | 문제 | 위치 | 등급 | 이번 브랜치 소관 |
|---|---|---|---|---|
| 1 | 비인증 SSRF — 인증 없이 호스트/프로토콜 완전 제어. IPv4 표기법 우회는 **파서가 막지만**, 🔴 **IPv6 차단 항목 4개가 죽은 코드**(대괄호). `fetch-url` 은 full-read, `proxy-image` 는 오라클 | `fetch-url:22,161,452`, `proxy-image:39,70` | **Medium**<br>(우선순위 **2위**) | ❌ 기존 |
| 2 | 게스트 메시지 한도 우회 — `session_id` 를 빼면 카운터가 안 오른다 | `chat/route.ts:132` | 쿼터(비용)<br>(3위) | ❌ 기존 |
| 3 | 🔴 **무인증 LLM 엔드포인트 2개** — 인증 0건인데 `API_KEYS` 풀을 직접 쓴다. **초판이 놓쳤고 TODO 에 이미 있었다** | `speech`·`summarize-title` | 쿼터(비용)<br>(우선순위 **1위**) | ❌ 기존 |

🔴 **두 문제 모두 "각 줄은 맞는데 전제가 어긋난" 모양이다.** SSRF 정규식은 사설 대역 목록으로는 정확한데 **IP 를 파싱하지 않는다는 전제**가 빠졌고, 게스트 카운터는 "메시지를 저장하면 센다"가 맞는데 **저장이 조건부라는 것**을 세지 않았다.

⚖️ **09-04 2차 개정에서 "SSRF 1순위" 를 철회했다(§3.4).** [TODO.md §보안](../../../TODO.md) 을 대조하니 무인증 라우트가 **6개**로 이미 세어져 있었고(초판은 2개만 봤다), 그중 `speech`·`summarize-title` 이 **인증 없이 Gemini 키 풀을 태우는 LLM 엔드포인트**였다. 이 앱의 실제 위협 모델(무료 키 RPD 소진 → 소유자 24시간 장애)에 **직결되는 건 그쪽**이다.

🔴 **이 검토의 가장 큰 결함은 발견한 것이 아니라 읽지 않은 것이다.** 초판이 "발견"으로 적은 SSRF 우회 항목 대부분은 TODO 에 **실측과 함께** 이미 있었고, 초판의 우회표는 그 실측과 **정면으로 충돌하는 오답**이었다(§3.0-④). 보안 검토는 코드보다 **그 레포의 기존 보안 기록을 먼저 읽어야 한다.**

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

## 3. 결함 ① — 비인증 SSRF (Medium, 기존 · 우선순위 **2위**, §3.4 에서 하향)

**위치:** [fetch-url/route.ts:22,161,452](../../../../app/api/fetch-url/route.ts) · [proxy-image/route.ts:39,70](../../../../app/api/proxy-image/route.ts)

### 3.0 ⚖️ 초판에서 세 군데를 정정했다 (2026-09-04)

초판은 이 절을 **"비인증 full-read SSRF (High)"** 로 적었다. 재검증하며 셋을 뒤집었다. **셋 다 내가 코드를 끝까지 읽지 않고 일반 SSRF 플레이북을 그대로 붙인 자리다.**

| # | 초판 서술 | 실제 | 근거 |
|---|---|---|---|
| ① | *"`proxy-image` 는 응답 본문을 그대로 반환하므로 full-read"* | **틀렸다.** content-type 게이트가 있다 | `proxy-image:70` |
| ② | full-read 의 주어를 `proxy-image` 로 잡음 | **진짜 full-read 는 `fetch-url` 이다** | `fetch-url:452` |
| ③ | *"메타데이터(`169.254.169.254`) → 크리덴셜 탈취"* | **Vercel(Lambda 계열)엔 EC2 IMDS 가 노출되지 않는다.** 크리덴셜은 환경변수로 주입된다 | 배포 환경 |
| ④ | *"`http://2130706433/`·`0x7f000001`·`0177.0.0.1` 이 통과한다"* | 🔴 **전부 차단된다.** WHATWG `new URL()` 이 `127.0.0.1` 로 정규화한다 | Node 실측(§3.1) |
| ⑤ | (초판에 없음) | **IPv6 차단 항목 4개(`::1`·`fc..`·`fd..`·`fe80:`)가 전부 죽은 코드다** — `hostname` 이 `[::1]` 이라 `^` 앵커가 매치를 막는다 | Node 실측(§3.1) |

🔴 **③이 특히 나쁜 종류의 오류다.** "SSRF → IMDS → 크리덴셜"은 워낙 표준 플레이북이라 **이 앱이 어디서 도는지 확인하지 않고** 썼다. 등급의 근거가 통째로 그 위에 서 있었으므로 **High 는 근거 없이 매겨진 값이었다.**

🔴 **④는 더 나쁘다 — 레포가 이미 정답을 갖고 있었다.** [TODO.md §보안](../../../TODO.md) 은 2026-08-29 에 **실측으로** 이렇게 적어뒀다:

> ✅ **SSRF 는 생각보다 낫다(실측)** … **숫자 IP 우회도 막힌다** — WHATWG `new URL()` 이 `http://2130706433/` 을 `127.0.0.1` 로 정규화해주기 때문(정규식 덕이 아니라 **파서 덕**이다)

**나는 이 문서를 읽지 않고 검토를 썼고, 이미 반증된 주장을 새 문서에 다시 적었다.** 같은 TODO 항목은 `[::ffff:127.0.0.1] → 502 ← 차단 목록 통과` 와 *"미검증: ⓐ리다이렉트 추적 ⓑ내부 IP 로 해석되는 호스트명"* 까지 이미 갖고 있었다 — **초판이 "발견"이라며 적은 것의 대부분이 거기 있었다.**

⚖️ **교훈: 보안 검토는 코드보다 먼저 그 레포의 기존 보안 기록을 읽는다.** 안 그러면 새 문서가 **기존 실측을 덮어쓰는 오답**이 된다.

### 3.1 ⚖️ 우회표를 실측으로 다시 썼다 — 절반이 틀렸다

두 라우트 모두 **인증이 없다**(`Authorization`·`getUser` 참조 0건). 공격자가 URL 의 **호스트와 프로토콜을 완전히 제어**하고, 유일한 방어는 hostname 정규식이다.

```js
/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i
```

초판은 "문자열 매칭이라 표기법 우회가 전부 통한다"고 적었다. **Node 로 직접 재보니 절반이 틀렸다.**

| 입력 | `new URL().hostname` | 차단? | 초판 판정 |
|---|---|---|---|
| `http://2130706433/` | `127.0.0.1` | ✅ 차단 | ❌ *"통과"* — **틀림** |
| `http://0x7f000001/` | `127.0.0.1` | ✅ 차단 | ❌ *"통과"* — **틀림** |
| `http://0177.0.0.1/` | `127.0.0.1` | ✅ 차단 | ❌ *"통과"* — **틀림** |
| `http://127.1/` | `127.0.0.1` | ✅ 차단 | (미기재) |
| `http://2852039166/` | `169.254.169.254` | ✅ 차단 | (미기재) |
| `http://[::1]/` | `[::1]` | ❌ **통과** | (미기재) |
| `http://[fd00::1]/` | `[fd00::1]` | ❌ **통과** | (미기재) |
| `http://[fe80::1]/` | `[fe80::1]` | ❌ **통과** | (미기재) |
| `http://[::ffff:127.0.0.1]/` | `[::ffff:7f00:1]` | ❌ **통과** | ✅ 맞음 |
| 사설 IP 로 해석되는 DNS 이름 | (그 이름 그대로) | ❌ **통과** | ✅ 맞음 |

**IPv4 표기법 우회가 막히는 건 정규식 덕이 아니라 파서 덕이다.** WHATWG `new URL()` 이 10진·16진·8진·축약형을 전부 점표기로 정규화한 뒤 `hostname` 에 넣는다. [TODO.md §보안](../../../TODO.md) 이 이미 실측해 적어둔 그대로다 — *"정규식 덕이 아니라 **파서 덕**이다"*.

⚠️ **그러므로 이 방어는 `new URL()` 의 정규화 동작에 암묵적으로 의존한다.** 파서를 바꾸거나 문자열을 직접 파싱하도록 리팩터링하면 **정규식은 그대로인데 방어가 사라진다.** TODO 가 *"이 의존을 주석에 적어둘 것"* 이라 해둔 이유다(아직 미반영).

### 3.1-a 🔴 진짜 구멍 — IPv6 차단 항목 4개가 전부 죽은 코드다

정규식은 IPv6 를 막으려고 `::1`(루프백)·`fc[0-9a-f]{2}:`·`fd[0-9a-f]{2}:`(ULA)·`fe80:`(링크로컬) **네 항목**을 갖고 있다. **하나도 동작하지 않는다.**

```js
new URL("http://[::1]/").hostname  // → "[::1]"   ← 대괄호가 붙어 있다
RE.test("::1")    // true   ← 작성자가 의도한 값
RE.test("[::1]")  // false  ← 실제로 들어오는 값
```

`hostname` 은 IPv6 리터럴을 **대괄호째** 돌려주는데 정규식은 `^` 앵커라 `[` 로 시작하는 문자열에서 `::1` 을 매치할 수 없다. **목록은 정확한데 비교 대상의 모양이 다르다** — §1 🔴 이 말한 "각 줄은 맞는데 전제가 어긋난" 바로 그 형태다.

🔴 **이 때문에 [TODO.md §보안](../../../TODO.md) 에 열려 있는 수정 계획 — *"IPv4-mapped IPv6(`::ffff:*`) 를 `SSRF_BLOCK` 에 추가"* — 는 실행해도 통하지 않는다.** 실측:

```
::ffff: 를 목록에 추가한 정규식으로 재시험
  http://[::ffff:127.0.0.1]/      → [::ffff:7f00:1]     ❌ 여전히 통과
  http://[::1]/                   → [::1]               ❌ 여전히 통과

대괄호를 벗기고(hostname.replace(/^\[|\]$/g,"")) 같은 목록으로 재시험
  ::1            ✅ 차단
  ::ffff:7f00:1  ✅ 차단
  fd00::1        ✅ 차단
```

**목록에 무엇을 더해도 대괄호가 남아 있으면 소용없다.** 대괄호를 벗기거나(1줄) `net.isIP` 로 판정해야 한다.

### 3.2 두 라우트의 회수 능력이 다르다

**`fetch-url` — 진짜 full-read.** 가져온 HTML 에서 본문 텍스트를 뽑아 그대로 돌려준다. content-type 제한이 없다.

```ts
// fetch-url/route.ts:452
return NextResponse.json({ content: extracted.content });
```

**`proxy-image` — 본문은 막히고 오라클만 남는다.** content-type 게이트가 있다.

```ts
// proxy-image/route.ts:70
if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
    return NextResponse.json({ error: 'URL did not return an image', contentType }, { status: 422 });
}
```

내부 서비스는 대개 `application/json`·`text/html` 을 내므로 **본문은 회수되지 않는다.** 그러나 **422 응답이 `contentType` 문자열을 그대로 돌려주고**, 상태코드도 갈린다(연결 실패 500 / 비이미지 422 / 이미지 200). **포트 스캔과 서비스 핑거프린팅은 된다.**

```bash
# fetch-url — 본문 회수
curl -X POST https://<app>/api/fetch-url -d '{"url":"http://2130706433:8080/"}'
# proxy-image — 본문 대신 contentType 오라클
curl 'https://<app>/api/proxy-image?url=http://2130706433:6379/'
```

### 3.3 고치는 법

**0. 🔴 대괄호를 벗기는 1줄이 먼저다** — §3.1-a. 지금은 IPv6 차단이 통째로 무효이고, 목록만 늘리는 수정(TODO 에 열려 있는 `::ffff:*` 추가)은 **실행해도 통하지 않는다.**
```ts
const host = new URL(target).hostname.replace(/^\[|\]$/g, '');
```
1. `new URL(target).protocol` 이 `http:`·`https:` 인지 **명시 확인**.
2. `dns.promises.lookup(hostname, { all: true })` 로 해석한 **모든** 주소를 IP 대역 판정에 통과시킨다 — 루프백·사설·링크로컬·CGNAT(`100.64/10`)·IPv4-mapped. `ipaddr.js` 의 `range()` 권장. **이게 되면 정규식도 `new URL()` 정규화 의존(§3.1 ⚠️)도 함께 사라진다.**
3. `redirect: 'manual'` 로 두고 **리다이렉트마다 같은 검증을 반복.** 현재는 `fetch` 기본 follow 라 첫 홉만 검사해도 무의미하다 — TODO 가 *"미검증 ⓐ리다이렉트 추적"* 으로 열어둔 항목이다.
4. `proxy-image` 는 이미 referer 분기에 사실상 화이트리스트(`pstatic.net`·`nedrug.mfds.go.kr`·`connectdi.com`)를 갖고 있다. **그걸 허용 호스트 목록으로 승격**하는 게 가장 확실하고 코드도 가장 적다.
5. `proxy-image` 의 422 에서 **`contentType` 을 응답에 싣지 않는다**(§3.2 오라클 차단).
6. 2 를 하지 않고 정규식을 유지한다면 **`new URL()` 정규화에 의존한다는 주석을 코드에 남긴다** — TODO 가 지시해둔 것이고 아직 미반영이다.

### 3.4 ⚖️ "1순위" 를 철회한다 — 더 급한 게 이미 TODO 에 적혀 있었다

초판과 09-04 1차 개정까지 나는 이 SSRF 를 **1순위**로 답했다. **철회한다.** [TODO.md §보안](../../../TODO.md) 을 읽고 나니 같은 뿌리(무인증 라우트)에서 **더 급한 항목**이 이미 식별돼 있었다.

TODO 는 무인증 라우트를 **6개**로 세어뒀다 — `fetch-url` · `proxy-image` · `showtimes` · `speech` · `summarize-title` · `sync-drug-image`. **내 초판은 앞의 둘만 봤다.** 확인해보니:

| 라우트 | 인증 | 하는 일 |
|---|---|---|
| `speech` | **0건** | `GoogleGenAI` 직접 호출 — `API_KEYS` 풀 소비 |
| `summarize-title` | **0건** | `GoogleGenAI` 직접 호출 — `API_KEYS` 풀 소비 |

🔴 **이 둘은 인증 없이 호출 가능한 LLM 엔드포인트다.** [lib/limits.ts](../../../../lib/limits.ts) 가 밝힌 이 앱의 실제 위협 모델은 *"무료 Gemini 키의 일일 할당량(RPD) 방어 — 소진되면 소유자 본인이 24시간 못 쓴다"* 인데, **게스트 한도(§4)를 아무리 조여도 이 두 라우트가 옆으로 열려 있다.** §4 의 `session_id` 우회와 **같은 결과를 더 쉽게** 낸다.

**따라서 순서는 이렇게 바뀐다:**

| 순위 | 항목 | 근거 |
|---|---|---|
| **1** | `speech`·`summarize-title` 에 인증 | 위협 모델(RPD 소진)에 **직결**. 무인증 LLM 호출 |
| **2** | §3.1-a 대괄호 1줄 + `::ffff:` | 차단 의도가 **이미 코드에 있는데 안 도는** 것. 1줄 |
| 3 | §4 게스트 카운팅 분리 | 1 과 같은 뿌리 |
| 4 | `fetch-url` DNS/리다이렉트 검증 | 코드가 큼. TODO 미검증 ⓐⓑ 해소 |

### 3.5 SSRF 자체의 잔여 위험 (Medium 유지)

| 남는 위험 | 지금 가능한가 |
|---|---|
| ⓐ **인증 없는 오픈 프록시** — 정규식은 사설 대역만 막고 공개 인터넷은 전부 열려 있다. 어뷰즈 신고·IP 차단이 **이 계정으로** 온다 | ✅ **우회조차 필요 없다** |
| ⓑ **유료 크레딧 소모** — `fetch-url` 은 실패 시 ScrapingBee/browserless 로 넘어간다(TODO: browserless **1000 units/월**, 회당 ~2) | ✅ 지금 가능 |
| ⓒ **IPv6 로 내부 조회** — §3.1-a 로 `[::1]`·ULA·링크로컬이 전부 열려 있다 | ✅ 통과는 확인. 도달 대상은 Lambda 격리에 달림 |
| ⓓ 내부 서비스 **본문 회수** | Lambda 격리 덕에 표면이 좁다 |

🔴 **ⓓ의 표면이 좁은 건 우리 코드가 막아서가 아니라 런타임이 마침 그래서다.** VPC 연결(프라이빗 DB)·컨테이너·자체 호스팅으로 옮기면 **코드는 한 줄도 안 변했는데 심각해진다.** 방어가 코드가 아니라 **우연** 위에 서 있다.

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

⚖️ **검토 방법 자체의 교훈(2026-09-04, 2차까지).** §3.0 의 정정 다섯은 **두 종류의 실수**다.

**ⓐ 코드를 끝까지 안 읽었다(①②).** `proxy-image` 는 `:70` 까지만 읽으면 content-type 게이트가 보인다. 패턴을 알아본 시점에서 읽기를 멈췄다.

**ⓑ 🔴 레포의 기존 기록을 안 읽었다(③④⑤).** 이게 더 크다.
- ③ 런타임(Vercel/Lambda)은 배포 설정 한 줄이면 확인되는데 **표준 플레이북을 그대로 붙였다.** 그게 등급의 유일한 근거였다.
- ④ [TODO.md §보안](../../../TODO.md) 이 2026-08-29 에 **실측으로** 반증해둔 주장을 새 문서에 다시 적었다.
- ⑤ 같은 TODO 가 무인증 라우트를 **6개**로 세어뒀는데 나는 **2개만** 보고 "1순위"를 단정했다.

**교훈: 검토 대상이 코드일 때도, 먼저 읽어야 할 것은 그 레포가 자기에 대해 이미 적어둔 문서다.** 안 그러면 산출물이 **기존 실측을 덮어쓰는 오답**이 되고, 심지어 **더 급한 항목을 밀어낸다**(§3.4). 초판이 이 문서를 근거로 "SSRF 부터 고치자"고 답한 3턴 동안, 실제 1순위인 `speech`·`summarize-title` 은 언급조차 되지 않았다.

📌 **다음 보안 검토의 첫 단계를 고정한다: ① `docs/TODO.md §보안` ② `docs/plans/PLAN_HARDENING_*` ③ 최근 `DEV_*` 보안 항목 — 코드를 열기 전에 이 셋을 읽고, 새 발견이 기존 기록과 충돌하면 실측으로 결판낸 뒤에 쓴다.**

## 6. 다음 할 일

우선순위는 **등급이 아니라 이 앱의 실제 위협 모델**(무료 Gemini 키 RPD 소진 → 소유자 24시간 장애, [lib/limits.ts](../../../../lib/limits.ts)) 기준이다. 09-04 2차 개정에서 1·2 가 바뀌었다(§3.4).

| # | 작업 | 우선순위 | 근거 |
|---|---|---|---|
| 1 | 🔴 **`speech`·`summarize-title` 에 인증** | 🔴 최상 | 인증 0건인데 `API_KEYS` 풀 직접 소비. **위협 모델에 직결**. TODO 에 이미 있던 항목 |
| 2 | §3.1-a **대괄호 1줄** + `::ffff:` 목록 추가 | 🔴 높음 | IPv6 차단 4항목이 **죽은 코드**. TODO 의 기존 계획(`::ffff:` 추가)은 **이것 없이는 안 통한다** |
| 3 | `proxy-image` 를 호스트 허용목록으로 + 422 `contentType` 제거 (§3.3-4,5) | 🔴 높음 | 이미 있는 referer 분기 승격 — 코드 최소 |
| 4 | 게스트 카운팅을 `session_id` 의존에서 분리 (§4) | 🟡 중간 | 1 과 같은 뿌리(쿼터 소진) |
| 5 | `fetch-url` DNS 해석 후 IP 검증 + `redirect: 'manual'` (§3.3-2,3) | 🟡 중간 | TODO 미검증 ⓐⓑ 해소. **이걸 하면 `new URL()` 정규화 의존도 함께 사라진다** |
| 6 | 2·5 를 안 할 거면 **`new URL()` 정규화 의존을 코드 주석에** (§3.3-6) | 🟡 중간 | TODO 가 지시해둔 것. 미반영 |
| 7 | 회귀 하니스 — `[::1]`·`[fd00::1]`·`[::ffff:127.0.0.1]`·`2130706433`(차단 유지 확인)·리다이렉트 체인 | 🟡 중간 | 네트워크 미사용이라 `npm test` 편입 조건(tests/README ⓐⓑⓒ) 충족 |

🔴 **7번을 빼면 2·5 는 조용히 되돌아간다.** 이 결함의 본질은 "사설 대역 목록"이 아니라 **"비교 대상의 모양을 안 봤다"** 이다(대괄호). 목록을 늘리는 방식의 수정은 같은 함정에 또 빠진다. 하니스가 **차단돼야 할 것과 이미 차단되는 것(`2130706433`)을 함께** 고정해두는 게 수정보다 오래 간다.

📌 **인프라가 바뀌면 이 문서를 다시 열 것**(§3.5). VPC 연결·자체 호스팅·런타임 변경은 코드 한 줄 없이 ⓒⓓ의 등급을 올린다.
