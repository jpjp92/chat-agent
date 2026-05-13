import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 행정안전부_동물_동물병원 조회서비스
// Endpoint: /1741000/animal_hospitals/info
// returnType=JSON 지원 → XML 파싱 불필요
// Note: apis.data.go.kr → native fetch + AbortController (hospital B551182와 동일 패턴)
const VET_KEY = process.env.VET_KEY || '';

async function fetchJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        const text = await res.text();

        if (!res.ok) {
            throw new Error(`동물병원 API HTTP 오류: ${res.status}`);
        }

        try {
            return JSON.parse(text);
        } catch {
            const excerpt = text.replace(/\s+/g, ' ').slice(0, 120);
            throw new Error(`동물병원 API JSON 파싱 실패${excerpt ? `: ${excerpt}` : ''}`);
        }
    } finally {
        clearTimeout(timer);
    }
}

function assertApiSuccess(data: any) {
    const header = data?.response?.header;
    const code = String(header?.resultCode ?? header?.resultCd ?? '').trim();
    const message = header?.resultMsg || header?.resultMessage || '알 수 없는 오류';

    if (code && code !== '00' && code !== '0' && code.toUpperCase() !== 'NORMAL_CODE' && code.toUpperCase() !== 'INFO-000') {
        throw new Error(`동물병원 API 오류: ${message} (${code})`);
    }
}

