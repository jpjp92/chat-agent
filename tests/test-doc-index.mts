/**
 * 문서 인덱스 등록 하니스 — `npx tsx tests/test-doc-index.mts`
 *
 * 이 파일이 생긴 이유: [10-31 문서 감사](../docs/logs/2026/10/DEV_261031.md) 에서 **등록 누락 6건**이
 * 한꺼번에 나왔다 — 월 인덱스에 10-25·26·27 사흘, `PLAN_INDEX` 에 보안 검토 1건, `tests/README` 에
 * 하니스 1건, `guide/README` 에 `REF_ROUTER_LABELS`, `guide/db/README` 에 `tts-quota.sql`.
 * 전부 **파일은 멀쩡하고 인덱스만 비어 있는** 형태라 링크 검사기([test-doc-links](test-doc-links.mts))가
 * 잡을 수 없었다. 그쪽은 *있는 링크가 깨졌는가* 를 보고, 이쪽은 *있어야 할 링크가 없는가* 를 본다.
 *
 * 기록 규칙([docs/README](../docs/README.md))이 이미 "새 날짜 로그는 `DEV_HISTORY.md` 와 해당 월
 * `README.md` 에 링크한다" 고 정해 뒀는데도 사흘이 빠진 게 핵심이다 — **규칙이 있어도 사람이 거르면
 * 아무 신호가 없었다.** `tts-quota.sql` 은 특히 나쁜 종류였다: `docs/guide/db/` 가 "추적되는 DB 스키마와
 * 실행 순서의 **유일한 출처**" 인데, 유료 TTS 를 막는 쿼터 테이블이 그 표에 아예 없었다(언급 0건).
 *
 * 판정 규칙 — 왜 이렇게 갈랐는가:
 *   ① 날짜 로그(`DEV_YYMMDD.md`) → 월 인덱스·`DEV_HISTORY` 둘 다 **실패**. 기록 규칙이 명시한다.
 *   ② 부록형 로그(`DEV_YYMMDD_SUFFIX.md`) → 월 인덱스는 **실패**, `DEV_HISTORY` 는 **경고**.
 *      실측 근거: 부록 4개 중 `DEPLOY_CHECK`·`DEADCODE`·`DEPS` 셋은 `DEV_HISTORY` 에 있고
 *      `COMMENT_ARCHIVE` 만 없다. 그건 주석 원문 보관이라 본문 로그가 대리하는 게 맞다 —
 *      규칙을 현실에 맞춘다([09-04 감사 §4](../docs/logs/2026/09/DEV_260904.md) 와 같은 판단).
 *   ③ 월 `README.md` 가 없는 달은 **건너뛴다**. 2026/04~07 은 `DEV_HISTORY` 로 갈음한다는
 *      명시 규칙이 있고 소급하지 않았다.
 *
 * 검사 대상은 **추적되는 파일뿐**이다(`git ls-files`). 디스크를 걷으면 로컬 전용 스크래치가
 * 환경마다 다른 결과를 만든다 — `test-doc-links` 가 같은 이유로 같은 선택을 했다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0, warn = 0, checked = 0;
const bad = (msg: string) => { fail++; console.log(`❌ ${msg}`); };
const soft = (msg: string) => { warn++; console.log(`⚠️  ${msg}`); };
const ok = (msg: string) => console.log(`✅ ${msg}`);

/** 추적 파일 목록. git 이 없으면 null → 호출부가 디스크 걷기로 되돌린다. */
const tracked = (glob: string): string[] | null => {
    const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', glob], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return r.stdout.split('\0').filter(Boolean);
};

