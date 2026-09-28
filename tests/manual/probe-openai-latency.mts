/**
 * luna(OpenAI Responses) 호출 지연 분포 프로브.
 *
 * 왜 있나: `OPENAI_CHAT_TIMEOUT_MS` 를 60→120 으로 올렸지만(DEV_260928 §11) **120 은 추정이다**.
 * 근거로 쓴 실측이 두 건뿐이었다 — 일반 검색 ~14~15s, 조사형 1건이 60s 초과(잘려서 진짜 값 모름).
 *
 * 🔴 왜 "며칠 뒤 로그 긁기" 가 아닌가: 무료티어는 런타임 로그 보존이 짧아 `vercel logs` 의
 *    JSON 레코드가 `"logs":[]` 로 온다 — 요청 줄만 남고 **console 본문이 사라진다**(2026-09-28 실측).
 *    그래서 `--follow` 로 **켜 두고 그 자리에서 재현**하는 수밖에 없다.
 *
 * 사용법
 *   1) 수집 (사용자가 직접 — 대화형이라 에이전트가 못 돈다)
 *        npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-openai-latency.mts --tail --deployment dpl_…
 *      켜 둔 채 웹에서 luna 로 검색형·조사형 질문을 7회 이상 던진다. Ctrl-C 로 종료.
 *
 *   2) 분석 (재호출 0 — 저장본만 읽는다)
 *        npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-openai-latency.mts --report
 *
 * 옵션: --deployment <dpl_…> (--tail 필수) · --project <name> (기본 chat-agent-dev) · --out/--in <path>
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const option = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const project = option('--project', 'chat-agent-dev');
const out = option('--out', option('--in', 'tests/manual/data/openai-latency.log'));

/** `[OpenAI] initial 14072ms · websearch=true · 상한 120000ms` */
const LINE = /\[OpenAI\]\s+(initial|followup)\s+(\d+)ms\s+·\s+websearch=(true|false)\s+·\s+상한\s+(\d+)ms/;

type Row = { phase: string; ms: number; websearch: boolean; cap: number };

const parse = (text: string): Row[] => text.split('\n').flatMap(line => {
    const m = line.match(LINE);
    return m ? [{ phase: m[1], ms: Number(m[2]), websearch: m[3] === 'true', cap: Number(m[4]) }] : [];
});

