import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildCardToolOutput } from "./card-tool-output";

// 건강보험심사평가원_병원정보서비스 getHospBasisList
// Note: B551182 백엔드는 https 모듈에서 타임아웃 발생 → native fetch 사용
//       (pharmacy B552657은 반대로 native fetch hang → https 모듈 사용)
const HOSP_KEY = process.env.PHARM_KEY || '';

/**
 * 🔴 심평원(B551182) 백엔드는 간헐적으로 죽는다. 실측(2026-08-24): 같은 조회 5회 중 **2회가
 *    25초까지 완전 무응답**이었고 성공해도 10.2~10.8초였다(같은 시각 약국 B552657은 0.3초,
 *    동물병원 1741000은 0.22초 — 심평원만 그렇다). 단발 20초 시도로는 그대로 실패한다.
 *    한 번에 오래 기다리는 대신 **짧게 끊고 한 번 더** 시도한다 — 정상 응답(~11초)은 통과하고,
 *    죽은 호출은 13초에 잘라 재시도로 건진다. 최악 26초로 단발 20초보다 조금 길 뿐이다.
 */
/**
 * 심평원 병원 목록 조회의 1회 시도 제한.
 *
 * 🔴 13초는 절반이 잘린다. 종별 코드표를 고치자(§6.16) "서초구 의원" 이 5건·4KB(치과병원,
 * 잘못된 코드)에서 **986건·166KB** 로 바뀌었고 — 맞는 데이터가 40배 무겁다 — 응답 시간이
 * 그만큼 늘었다. 실측 8회(2026-08-31, 서초구 clCd=31 numOfRows=200):
 *   2.4 · 2.7 · 4.2 · 8.3 · 12.5 · 13.4 · 14.1 · 16.5 초 (중앙 12.5 · 최대 16.5)
 * 8회 중 3회가 13초를 넘겨 abort 됐고, 사용자 화면에는 "병원 정보를 불러오지 못했습니다"
 * 가 떴다. 최대 실측 + 여유로 25초를 준다(2회 시도라 최악 50초, maxDuration 300s 안이다).
 */
const HOSP_ATTEMPT_TIMEOUT_MS = 25000;

async function fetchXml(url: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HOSP_ATTEMPT_TIMEOUT_MS);
        try {
            const res = await fetch(url, { signal: controller.signal });
            const text = await res.text();
            // 200이어도 본문이 비어 오는 경우가 있다 — 그것도 실패로 보고 재시도한다.
            if (text.includes('<totalCount>') || attempt === 2) return text;
            console.warn('[HospitalTool] empty body, retrying');
        } catch (error) {
            lastError = error;
            if (attempt === 2) throw error;
            console.warn('[HospitalTool] attempt 1 failed, retrying:', (error as Error)?.name);
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError ?? new Error('hospital API unavailable');
}

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

// 시도명 → sidoCd (curl 실측 검증값)
const SIDO_CODE: Record<string, string> = {
    '서울': '110000', '서울특별시': '110000',
    '부산': '210000', '부산광역시': '210000',
    '인천': '220000', '인천광역시': '220000',
    '대구': '230000', '대구광역시': '230000',
    '광주': '240000', '광주광역시': '240000',
    '대전': '250000', '대전광역시': '250000',
    '울산': '260000', '울산광역시': '260000',
    '경기': '310000', '경기도': '310000',
    '강원': '320000', '강원도': '320000', '강원특별자치도': '320000',
    '충북': '330000', '충청북도': '330000',
    '충남': '340000', '충청남도': '340000',
    '전북': '350000', '전라북도': '350000', '전북특별자치도': '350000',
    '전남': '360000', '전라남도': '360000',
    '경북': '370000', '경상북도': '370000',
    '경남': '380000', '경상남도': '380000',
    '제주': '390000', '제주특별자치도': '390000',
    '세종': '410000', '세종특별자치시': '410000',
};