const readOr = (rel: string) => {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

/**
 * `index` 안에 `needle` 이 적혀 있는가. 링크 문법을 따지지 않고 **이름이 등장하는지**만 본다 —
 * 표 셀·각주·본문 어디에 적혀도 "인덱스에 올렸다" 로 인정한다. 형식까지 강제하면
 * 10-20 행처럼 날짜 로그 없이 계획서만 적는 정당한 변형을 거짓 실패로 만든다.
 */
const listed = (index: string, needle: string) => index.includes(needle);

console.log('── 문서 인덱스 등록 검사 ──\n');

// ── ①② 날짜 로그 → 월 인덱스 · DEV_HISTORY ──────────────────────────
const history = readOr('docs/DEV_HISTORY.md');
if (history === null) bad('docs/DEV_HISTORY.md 가 없다');

const logs = (tracked('docs/logs/**/DEV_*.md') ?? []).sort();
let logFail = 0;
for (const rel of logs) {
    const base = path.basename(rel, '.md');
    const monthDir = path.dirname(rel);
    const monthIndex = readOr(path.join(monthDir, 'README.md'));
    const isAppendix = /^DEV_\d{6}_.+$/.test(base);
    checked++;

    if (monthIndex === null) continue;          // 판정 규칙 ③ — 월 인덱스를 안 만드는 달
    if (!listed(monthIndex, base)) { bad(`월 인덱스 누락  ${monthDir}/README.md ← ${base}`); logFail++; }

    if (history && !listed(history, base)) {
        const msg = `DEV_HISTORY 누락  ${base}`;
        isAppendix ? soft(`${msg}  ← 부록형이라 본문 로그가 대리한다`) : (bad(msg), logFail++);
    }
}
if (logFail === 0) ok(`날짜 로그 ${logs.length}개 — 월 인덱스·DEV_HISTORY 등록`);

// ── ③~⑥ 산출물 → 담당 인덱스 ────────────────────────────────────────
/**
 * `glob` 은 git pathspec 이라 `*` 가 **디렉터리 경계를 넘는다** — `tests/*.mts` 가 `tests/manual/` 까지
 * 잡아 25건이 거짓 실패로 떴다(작성 중 실측). `dir` 로 깊이를 고정한다.
 * 특히 하니스는 `run-all.mts` 가 **자기 디렉터리만** 훑으므로(하위는 의도적으로 제외) 최상위만 대상이다.
 */
const groups: { label: string; glob: string; dir: string; index: string; key: (rel: string) => string; skip?: (b: string) => boolean }[] = [
    { label: '계획서', glob: 'docs/plans/PLAN_*.md', dir: 'docs/plans', index: 'docs/plans/PLAN_INDEX.md',
      key: r => path.basename(r, '.md'), skip: b => b === 'PLAN_INDEX' },
    { label: '기능 레퍼런스', glob: 'docs/guide/REF_*.md', dir: 'docs/guide', index: 'docs/guide/README.md',
      key: r => path.basename(r, '.md') },
    { label: 'DB 스키마', glob: 'docs/guide/db/*.sql', dir: 'docs/guide/db', index: 'docs/guide/db/README.md',
      key: r => path.basename(r) },
    { label: '회귀 하니스', glob: 'tests/*.mts', dir: 'tests', index: 'tests/README.md',
      key: r => path.basename(r, '.mts'), skip: b => b === 'run-all' },
];

for (const g of groups) {
    const index = readOr(g.index);
    if (index === null) { bad(`${g.index} 가 없다`); continue; }
    const files = (tracked(g.glob) ?? []).filter(r => path.dirname(r) === g.dir).sort();
    const missing: string[] = [];
    let n = 0;
    for (const rel of files) {
        const name = g.key(rel);
        if (g.skip?.(name)) continue;   // 인덱스 대상이 아닌 것(러너 자신 등)은 세지도 않는다
        checked++; n++;
        if (!listed(index, name)) missing.push(name);
    }
    for (const m of missing) bad(`${g.label} 인덱스 누락  ${g.index} ← ${m}`);
    if (missing.length === 0) ok(`${g.label} ${n}개 — ${g.index} 등록`);
}

console.log(`\n대상 ${checked}건 검사`);
console.log(`${fail === 0 ? '✅' : '❌'} 실패 ${fail} / 경고 ${warn}`);
process.exit(fail === 0 ? 0 : 1);
