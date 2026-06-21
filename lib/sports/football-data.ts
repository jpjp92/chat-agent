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
