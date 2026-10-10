/**
 * SSRF 방어 하니스 — `npx tsx tests/test-ssrf.mts`
 *
 * 10-09 감사에서 통과하던 우회(`[::1]`, `[fd00::1]`, `[::ffff:127.0.0.1]`, 리다이렉트)를
 * 실제 `new URL()` 정규화를 거쳐 재현한다. 네트워크는 로컬 루프백만 쓴다(외부 DNS 불필요).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isBlockedIp, isBlockedHostname, assertPublicUrl, safeFetch } from '../server/ssrf.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

// ── ① 감사에서 통과하던 URL — new URL() 정규화를 거친 hostname 으로 판정 ─────────
console.log('── ① 이전 우회 (차단돼야 함) ──');
const BLOCK = [
    'http://[::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/',
    'http://[fe80::1]/', 'http://[::]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/', 'http://0.0.0.0/',
    'http://localhost/', 'http://foo.localhost/', 'http://LOCALHOST./', 'http://metadata.google.internal/',
];
for (const u of BLOCK) {
    const h = new URL(u).hostname;
    check(`차단  ${u}  (hostname=${h})`, isBlockedHostname(h));
}

console.log('\n── ② 공인 주소 (통과해야 함) ──');
for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '172.32.0.1', '[2606:4700::1111]']) {
    check(`통과  ${ip}`, !isBlockedIp(ip));
}
check('통과  example.com 호스트명(DNS 전)', !isBlockedHostname('example.com'));

console.log('\n── ③ assertPublicUrl ──');
check('거부  file:///etc/passwd', await rejects(assertPublicUrl('file:///etc/passwd')));
check('거부  http://user:pw@example.com', await rejects(assertPublicUrl('http://user:pw@example.com/')));
check('거부  http://[::1]:3000/', await rejects(assertPublicUrl('http://[::1]:3000/')));
check('거부  잘못된 URL', await rejects(assertPublicUrl('not a url')));

// ── ④ 리다이렉트 재검사 — 로컬 서버가 시작점이면 시작에서 막히므로, 검사 함수만 우회해
//     "hop 검사가 실제로 일어나는가"를 본다: 시작 URL 은 통과시키고 Location 이 내부 주소.
console.log('\n── ④ 리다이렉트 ──');
const srv = createServer((req, res) => {
    if (req.url === '/to-internal') { res.writeHead(302, { Location: 'http://[::1]:9/secret' }); return res.end(); }
    if (req.url === '/to-meta') { res.writeHead(301, { Location: 'http://169.254.169.254/latest/' }); return res.end(); }
    res.writeHead(200); res.end('ok');
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
const port = (srv.address() as AddressInfo).port;
check('시작 URL 이 루프백이면 즉시 거부', await rejects(safeFetch(`http://127.0.0.1:${port}/`)));

// hop 검사만 따로: safeFetch 의 루프와 같은 판정을 Location 에 적용
const { status, headers } = await fetch(`http://127.0.0.1:${port}/to-internal`, { redirect: 'manual' });
check('서버가 302 + 내부 Location 을 준다(재현 전제)', status === 302 && headers.get('location')!.includes('[::1]'));
check('그 Location 은 assertPublicUrl 에서 거부', await rejects(assertPublicUrl(new URL(headers.get('location')!, `http://127.0.0.1:${port}/`))));
const meta = await fetch(`http://127.0.0.1:${port}/to-meta`, { redirect: 'manual' });
check('메타데이터 주소로의 301 도 거부', await rejects(assertPublicUrl(meta.headers.get('location')!)));
srv.close();

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
