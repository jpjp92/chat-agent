# World Cup Sports Tool 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 진행 중인 FIFA 월드컵의 조별 순위·대진/일정·득점왕을 football-data.org API로 가져와 LangGraph tool로 응답한다 (Gemini grounding 우회).

**Architecture:** 순수 데이터 계층(`lib/sports/football-data.ts`, fetch+파싱+인메모리 캐시+마크다운 포맷)을 LangChain tool(`worldcup-tool.ts`)이 감싸고, 기존 movie/drug-tool과 동일하게 ToolNode에 바인딩. 새 `sports` intent를 라우터·LANGCHAIN_INTENTS에 등록해 google search 대신 tool 경로를 타게 한다. 렌더는 기존 마크다운(`ChatMessage.tsx` table 오버라이드) 그대로.

**Tech Stack:** TypeScript, Next.js App Router, LangGraph.js, LangChain tools, Zod, football-data.org v4 API.

## Global Constraints

- API: football-data.org v4, base `https://api.football-data.org/v4`, 대회 코드 `WC`. 인증 헤더 `X-Auth-Token: process.env.SPORTS_API_KEY` (TIER_ONE).
- **Rate limit 분당 6회** → 인메모리 캐시 필수. TTL: standings/scorers 300_000ms, matches 600_000ms.
- 범위: **월드컵(WC)만**. 기능: standings·matches·scorers. WC 외 리그·과거 시즌·전용 카드는 비범위.
- 과거 시즌은 API 403 → 라우터에서 `general`로 분기(학습지식 답변).
- 팀명 한글화·미확정 항목 안내는 **LLM이 처리**(tool은 영문 원본 + 지시문 반환).
- 렌더: 마크다운만(새 UI 컴포넌트 없음).
- **테스트 러너 없음** — 검증은 ① `npx tsc --noEmit` 타입 체크, ② `node scripts/*.mjs` 데이터 검증(기존 `test-sports-render.mjs`가 파싱/포맷 로직 동일 검증 완료), ③ `npm run dev` E2E(질의 후 로그·응답 확인).
- 설계 출처: `docs/plans/PLAN_WORLDCUP_SPORTS_TOOL_260621.md`, 진단 `docs/logs/DEV_260620.md` §5.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/sports/football-data.ts` (생성) | football-data.org fetch + 멀티그룹 파싱 + 인메모리 캐시 + 마크다운 포맷. 순수(서버onlyX, `fetch`+`process.env`만). |
| `server/agent/worldcup-tool.ts` (생성) | LangChain `tool` — resource 인자로 데이터 계층 호출, `[WORLDCUP_DATA]` + 지시문 반환. |
| `server/agent/state.ts` (수정) | `IntentType`에 `"sports"` 추가. |
| `server/agent/intentRules.ts` (수정) | `FALLBACK_RULES`에 sports 키워드 규칙 추가(휴리스틱 폴백). |
| `server/agent/nodes/router.ts` (수정) | LLM 프롬프트 intent 목록 + `validIntents` + 과거시즌→general 가드. |
| `server/agent/nodes/generator.ts` (수정) | `LANGCHAIN_INTENTS`에 `"sports"` 추가. |
| `server/agent/graph.ts` (수정) | `worldCupTool` import + ToolNode 배열 추가. |

---

## Task 1: 데이터 계층 `lib/sports/football-data.ts`

**Files:**
- Create: `lib/sports/football-data.ts`
- Verify: `scripts/test-sports-render.mjs` (기존, 동일 로직 검증) + 신규 import 스모크

**Interfaces:**
- Produces:
  - `getStandings(): Promise<string>` — 12조 마크다운 표
  - `getScorers(limit?: number): Promise<string>` — 득점왕 마크다운 표 (득점·PK·출전수)
  - `getMatches(opts?: { stage?: string; status?: string }): Promise<string>` — 경기/대진 마크다운 표. 요청 stage의 모든 경기가 팀 미정이면 `"[NOT_DETERMINED] ..."` 문자열 반환.

- [ ] **Step 1: 데이터 계층 작성**

```ts
// lib/sports/football-data.ts
// football-data.org v4 — 월드컵(WC) 전용 데이터 계층.
// fetch + 멀티그룹 파싱 + 인메모리 캐시(분당 6회 제한 대응) + 마크다운 포맷.

