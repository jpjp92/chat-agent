// Transcript extraction is disabled — all YouTube summarization uses Gemini native video analysis.
// All server-side methods (HTML scraping, timedtext API, youtubei.js InnerTube) were blocked
// by YouTube's IP-level filtering on Vercel servers (iad1, hnd1).

export const config = { preferredRegion: ['hnd1'] };

export default async function handler(req: Request) {
    return new Response(
        JSON.stringify({ error: 'Transcript unavailable', details: 'Transcript extraction is disabled. Using native video analysis.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}
