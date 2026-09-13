/**
 * kordoc 파싱 수동 점검 — `npx tsx tests/manual/check-kordoc-parse.mts <파일...>`
 *   인자 없이 돌리면 `tests/manual/fixtures/` 의 HWP 계열 파일을 전부 집어간다.
 *
 * 왜 수동인가: 실제 `.hwp` 파일이 필요해서다. 레포에 픽스처를 커밋하지 않으므로
 * `npm test` 에 넣을 수 없다(`tests/README` 의 "여기 둘 자격" 셋 중 ⓑ 를 못 만족).
 *
 * 이 파일이 생긴 이유: 2026-09-13 에 `kordoc` 을 3.1.1 → 4.13.1 로 올렸다. **major 하나가
 * 아니라 릴리스 70개 이상을 건너뛴 것**이다(3.1.1=06-13, 4.13.1=09-06, 그 사이 121개 중
 * 7월에만 42개). 타입 계약(`ParseFailure` 동일·`ParseSuccess` 가산)과 합성 HWPX 런타임까지는
 * 확인했지만, **HWP 5.x 바이너리·hwp3·hwpml 은 픽스처가 없어 못 봤다** —
 * [DEV_260913_DEPS §3](../../docs/logs/2026/09/DEV_260913_DEPS.md).
 *
 * 🔴 kordoc 을 직접 부르지 않고 **라우트가 하는 것과 같은 순서**로 본다. 라이브러리가
 * 돌아가는 것과 우리 라우트가 답을 내는 것은 다른 주장이다 — 확장자 게이트·4MB 라우팅 결정·
 * `MARKDOWN_MAX` 트렁케이트·응답 필드 6종까지 같이 재현한다.
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 라우트·클라이언트에서 그대로 가져온 상수 (app/api/parse-document/route.ts, components/ChatInput.tsx)
const SUPPORTED = ['.hwp', '.hwpx', '.hwp3', '.hwpml'];
const MARKDOWN_MAX = 100_000;
const INLINE_MAX = 4 * 1024 * 1024;

const isSupported = (name: string) =>
    SUPPORTED.some((ext) => (name || '').toLowerCase().endsWith(ext));

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

let files = process.argv.slice(2);
if (files.length === 0) {
    if (!fs.existsSync(FIXTURES)) fs.mkdirSync(FIXTURES, { recursive: true });
    files = fs.readdirSync(FIXTURES).filter(isSupported).map((f) => path.join(FIXTURES, f));
}
if (files.length === 0) {
    console.log('검사할 파일이 없다.\n');
    console.log(`  ① ${path.relative(process.cwd(), FIXTURES)}/ 에 .hwp/.hwpx/.hwp3/.hwpml 을 넣고 인자 없이 실행`);
    console.log('  ② 또는 경로를 인자로: npx tsx tests/manual/check-kordoc-parse.mts ~/문서.hwp');
    console.log('\n⚠️  fixtures/ 는 .gitignore 대상이다 — 실제 문서를 레포에 커밋하지 않는다.');
    process.exit(1);
}

const { parse } = await import('kordoc');
let fail = 0;

for (const file of files) {
    const name = path.basename(file);
    console.log(`\n── ${name} ──`);

    if (!isSupported(name)) {
        console.log('  ⏭️  라우트가 415 로 거절할 확장자다 (SUPPORTED 밖)');
        continue;
    }

    const buffer = fs.readFileSync(file);
    const mb = (buffer.length / 1024 / 1024).toFixed(2);
    // 라우트 ⓐ/ⓑ 중 어디로 갈 파일인지 — 실제 앱에서 타는 경로가 갈린다
    const route = buffer.length <= INLINE_MAX ? 'ⓐ 직행 multipart' : 'ⓑ Storage 경유';
    console.log(`  크기: ${mb}MB → ${route}`);

    const t0 = Date.now();
    let result: any;
    try {
        result = await parse(buffer);
    } catch (err: any) {
        // 🔴 라우트는 parse() 가 던지는 걸 잡지 않는다 — 던지면 500 이다(422 가 아니라).
        fail++;
        console.log(`  ❌ parse() 가 예외를 던졌다 — 라우트라면 500. ${err?.message}`);
        continue;
    }
    const ms = Date.now() - t0;

    if (!result.success) {
        fail++;
        console.log(`  ❌ 파싱 실패 → 라우트 422  code=${result.code}  error=${result.error}  (${ms}ms)`);
        continue;
    }

    // buildResponse() 가 만드는 응답을 그대로 재현한다
    let markdown: string = result.markdown ?? '';
    const truncated = markdown.length > MARKDOWN_MAX;
    if (truncated) markdown = markdown.slice(0, MARKDOWN_MAX);

    const blockCount = result.blocks?.length ?? 0;
    const tableCount = result.blocks?.filter((b: any) => b.type === 'table').length ?? 0;

    console.log(`  ✅ success  fileType=${result.fileType}  pageCount=${result.pageCount}  (${ms}ms)`);
    console.log(`     markdown ${result.markdown.length.toLocaleString()}자${truncated ? ` → ${MARKDOWN_MAX.toLocaleString()} 로 트렁케이트` : ''}`);
    console.log(`     blocks ${blockCount} · tables ${tableCount}`);
    if (result.warnings?.length) console.log(`     ⚠️  warnings: ${result.warnings.length}건 — ${JSON.stringify(result.warnings.slice(0, 2))}`);

    // 계약 점검 — 라우트 응답이 성립하는 최소 조건
    const problems: string[] = [];
    if (typeof result.markdown !== 'string') problems.push('markdown 이 문자열이 아니다');
    if (result.markdown.trim().length === 0) problems.push('🔴 본문이 비었다 — 파싱은 성공했다고 하는데 모델에 줄 내용이 없다');
    if (!SUPPORTED.some((e) => e.slice(1) === result.fileType)) problems.push(`fileType=${result.fileType} 가 HWP 계열이 아니다`);
    if (problems.length) { fail++; problems.forEach((p) => console.log(`  ❌ ${p}`)); }

    // 표가 있으면 마크다운 표로 나왔는지 — kordoc 을 쓰는 이유가 "구조 보존 표"다
    if (tableCount > 0) {
        const hasPipeTable = /^\s*\|.*\|\s*$/m.test(markdown) && /\|\s*-{3,}/.test(markdown);
        console.log(`     ${hasPipeTable ? '✅' : '❌'} 표 ${tableCount}개 → 마크다운 파이프 표 ${hasPipeTable ? '생성됨' : '없음'}`);
        if (!hasPipeTable) fail++;
    }

    console.log('     ── 본문 앞 300자 ──');
    console.log(markdown.slice(0, 300).split('\n').map((l) => '     │ ' + l).join('\n'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 파일 ${files.length}개 · 문제 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