const BASE = 'https://api.football-data.org/v4';
const WC = 'competitions/WC';

type CacheEntry = { value: string; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL = { standings: 300_000, scorers: 300_000, matches: 600_000 };

async function fetchJson(path: string): Promise<any> {
  const key = process.env.SPORTS_API_KEY;
  if (!key) throw new Error('SPORTS_API_KEY missing');
  const res = await fetch(`${BASE}/${path}`, { headers: { 'X-Auth-Token': key } });
  if (!res.ok) throw new Error(`football-data ${path} -> ${res.status}`);
  return res.json();
}

// 캐시 히트 시 반환, miss 시 producer 실행 후 저장. 에러/429 시 stale 값으로 폴백.
async function cached(cacheKey: string, ttl: number, producer: () => Promise<string>): Promise<string> {
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const value = await producer();
    cache.set(cacheKey, { value, expires: Date.now() + ttl });
    return value;
  } catch (e) {
    if (hit) return hit.value; // 갱신 실패 시 직전 데이터 유지
    throw e;
  }
}

const gd = (gf: number, ga: number): string => { const d = gf - ga; return d > 0 ? `+${d}` : `${d}`; };

const STAGE_KO: Record<string, string> = {
  GROUP_STAGE: '조별', LAST_32: '32강', LAST_16: '16강',
  QUARTER_FINALS: '8강', SEMI_FINALS: '준결승', THIRD_PLACE: '3·4위전', FINAL: '결승',
};
const STATUS_KO: Record<string, string> = {
  FINISHED: '종료', TIMED: '예정', SCHEDULED: '예정', IN_PLAY: '진행중', PAUSED: '하프타임',
};

function formatStandings(json: any): string {
  const out: string[] = ['## 2026 FIFA 월드컵 조별리그 순위'];
  for (const g of json.standings ?? []) {
    out.push(`\n### ${g.group ?? ''}`);
    out.push('| 순위 | 팀 | 경기 | 승 | 무 | 패 | 득점 | 실점 | 득실 | 승점 |');
    out.push('|:--:|:--|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|');
    for (const t of g.table ?? []) {
      out.push(`| ${t.position} | ${t.team?.name ?? '?'} | ${t.playedGames} | ${t.won} | ${t.draw} | ${t.lost} | ${t.goalsFor} | ${t.goalsAgainst} | ${gd(t.goalsFor, t.goalsAgainst)} | ${t.points} |`);
    }
  }
  return out.join('\n');
}

function formatScorers(json: any): string {
  const out: string[] = ['## 월드컵 득점 순위', '', '| 순위 | 선수 | 팀 | 득점 | PK | 출전 |', '|:--:|:--|:--|:--:|:--:|:--:|'];
  (json.scorers ?? []).forEach((s: any, i: number) => {
    out.push(`| ${i + 1} | ${s.player?.name ?? '?'} | ${s.team?.name ?? '?'} | ${s.goals ?? 0} | ${s.penalties ?? 0} | ${s.playedMatches ?? 0} |`);
  });
  return out.join('\n');
}

function formatMatches(json: any, opts?: { stage?: string }): string {
  const matches = json.matches ?? [];
  const determined = matches.filter((m: any) => m.homeTeam?.name && m.awayTeam?.name);
  // 요청 단계의 대진이 전부 미정이면 표 대신 안내 문자열 반환.
  if (opts?.stage && determined.length === 0) {
    return `[NOT_DETERMINED] ${STAGE_KO[opts.stage] ?? opts.stage} 대진은 아직 확정되지 않았습니다. 조별리그가 진행 중입니다.`;
  }
  const out: string[] = ['## 월드컵 경기', '', '| 날짜 | 단계 | 홈 | 스코어 | 원정 | 상태 |', '|:--:|:--:|:--:|:--:|:--:|:--:|'];
  for (const m of matches) {
    const h = m.score?.fullTime?.home, a = m.score?.fullTime?.away;
    const score = (h != null && a != null) ? `${h} : ${a}` : 'vs';
    out.push(`| ${m.utcDate?.slice(5, 10) ?? '?'} | ${STAGE_KO[m.stage] ?? m.stage} | ${m.homeTeam?.name ?? '미정'} | ${score} | ${m.awayTeam?.name ?? '미정'} | ${STATUS_KO[m.status] ?? m.status} |`);
  }
  return out.join('\n');
}

