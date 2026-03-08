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

        // Combine into a single text block with chunked timestamps (e.g. every 1 minute)
        let fullText = '';
        let currentChunkIndex = -1;
        const chunkSizeInSeconds = 60; // 1-minute chunks

        for (const t of transcript) {
            const chunkIndex = Math.floor(t.offset / chunkSizeInSeconds);
            if (chunkIndex > currentChunkIndex) {
                currentChunkIndex = chunkIndex;
                const minutes = Math.floor(t.offset / 60);
                const seconds = Math.floor(t.offset % 60);
                const timeString = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
                fullText += `\n\n${timeString}\n`;
            }
            fullText += t.text + ' ';
        }

        fullText = fullText.trim();

        return res.status(200).json({ transcript: fullText });
    } catch (error: any) {
        console.error('Transcript fetch failed:', error.message);
        return res.status(200).json({ error: 'Transcript unavailable', details: error.message });
    }
}
