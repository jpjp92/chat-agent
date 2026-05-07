import { tool } from "@langchain/core/tools";
import { z } from "zod";
import https from "https";

// 국립중앙의료원 전국약국정보조회서비스
// Endpoint: getParmacyListInfoInqire (시도/시군구 기반 목록 조회)
// Note: node fetch hangs on apis.data.go.kr TLS → use https module
const PHARM_KEY = process.env.PHARM_KEY || '';  // Encoding key

/** Node https 모듈로 GET 요청 */
function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

/** XML에서 <tag>value</tag> 패턴 파싱 */
function parseXmlItems(xml: string): { totalCount: number; items: any[] } {
    const totalMatch = xml.match(/<totalCount>(\d+)<\/totalCount>/);
    const totalCount = totalMatch ? parseInt(totalMatch[1]) : 0;
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    const items = itemBlocks.map(m => {
        const fields: Record<string, string> = {};
        for (const [, tag, val] of m[1].matchAll(/<([^>/\s]+)>([^<]*)<\/\1>/g)) {
            fields[tag] = val.trim();
        }
        return fields;
    });
    return { totalCount, items };
}

/** HHMM 형식 → HH:MM */
const fmt = (t: string) => t && t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : (t || '');
/** 영업 시간 범위 문자열 생성 */
const range = (s: string, c: string) => s ? `${fmt(s)}~${fmt(c)}` : '휴무';