// 단일 item 또는 배열 모두 처리 (totalCount=1 시 단일 객체 반환 API 특성)
function extractItems(data: any): any[] {
    const raw = data?.response?.body?.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

type AddressField = 'ROAD_NM_ADDR' | 'LOTNO_ADDR';

function uniqueNonEmpty(values: Array<string | undefined>) {
    return [...new Set(values.map(v => v?.trim()).filter((v): v is string => !!v))];
}

function getDongKeywords(dongName?: string) {
    if (!dongName) return [];
    const baseName = dongName.replace(/동$/, '').trim();
    return uniqueNonEmpty([
        dongName,
        baseName.length >= 2 ? baseName : undefined,
    ]);
}

export const vetTool = tool(
    async ({ sido, sigungu, dong_name, hospital_name }: {
        sido?: string;
        sigungu?: string;
        dong_name?: string;
        hospital_name?: string;
    }) => {
        try {
            const cleanSido = sido?.trim();
            let cleanSigungu = sigungu?.trim();
            const cleanDongName = dong_name?.trim();
            const cleanHospitalName = hospital_name?.trim();

            // 공공데이터 주소 LIKE는 "전주시 덕진구"처럼 복합 시군구가 들어오면 0건이 나기 쉬움.
            // 약국/병원 도구와 동일하게 마지막 구 단위로 정규화한다.
            if (cleanSigungu && cleanSigungu.includes(' ')) {
                const parts = cleanSigungu.split(/\s+/);
                cleanSigungu = parts[parts.length - 1];
                console.log(`[VetTool] sigungu 변환: ${sigungu} -> ${cleanSigungu}`);
            }

            const areaAddrQuery = [cleanSido, cleanSigungu].filter(Boolean).join(' ').trim();
            const fullAddrQuery = [cleanSido, cleanSigungu, cleanDongName].filter(Boolean).join(' ').trim();
            const locationLabel = [cleanSido, cleanSigungu, cleanDongName, cleanHospitalName].filter(Boolean).join(' ').trim();
            const dongKeywords = getDongKeywords(cleanDongName);

            console.log(`[VetTool] area="${areaAddrQuery}" dong="${cleanDongName || ''}" name="${cleanHospitalName || ''}"`);

            if (!VET_KEY) {
                return `동물병원 API 키가 설정되어 있지 않습니다. [지시사항]: VET_KEY 환경변수 설정이 필요하다고 사용자에게 안내해 주세요.`;
            }

            if (!areaAddrQuery && !cleanDongName && !cleanHospitalName) {
                return `동물병원을 검색하려면 지역명이나 병원명이 필요합니다. [지시사항]: 사용자에게 시/군/구 또는 동 이름을 포함해 다시 요청해 달라고 짧게 안내해 주세요.`;
            }

            const buildUrl = (withStatus: boolean, address?: { field: AddressField; query: string }) => {
                // serviceKey는 이미 URL 인코딩된 값이므로 URLSearchParams 바깥에서 직접 삽입
                // URLSearchParams에 넣으면 이중 인코딩(%2F → %252F)이 발생해 Unauthorized 오류
                const qs = new URLSearchParams();
                qs.set('pageNo', '1');
                qs.set('numOfRows', '300');
                qs.set('returnType', 'JSON');
                if (address?.query) qs.set(`cond[${address.field}::LIKE]`, address.query);
                if (cleanHospitalName) qs.set('cond[BPLC_NM::LIKE]', cleanHospitalName);
                if (withStatus) qs.set('cond[SALS_STTS_CD::EQ]', '01');
                return `https://apis.data.go.kr/1741000/animal_hospitals/info?serviceKey=${VET_KEY}&${qs}`;
            };

            const fetchItems = async (field?: AddressField, query?: string) => {
                const address = field && query ? { field, query } : undefined;
                const openData = await fetchJson(buildUrl(true, address));
                assertApiSuccess(openData);
                let rows = extractItems(openData);

                // 영업중 0건 → 전체 상태(휴업 포함)로 재조회
                if (rows.length === 0 && (query || cleanHospitalName || cleanDongName)) {
                    const allStatusData = await fetchJson(buildUrl(false, address));
                    assertApiSuccess(allStatusData);
                    rows = extractItems(allStatusData);
                }

                return rows;
            };

            const fetchFirstNonEmpty = async (field: AddressField, queries: string[]) => {
                for (const query of queries) {
                    const rows = await fetchItems(field, query);
                    if (rows.length > 0) {
                        if (query !== queries[0]) console.log(`[VetTool] ${field} fallback query="${query}"`);
                        return rows;
                    }
                }
                return [];
            };

            const roadQueries = uniqueNonEmpty([
                areaAddrQuery,
                cleanSigungu,
                cleanDongName,
            ]);
            let items = roadQueries.length > 0
                ? await fetchFirstNonEmpty('ROAD_NM_ADDR', roadQueries)
                : await fetchItems();
            let notice = '';

            if (cleanDongName) {
                const matchesDong = (h: any) =>
                    dongKeywords.some(keyword =>
                        `${h.ROAD_NM_ADDR || ''} ${h.LOTNO_ADDR || ''}`.toLowerCase().includes(keyword.toLowerCase())
                    );
                const dongFiltered = items.filter(matchesDong);

                if (dongFiltered.length > 0) {
                    items = dongFiltered;
                } else {
                    const lotnoQueries = uniqueNonEmpty([
                        fullAddrQuery,
                        [cleanSigungu, cleanDongName].filter(Boolean).join(' '),
                        cleanDongName,
                        ...dongKeywords.map(keyword => [cleanSigungu, keyword].filter(Boolean).join(' ')),
                        ...dongKeywords,
                    ]);
                    const lotnoItems = await fetchFirstNonEmpty('LOTNO_ADDR', lotnoQueries);
                    const lotnoFiltered = lotnoItems.filter(matchesDong);

                    if (lotnoFiltered.length > 0) {
                        items = lotnoFiltered;
                    } else if (items.length > 0 && areaAddrQuery) {
                        notice = `${cleanDongName} 동 단위 일치 결과가 없어 ${areaAddrQuery} 범위 결과를 표시합니다.`;
                    } else {
                        items = [];
                    }
                }
            }

            if (items.length === 0) {
                return `${locationLabel || '해당 지역'} 동물병원 정보를 찾을 수 없습니다. [지시사항]: 제공된 search_web 툴을 사용하여 해당 지역의 동물병원을 검색한 후, 사용자에게 텍스트로 친절하게 안내해 주세요.`;
            }

            // 가나다순 정렬 (운영시간 데이터 없음)
            items.sort((a, b) => (a.BPLC_NM || '').localeCompare(b.BPLC_NM || '', 'ko'));

            const top10 = items.slice(0, 10).map((h: any) => {
                const ymd = h.LCPMT_YMD || '';
                const licenseDate = ymd.length === 8
                    ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
                    : '';
                return {
                    name: h.BPLC_NM || '',
                    address: h.ROAD_NM_ADDR || h.LOTNO_ADDR || '',
                    phone: (h.TELNO || '').replace(/\s/g, ''),
                    status: h.SALS_STTS_NM || '',
                    status_detail: h.DTL_SALS_STTS_NM || '',
                    license_date: licenseDate,
                };
            });

            const jsonPayload = JSON.stringify({
                query: locationLabel,
                notice,
                count: top10.length,
                vets: top10
            });

            return `동물병원 검색에 성공했습니다. [지시사항]: 아래의 마크다운 코드 블록을 토씨 하나 틀리지 말고 그대로 출력하세요. 다른 부가 설명이나 텍스트 목록은 절대 생성하지 마세요.\n\n\`\`\`json:vet\n${jsonPayload}\n\`\`\``;

        } catch (error: any) {
            console.error('[VetTool] Exception:', error);
            return `오류 발생: ${error.message}`;
        }
    },
    {
        name: "vetTool",
        description: `전국 동물병원(동물의료기관) 위치 정보를 검색합니다. 행정안전부 인허가 데이터 기반. 영업 중인 동물병원을 우선 조회합니다.
이 툴은 \`\`\`json:vet 로 시작하는 마크다운 블록을 반환합니다. LLM은 툴이 반환한 텍스트를 절대로 수정하거나 요약하지 말고 그대로 출력해야 프론트엔드 카드가 정상 작동합니다.`,
        schema: z.object({
            sido: z.string().optional().describe("동물병원이 위치한 시/도 (예: '서울특별시', '경기도'). 사용자가 구/동만 언급해도 정확한 시/도를 유추해 입력."),
            sigungu: z.string().optional().describe("시/군/구 명칭 (예: '강남구', '수원시'). '전주시 덕진구' 처럼 공백 포함 시 최종 구 단위만 입력 — '덕진구'."),
            dong_name: z.string().optional().describe("읍/면/동 명칭 (예: '역삼동', '중화산동'). 사용자가 동 단위를 명시한 경우에만 입력."),
            hospital_name: z.string().optional().describe("특정 동물병원 이름 키워드 (예: '우리동물병원'). 없으면 생략."),
        }),
    }
);
