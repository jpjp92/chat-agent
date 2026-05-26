export const runtime = 'nodejs';

// Transcript extraction is disabled — all YouTube summarization uses Gemini native video analysis.
export async function POST() {
    return Response.json(
        { error: 'Transcript unavailable', details: 'Transcript extraction is disabled. Using native video analysis.' },
        { status: 200 }
    );
}
