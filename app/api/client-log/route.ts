// 브라우저 오류 원본 수신 — src/lib/client-error.ts 가 보낸다.
// 인증 없이 열려 있으므로 범위는 허용 목록으로 묶고, 길이를 자르고, 줄바꿈을 지워 로그 위조·도배를 막는다.

const SCOPES = new Set(['upload', 'auth.link', 'auth.idToken', 'auth.kakao', 'auth.signIn', 'auth.route']);
const MAX_BODY = 2_000;

const clean = (v: unknown, max: number) =>
    v == null ? undefined : String(v).replace(/[\r\n\t]+/g, ' ').slice(0, max);

export async function POST(req: Request) {
    try {
        const raw = await req.text();
        if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
        const data = JSON.parse(raw);
        if (!SCOPES.has(data?.scope)) return new Response(null, { status: 400 });
        console.error('[client-error]', {
            scope: data.scope,
            code: clean(data.code, 60),
            status: typeof data.status === 'number' ? data.status : undefined,
            message: clean(data.message, 500),
        });
    } catch {
        return new Response(null, { status: 400 });
    }
    return new Response(null, { status: 204 });
}
