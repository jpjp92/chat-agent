export const config = { preferredRegion: ['hnd1'] }; // Tokyo — iad1 (US East) IP blocked by YouTube

const ABORT_TIMEOUT_MS = 12000;

async function fetchTranscript(videoId: string, signal: AbortSignal) {
    // Step 1: Get available caption tracks
    const listRes = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`,
        {
            signal,
            headers: { 'Accept-Language': 'en-US,en;q=0.9' },
        }
    );
    const trackListXml = await listRes.text();

    const langs = [...trackListXml.matchAll(/lang_code="([^"]+)"/g)].map(m => m[1]);
    if (langs.length === 0) throw new Error('No caption tracks available for this video.');

    const lang = langs.find(l => l === 'ko') ?? langs.find(l => l === 'en') ?? langs[0];

    // Step 2: Fetch transcript JSON
    const txRes = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
        { signal }
    );
    const data = await txRes.json();

    const transcript = (data?.events ?? [])
        .filter((e: any) => e.segs)
        .map((e: any) => ({
            offset: (e.tStartMs ?? 0) / 1000,
            duration: (e.dDurationMs ?? 0) / 1000,
            text: e.segs.map((s: any) => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim(),
        }))
        .filter((t: any) => t.text.length > 0);

    if (transcript.length === 0) throw new Error('Transcript events are empty after parsing.');

    return transcript;
}

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { videoId } = body;
    if (!videoId) {
        return new Response(JSON.stringify({ error: 'Video ID is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Top-level AbortController — actually cancels underlying fetch connections
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

    try {
        const transcript = await fetchTranscript(videoId, controller.signal);

        let fullText = '';
        let currentChunkIndex = -1;
        const CHUNK_SEC = 60;
        const minOffset = transcript[0]?.offset ?? 0;

        for (const t of transcript) {
            const sec = Math.max(0, t.offset - minOffset);
            const chunkIndex = Math.floor(sec / CHUNK_SEC);
            if (chunkIndex > currentChunkIndex) {
                currentChunkIndex = chunkIndex;
                const m = Math.floor(sec / 60).toString().padStart(2, '0');
                const s = Math.floor(sec % 60).toString().padStart(2, '0');
                fullText += `\n\n[${m}:${s}]\n`;
            }
            fullText += t.text + ' ';
        }

        return new Response(JSON.stringify({ transcript: fullText.trim() }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error('[fetch-transcript] failed:', error.message);
        return new Response(
            JSON.stringify({ error: 'Transcript unavailable', details: error.message }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } finally {
        clearTimeout(timeout);
        controller.abort(); // Ensure all pending fetch connections are closed
    }
}
