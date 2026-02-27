import { VercelRequest, VercelResponse } from '@vercel/node';
import { searchPill } from './_lib/pill-logic.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { imprint_front, imprint_back, color, shape } = req.body;

    try {
        const { match_type, filteredResults } = await searchPill({
            imprint_front,
            imprint_back,
            color,
            shape
        });

        return res.status(200).json({
            found: filteredResults.length > 0,
            match_type,
            results: filteredResults
        });

    } catch (error: any) {
        console.error('[Pill Search] Error:', error);
        return res.status(500).json({ error: 'Failed to search pill database', message: error.message });
    }
}
