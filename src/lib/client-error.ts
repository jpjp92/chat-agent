// 브라우저에서 난 오류의 원본(Supabase 응답 본문·인증 오류 객체)을 개발자 도구에 남기지 않고 서버 로그로 보낸다.
// 사용자에겐 각 화면의 안내 문구만 보이고, 콘솔에는 어느 단계가 실패했는지만 남는다.
// 수신: app/api/client-log/route.ts (Vercel 함수 로그에 console.error 로 기록)

type ClientErrorScope =
    | 'upload'
    | 'auth.link'
    | 'auth.idToken'
    | 'auth.kakao'
    | 'auth.signIn'
    // 인증이 붙은 보조 라우트(fetch-url·sync-drug-image·showtimes)의 401 — 화면엔 조용히 폴백돼 여기서만 드러난다.
    | 'auth.route';

const pick = (err: unknown, extra?: { status?: number; body?: string }) => {
    const e = err as any;
    return {
        code: e?.code != null ? String(e.code) : undefined,
        status: extra?.status ?? (typeof e?.status === 'number' ? e.status : undefined),
        message: String(extra?.body ?? e?.message ?? err ?? '').slice(0, 500),
    };
};

export const reportClientError = (scope: ClientErrorScope, err: unknown, extra?: { status?: number; body?: string }) => {
    console.error(`[${scope}] failed`);
    try {
        const payload = JSON.stringify({ scope, ...pick(err, extra) });
        const sent = typeof navigator !== 'undefined' && navigator.sendBeacon
            && navigator.sendBeacon('/api/client-log', new Blob([payload], { type: 'application/json' }));
        if (!sent) void fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    } catch { /* 보고 실패는 무시 — 사용자 흐름에 영향 없음 */ }
};
