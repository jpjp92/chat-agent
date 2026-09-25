/**
 * 전체 하니스 러너 — `npm test` 의 입구.
 *
 * 🔴 **초판은 `&&` 체인이었다**(`tsx a.mts && tsx b.mts && ...`, 19개). 하나가 깨지면
 *    **뒤의 하니스가 아예 돌지 않는다.** 화면에는 "1건 실패"로 보이지만 실제로는
 *    "1건 실패 + **미확인 n건**"이고, 고치고 다시 돌려야 다음 실패가 보인다.
 *    깨진 게 3개면 3번 왕복한다 — 리팩터링에서 가장 손해가 큰 자리다.
 *    전부 돌리고 **끝에 집계**한다. 종료 코드는 하나라도 실패하면 1.
 *
 * 🔴 **목록을 손으로 적지 않는다** — `tests/*.mts` 를 훑는다. 하니스를 새로 만들고
 *    `package.json` 에 등재하는 것을 잊으면 **조용히 안 돌던** 구멍이 있었다.
 *    실전 호출이 드는 것들은 `tests/manual/` 에 있고 하위 디렉터리는 훑지 않으므로
 *    여기 걸리지 않는다 — 그래서 `tests/manual/` 의 파일에 `test-` 접두를 쓰면 안 된다.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const HERE = new URL('.', import.meta.url);
const SELF = 'run-all.mts';

const harnesses = fs.readdirSync(HERE)
    .filter(f => f.endsWith('.mts') && f !== SELF)
    .sort();

if (harnesses.length === 0) {
    console.error('❌ 하니스를 하나도 못 찾았다 — 수집 규칙이 깨졌다');
    process.exit(1);
}

const failed: string[] = [];
const started = Date.now();

for (const file of harnesses) {
    console.log(`\n${'─'.repeat(72)}\n▶ ${file}\n${'─'.repeat(72)}`);
    const r = spawnSync('npx', ['tsx', new URL(file, HERE).pathname], { stdio: 'inherit', shell: false });
    // signal 로 죽은 경우 status 는 null 이다 — 통과로 세면 안 된다
    if (r.status !== 0) failed.push(`${file}${r.signal ? ` (signal ${r.signal})` : ` (exit ${r.status})`}`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${'═'.repeat(72)}`);
console.log(`하니스 ${harnesses.length}개 · 실패 ${failed.length}개 · ${secs}s`);
if (failed.length > 0) {
    for (const f of failed) console.log(`  ❌ ${f}`);
    console.log('\n🔴 위 하니스는 전부 돌았다 — 실패 하나가 다른 하니스를 가리지 않는다.');
    process.exit(1);
}
console.log('✅ 전부 통과');
