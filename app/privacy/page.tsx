import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <main className="privacy-page">
      <article className="privacy-document">
        <p className="eyebrow">MORROW · PRIVACY</p>
        <h1>개인정보처리방침</h1>
        <p>시행일: 2026년 8월 3일</p>
        <p>Morrow는 사용자가 연결한 메일에서 일정 및 답변 기한 후보를 찾고, 사용자가 확인한 항목만 일정으로 관리하도록 돕는 서비스입니다.</p>

        <h2>1. 처리하는 정보</h2>
        <ul>
          <li>Google 계정의 기본 식별 정보(이메일 주소, 표시 이름)</li>
          <li>사용자가 허용한 Gmail 메시지의 제목, 발신자, 수신 시각, 읽음 상태, 본문 일부 및 원본 메일 링크</li>
          <li>서비스 연결을 유지하기 위한 OAuth 토큰</li>
        </ul>

        <h2>2. 이용 목적</h2>
        <p>Google 사용자 데이터는 메일을 조회하고 일정·회의·답변 기한 후보를 추출하여 사용자에게 검토 화면으로 제공하는 데만 사용합니다. 광고, 사용자 프로파일링 또는 제3자 판매 목적으로 사용하지 않습니다.</p>

        <h2>3. 저장 및 보유</h2>
        <p>메일 원문은 별도로 저장하지 않습니다. 연결 정보와 OAuth 토큰은 암호화하여 보관하며, 사용자가 연결을 해제하면 관련 인증 정보를 삭제합니다. 추출 결과에는 서비스 기능 제공에 필요한 최소한의 메일 요약 정보만 사용합니다.</p>

        <h2>4. 공유 및 이전</h2>
        <p>Google 사용자 데이터를 판매하지 않습니다. 서비스 운영에 필요한 인프라 제공자를 제외하고 제3자에게 공유하지 않으며, 법령상 의무가 있는 경우에만 관련 절차에 따라 처리합니다.</p>

        <h2>5. 사용자 선택과 권리</h2>
        <p>사용자는 앱의 연결 및 개인정보 화면에서 Google 계정 연결을 해제할 수 있습니다. Google 계정의 보안 설정에서도 Morrow의 접근 권한을 철회할 수 있습니다.</p>

        <h2>6. Google API 데이터 정책</h2>
        <p>Morrow의 Google API 사용 및 다른 앱으로부터 받은 정보의 이전은 제한적 사용 요건을 포함한 Google API 서비스 사용자 데이터 정책을 준수합니다.</p>

        <h2>7. 문의</h2>
        <p>개인정보 및 서비스 관련 문의: <a href="mailto:james.park@collietech.co.kr">james.park@collietech.co.kr</a></p>

        <p><Link href="/">Morrow로 돌아가기</Link></p>
      </article>
    </main>
  );
}