// sgguCd 매핑 (curl 실측값 — 약국과 동일한 API 레벨 필터 방식)
// 비서울 대도시는 API가 '부산해운대구' 처럼 시 이름 포함해 반환
const SGGU_CODE: Record<string, string> = {
    // 서울 (110xxx)
    '강남구': '110001', '강동구': '110002', '강서구': '110003',
    '관악구': '110004', '구로구': '110005', '도봉구': '110006',
    '동대문구': '110007', '동작구': '110008', '마포구': '110009',
    '서대문구': '110010', '성동구': '110011', '성북구': '110012',
    '영등포구': '110013', '용산구': '110014', '은평구': '110015',
    '종로구': '110016', '중구': '110017', '송파구': '110018',
    '중랑구': '110019', '양천구': '110020', '서초구': '110021',
    '노원구': '110022', '광진구': '110023', '강북구': '110024',
    '금천구': '110025',
    // 부산 (210xxx)
    '부산남구': '210001', '부산동구': '210002', '부산동래구': '210003',
    '부산진구': '210004', '부산북구': '210005', '부산서구': '210006',
    '부산영도구': '210007', '부산중구': '210008', '부산해운대구': '210009',
    '부산연제구': '210013', '부산수영구': '210014', '부산사상구': '210015',
    '부산기장군': '210100',
    // 인천 (220xxx)
    '인천미추홀구': '220001', '인천동구': '220002', '인천부평구': '220003',
    '인천중구': '220004', '인천서구': '220005', '인천남동구': '220006',
    '인천연수구': '220007', '인천계양구': '220008', '인천강화군': '220100',
    // 대구 (230xxx)
    '대구남구': '230001', '대구동구': '230002', '대구북구': '230003',
    '대구서구': '230004', '대구수성구': '230005', '대구중구': '230006',
    '대구달서구': '230007',
    // 광주 (240xxx)
    '광주동구': '240001', '광주북구': '240002', '광주서구': '240003',
    '광주광산구': '240004', '광주남구': '240005',
    // 대전 (250xxx)
    '대전유성구': '250001', '대전대덕구': '250002', '대전서구': '250003',
    '대전동구': '250004', '대전중구': '250005',
    // 울산 (260xxx)
    '울산남구': '260001', '울산중구': '260003', '울산북구': '260004',
    '울산울주군': '260100',
    // 경기 (31xxxx)
    '광명시': '310100',
    '부천소사구': '310301', '부천오정구': '310302', '부천원미구': '310303',
    '성남수정구': '310401', '성남중원구': '310402', '성남분당구': '310403',
    '수원권선구': '310601', '수원장안구': '310602', '수원팔달구': '310603',
    '안양만안구': '310701',
    '의정부시': '310800',
    '구리시': '311000',
    '안산단원구': '311101', '안산상록구': '311102',
    '평택시': '311200', '군포시': '311400', '남양주시': '311500',
    '시흥시': '311700', '오산시': '311800',
    '고양덕양구': '311901', '고양일산서구': '311902', '고양일산동구': '311903',
    '용인기흥구': '312001', '용인처인구': '312003',
    '이천시': '312100', '파주시': '312200', '김포시': '312300',
    '안성시': '312400',
    '화성만세구': '312501', '화성병점구': '312503', '화성동탄구': '312504',
    '경기광주시': '312600', '포천시': '312800', '여주시': '312900',
    // 강원 (320xxx)
    '영월군': '320006', '홍천군': '320013',
    '강릉시': '320100', '동해시': '320200', '속초시': '320300',
    '원주시': '320400', '춘천시': '320500', '태백시': '320600', '삼척시': '320700',
    // 충북 (330xxx)
    '옥천군': '330005', '음성군': '330006', '진천군': '330009',
    '청주상당구': '330101', '청주흥덕구': '330102', '청주청원구': '330103', '청주서원구': '330104',
    '충주시': '330200', '제천시': '330300',
    // 충남 (340xxx)
    '예산군': '340012', '홍성군': '340015',
    '천안서북구': '340201', '천안동남구': '340202',
    '공주시': '340300', '보령시': '340400', '아산시': '340500',
    '서산시': '340600', '논산시': '340700', '당진시': '340900',
    // 전북 (350xxx)
    '고창군': '350001', '부안군': '350005',
    '군산시': '350100', '남원시': '350200', '익산시': '350300',
    '전주완산구': '350401', '전주덕진구': '350402',
    '정읍시': '350500',
    // 전남 (360xxx)
    '강진군': '360001', '고흥군': '360002', '무안군': '360009',
    '영광군': '360014', '장흥군': '360018', '해남군': '360021',
    '나주시': '360200', '목포시': '360300', '순천시': '360400',
    '여수시': '360500', '광양시': '360700',
    // 경북 (370xxx)
    '경주시': '370100', '구미시': '370200', '김천시': '370300',
    '안동시': '370400', '영주시': '370500', '영천시': '370600',
    '포항남구': '370701', '포항북구': '370702',
    '문경시': '370800', '상주시': '370900', '경산시': '371000',
    // 경남 (380xxx)
    '김해시': '380100', '진주시': '380500',
    '창원마산회원구': '380701', '창원마산합포구': '380702', '창원진해구': '380703',
    '창원의창구': '380704', '창원성산구': '380705',
    '통영시': '380800', '거제시': '381000', '양산시': '381100',
    // 제주 (390xxx)
    '서귀포시': '390100', '제주시': '390200',
};

