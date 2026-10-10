/**
 * SSRF 방어 — 사용자가 준 URL 을 서버가 대신 가져오는 라우트(fetch-url, proxy-image) 공용.
 * 검증: `npx tsx tests/test-ssrf.mts`
 *
 * 🔴 이전 정규식 차단(10-09 감사)의 구멍:
 *   · `new URL('http://[::1]/').hostname` 은 **`[::1]`**(대괄호 포함) → `^::1` 에 안 걸림
 *   · `[::ffff:127.0.0.1]` 은 URL 이 `[::ffff:7f00:1]` 로 정규화 → 점 표기 정규식에 안 걸림
 *   · 공인 도메인이 사설 IP 로 해석되거나(DNS), 공인 URL 이 사설 주소로 **리다이렉트**하면 통과
 * → IP 리터럴은 바이트 단위로 판정, 호스트명은 DNS 해석 결과 전부 판정, 리다이렉트는 hop 마다 재검사.
 * 남는 것: 검사와 연결 사이 DNS 재바인딩(TOCTOU). 막으려면 해석된 IP 로 직접 연결해야 해 범위 밖.
 */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const parseV4 = (s: string): number[] | null => {
    const p = s.split('.');
    if (p.length !== 4) return null;
    const n = p.map(Number);
    return n.every((x, i) => /^\d{1,3}$/.test(p[i]) && x <= 255) ? n : null;
};

const isBlockedV4 = ([a, b]: number[]): boolean =>
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // 링크 로컬 · 클라우드 메타데이터
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // 벤치마크
    a >= 224;                               // 멀티캐스트 · 예약 · 브로드캐스트

/** IPv6 문자열 → 16바이트. `::` 축약, 끝의 점 표기 IPv4 모두 처리. */
const parseV6 = (s: string): number[] | null => {
    let str = s.split('%')[0];
    let tail: number[] = [];
    const v4 = str.match(/:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) {
        const b = parseV4(v4[1]);
        if (!b) return null;
        tail = b;
        str = str.slice(0, -v4[1].length) + '0:0';   // 자리만 잡고 아래에서 덮어쓴다
    }
    const halves = str.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
    const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest];
    if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return null;
    const bytes = groups.flatMap(g => { const v = parseInt(g, 16); return [v >> 8, v & 0xff]; });
    if (tail.length) bytes.splice(12, 4, ...tail);
    return bytes;
};

const isBlockedV6 = (b: number[]): boolean => {
    const zero = (from: number, to: number) => b.slice(from, to).every(x => x === 0);
    if (zero(0, 16)) return true;                                       // ::
    if (zero(0, 15) && b[15] === 1) return true;                        // ::1
    if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isBlockedV4(b.slice(12)); // ::ffff:v4
    if (zero(0, 12)) return isBlockedV4(b.slice(12));                   // ::v4 (구 호환형)
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return isBlockedV4(b.slice(12)); // 64:ff9b::/96 NAT64
    if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(b.slice(2, 6)); // 6to4
    if ((b[0] & 0xfe) === 0xfc) return true;                            // fc00::/7 ULA
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;           // fe80::/10 링크 로컬
    if (b[0] === 0xff) return true;                                     // 멀티캐스트
    return false;
};

/** IP 리터럴이 내부·예약 대역인가. IP 가 아니면 false. */
export const isBlockedIp = (ip: string): boolean => {
    const s = ip.replace(/^\[|\]$/g, '');
    const kind = isIP(s.split('%')[0]);
    if (kind === 4) { const b = parseV4(s); return !b || isBlockedV4(b); }
    if (kind === 6) { const b = parseV6(s); return !b || isBlockedV6(b); }
    return false;
};

/** 호스트명만으로(DNS 없이) 막을 수 있는가 — IP 리터럴 + 내부 전용 이름. */
export const isBlockedHostname = (hostname: string): boolean => {
    const h = hostname.toLowerCase().replace(/\.$/, '');
    if (isBlockedIp(h)) return true;
    return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal');
};

export class SsrfError extends Error {}

/** URL 이 외부 공인 주소인가 — 스킴·호스트명·DNS 해석 결과 전부. 실패 시 SsrfError. */
export const assertPublicUrl = async (raw: string | URL): Promise<URL> => {
    let u: URL;
    try { u = new URL(raw); } catch { throw new SsrfError('invalid url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SsrfError('scheme');
    if (u.username || u.password) throw new SsrfError('credentials');
    if (isBlockedHostname(u.hostname)) throw new SsrfError('blocked host');
    if (!isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
        let addrs: { address: string }[];
        try { addrs = await lookup(u.hostname, { all: true }); } catch { throw new SsrfError('dns'); }
        if (addrs.some(a => isBlockedIp(a.address))) throw new SsrfError('resolves to blocked address');
    }
    return u;
};

/**
 * fetch 대체 — 시작 URL 과 **모든 리다이렉트 대상**을 assertPublicUrl 로 검사한다.
 * 리다이렉트는 수동으로 따라간다(최대 5회). 303 또는 POST 의 301/302 는 GET 으로 바꾼다(브라우저 규칙).
 */
export const safeFetch = async (raw: string, init: RequestInit = {}, maxHops = 5): Promise<Response> => {
    let url = (await assertPublicUrl(raw)).toString();
    let opts: RequestInit = { ...init, redirect: 'manual' };
    for (let hop = 0; ; hop++) {
        const res = await fetch(url, opts);
        const loc = res.headers.get('location');
        if (res.status < 300 || res.status >= 400 || !loc) return res;
        if (hop >= maxHops) throw new SsrfError('too many redirects');
        await res.body?.cancel().catch(() => {});
        url = (await assertPublicUrl(new URL(loc, url))).toString();
        const method = (opts.method ?? 'GET').toUpperCase();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
            opts = { ...opts, method: 'GET', body: undefined };
        }
    }
};
