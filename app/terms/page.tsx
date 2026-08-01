/**
 * 이용약관. 개인정보처리방침과 함께 Google OAuth 동의 화면 브랜딩의 필수 입력 항목이다
 * (docs/plans/PLAN_AUTH_PROD_ROLLOUT_260719.md §5).
 *
 * 과장하지 않는다 — 개인이 무료 API 할당량으로 굴리는 비상업 프로젝트라는 사실을
 * 그대로 적는 편이 사용자에게도 정확하고, 나중에 지킬 수 없는 약속을 남기지 않는다.
 */
import type { Metadata } from 'next';
import { LegalPage, Section, Bullets, Notice, CONTACT_EMAIL } from '../legal/LegalPage';

export const metadata: Metadata = {
    title: '이용약관 | Chat Agent',
    description: 'Chat Agent Terms of Service',
};

export default function TermsPage() {
    return (
        <LegalPage title="이용약관" titleEn="Terms of Service">
            <p>
                이 약관은 Chat Agent(이하 &ldquo;서비스&rdquo;) 이용에 적용됩니다. 서비스를 사용하면 이
                약관에 동의한 것으로 봅니다.
            </p>
            <p className="text-slate-500 dark:text-slate-400">
                These terms apply to your use of Chat Agent. The Korean text is authoritative.
            </p>

            <Section n={1} title="서비스의 성격" titleEn="Nature of the service">
                <p>
                    서비스는 개인이 운영하는 <b>비상업적 실험 프로젝트</b>입니다. 무료로 제공되며, 사전 통지
                    없이 기능이 바뀌거나 중단될 수 있습니다. 가동 시간이나 데이터 보존을 보장하지 않습니다.
                </p>
            </Section>

            <Section n={2} title="계정" titleEn="Accounts">
                <Bullets items={[
                    '별도 가입 없이 익명 게스트로 이용할 수 있습니다. 익명 게스트에는 메시지 횟수 제한이 적용됩니다.',
                    'Google 계정으로 로그인하면 횟수 제한이 해제되고, 기존 익명 게스트의 대화가 그대로 승계됩니다.',
                    '이미 다른 계정에 연결된 Google 신원으로는 승계할 수 없습니다. 이 경우 기존 계정으로 로그인해 주세요.',
                    '계정 정보의 관리 책임은 이용자에게 있습니다.',
                ]} />
            </Section>

            <Section n={3} title="AI 답변에 대한 고지" titleEn="About AI-generated answers">
                <Notice>
                    <p className="font-semibold">답변이 틀릴 수 있습니다. 중요한 판단의 근거로 삼지 마세요.</p>
                    <p className="mt-2">
                        서비스는 생성형 AI를 사용하며, 사실과 다른 내용을 그럴듯하게 제시할 수 있습니다.
                        특히 <b>의약품·의료·법령·투자</b>에 관한 내용은 정보 제공 목적일 뿐이며
                        <b> 전문가의 진단·상담·자문을 대체하지 않습니다.</b> 약국·병원·상영시간·날씨 등
                        외부 데이터는 원 제공처의 갱신 주기에 따라 실제와 다를 수 있으니 최종 확인은
                        해당 기관·업체에 하시기 바랍니다.
                    </p>
                </Notice>
            </Section>

            <Section n={4} title="금지 행위" titleEn="Prohibited use">
                <Bullets items={[
                    '법령을 위반하거나 타인의 권리를 침해하는 목적의 이용',
                    '타인의 개인정보를 동의 없이 입력하거나 업로드하는 행위',
                    '자동화 수단으로 과도한 요청을 보내 서비스나 연동된 외부 API에 부담을 주는 행위',
                    '서비스의 이용 제한(횟수 제한 등)을 우회하려는 시도',
                    '불법 콘텐츠의 생성·유포 시도',
                ]} />
                <p>위반이 확인되면 사전 통지 없이 이용을 제한할 수 있습니다.</p>
            </Section>

            <Section n={5} title="이용자 콘텐츠" titleEn="Your content">
                <p>
                    입력한 내용과 업로드한 파일의 권리는 이용자에게 있습니다. 서비스는 답변 생성과 화면 표시,
                    대화 기록 보관에 필요한 범위에서만 이를 처리합니다. 처리 경로와 보관 방식은{' '}
                    <a className="text-indigo-600 hover:underline dark:text-indigo-400" href="/privacy">
                        개인정보처리방침
                    </a>
                    을 참고하세요.
                </p>
                <p>
                    업로드한 파일은 URL을 아는 사람이 열람할 수 있는 위치에 보관됩니다. 민감한 자료는
                    업로드하지 마세요.
                </p>
            </Section>

            <Section n={6} title="제3자 서비스" titleEn="Third-party services">
                <p>
                    서비스는 Google Gemini, Supabase, 그리고 공공기관·영화관·기상 등 외부 API에 의존합니다.
                    이들 서비스의 장애·정책 변경·데이터 오류로 인한 영향은 서비스가 통제할 수 없습니다.
                </p>
            </Section>

            <Section n={7} title="책임의 한계" titleEn="Limitation of liability">
                <p>
                    서비스는 &ldquo;있는 그대로&rdquo; 제공됩니다. 무료로 제공되는 비상업 서비스라는 점을
                    고려하여, 서비스 이용 또는 이용 불가로 발생한 손해에 대해 관련 법령이 허용하는 범위에서
                    책임을 지지 않습니다. 다만 고의 또는 중대한 과실이 있는 경우에는 그러하지 않습니다.
                </p>
            </Section>

            <Section n={8} title="약관 변경" titleEn="Changes to these terms">
                <p>
                    약관이 바뀌면 이 페이지의 최종 개정일을 갱신합니다. 변경 후에도 서비스를 계속 이용하면
                    변경된 약관에 동의한 것으로 봅니다.
                </p>
            </Section>

            <Section n={9} title="준거법·문의" titleEn="Governing law and contact">
                <p>
                    이 약관은 대한민국 법을 준거법으로 합니다. 문의는{' '}
                    <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                    </a>{' '}
                    로 보내주세요.
                </p>
            </Section>
        </LegalPage>
    );
}