// 기초자치단체(시) → 광역자치단체(도) 역매핑
// LLM이 sido_name을 도 대신 시 이름으로 넘기는 경우를 처리
const CITY_TO_SIDO: Record<string, string> = {
    // 경기도
    '전주시': '350000', '남원시': '350000', '군산시': '350000', '익산시': '350000', '정읍시': '350000',
    '청주시': '330000', '충주시': '330000', '제천시': '330000',
    '천안시': '340000', '공주시': '340000', '보령시': '340000', '아산시': '340000', '서산시': '340000', '논산시': '340000', '당진시': '340000',
    '수원시': '310000', '성남시': '310000', '의정부시': '310000', '안양시': '310000', '부천시': '310000',
    '광명시': '310000', '평택시': '310000', '시흥시': '310000', '군포시': '310000', '남양주시': '310000',
    '오산시': '310000', '고양시': '310000', '용인시': '310000', '이천시': '310000', '파주시': '310000',
    '김포시': '310000', '안성시': '310000', '화성시': '310000', '구리시': '310000', '포천시': '310000', '여주시': '310000',
    '안산시': '310000',
    // 강원
    '춘천시': '320000', '원주시': '320000', '강릉시': '320000', '동해시': '320000', '속초시': '320000',
    '태백시': '320000', '삼척시': '320000',
    // 경북
    '경주시': '370000', '구미시': '370000', '김천시': '370000', '안동시': '370000', '영주시': '370000',
    '영천시': '370000', '포항시': '370000', '문경시': '370000', '상주시': '370000', '경산시': '370000',
    // 경남
    '창원시': '380000', '진주시': '380000', '통영시': '380000', '거제시': '380000', '양산시': '380000', '김해시': '380000',
    // 전남
    '목포시': '360000', '여수시': '360000', '순천시': '360000', '나주시': '360000', '광양시': '360000',
};

// 병원 종별코드
/**
 * 진료과목 코드(`dgsbjtCd`) — **종별(`clCd`)과 다른 축이다.**
 *
 * 🔴 이게 없던 시절 진료과가 통째로 버려졌다(실측 2026-08-31, 사용자 로컬):
 * "서초구 소아과 알려줘" 에 모델이 소아과를 넣을 자리가 없어 `hospital_type='의원'` 으로
 * 바꿔 넣었고, 화면엔 **치과병원 4곳**이 나왔다. 종별 필드에 진료과를 밀어 넣으면
 * CL_CODE 에 없어 `clCd` 가 undefined 가 되거나, 엉뚱한 종별로 조회된다.
 *
 * ⚖️ **코드표는 추측하지 않았다.** 처음엔 기억으로 15개를 적었는데, 그건 §6.16 에서 잡은
 * 종별 코드 오류와 똑같은 짓이다(그때도 표가 한 칸 밀려 조용히 틀린 병원이 나갔다).
 * 이름 일치율로 역산해 보니 흔한 과일수록 판별이 안 됐다 — 코드 01 을 서울 의원 4,756곳이
 * 신고한다. 내과의원이 아닌 곳도 내과를 **부수 과목**으로 달기 때문이다.
 *
 * 그래서 `MadmDtlInfoService2.8/getDgsbjtInfo2.8`(병원별 진료과목 상세)에서 **직접 받았다**.
 * 큰 병원 몇 곳의 `ykiho` 로 조회하면 코드-이름 쌍이 그대로 나온다(43개 확정, 2026-08-31).
 * 같은 계정 키를 쓰므로 새 환경변수가 필요 없다.
 * (11 결과에 서울특별시어린이병원, 12 결과 상위 40 중 27개가 이름에 "안과" 를 포함한다)
 *
 * ⚖️ 종합병원이 상위에 오는 건 정상이다 — 실제로 그 과를 운영한다. 다만 사용자가 과 이름을
 *   대면 그 과의 **의원**을 기대하는 쪽이 많아, 이름이 일치하면 가산점을 준다(아래 정렬).
 */