const quantile = (sorted: number[], q: number) => {
    if (sorted.length === 0) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const report = (rows: Row[]) => {
    if (rows.length === 0) {
        console.log('🔴 파싱된 [OpenAI] 줄이 0개다. 배포가 됐는지, 테일 중 실제로 luna 를 썼는지 확인해라.');
        process.exit(1);
    }
    const groups: Array<[string, Row[]]> = [
        ['검색 ON  ', rows.filter(r => r.websearch)],
        ['검색 OFF ', rows.filter(r => !r.websearch)],
        ['initial  ', rows.filter(r => r.phase === 'initial')],
        ['followup ', rows.filter(r => r.phase === 'followup')],
        ['전체     ', rows],
    ];
    console.log(`\n표본 ${rows.length}건 · 현재 상한 ${rows[0].cap}ms\n`);
    console.log('구간        n     p50      p90      max      상한대비');
    console.log('─'.repeat(56));
    for (const [label, group] of groups) {
        if (group.length === 0) { console.log(`${label}   0        —        —        —`); continue; }
        const sorted = [...group.map(r => r.ms)].sort((a, b) => a - b);
        const max = sorted[sorted.length - 1];
        const pct = Math.round((max / group[0].cap) * 100);
        console.log(`${label} ${String(group.length).padStart(3)}  ${String(Math.round(quantile(sorted, 0.5))).padStart(7)}  ${String(Math.round(quantile(sorted, 0.9))).padStart(7)}  ${String(max).padStart(7)}  ${String(pct).padStart(6)}%`);
    }

    // 🔴 판정은 "최대값이 상한에 얼마나 붙었나" 로 한다. 길이가 아니라 여유가 지표다.
    const cap = rows[0].cap;
    const max = Math.max(...rows.map(r => r.ms));
    const searchN = rows.filter(r => r.websearch).length;
    console.log('');
    if (searchN < 7) console.log(`⚠️  검색 ON 표본이 ${searchN}건뿐이다 — §10-2(7회 이상)를 못 채웠다. 더 모아라.`);
    if (max >= cap * 0.9) console.log(`🔴 최대 ${max}ms 가 상한 ${cap}ms 의 90% 를 넘었다 — 여전히 자르고 있을 수 있다. 상한을 올려라.`);
    else if (max <= cap * 0.4) console.log(`🟡 최대 ${max}ms 가 상한의 40% 이하다 — 상한을 낮춰 실패를 빨리 드러낼 여지가 있다.`);
    else console.log(`✅ 최대 ${max}ms · 상한 ${cap}ms — 여유가 적절하다(40~90%).`);
    console.log('\n⚠️  이 판정은 관측된 꼬리에 대한 것이다. 더 무거운 조사형 질문은 아직 안 봤을 수 있다.');
};

if (has('--report')) {
    if (!existsSync(out)) { console.error(`저장본이 없다: ${out}\n먼저 --tail 로 수집해라.`); process.exit(1); }
    report(parse(readFileSync(out, 'utf8')));
} else if (has('--tail')) {
    mkdirSync(dirname(out), { recursive: true });
    console.log(`▶ ${project} 라이브 테일 → ${out}`);
    console.log('  켜 둔 채 웹에서 luna 로 검색형·조사형 질문을 7회 이상 던져라. 끝나면 Ctrl-C.\n');
    // 🔴 `--follow` 는 **배포를 특정해야** 한다(`--no-branch` 와 같이 못 쓴다). 배포를 고정하는 편이
    //    측정에도 맞다 — 고정하지 않으면 구버전 트래픽이 섞여 상한이 다른 줄이 한 파일에 들어온다.
    const deployment = option('--deployment', '');
    if (!deployment) {
        console.error('🔴 --deployment <dpl_…> 가 필요하다. 현재 프로덕션 배포는:');
        console.error(`     vercel inspect $(vercel list ${project} --prod | awk 'NR==5{print $3}') | grep "  id"`);
        process.exit(1);
    }
    /**
     * 🔴 **재연결이 필요하다.** 질문 사이 유휴 구간에서 스트림이 `ETIMEDOUT` 으로 죽는다
     *    (2026-09-28 실측: 트래픽 없이 ~5분). 수집은 30분 단위로 도는데 한 번 끊기면
     *    그 뒤 질문이 통째로 유실되고, **파일만 보면 "그 시간대엔 안 썼나 보다" 와 구분이 안 된다.**
     *    → 끊기면 다시 붙고, 끊긴 사실을 파일에도 남긴다.
     */
    let stopped = false;
    let generation = 0;
    let captured = 0;
    let searchHits = 0;

    const connect = () => {
        const gen = ++generation;
        const child = spawn('vercel', ['logs', deployment, '-p', project, '--follow'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', chunk => {
            const text = String(chunk);
            appendFileSync(out, text);
            for (const line of text.split('\n')) {
                const m = line.match(LINE);
                if (!m) continue;
                if (m[3] === 'true') searchHits++;
                captured++;
                // 🔴 진행을 보여준다. 지난 회차는 **다 끝난 뒤에** 파일이 빈 걸 알았다 —
                //    그게 가장 비싼 실패였다. 목표(검색 ON 7건) 대비로 찍는다.
                console.log(`  ${line.trim()}   ← 누적 ${captured}건(검색 ON ${searchHits}/7)`);
                if (searchHits === 7) console.log('  ✅ 검색 ON 7건 달성. 더 모아도 되고, Ctrl-C 로 끝내도 된다.');
            }
        });
        child.stderr.on('data', chunk => process.stderr.write(chunk));
        child.on('exit', () => {
            if (stopped || gen !== generation) return;
            appendFileSync(out, `\n# --- 스트림 끊김, 재연결 ${new Date().toISOString()} ---\n`);
            console.log('  ↻ 스트림이 끊겨 재연결한다(유휴 타임아웃). 계속 질문해도 된다.');
            setTimeout(connect, 2000);
        });
        return child;
    };

    let child = connect();
    const finish = () => {
        stopped = true;
        try { child.kill('SIGINT'); } catch {}
        const rows = existsSync(out) ? parse(readFileSync(out, 'utf8')) : [];
        console.log(`\n저장 완료: ${out} · [OpenAI] 줄 ${rows.length}건`);
        console.log('분석:  npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-openai-latency.mts --report');
        process.exit(0);
    };
    process.on('SIGINT', finish);
} else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
}
