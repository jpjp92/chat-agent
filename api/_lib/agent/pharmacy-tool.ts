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

            // 1, 2페이지(총 200건) 병렬 조회로 지연 시간 단축
            const baseQs = {
                ...(sido ? { Q0: sido } : {}),
                ...(sigungu ? { Q1: sigungu } : {}),
                numOfRows: '100',
            };
            const url1 = `https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire?serviceKey=${PHARM_KEY}&${new URLSearchParams({ ...baseQs, pageNo: '1' })}`;
            const url2 = `https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire?serviceKey=${PHARM_KEY}&${new URLSearchParams({ ...baseQs, pageNo: '2' })}`;

            // Promise.allSettled로 하나가 실패해도 다른 하나의 결과를 살림
            const responses = await Promise.allSettled([httpsGet(url1), httpsGet(url2)]);

            let allItems: any[] = [];
            let totalCount = 0;

            if (responses[0].status === 'fulfilled') {
                const res1 = parseXmlItems(responses[0].value);
                allItems = allItems.concat(res1.items);
                totalCount = res1.totalCount;
            }

            // 전체 데이터가 100건을 초과할 때만 2페이지 결과 병합 (중복 방지)
            if (responses[1].status === 'fulfilled' && totalCount > 100) {
                const res2 = parseXmlItems(responses[1].value);
                allItems = allItems.concat(res2.items);
            }

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

            // 영업중 우선 정렬, 상위 20개 선택
            const pharmacies = allItems.map((p: any) => {
                const s = p[`dutyTime${todayIdx}s`] || '';
                const c = p[`dutyTime${todayIdx}c`] || '';
                const isOpen = s && c ? (curTime >= parseInt(s) && curTime <= parseInt(c)) : false;
                return {
                    name: p.dutyName,
                    address: p.dutyAddr,
                    phone: p.dutyTel1,
                    lat: parseFloat(p.wgs84Lat) || 0,
                    lon: parseFloat(p.wgs84Lon) || 0,
                    hours_today: range(s, c),
                    is_open_now: isOpen,
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

            // 영업중 먼저, 그 다음 가나다순
            pharmacies.sort((a, b) => {
                if (a.is_open_now !== b.is_open_now) return a.is_open_now ? -1 : 1;
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
            sigungu: z.string().optional().describe("약국이 위치한 '시/군/구'의 명칭. **[주의]** '전주시 덕진구', '수원시 영통구'처럼 '시'와 '구'가 합쳐진 지명인 경우, 앞의 '시'를 반드시 제외하고 '덕진구', '영통구' 처럼 최종 '구' 단위만 입력해야 합니다! (예: '창원시 성산구' -> '성산구', '전주 완산구' -> '완산구')"),
            keyword: z.string().optional().describe("사용자가 특정한 동 이름(예: '중화산동'), 약국 이름(예: '종로약국'), 또는 세부 주소를 명시한 경우 그 키워드를 입력하세요. 없으면 생략합니다."),
            current_time_kst: z.string().optional().describe("한국 표준시 기준 현재 요일 및 시간 (예: 월요일 14:30). 영업중 여부 판단에 사용됩니다."),
        }),
    }
);