const DGSBJT_CODE: Record<string, string> = {
    // 의과
    '내과': '01', '신경과': '02', '정신건강의학과': '03', '외과': '04', '정형외과': '05',
    '신경외과': '06', '심장혈관흉부외과': '07', '성형외과': '08', '마취통증의학과': '09',
    '산부인과': '10', '소아청소년과': '11', '안과': '12', '이비인후과': '13', '피부과': '14',
    '비뇨의학과': '15', '영상의학과': '16', '방사선종양학과': '17', '병리과': '18',
    '진단검사의학과': '19', '재활의학과': '21', '핵의학과': '22', '가정의학과': '23',
    '응급의학과': '24', '직업환경의학과': '25',
    // 치과
    '구강악안면외과': '50', '치과보철과': '51', '치과교정과': '52', '소아치과': '53',
    '치주과': '54', '치과보존과': '55', '구강내과': '56', '영상치의학과': '57',
    '구강병리과': '58', '예방치과': '59', '통합치의학과': '61',
    // 한방
    '한방내과': '80', '한방부인과': '81', '한방소아과': '82', '한방안·이비인후·피부과': '83',
    '한방신경정신과': '84', '침구과': '85', '한방재활의학과': '86', '사상체질과': '87',
    // 사람들이 실제로 쓰는 말 → 공식 명칭
    '소아과': '11', '소아정형외과': '11', '정신과': '03', '신경정신과': '03',
    '흉부외과': '07', '심장외과': '07', '비뇨기과': '15', '통증의학과': '09',
    '재활의학': '21', '가정의학': '23', '응급실': '24', '산과': '10', '부인과': '10',
    '교정치과': '52', '치아교정': '52', '한방소아청소년과': '82',
    // ⚠️ '한의원'·'한방병원'·'의원' 은 **종별**(CL_CODE)이지 진료과가 아니다. 여기 넣으면
    //    라벨 로직이 종별을 지우고(카드 제목이 "서초구 병원 검색" 이 된다) 엉뚱한 과로 조회한다.
};


/**
 * 종별 코드(`clCd`).
 *
 * 🔴 표의 절반이 **틀려 있었다**(실측 2026-08-31, 심평원 응답의 `clCdNm` 과 대조):
 *   `의원 → 41` 은 실제로 **치과병원**이고, `치과병원 → 51` 은 **치과의원**,
 *   `치과의원 → 61` 은 **조산원**, `한의원 → 92` 는 **한방병원**, `정신병원 → 31` 은 **의원** 이었다.
 * 뒤쪽이 통째로 한 칸씩 밀려 있었다. 사용자가 "서초구 의원" 을 물으면 **치과병원 5곳**이
 * 나왔다(스크린샷으로 확인). 조용히 틀린 결과를 주는 종류라 오래 남아 있었다.
 *
 * 아래는 서울(sidoCd=110000) 응답의 `clCdNm` 으로 하나씩 확인한 값이다:
 *   01 상급종합 · 11 종합병원 · 21 병원 · 28 요양병원 · 29 정신병원 · 31 의원 ·
 *   41 치과병원 · 51 치과의원 · 61 조산원 · 71 보건소 · 72 보건지소 · 92 한방병원 · 93 한의원
 */
const CL_CODE: Record<string, string> = {
    '상급종합병원': '01', '상급종합': '01', '대학병원': '01',
    '종합병원': '11', '병원': '21', '요양병원': '28', '정신병원': '29',
    '의원': '31', '치과병원': '41', '치과의원': '51', '치과': '51',
    '조산원': '61', '보건소': '71', '보건지소': '72',
    '한방병원': '92', '한의원': '93',
};

/**
 * sgguCd 찾기
 * 1) 직접 매핑 (예: '강남구' → 110001)
 * 2) sidoCd 앞 3자리 기준으로 key가 sigunguName으로 끝나는 항목 검색
 *    (예: sidoCd=210000, sigunguName='해운대구' → '부산해운대구' → 210009)
 */
