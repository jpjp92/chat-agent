import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { defaultsForRegion } from "../../lib/theaters";
import { buildCardToolOutput } from "./card-tool-output";

/**
 * 영화 상영시간표 도구 — CGV·롯데시네마·메가박스 3사 카드.
 *
 * 클라이언트 페치 구조: 이 도구는 무거운 상영시간표를 직접 가져오지 않고,
 * 사용자가 말한 지역(region)에 대응하는 3사 기본 지점만 골라 가벼운 json:movie 블록을 반환한다.
 * 실제 상영시간표는 MovieRenderer가 마운트/지점변경 시 /api/showtimes 로 조회(스켈레톤+SWR 캐시).
 * → 채팅 응답이 즉시 끝나고(CGV browserless ~2.5s가 챗 경로 밖), 지점 드롭다운 재조회와 동일 경로 재사용.
 *
 * 스파이크 본류: DEV_260608 §9 ~ DEV_260611.
 */
export const movieTool = tool(
  async ({ region }: { region?: string }) => {
    const defaults = defaultsForRegion(region);
    const payload = {
      region: (region || '').trim() || '강남',
      defaults: {
        cgv: defaults.cgv,
        lotte: defaults.lotte,
        mega: defaults.mega,
      },
    };
    return buildCardToolOutput('movie', payload);
  },
  {
    name: "movieTool",
    description: `CGV·롯데시네마·메가박스 3대 멀티플렉스의 오늘 영화 상영시간표 카드를 표시합니다. 사용자가 영화 상영시간, 상영표, 영화관/극장 정보, 무슨 영화 하는지 등을 물을 때 사용합니다. region 인자에 사용자가 언급한 지역명(예: "강남", "홍대", "노원", "부산 서면")을 넣으세요. 지역을 말하지 않으면 비워두면 됩니다(기본 강남). 이 도구는 \`\`\`json:movie 블록을 반환하며, 당신(LLM)은 그 텍스트를 절대 수정·요약하지 말고 그대로 출력해야 UI 카드가 정상 작동합니다. 영화 제목이나 상영시간을 직접 지어내지 마세요 — 카드가 실시간으로 조회합니다.`,
    schema: z.object({
      region: z.string().optional().describe("사용자가 언급한 지역/동네 이름 (예: '강남', '홍대', '노원', '서면'). 시/구 단위도 가능. 지역을 명시하지 않았으면 생략하세요."),
    }),
  }
);
