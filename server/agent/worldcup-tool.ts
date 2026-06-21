import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStandings, getScorers, getMatches } from "../../lib/sports/football-data";

const INSTRUCTION = [
  '[지시사항]',
  '- 위 데이터는 football-data.org의 실시간 공식 데이터다. 이 데이터만 근거로 답하라.',
  '- 순위·점수·선수명·숫자를 절대 지어내거나 변형하지 마라.',
  '- 팀명은 한국어로 번역해 표기하라 (예: Mexico→멕시코, South Korea→대한민국).',
  '- 데이터가 "[NOT_DETERMINED]"로 시작하면 표를 만들지 말고 그 안내 문구로 답하라.',
  '- 사용자 질문에 맞춰 표 전체를 보여주거나, 필요한 부분만 뽑아 자연스럽게 답하라.',
].join('\n');

export const worldCupTool = tool(
  async ({ resource, stage, status, limit }: { resource: string; stage?: string; status?: string; limit?: number }) => {
    let data: string;
    if (resource === 'scorers') data = await getScorers(limit ?? 10);
    else if (resource === 'matches') data = await getMatches({ stage, status });
    else data = await getStandings();
    return `[WORLDCUP_DATA]\n${data}\n\n${INSTRUCTION}`;
  },
  {
    name: "worldCupTool",
    description: `**현재 진행 중인** FIFA 월드컵(2026 북중미)의 조별 순위/경기·대진/득점왕을 실시간 조회한다. 사용자가 월드컵 순위, 조별리그, 특정 조, 16강/8강 대진, 경기 일정·결과, 득점왕을 물을 때 사용한다. resource로 종류를 선택: 순위는 'standings', 경기/대진은 'matches'(stage로 단계 필터), 득점왕은 'scorers'. 과거 대회(2022 등)는 지원하지 않으므로 호출하지 말 것. 데이터를 지어내지 말고 이 도구로 조회하라.`,
    schema: z.object({
      resource: z.enum(["standings", "matches", "scorers"]).describe("조회할 데이터 종류: 조별순위(standings), 경기/대진(matches), 득점왕(scorers)"),
      stage: z.enum(["GROUP_STAGE", "LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"]).optional().describe("matches일 때 토너먼트 단계 필터 (예: 16강=LAST_16)"),
      status: z.enum(["SCHEDULED", "TIMED", "FINISHED", "IN_PLAY", "PAUSED"]).optional().describe("matches일 때 경기 상태 필터 (예: 종료=FINISHED, 예정=SCHEDULED)"),
      limit: z.number().optional().describe("scorers일 때 표시할 선수 수 (기본 10)"),
    }),
  }
);