function findSgguCd(sidoCd: string, sigunguName: string): string | undefined {
    if (SGGU_CODE[sigunguName]) return SGGU_CODE[sigunguName];
    const prefix = sidoCd.slice(0, 3);
    // suffix matching: "해운대구" → '부산해운대구' 처럼 시 prefix 붙은 키 탐색
    for (const [key, code] of Object.entries(SGGU_CODE)) {
        if (code.startsWith(prefix) && key.endsWith(sigunguName)) return code;
    }
    // "전주시 덕진구" 형태로 들어온 경우: 마지막 토큰으로 재시도
    const lastToken = sigunguName.split(/\s+/).pop();
    if (lastToken && lastToken !== sigunguName) return findSgguCd(sidoCd, lastToken);
    return undefined;
}

/**
 * 카드에 표시된 주소 문자열에서 심평원 지역 코드를 되찾는다. 후속 턴의 진료시간 조회
 * (hospital-hours)가 기본목록을 1건 재조회할 때 sidoCd가 필요한데, 그 턴에는 원래
 * 도구 인자가 남아 있지 않고 카드 주소만 있다.
 */
export function resolveAreaCodesFromAddress(address: string): { sidoCd: string; sgguCd?: string } | undefined {
    const tokens = address.trim().split(/\s+/);
    if (tokens.length === 0) return undefined;

    const sidoName = tokens[0];
    const sidoCd = SIDO_CODE[sidoName]
        ?? SIDO_CODE[sidoName.replace(/특별시|광역시|특별자치시|특별자치도|도$/, '').trim()]
        ?? CITY_TO_SIDO[sidoName];

    // 🔴 카드 주소가 늘 시도로 시작하지는 않는다. 실측(2026-08-24): 서울 병원은 API가
    //    `광진구 천호대로 536`처럼 시도를 빼고 준다. 시군구 코드에서 시도를 역산한다
    //    (앞 3자리가 시도 — 110023 → 110000, 350402 → 350000).
    if (!sidoCd) {
        const sgguToken = tokens.find(token => SGGU_CODE[token]);
        if (!sgguToken) return undefined;
        const code = SGGU_CODE[sgguToken];
        return { sidoCd: `${code.slice(0, 3)}000`, sgguCd: code };
    }

    // "전북특별자치도 전주시 덕진구" — 구가 있으면 구, 없으면 시/군이 시군구 단위다.
    const gu = tokens.slice(1).find(token => token.endsWith('구'));
    const siGun = tokens.slice(1).find(token => /(시|군)$/.test(token));
    const sigunguName = gu ?? siGun;
    return { sidoCd, sgguCd: sigunguName ? findSgguCd(sidoCd, sigunguName) : undefined };
}

const fmtDate = (d: string) =>
    d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : '';

