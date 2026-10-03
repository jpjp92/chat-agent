import { NextRequest, NextResponse } from 'next/server';
import { synthesizeSpeechStream } from '../../../server/tts/synth';
import { toSpeakableText } from '../../../lib/tts-speakable';
import { createRouteClient, unauthorized, isAuthError } from '../../../lib/supabase/route';

export const runtime = 'nodejs';
// 2000자 ≈ 280s 분량. 조각을 스트리밍하므로 전송이 재생 속도로 늘어지지는 않지만
// 생성 전체(OpenAI ~25s, Gemini ~45s, PLAN_TTS_STREAMING_261002 §4-2c)에 여유를 둔다.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
    // 🔴 유료 키를 쓰는 라우트다(하드닝 §6-1 1순위). 토큰 없음 → 401, 위조·만료는 아래 RPC 에서 PostgREST 가 401.
    const db = createRouteClient(req);
    if (!db) return unauthorized();

    // 깨진 본문은 Next 기본 500(개발 모드에선 스택)으로 떨어지지 않게 400 으로 막는다
    const body = await req.json().catch(() => null);
    const text = body?.text;
    if (!text || typeof text !== 'string') return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    if (text.length > 10000) return NextResponse.json({ error: 'Text too long' }, { status: 400 });

    // 마크다운 원문을 받아 서버에서 읽을 텍스트로 바꾼다 — 카드 JSON·코드가 TTS 로 새면
    // 철자로 읽고 기호 조각은 오디오가 안 온다(lib/tts-speakable.ts). 2000자 상한은 정리한 뒤에 건다.
    const speakable = toSpeakableText(text).slice(0, 2000);
    if (!speakable) return NextResponse.json({ error: 'Nothing to read' }, { status: 422 });

    // 게스트 차단 + 회원 일일 글자 한도를 **공급자 호출 전에** 원자적으로 소비한다(docs/guide/db/tts-quota.sql).
    // RPC 가 없거나 실패하면 부르지 않는다(fail-closed) — 유료 키를 무방비로 여는 것보다 TTS 가 꺼지는 편이 낫다.
    const { data: quota, error: quotaError } = await db.rpc('consume_tts_quota', { p_chars: speakable.length });
    if (quotaError) {
        if (isAuthError(quotaError)) return unauthorized();
        console.error('[speech] quota rpc failed:', quotaError.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!quota?.allowed) {
        const reason = quota?.reason ?? 'denied';
        if (reason === 'unauthenticated') return unauthorized();
        if (reason === 'guest') return NextResponse.json({ error: 'Members only', reason }, { status: 403 });
        if (reason === 'quota') return NextResponse.json({ error: 'Daily limit reached', reason, used: quota.used, limit: quota.limit }, { status: 429 });
        return NextResponse.json({ error: 'Invalid request', reason }, { status: 400 });
    }

    try {
        const { provider, chunks, stream } = await synthesizeSpeechStream(speakable, req.signal);
        return new Response(stream, {
            headers: {
                'Content-Type': 'audio/pcm',
                'Cache-Control': 'no-store',
                'X-Audio-Sample-Rate': '24000',
                'X-TTS-Provider': provider,
                'X-TTS-Chunks': String(chunks),
            },
        });
    } catch (error) {
        if (req.signal.aborted) return new Response(null, { status: 499 });
        console.error('[speech] synth failed:', (error as Error)?.message);
        return NextResponse.json({ error: 'Failed to generate speech' }, { status: 500 });
    }
}