export async function getStandings(): Promise<string> {
  return cached('standings', TTL.standings, async () => formatStandings(await fetchJson(`${WC}/standings`)));
}

export async function getScorers(limit = 10): Promise<string> {
  return cached(`scorers:${limit}`, TTL.scorers, async () => formatScorers(await fetchJson(`${WC}/scorers?limit=${limit}`)));
}

export async function getMatches(opts: { stage?: string; status?: string } = {}): Promise<string> {
  const qs = new URLSearchParams();
  if (opts.stage) qs.set('stage', opts.stage);
  if (opts.status) qs.set('status', opts.status);
  const q = qs.toString();
  return cached(`matches:${q}`, TTL.matches, async () => formatMatches(await fetchJson(`${WC}/matches${q ? `?${q}` : ''}`), opts));
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 신규 파일 관련 에러 0 (PASS)

- [ ] **Step 3: 데이터 로직 동작 확인 (기존 스크립트)**

Run: `node scripts/test-sports-render.mjs`
Expected: 12조 표 + 득점왕 표 + 최근 경기 표 정상 출력 (이 스크립트가 동일 파싱/포맷 알고리즘을 검증). 이미 검증됨.

- [ ] **Step 4: Commit**

```bash
git add lib/sports/football-data.ts
git commit -m "feat(sports): football-data.org 월드컵 데이터 계층 (fetch+캐시+마크다운)"
```

---

## Task 2: tool `server/agent/worldcup-tool.ts`

**Files:**
- Create: `server/agent/worldcup-tool.ts`

**Interfaces:**
- Consumes: `getStandings`, `getScorers`, `getMatches` (Task 1)
- Produces: `worldCupTool` (LangChain tool, named `"worldCupTool"`)

- [ ] **Step 1: tool 작성**

```ts
// server/agent/worldcup-tool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStandings, getScorers, getMatches } from "../../lib/sports/football-data";

const INSTRUCTION = [
  '[지시사항]',
  '- 위 데이터는 football-data.org의 실시간 공식 데이터다. 이 데이터만 근거로 답하라.',
  '- 순위·점수·선수명·숫자를 절대 지어내거나 변형하지 마라.',
  '- 팀명은 한국어로 번역해 표기하라 (예: Mexico→멕시코, South Korea→대한민국).',
  '- 데이터가 "[NOT_DETERMINED]"로 시작하면 표를 만들지 말고 그 안내 문구로 답하라.',
  '- 사용자 질문에 맞춰 표 전체를 보여주거나, 필요한 부분만 뽑아 자연스럽게 답하라.',
].join('\n');

export const worldCupTool = tool(
  async ({ resource, stage, status, limit }: { resource: string; stage?: string; status?: string; limit?: number }) => {
    let data: string;
    if (resource === 'scorers') data = await getScorers(limit ?? 10);
    else if (resource === 'matches') data = await getMatches({ stage, status });
    else data = await getStandings();
    return `[WORLDCUP_DATA]\n${data}\n\n${INSTRUCTION}`;
  },
  {
    name: "worldCupTool",
    description: `**현재 진행 중인** FIFA 월드컵(2026 북중미)의 조별 순위/경기·대진/득점왕을 실시간 조회한다. 사용자가 월드컵 순위, 조별리그, 특정 조, 16강/8강 대진, 경기 일정·결과, 득점왕을 물을 때 사용한다. resource로 종류를 선택: 순위는 'standings', 경기/대진은 'matches'(stage로 단계 필터), 득점왕은 'scorers'. 과거 대회(2022 등)는 지원하지 않으므로 호출하지 말 것. 데이터를 지어내지 말고 이 도구로 조회하라.`,
    schema: z.object({
      resource: z.enum(["standings", "matches", "scorers"]).describe("조회할 데이터 종류: 조별순위(standings), 경기/대진(matches), 득점왕(scorers)"),
      stage: z.enum(["GROUP_STAGE", "LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"]).optional().describe("matches일 때 토너먼트 단계 필터 (예: 16강=LAST_16)"),
      status: z.enum(["SCHEDULED", "TIMED", "FINISHED", "IN_PLAY", "PAUSED"]).optional().describe("matches일 때 경기 상태 필터 (예: 종료=FINISHED, 예정=SCHEDULED)"),
      limit: z.number().optional().describe("scorers일 때 표시할 선수 수 (기본 10)"),
    }),
  }
);
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0 (PASS)

- [ ] **Step 3: Commit**

```bash
git add server/agent/worldcup-tool.ts
git commit -m "feat(sports): worldCupTool — 데이터 계층을 LangChain tool로 래핑"
```

---

## Task 3: 그래프·제너레이터 배선 (tool 활성화)

**Files:**
- Modify: `server/agent/state.ts:5-19`
- Modify: `server/agent/graph.ts`
- Modify: `server/agent/nodes/generator.ts:147`

**Interfaces:**
- Consumes: `worldCupTool` (Task 2)
- Produces: `"sports"` intent가 LANGCHAIN 경로로 라우팅되고 ToolNode에서 실행 가능해짐.

- [ ] **Step 1: IntentType에 sports 추가**

`server/agent/state.ts` — `"movie_search"` 줄 다음에 추가:

```ts
    | "movie_search"  // 영화 상영시간표 (CGV/롯데/메가박스)
    | "sports"        // 월드컵 순위/대진/득점왕 (football-data.org)
    | "general";     // 나머지 모든 것
```

- [ ] **Step 2: graph.ts에 tool 바인딩**

`server/agent/graph.ts` — import 추가 (movieTool import 다음):

```ts
import { movieTool } from "./movie-tool";
import { worldCupTool } from "./worldcup-tool";
```

ToolNode 배열에 추가:

```ts
    const toolNode = new ToolNode([identifyPillTool, searchDrugInfoTool, searchWebTool, pharmacyTool, hospitalTool, vetTool, lawTool, movieTool, worldCupTool]);
```

- [ ] **Step 3: generator LANGCHAIN_INTENTS에 sports 추가**

`server/agent/nodes/generator.ts:147`:

```ts
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports"];
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0 (PASS)

- [ ] **Step 5: Commit**

```bash
git add server/agent/state.ts server/agent/graph.ts server/agent/nodes/generator.ts
git commit -m "feat(sports): sports intent 배선 (IntentType·ToolNode·LANGCHAIN_INTENTS)"
```

---

## Task 4: 라우터 의도 감지

**Files:**
- Modify: `server/agent/nodes/router.ts:96`, `:116`, `:180` 부근
- Modify: `server/agent/intentRules.ts:12-16` 부근

**Interfaces:**
- Consumes: `"sports"` IntentType (Task 3)
- Produces: 월드컵 질의 → `intent="sports"`, 과거 대회 질의 → `intent="general"`.

- [ ] **Step 1: LLM 라우터 프롬프트에 sports 추가**

`server/agent/nodes/router.ts` — line 96 `movie_search` 항목 다음에 추가:

```ts
- "movie_search"    : movie showtimes / what's playing now at CGV, Lotte Cinema, Megabox theaters (상영시간표, 영화관, 무슨 영화 하는지)
- "sports"          : CURRENT/ONGOING FIFA World Cup standings, group rankings, fixtures/bracket (16강/8강 대진), match results, top scorers. ONLY for the tournament happening now — past World Cups (2022 등) go to "general".
```

- [ ] **Step 2: validIntents 배열에 sports 추가**

`server/agent/nodes/router.ts:116`:

```ts
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
```

- [ ] **Step 3: 과거 대회 → general 가드 추가**

`server/agent/nodes/router.ts` — line 155 (`}` 닫힘) 다음, line 157 영화 가드 위에 삽입:

```ts
    // 과거/완료 월드컵(연도 명시 또는 "지난/과거 월드컵")은 API 미지원(403) → general로 보내 학습지식으로 답.
    if (intent === "sports" && /(20\d\d|지난|과거|역대|작년|예전)\s*(년)?\s*(월드컵|world\s?cup)|(월드컵|world\s?cup)\s*(20\d\d|역대|역사)/i.test(textContent)) {
        console.log('[LangGraph] Sports: 과거 대회 질의 → general (API는 현재 대회만)');
        intent = "general";
    }
```

- [ ] **Step 4: 휴리스틱 폴백 규칙 추가**

`server/agent/intentRules.ts` — `FALLBACK_RULES` 배열 첫 항목(movie_search) 앞에 추가:

```ts
const FALLBACK_RULES: Array<{ intent: Exclude<IntentType, "drug_id" | "drug_info" | "general">; pattern: RegExp }> = [
    {
        intent: "sports",
        pattern: /(월드컵|world\s?cup|조별\s*리그|조별\s*순위|[A-L]조\s*순위|16강|8강|준결승|결승\s*대진|월드컵\s*대진|월드컵\s*득점왕|월드컵\s*일정)/i,
    },
    {
        intent: "movie_search",
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 0 (PASS)

- [ ] **Step 6: Commit**

```bash
git add server/agent/nodes/router.ts server/agent/intentRules.ts
git commit -m "feat(sports): 라우터 sports 의도 감지 + 과거대회 general 분기"
```

---

## Task 5: E2E 검증 + 정리

**Files:**
- Verify: `npm run dev` 수동 E2E
- Cleanup: 임시 진단 흔적 점검

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev`
Expected: `Ready` 출력, 에러 없음.

- [ ] **Step 2: 순위 질의 E2E**

채팅에 입력: `월드컵 조별리그 전체 순위 알려줘`
Expected 로그:
```
[LangGraph] Router decided: intent=sports, ...
```
Expected 응답: 12개 조 A~L 마크다운 표, 한글 팀명, 일관된 1회 응답(grounding 신선도 불균질 없음), 가짜 출처 없음.

- [ ] **Step 3: 자유 질문 E2E**

채팅에 입력: `한국 16강 가능성 어때?`
Expected: worldCupTool(standings) 호출 후 A조 순위 기반 추론 답변.

- [ ] **Step 4: 미확정 대진 E2E**

채팅에 입력: `월드컵 16강 대진표 보여줘`
Expected: 미정 표 나열이 아니라 "아직 확정되지 않았습니다" 안내 (`[NOT_DETERMINED]` 처리).

- [ ] **Step 5: 과거 대회 분기 E2E**

채팅에 입력: `2022 월드컵 우승팀 알려줘`
Expected 로그: `Sports: 과거 대회 질의 → general`. 응답: 학습지식 기반(아르헨티나) + 실시간 아님 톤.

- [ ] **Step 6: 득점왕 E2E**

채팅에 입력: `월드컵 득점왕 누구야?`
Expected: 득점 Top 10 표 (득점·PK·출전수).

- [ ] **Step 7: 임시 흔적 점검**

`server/agent/nodes/generator.ts`에 이전 디버깅 임시 로그(`[DIAG]`)나 실험 잔재 없는지 확인. (이미 원복됨 — 재확인만.)

Run: `grep -n "DIAG\|thinkingBudget: 2048" server/agent/nodes/generator.ts`
Expected: 출력 없음.

- [ ] **Step 8: 최종 Commit (필요 시)**

```bash
git add -A && git commit -m "test(sports): E2E 검증 완료"
```

---

## Self-Review 결과

- **Spec 커버리지**: §2 범위(WC/3기능)→Task1·2, 렌더 마크다운→Task1 포맷+기존 ChatMessage, §3 아키텍처(intent+tool)→Task3·4, §4.1 캐시 TTL→Task1, §4.2 지시문(팀명/미확정)→Task2, §4.3 라우팅+과거분기→Task4, §5 에러(stale 폴백/미확정)→Task1, §6 테스트→각 Task 검증단계+Task5. 누락 없음.
- **Placeholder**: 없음 (모든 step에 실제 코드/명령).
- **타입 일관성**: `getStandings/getScorers/getMatches`(Task1) ↔ worldcup-tool import(Task2) 시그니처 일치. `"sports"` IntentType(Task3) ↔ router validIntents/intentRules(Task4) 일치.
