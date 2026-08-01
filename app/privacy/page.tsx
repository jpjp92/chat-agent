/**
 * 개인정보처리방침. Google OAuth 동의 화면 브랜딩의 필수 입력 항목이다
 * (docs/plans/PLAN_AUTH_PROD_ROLLOUT_260719.md §5 — supabase.co 노출 해소).
 *
 * 내용은 **실제 코드에서 확인한 것만** 적는다. 근거:
 *   - 저장 항목      : scripts/sql/auth-mvp-schema.sql (profiles / chat_sessions / chat_messages)
 *   - 스토리지 공개성 : scripts/sql/auth-mvp-storage-buckets.sql (public = true)
 *   - 외부 전송처    : server/ · app/api/ 의 아웃바운드 도메인
 * 기능이 바뀌면 이 문서도 같이 고쳐야 한다.
 */
import type { Metadata } from 'next';
import { LegalPage, Section, Bullets, Notice, CONTACT_EMAIL } from '../legal/LegalPage';

export const metadata: Metadata = {
    title: '개인정보처리방침 | Chat Agent',
    description: 'Chat Agent Privacy Policy',
};

export default function PrivacyPage() {
    return (
        <LegalPage title="개인정보처리방침" titleEn="Privacy Policy">
            <p>
                Chat Agent(이하 &ldquo;서비스&rdquo;)는 개인이 운영하는 비상업적 AI 메신저 프로젝트입니다.
                이 문서는 서비스가 어떤 정보를 수집하고, 어디로 보내며, 어떻게 보관하는지를 설명합니다.
            </p>
            <p className="text-slate-500 dark:text-slate-400">
                Chat Agent is a non-commercial, individually operated AI messenger. This policy explains what
                data we collect, where it is sent, and how it is stored. The Korean text is authoritative.
            </p>

            <Section n={1} title="수집하는 정보" titleEn="Information we collect">
                <Bullets items={[
                    <><b>익명 게스트 식별자</b> — 서비스는 별도 가입 없이 시작할 수 있습니다. 첫 접속 시 익명 계정이 자동 생성되며, 임의의 UUID와 자동 생성된 표시 이름·아바타가 부여됩니다.</>,
                    <><b>Google 계정 정보</b> — Google 로그인을 선택한 경우에 한해 이메일 주소, 이름, 프로필 사진 URL을 받습니다. 요청 범위는 <code>openid</code>, <code>email</code>, <code>profile</code>이며 이메일 열람·연락처 등 민감 범위는 요청하지 않습니다.</>,
                    <><b>대화 내용</b> — 입력한 메시지, AI의 답변, 대화 제목, 답변에 인용된 출처 링크가 저장됩니다.</>,
                    <><b>첨부 파일</b> — 업로드한 이미지·영상·문서 파일과 그 URL.</>,
                    <><b>이용 카운터</b> — 게스트 메시지 횟수 제한을 적용하기 위한 누적 메시지 수.</>,
                    <><b>브라우저 저장소</b> — 로그인 세션 유지와 화면 설정(테마·모델 선택)을 위해 사용합니다. 광고·추적 목적의 쿠키는 사용하지 않습니다.</>,
                ]} />
                <p>서비스는 별도의 접속 로그 분석 도구나 광고 추적기를 운영하지 않습니다.</p>
            </Section>

            <Section n={2} title="이용 목적" titleEn="How we use it">
                <Bullets items={[
                    '대화 기록의 저장과 재조회',
                    '로그인·계정 승계(익명 게스트가 Google 계정으로 전환할 때 기존 대화를 유지)',
                    '무료 API 할당량 보호를 위한 게스트 이용 횟수 제한',
                    '오류 원인 파악과 서비스 개선',
                ]} />
                <p>수집한 정보를 판매하거나 광고 목적으로 제3자에게 제공하지 않습니다.</p>
            </Section>

            <Section n={3} title="제3자 전송" titleEn="Third-party processing">
                <p>서비스는 답변을 만들기 위해 아래 외부 서비스로 정보를 전송합니다.</p>
                <Bullets items={[
                    <><b>Google (Gemini API)</b> — 대화 내용과 첨부 파일이 답변 생성을 위해 전송됩니다. 검색이 필요한 질문에서는 Google 검색 결과가 함께 사용됩니다.</>,
                    <><b>Supabase</b> — 계정·대화·첨부 파일의 저장소이자 인증 제공자입니다.</>,
                    <><b>Vercel</b> — 서비스 호스팅.</>,
                    <><b>공공·공개 API</b> — 질문 유형에 따라 <b>조회에 필요한 부분만</b> 전달됩니다. 예: 날씨는 지역명(기상청·OpenWeather), 의약품은 약품명(식품의약품안전처), 약국·병원은 지역명(공공데이터포털·건강보험심사평가원), 법령은 법령명(국가법령정보센터), 영화 상영시간은 지역·지점(CGV·롯데시네마·메가박스), 스포츠는 대회명(football-data.org). 대화 전문이 전달되지는 않습니다.</>,
                    <><b>웹 페이지 요약 보조</b> — 링크를 첨부해 요약을 요청하면 해당 URL이 페이지 수집 대행 서비스(browserless, ScrapingBee, ScraperAPI)로 전달될 수 있습니다.</>,
                ]} />
                <p>각 서비스의 처리 방침은 해당 사업자의 정책을 따릅니다.</p>
            </Section>

            <Section n={4} title="첨부 파일의 공개 범위" titleEn="Visibility of uploaded files">
                <Notice>
                    <p className="font-semibold">중요: 업로드한 파일은 URL을 아는 사람이 열람할 수 있습니다.</p>
                    <p className="mt-2">
                        서비스는 대화창에 이미지를 표시하기 위해 파일을 <b>공개 스토리지</b>에 보관합니다.
                        파일 주소는 임의의 문자열이라 검색으로 찾기는 어렵지만, 주소가 알려지면 로그인 없이도
                        접근할 수 있습니다. <b>민감한 개인정보·신분증·계약서 등은 업로드하지 마세요.</b>
                    </p>
                    <p className="mt-2 text-slate-600 dark:text-slate-300">
                        Uploaded files are stored in a public bucket so they can be rendered in chat. Anyone who
                        knows the URL can open them without signing in. Do not upload sensitive documents.
                    </p>
                </Notice>
            </Section>

            <Section n={5} title="보관과 삭제" titleEn="Retention and deletion">
                <Bullets items={[
                    '대화와 첨부 파일은 이용자가 삭제하거나 계정이 삭제될 때까지 보관합니다.',
                    '대화 삭제는 서비스 화면에서 직접 할 수 있습니다.',
                    <>현재 서비스 화면에는 <b>계정 삭제 기능이 없습니다.</b> 계정과 관련 데이터 전부의 삭제를 원하시면 아래 문의처로 요청해 주세요. 계정을 삭제하면 그 계정의 프로필·대화·메시지가 함께 삭제됩니다.</>,
                    '로그인하지 않은 익명 게스트 계정은 브라우저 저장소를 지우면 다시 접근할 수 없게 되며, 해당 데이터는 서버에 남아 있다가 정리 대상이 됩니다.',
                ]} />
            </Section>

            <Section n={6} title="이용자의 권리" titleEn="Your rights">
                <p>
                    본인 정보의 열람·정정·삭제를 요청할 수 있습니다. 아래 문의처로 연락해 주시면 확인 후
                    처리합니다. Google 계정 연동은 Google 계정 설정의 &ldquo;타사 앱 및 서비스&rdquo;에서
                    직접 해제할 수 있습니다.
                </p>
            </Section>

            <Section n={7} title="아동" titleEn="Children">
                <p>서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 아동의 정보를 의도적으로 수집하지 않습니다.</p>
            </Section>

            <Section n={8} title="변경 고지" titleEn="Changes">
                <p>
                    이 방침이 바뀌면 이 페이지의 최종 개정일을 갱신합니다. 중요한 변경은 서비스 화면에서
                    별도로 알립니다.
                </p>
            </Section>

            <Section n={9} title="문의" titleEn="Contact">
                <p>
                    개인정보 처리에 관한 문의는{' '}
                    <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                    </a>{' '}
                    로 보내주세요.
                </p>
            </Section>
        </LegalPage>
    );
}
