import { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchTranscript } from 'youtube-transcript-plus';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { videoId } = req.body;
    if (!videoId) return res.status(400).json({ error: 'Video ID is required' });

    try {
        const transcript = await fetchTranscript(videoId);

        // Combine into a single text block
        const fullText = transcript.map(t => t.text).join(' ');

        return res.status(200).json({ transcript: fullText });
    } catch (error: any) {
        console.error('Transcript fetch failed:', error.message);
        return res.status(200).json({ error: 'Transcript unavailable', details: error.message });
    }
}
