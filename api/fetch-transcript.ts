async function fetchTranscript(videoId: string) {
  const pageController = new AbortController();
  const pageTimeout = setTimeout(() => pageController.abort(), 25000);
  let html: string;
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: pageController.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    html = await response.text();
  } finally {
    clearTimeout(pageTimeout);
  }

  // Regex to extract captionTracks directly without JSON.parse the whole document
  const captionRegex = /"captionTracks":(\[.*?\])/;
  const match = html.match(captionRegex);
  
  if (!match || match.length < 2) {
      throw new Error('No transcript tracks found for this video.');
  }

  let captionTracks;
  try {
     // Match group 1 is just the list of tracks
     captionTracks = JSON.parse(match[1]);
  } catch(e) {
     throw new Error('Failed to parse caption tracks array.');
  }

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('Caption tracks array is empty.');
  }

  // Prefer Korean, then English, then fallback
  const track = captionTracks.find((t: any) => t.languageCode === 'ko' || t.languageCode === 'en') || captionTracks[0];

  // Fetch XML (less likely to be truncated than JSON block)
  const xmlController = new AbortController();
  const xmlTimeout = setTimeout(() => xmlController.abort(), 15000);
  let transcriptXml: string;
  try {
    const transcriptResponse = await fetch(track.baseUrl, { signal: xmlController.signal });
    transcriptXml = await transcriptResponse.text();
  } finally {
    clearTimeout(xmlTimeout);
  }

  const transcript = [];
  const regex = /<text\s+start="([\d.]+)"\s+(?:dur="([\d.]+)"\s+)?[^>]*>(.*?)<\/text>/g;
  let textMatch;

  const decodeHtmlEntities = (text: string) => {
    return text.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&#x27;/g, "'");
  };

  while ((textMatch = regex.exec(transcriptXml)) !== null) {
    transcript.push({
      offset: parseFloat(textMatch[1]),
      duration: textMatch[2] ? parseFloat(textMatch[2]) : 0,
      text: decodeHtmlEntities(textMatch[3]),
    });
  }

  if (transcript.length === 0) {
    throw new Error('Failed to extract text from XML transcript.');
  }

  return transcript;
}

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    let body;
    try {
        body = await req.json();
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    const { videoId } = body;
    if (!videoId) return new Response(JSON.stringify({ error: 'Video ID is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    try {
        const transcript = await fetchTranscript(videoId);

        // Combine into a single text block
        let fullText = '';
        let currentChunkIndex = -1;
        const chunkSizeInSeconds = 60; // 1-minute chunks

        const minOffset = transcript[0]?.offset || 0;

        for (const t of transcript) {
            const rawOffsetInSeconds = Math.max(0, t.offset - minOffset);
            const chunkIndex = Math.floor(rawOffsetInSeconds / chunkSizeInSeconds);
            
            if (chunkIndex > currentChunkIndex) {
                currentChunkIndex = chunkIndex;
                const minutes = Math.floor(rawOffsetInSeconds / 60);
                const seconds = Math.floor(rawOffsetInSeconds % 60);
                const timeString = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
                fullText += `\n\n${timeString}\n`;
            }
            fullText += t.text + ' ';
        }

        fullText = fullText.trim();

        return new Response(JSON.stringify({ transcript: fullText }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error: any) {
        console.error('Transcript fetch failed:', error.message);
        return new Response(JSON.stringify({ error: 'Transcript unavailable', details: error.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
}
