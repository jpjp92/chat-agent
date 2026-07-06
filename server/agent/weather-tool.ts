import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildWeatherData } from "../lib/weather";

/**
 * 날씨 카드 도구 — KMA(한국 정밀) + OpenWeather(해외·폴백) 하이브리드.
 *
 * grounding 우회 구조: "날씨"를 general+search로 흘려보내면 Google Search 왕복 + LLM
 * 마크다운 표 생성으로 15s+·부정확·비구조였다(PLAN_WEATHER_TOOL §1). 이 도구는 KMA/OWM를
 * **서버에서 직접 호출**해 ~1s 결정론 데이터를 만들고, 언어 중립 구조를 `json:weather` 블록으로
 * 반환한다. 카드 렌더러(WeatherRenderer)가 i18n·이모지·요일을 클라이언트에서 매핑.
 *
 * 멀티 도시: cities 배열을 받아 병렬 조회 → 도시별 json:weather 블록을 이어 붙여 반환
 * (예: "전주, 서울 날씨" → 카드 2개). route.ts on_tool_end가 각 블록을 스트리밍.
 *
 * 설계·검증: PLAN_WEATHER_TOOL_260706 / DEV_260705 / scripts/test-weather-hybrid.ts.
 */
export const weatherTool = tool(
  async ({ cities }: { cities?: string[] }) => {
    const list = (Array.isArray(cities) ? cities : [])
      .map(c => (c || '').trim())
      .filter(Boolean)
      .slice(0, 4);                       // 과도한 다중 조회 방지 (쿼터·레이턴시)
    if (list.length === 0) list.push('서울');

    const results = await Promise.all(list.map(async (city) => {
      try {
        const data = await buildWeatherData(city);
        return `\`\`\`json:weather\n${JSON.stringify(data)}\n\`\`\``;
      } catch (e: any) {
        console.warn('[weatherTool] 조회 실패:', city, e?.message);
        // 실패 도시는 에러 카드로 표기(렌더러가 error 필드 처리)
        return `\`\`\`json:weather\n${JSON.stringify({ error: true, input: city, code: e?.code || 'WEATHER_FETCH_FAILED' })}\n\`\`\``;
      }
    }));

    return [
      '날씨 카드를 표시합니다. [지시사항]: 아래 코드 블록들을 토씨 하나 바꾸지 말고 그대로 출력하세요.',
      '기온·강수량·습도 등 수치를 절대 지어내거나 요약하지 마세요(데이터는 카드가 담고 있습니다). 별도 마크다운 표를 만들지 마세요.',
      '',
      results.join('\n\n'),
    ].join('\n');
  },
  {
    name: "weatherTool",
    description: `특정 지역의 현재 날씨·기온·강수·단기예보 카드를 표시합니다. 사용자가 날씨, 기온, 비/눈, 강수확률, 미세먼지 아닌 일반 기상, "오늘/내일 날씨", 특정 도시의 날씨를 물을 때 사용합니다. cities 인자에 사용자가 언급한 지역명 배열을 넣으세요 — 한 곳이면 ["서울"], 여러 곳이면 ["전주","서울"]처럼 모두 포함. 지역을 말하지 않으면 비워두면 됩니다(기본 서울). 한국 도시는 기상청(KMA), 해외 도시는 OpenWeather로 자동 조회됩니다. 이 도구는 \`\`\`json:weather 블록을 반환하며, 당신(LLM)은 그 텍스트를 절대 수정·요약하지 말고 그대로 출력해야 UI 카드가 정상 작동합니다. 날씨 수치를 직접 지어내지 마세요.`,
    schema: z.object({
      cities: z.array(z.string()).optional().describe("날씨를 조회할 지역명 배열 (예: [\"서울\"], [\"전주\",\"부산\"], [\"Tokyo\"]). 사용자가 여러 도시를 말하면 모두 포함하세요. 지역 미언급 시 생략."),
    }),
  }
);
