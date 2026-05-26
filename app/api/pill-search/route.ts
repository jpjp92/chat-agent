import { NextRequest, NextResponse } from 'next/server';
import { searchPill } from '../../../api/_lib/pill-logic';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const { imprint_front, imprint_back, color, shape } = await req.json();
    try {
        const { match_type, filteredResults } = await searchPill({ imprint_front, imprint_back, color, shape });
        return NextResponse.json({ found: filteredResults.length > 0, match_type, results: filteredResults });
    } catch (error: any) {
        console.error('[Pill Search] Error:', error);
        return NextResponse.json({ error: 'Failed to search pill database' }, { status: 500 });
    }
}
