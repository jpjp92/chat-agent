/**
 * API 라우트 인증 소스 계약 — `npx tsx tests/test-route-auth.mts`
 *
 * middleware 가 없어 인증은 라우트마다 따로 적는다 → 빠뜨려도 아무 신호가 없었다.
 * 2026-10-17 전수조사에서 fetch-url·sync-drug-image·showtimes 는 인증이 없었고,
 * parse-document 직행은 `userIdFromToken`(서명 미검증)만 봐서 위조 토큰이 통과했다.
 * (docs/plans/PLAN_PUBLIC_ROUTE_AUTH_261017.md)
 *
 * 규칙:
 *   ① 공개 허용목록(PUBLIC) 밖의 모든 `app/api/**\/route.ts` 는 토큰을 **실제로 검증하는** 경로를 가져야 한다 —
 *      `requireProfile`, 또는 user-scoped 클라이언트(`createRouteClient`)로 DB·Storage 를 부르는 것.
 *   ② `userIdFromToken` 만으로는 통과시키지 않는다(서명을 보지 않는다).
 *   ③ proxy-image 는 공개지만 약품 호스트 허용목록을 써야 한다.
 * 새 라우트를 공개로 두려면 PUBLIC 에 사유와 함께 추가한다.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: string) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok || got === undefined ? '' : `  → ${got}`}`); };

const ROOT = path.resolve(import.meta.dirname, '..');
const API = path.join(ROOT, 'app/api');

const PUBLIC: Record<string, string> = {
    'client-log': '로그인 실패도 보고해야 한다 — scope 허용목록·2KB 상한',
    'proxy-image': '<img src> 라 토큰을 못 붙인다 — 약품 호스트 허용목록으로 닫는다',
};

const routes: string[] = [];
const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'route.ts') routes.push(p);
    }
};
walk(API);

check('라우트를 찾았다', routes.length >= 10, String(routes.length));

for (const file of routes) {
    const name = path.relative(API, path.dirname(file));
    const src = fs.readFileSync(file, 'utf8');
    if (name in PUBLIC) {
        check(`${name} — 공개 허용목록`, true);
        continue;
    }
    const verified = /requireProfile\(/.test(src)
        || (/createRouteClient\(/.test(src) && /\.(from|rpc|storage)\b/.test(src));
    check(`${name} — 토큰을 실제로 검증한다`, verified, 'requireProfile 또는 user-scoped DB/Storage 호출 없음');
}

const proxy = fs.readFileSync(path.join(API, 'proxy-image/route.ts'), 'utf8');
check('proxy-image — 약품 호스트 허용목록', /isDrugImageHost\(targetUrl\)/.test(proxy));

const parse = fs.readFileSync(path.join(API, 'parse-document/route.ts'), 'utf8');
const authAt = parse.indexOf('requireProfile(');
const directAt = parse.indexOf("contentType.includes('multipart/form-data')");
check('parse-document — 직행 분기보다 인증이 먼저', authAt > -1 && authAt < directAt);

for (const r of ['fetch-url', 'sync-drug-image']) {
    const s = fs.readFileSync(path.join(API, r, 'route.ts'), 'utf8');
    const body = s.slice(s.indexOf('export async function POST'));
    check(`${r} — 본문 파싱보다 인증이 먼저`, body.indexOf('requireProfile(') > -1 && body.indexOf('requireProfile(') < body.indexOf('req.json()'));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