export const hospitalTool = tool(
    async ({ sido_name, sigungu_name, dong_name, hospital_name, hospital_type, subject }: {
        sido_name: string;
        sigungu_name?: string;
        dong_name?: string;
        hospital_name?: string;
        hospital_type?: string;
        subject?: string;
    }) => {
        try {
            const sidoCd = SIDO_CODE[sido_name]
                ?? SIDO_CODE[sido_name.replace(/특별시|광역시|특별자치시|특별자치도|도$/, '').trim()]
                ?? CITY_TO_SIDO[sido_name]; // LLM이 시(市) 이름을 sido_name으로 넘긴 경우 fallback

            if (!sidoCd) return `${sido_name} 지역의 시도 코드를 찾을 수 없습니다.`;

            const clCd = hospital_type ? (CL_CODE[hospital_type] ?? undefined) : undefined;
            // 🔴 모델이 진료과를 hospital_type 으로 잘못 넣는 경우를 여기서 건진다. 종별 코드가
            //   안 나왔는데 진료과 코드가 나오면, 그건 진료과를 종별 자리에 넣은 것이다.
            // 모델이 진료과를 hospital_type 으로 잘못 넣는 경우를 여기서 건진다. 종별 코드가
            // 안 나왔는데 그 값이 진료과처럼 보이면, 그건 진료과를 종별 자리에 넣은 것이다.
            const rawSubject = subject?.trim() || (!clCd && hospital_type?.trim()) || '';
            const dgsbjtCd = rawSubject ? DGSBJT_CODE[rawSubject] : undefined;
            // 🔴 표에 없는 과라고 **버리지 않는다** — 그게 원래 결함이었다("소아과" 가 통째로
            //   증발해 치과병원이 나왔다). 코드가 없으면 이름으로 거른다. 놓치는 게 있지만
            //   (간판에 과가 없는 곳) 엉뚱한 병원을 근거처럼 내미는 것보다 낫다.
            const subjectName = dgsbjtCd ? rawSubject : undefined;
            const nameFilter = !dgsbjtCd && rawSubject && !CL_CODE[rawSubject] ? rawSubject : undefined;
            // 라벨용 종별 — 모델이 종별 자리에 진료과를 넣었다면 그건 subjectName 이 이미 갖고 있다
            const typeLabel = hospital_type && DGSBJT_CODE[hospital_type.trim()] ? undefined : hospital_type;
            const subjectLabel = subjectName ?? nameFilter;
            const sgguCd = sigungu_name ? findSgguCd(sidoCd, sigungu_name.trim()) : undefined;
            const useSgguFilter = !!sgguCd;

            // sgguCd API 필터 가능: 소규모 응답 → 약국과 동일 패턴
            // sgguCd 없음: 전체 sido 조회 후 addr 텍스트 필터
            const numOfRows = useSgguFilter || hospital_name ? '200' : '100';


            const baseQs: Record<string, string> = { sidoCd, numOfRows, pageNo: '1' };
            if (sgguCd) baseQs.sgguCd = sgguCd;
            if (hospital_name) baseQs.yadmNm = hospital_name;
            if (clCd) baseQs.clCd = clCd;
            if (dgsbjtCd) baseQs.dgsbjtCd = dgsbjtCd;

            const url = `https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList?serviceKey=${HOSP_KEY}&${new URLSearchParams(baseQs)}`;
            const xml = await fetchXml(url);

            // 🔴 `<totalCount>`가 없으면 정상 응답이 아니다 — 0건이 아니라 **조회 실패**다.
            //    실측(2026-08-24): 심평원 백엔드가 느려지며 200 + 빈 본문을 돌려줬고, errMsg도 없어
            //    이 가드를 빠져나가 "광진구에 해당하는 병원 정보를 찾을 수 없습니다"로 표시됐다.
            //    일시적 장애를 "그런 병원이 없다"로 보고하면 사용자가 잘못된 결론을 내린다.
            // 실측(2026-08-24 09:07): 장애 시 `resultCode 99` + weblogic
            // `ResourceLimitException: No resources ... in pool dsOpenapi` — 심평원 서버의 DB
            // 커넥션 풀 고갈이다. 우리 키·쿼터 문제가 아니므로 원인 메시지를 그대로 남긴다.
            const errMatch = xml.match(/<errMsg>(.*?)<\/errMsg>/) ?? xml.match(/<resultMsg>(.*?)<\/resultMsg>/);
            if (!xml.includes('<totalCount>')) {
                console.warn('[HospitalTool] API error or empty body:', errMatch?.[1]?.slice(0, 160) ?? `len=${xml.length}`);
                return buildCardToolOutput('hospital', {
                    query: [sido_name, sigungu_name, dong_name, hospital_name, subjectLabel, typeLabel].filter(Boolean).join(' '),
                    count: 0, hospitals: [], notice: '병원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
                });
            }

            let { items: allItems } = parseXmlItems(xml);

            // sgguCd 매핑 실패 시 addr 텍스트 필터 fallback
            if (sigungu_name && !useSgguFilter) {
                allItems = allItems.filter(h => h.addr?.includes(sigungu_name.trim()));
            }
            // 동(洞) 필터: API에 읍면동 파라미터가 없으므로 addr 텍스트 필터
            if (dong_name) {
                allItems = allItems.filter(h => h.addr?.includes(dong_name.trim()));
            }
            // 코드 없는 진료과: 간판으로 거른다 ('재활의학과의원' → 이름에 '재활의학' 포함)
            if (nameFilter) {
                const stem = nameFilter.replace(/과$/, '');
                allItems = allItems.filter(h => h.yadmNm?.includes(stem));
            }

            const locationLabel = [sido_name, sigungu_name, dong_name, hospital_name, subjectLabel, typeLabel].filter(Boolean).join(' ').trim();

            if (allItems.length === 0) {
                // 🔴 "못 찾았다" 로 끝내면 사용자가 다음에 뭘 할지 모른다. 진료과를 물었는데
                //   0건이면 그건 **그 지역에 그 과가 없다**는 뜻이므로 그렇게 말하고, 범위를
                //   넓히라고 안내한다(구 → 시/도). 조회 실패와는 다른 상황이라 문구도 다르다.
                const area = [sido_name, sigungu_name, dong_name].filter(Boolean).join(' ');
                const notice = subjectLabel
                    ? `${area}에는 ${subjectLabel} 진료 기관이 검색되지 않았습니다. 인접 지역이나 더 넓은 범위(예: ${sigungu_name ? sido_name : '전국'})로 다시 찾아보세요.`
                    : `${locationLabel || '해당 조건'}에 해당하는 병원 정보를 찾을 수 없습니다.`;
                return buildCardToolOutput('hospital', {
                    query: locationLabel, count: 0, hospitals: [], notice,
                });
            }

            const hospitals = allItems.map((h: any) => ({
                name: h.yadmNm || '',
                address: h.addr || '',
                phone: h.telno || '',
                url: h.hospUrl || '',
                type: h.clCdNm || '',
                doctor_count: parseInt(h.drTotCnt) || 0,
                established: fmtDate(h.estbDd),
                lat: parseFloat(h.YPos) || 0,
                lon: parseFloat(h.XPos) || 0,
            }));

            // 진료과를 물었으면 그 과가 **간판인** 곳을 위로 올린다. dgsbjtCd 필터만으로는
            // 그 과를 운영하는 종합병원이 의사수 순으로 상위를 독식한다 — 틀린 결과는 아니지만
            // "소아과 알려줘" 에 대학병원 5곳이 나오는 건 사용자가 기대한 답이 아니다.
            const hitStem = (subjectName ?? nameFilter)?.replace(/과$/, '');
            const nameHit = hitStem ? (n: string) => n.includes(hitStem) : () => false;
            hospitals.sort((a, b) => {
                const ah = nameHit(a.name) ? 1 : 0, bh = nameHit(b.name) ? 1 : 0;
                if (ah !== bh) return bh - ah;
                return b.doctor_count !== a.doctor_count
                    ? b.doctor_count - a.doctor_count
                    : a.name.localeCompare(b.name, 'ko');
            });

            const top10 = hospitals.slice(0, 10);
            return buildCardToolOutput('hospital', { query: locationLabel, count: top10.length, hospitals: top10 });

        } catch (error: any) {
            console.error('[HospitalTool] Exception:', error);
            return buildCardToolOutput('hospital', {
                query: [sido_name, sigungu_name, dong_name, hospital_name, hospital_type].filter(Boolean).join(' '),
                count: 0, hospitals: [], notice: '병원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
            });
        }
    },
    {
        name: "hospitalTool",
        description: `전국 병원·의원 위치, 의사수, 종별(상급종합/종합병원/병원/의원 등) 정보를 검색합니다. sido_name(시도)은 반드시 입력해야 합니다. 결과는 UI 카드 데이터입니다.`,
        schema: z.object({
            sido_name: z.string().describe("병원이 위치한 '시/도'의 공식 명칭 (예: 서울특별시, 경기도, 부산광역시). 시/도를 생략해도 올바른 공식 명칭을 유추해서 반드시 입력하세요."),
            sigungu_name: z.string().optional().describe("병원이 위치한 '시/군/구' 명칭. 구 이름만 입력하세요 (예: '강남구', '해운대구', '팔달구'). '수원시 팔달구' → '팔달구'처럼 최소 단위로 입력."),
            dong_name: z.string().optional().describe("병원이 위치한 읍/면/동 명칭 (예: '금암동', '역삼동'). 사용자가 동 단위를 명시한 경우에만 입력하세요."),
            hospital_name: z.string().optional().describe("찾고자 하는 특정 병원 이름 (예: 서울아산병원). 있을 때만 입력하세요."),
            hospital_type: z.string().optional().describe("병원 **종별** (예: 상급종합병원, 종합병원, 병원, 의원, 한방병원). 규모 구분이며 진료과가 아닙니다. 사용자가 명시한 경우만 입력하세요."),
            subject: z.string().optional().describe("찾는 **진료과** (예: 소아과, 내과, 정형외과, 안과, 이비인후과, 피부과, 산부인과, 비뇨의학과, 신경과, 성형외과). 사용자가 과 이름을 대면 hospital_type 이 아니라 여기에 넣으세요."),
        }),
    }
);