export const pharmacyTool = tool(
    async ({ sido, sigungu, keyword, current_time_kst }: { sido: string; sigungu?: string; keyword?: string; current_time_kst?: string }) => {
        try {
            console.log(`[PharmacyTool] LLM Parsed - 시도: ${sido}, 시군구: ${sigungu || '(없음)'}, 키워드: ${keyword || '(없음)'}`);

            // 현재 시간 계산
            const now = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Seoul' }));
            const weekday = now.getDay(); // 0=sun,1=mon..6=sat
            const dayMap: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 0: 7 };
            const todayIdx = dayMap[weekday];
            const curTime = parseInt(now.toTimeString().slice(0, 5).replace(':', ''));

            // API는 '전주시 완산구' 처럼 시와 구가 결합된 형태를 인식하지 못함 (0건 반환).
            // 띄어쓰기가 있다면 무조건 마지막 단어('완산구')만 추출하여 사용.
            let cleanSigungu = sigungu?.trim();
            if (cleanSigungu && cleanSigungu.includes(' ')) {
                const parts = cleanSigungu.split(/\s+/);
                cleanSigungu = parts[parts.length - 1];
                console.log(`[PharmacyTool] sigungu 변환: ${sigungu} -> ${cleanSigungu} (API 인식 오류 방지)`);
            }

            // 1페이지에 최대 1000건을 한 번에 조회하여 넓은 구역(예: 전주시 전체)도 누락 없이 커버
            const baseQs = {
                ...(sido ? { Q0: sido } : {}),
                ...(cleanSigungu ? { Q1: cleanSigungu } : {}),
                numOfRows: '1000',
                pageNo: '1',
            };
            const url = `https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire?serviceKey=${PHARM_KEY}&${new URLSearchParams(baseQs)}`;

            const xmlResponse = await httpsGet(url);
            let { items: allItems } = parseXmlItems(xmlResponse);

            // 키워드(동, 약국명 등) 필터링
            if (keyword) {
                const kw = keyword.toLowerCase().trim();
                allItems = allItems.filter(p => 
                    (p.dutyName && p.dutyName.toLowerCase().includes(kw)) || 
                    (p.dutyAddr && p.dutyAddr.toLowerCase().includes(kw))
                );
            }

            const locationLabel = `${sido} ${sigungu || ''} ${keyword || ''}`.trim();
            if (allItems.length === 0) {
                return `${locationLabel} 지역의 약국 정보를 찾을 수 없습니다. [지시사항]: 제공된 search_web 툴을 사용하여 해당 지역의 영업 중인 약국을 검색한 후, 사용자에게 텍스트로 친절하게 안내해 주세요.`;
            }

            // 영업중 및 주말/공휴일 영업 여부에 따른 가중치 점수 부여
            const pharmacies = allItems.map((p: any) => {
                const s = p[`dutyTime${todayIdx}s`] || '';
                const c = p[`dutyTime${todayIdx}c`] || '';
                const isOpen = s && c ? (curTime >= parseInt(s) && curTime <= parseInt(c)) : false;

                const hasSat = !!p.dutyTime6s;
                const hasSun = !!p.dutyTime7s;
                const hasHol = !!p.dutyTime8s;

                let score = 0;
                if (isOpen) score += 100;       // 1순위: 현재 영업중 (압도적 가중치)
                if (hasSun || hasHol) score += 20; // 2순위: 일/공휴일 지킴이 약국
                if (hasSat) score += 10;        // 3순위: 토요일 영업 약국

                return {
                    name: p.dutyName,
                    address: p.dutyAddr,
                    phone: p.dutyTel1,
                    lat: parseFloat(p.wgs84Lat) || 0,
                    lon: parseFloat(p.wgs84Lon) || 0,
                    hours_today: range(s, c),
                    is_open_now: isOpen,
                    score: score,
                    hours: {
                        mon: range(p.dutyTime1s, p.dutyTime1c),
                        tue: range(p.dutyTime2s, p.dutyTime2c),
                        wed: range(p.dutyTime3s, p.dutyTime3c),
                        thu: range(p.dutyTime4s, p.dutyTime4c),
                        fri: range(p.dutyTime5s, p.dutyTime5c),
                        sat: range(p.dutyTime6s, p.dutyTime6c),
                        sun: range(p.dutyTime7s, p.dutyTime7c),
                        holiday: range(p.dutyTime8s, p.dutyTime8c),
                    }
                };
            });

            // 점수 내림차순 (영업중 > 일휴일 > 토요일) -> 동점 시 가나다순 정렬
            pharmacies.sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                return a.name.localeCompare(b.name, 'ko');
            });

            const top10 = pharmacies.slice(0, 10);

            const jsonPayload = JSON.stringify({
                query: locationLabel,
                count: top10.length,
                pharmacies: top10
            });

            return `약국 검색에 성공했습니다. [지시사항]: 아래의 마크다운 코드 블록을 토씨 하나 틀리지 말고 그대로 출력하세요. 다른 부가 설명이나 텍스트 목록은 절대 생성하지 마세요.\n\n\`\`\`json:pharmacy\n${jsonPayload}\n\`\`\``;

        } catch (error: any) {
            console.error('[PharmacyTool] Exception:', error);
            return `오류 발생: ${error.message}`;
        }
    },
    {
        name: "pharmacyTool",
        description: `전국 약국 위치, 영업시간 정보를 검색합니다. 시도(sido)와 시군구(sigungu) 값을 반드시 분리해서 전달해야 합니다. (예: sido="경기도", sigungu="일산동구")
이 툴은 \`\`\`json:pharmacy 로 시작하는 완전한 마크다운 블록을 반환합니다. 당신(LLM)은 툴이 반환한 텍스트를 절대로 수정하거나 요약하지 말고, 그대로 화면에 출력해야만 프론트엔드 UI 카드가 정상 작동합니다. 환각(거짓 정보)을 만들어내지 마세요.`,
        schema: z.object({
            sido: z.string().describe("약국이 위치한 '시/도'의 공식 명칭 (예: 서울특별시, 경기도, 전북특별자치도, 강원특별자치도 등). 사용자가 '전주 덕진구'나 '동탄'처럼 시/도를 생략해도, 올바른 공식 시/도 명칭을 유추해서 반드시 입력해야 합니다."),
            sigungu: z.string().optional().describe("약국이 위치한 '시/군/구'의 명칭. **[주의]** '전주시 덕진구', '수원시 영통구'처럼 '시'와 '구'가 합쳐진 지명인 경우, 앞의 '시'를 제외하고 '덕진구' 처럼 최종 '구' 단위만 입력하세요. 단, 사용자가 '구'를 언급하지 않고 '전주', '수원' 등 '시'만 말한 경우에는 해당 시 이름 전체(예: '전주시', '수원시')를 입력하세요."),
            keyword: z.string().optional().describe("사용자가 특정한 동 이름(예: '중화산동'), 약국 이름(예: '종로약국'), 또는 세부 주소를 명시한 경우 그 키워드를 입력하세요. 없으면 생략합니다."),
            current_time_kst: z.string().optional().describe("한국 표준시 기준 현재 요일 및 시간 (예: 월요일 14:30). 영업중 여부 판단에 사용됩니다."),
        }),
    }
);

