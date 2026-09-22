/**
 * 문서 링크·앵커·행번호 하니스 — `npx tsx tests/test-doc-links.mts`
 *
 * 이 파일이 생긴 이유: [09-04 문서 감사](../docs/logs/2026/09/DEV_260904.md) 가 링크를 전수 검사하고
 * "깨진 링크 0건"으로 닫았는데, ⚠️ **앵커(`#섹션`)와 행번호(`#L42`)는 검사하지 않았다**고 §7-3 에
 * 남겨뒀다. 09-13 에 그 셋을 다 켜보니 **파일 존재 검사조차 13건을 놓치고 있었다** — 당시 검사기가
 * 인라인 코드 오탐 39건을 걸러내는 과정에서 경로형 필터를 좁게 잡은 탓이다(`reference/`·`preview/`·
 * `docs/superpowers/` 처럼 레포에 없는 로컬 전용 경로).
 *
 * 판정 규칙 세 가지 — 왜 이렇게 갈랐는지가 중요하다:
 *   ① 대상 파일 부재 → **실패**. 정책은 이미 있다(레포에 없는 경로는 링크가 아니라 인라인 코드,
 *      [DEV_260829_DEADCODE §9](../docs/logs/2026/08/DEV_260829_DEADCODE.md)).
 *   ② `.md` 앵커 부재 → **실패**. 제목을 고치면 남의 문서가 조용히 깨지는데 화면상 티가 안 난다.
 *   ③ 코드 `#L` 행번호 → **`docs/logs/` 안에서는 경고만**. 날짜 로그는 **그날의 기록**이라
 *      코드가 움직였다고 로그를 고치는 건 기록을 바꾸는 것이다. 반면 계획·가이드·TODO 는
 *      **현재를 말하는 문서**라 어긋나면 실패로 잡는다(09-13 에 PLAN_HARDENING 의 `:310` 이 이렇게 잡혔다 —
 *      파일은 251줄이었다).
 *
 * 앵커는 GitHub 규칙(소문자화 → 문장부호 제거 → 공백을 하이픈)을 따르고, 명시 앵커
 * `<a id="...">` 도 인정한다. 코드블록·인라인 코드 안의 `[url]`·`(A)` 는 링크가 아니다 —
 * 이걸 안 거르면 인용 마커 예시가 대량 오탐으로 잡힌다(09-04 의 39건이 전부 그것이었다).
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build']);

let fail = 0, warn = 0, checked = 0;
const bad = (msg: string) => { fail++; console.log(`❌ ${msg}`); };
const soft = (msg: string) => { warn++; console.log(`⚠️  ${msg}`); };

const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
};

/**
 * 검사 대상은 **추적되는 md 뿐**이다.
 *
 * 디스크를 걷기만 하면 gitignore 된 로컬 전용 트리까지 검사한다 — 위 헤더가 이미
 * "레포에 없는 로컬 전용 경로"로 지목한 `reference/`(92개)와 `docs/superpowers/`(2개)가 그것이다.
 * 그 안의 md 는 남의 프로젝트를 벤더링한 것이라 **우리가 고칠 수 없는 링크**로 하니스를 빨갛게 만든다.
 * 실제로 실패 12건이 전부 거기서 나왔고, 그 트리를 받지 않은 사람에게는 보이지도 않아
 * **환경마다 결과가 달라졌다**. 추적 파일로 좁히면 262개 → 168개가 되고 판정이 환경과 무관해진다.
 *
 * 링크의 **대상** 검사는 그대로 `fs.existsSync` 다. 추적 문서가 `reference/…` 를 가리키면
 * 여전히 실패해야 하기 때문이다(헤더 판정 규칙 ①).
 */
const trackedMarkdown = (): string[] | null => {
    const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '*.md'], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return null;   // git 없음·레포 아님 → 호출부가 걷기로 되돌린다
    return r.stdout.split('\0').filter(Boolean).map(f => path.join(ROOT, f));
};

/** 코드블록·인라인 코드 제거 — 링크 문법처럼 보이는 예시를 링크로 세지 않는다. */
const stripCode = (s: string) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** GitHub 제목 앵커 규칙. 이모지·`—`·`·` 는 제거되고 공백만 하이픈이 된다(연속 공백은 연속 하이픈). */
const slug = (h: string) =>
    h.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

const anchorCache = new Map<string, Set<string>>();
const anchorsOf = (file: string): Set<string> => {
    const hit = anchorCache.get(file);
    if (hit) return hit;
    const set = new Set<string>();
    // 백틱은 지우되 **안의 글자는 남긴다** — `## \`Message.image\` …` 의 앵커에 그 글자가 들어간다.
    const raw = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`/g, '');
    for (const m of raw.matchAll(/^#{1,6}\s+(.+)$/gm)) set.add(slug(m[1]));
    for (const m of raw.matchAll(/<a\s+id=["']([^"']+)["']/g)) set.add(m[1].toLowerCase());
    anchorCache.set(file, set);
    return set;
};
const lineCount = (f: string) => fs.readFileSync(f, 'utf8').split('\n').length;

console.log('── 문서 링크 전수 검사 ──');
const files = trackedMarkdown() ?? walk(ROOT);

for (const file of files) {
    const rel = path.relative(ROOT, file);
    const isDatedLog = rel.startsWith(path.join('docs', 'logs'));
    for (const m of stripCode(fs.readFileSync(file, 'utf8')).matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|#)/.test(href)) continue;   // 외부·페이지 내 앵커는 대상 밖
        const [rawPath, frag] = href.split('#');
        if (!rawPath) continue;
        checked++;
        const target = path.resolve(path.dirname(file), decodeURIComponent(rawPath));

        if (!fs.existsSync(target)) {
            bad(`대상 없음  ${rel} → ${href}   (레포에 없는 경로는 인라인 코드로 강등한다)`);
            continue;
        }
        if (!frag) continue;

        if (/^L?\d+(-L?\d+)?$/.test(frag)) {
            const n = parseInt(frag.replace(/^L/, ''), 10);
            const total = lineCount(target);
            if (total && n > total) {
                const msg = `행번호 초과  ${rel} → ${href}   (대상 ${total}줄)`;
                isDatedLog ? soft(`${msg}  ← 날짜 로그라 기록으로 둔다`) : bad(msg);
            }
            continue;
        }
        if (!target.endsWith('.md')) continue;
        if (!anchorsOf(target).has(decodeURIComponent(frag).toLowerCase()))
            bad(`앵커 없음  ${rel} → ${href}`);
    }
}

console.log(`\nmd ${files.length}개 · 상대링크 ${checked}건 검사`);
console.log(`${fail === 0 ? '✅' : '❌'} 실패 ${fail} / 경고 ${warn}`);
process.exit(fail === 0 ? 0 : 1);
