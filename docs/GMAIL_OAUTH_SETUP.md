# Gmail OAuth 환경변수

Google Cloud에서 만든 `Morrow Local Web` 클라이언트 값을 소스 코드가 아닌 실행 환경의 비밀 변수로 등록한다.

```text
GOOGLE_CLIENT_ID=<Google OAuth 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<Google OAuth 클라이언트 보안 비밀번호>
OAUTH_ENCRYPTION_KEY=<충분히 긴 임의 문자열>
APP_BASE_URL=http://localhost:3000
```

운영 배포에서는 `APP_BASE_URL`과 Google Cloud의 승인된 JavaScript 원본 및 리디렉션 URI를 실제 소유 도메인으로 변경한다. 리디렉션 경로는 `/api/auth/google/callback`이다.

OAuth 클라이언트 JSON 파일과 비밀번호는 저장소에 커밋하지 않는다.
