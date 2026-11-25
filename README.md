# 식물 관찰 학습 웹앱

## 준비물

- Windows
- Node.js 18 이상
- Docker에서 실행 중인 AnythingLLM
- AnythingLLM Developer API 키

## 실행 방법

1. `.env` 파일을 메모장으로 엽니다.
2. 다음 두 항목을 입력하고 저장합니다.

   ```env
   ANYTHINGLLM_API_KEY=발급받은_Developer_API_키
   ANYTHINGLLM_WORKSPACE_SLUG=워크스페이스_slug
   ```

   `workspace slug`는 AnythingLLM 워크스페이스 주소의 `/workspace/` 뒤에
   표시되는 값입니다.

3. Docker AnythingLLM이 `http://localhost:3001`에서 실행 중인지 확인합니다.
4. `start.bat`을 더블 클릭합니다.
5. 브라우저에서 `http://127.0.0.1:8765`를 엽니다.

`.env`를 수정했다면 실행 중인 서버 창에서 `Ctrl+C`를 누른 후
`start.bat`을 다시 실행해야 합니다.

## Railway 배포

1. Railway 프로젝트에 이 GitHub 저장소의 `main` 브랜치를 연결합니다.
   학습 웹 서비스의 **Settings → Public Networking**에서 도메인을 만듭니다.
   `railway.json`은 `npm start`와 `/healthz`를 사용합니다.
2. 같은 프로젝트와 환경에 AnythingLLM 서비스를 추가합니다. 프로젝트의 **New → Template**에서
   [AnythingLLM Private Docs Chat](https://railway.com/deploy/anythingllm-private-docs-chat)을 선택할 수 있습니다.
   서비스 이름을 `anythingllm`으로 두고, 템플릿의 영구 볼륨을 연결합니다.
3. AnythingLLM 관리 화면에서 관리자 인증을 설정하고 모델 공급자와 모델을 선택합니다.
   식물 관찰용 워크스페이스를 만든 후 실제 slug를 확인하고 Developer API 키를 발급합니다.
   로컬에서 실행 중인 모델을 사용했다면 Railway에서 접근할 수 있는 모델로 설정해야 합니다.
4. 학습 웹 서비스의 **Variables**에 다음 값을 넣고 변경 사항을 배포합니다.

   | 변수 | 값 |
   | --- | --- |
   | `ANYTHINGLLM_URL` | `http://${{anythingllm.RAILWAY_PRIVATE_DOMAIN}}:3001` |
   | `ANYTHINGLLM_API_KEY` | Railway의 AnythingLLM에서 발급한 Developer API 키 |
   | `ANYTHINGLLM_WORKSPACE_SLUG` | Railway의 AnythingLLM에서 만든 워크스페이스 slug |

   서비스 이름을 다르게 지정했다면 URL 참조의 `anythingllm`을 실제 이름으로 바꿉니다.
   초기 설정에 사용한 AnythingLLM 관리 도메인은 관리가 끝나면 제거할 수 있습니다.
5. 배포된 페이지에서 대화창의 연결 상태를 확인하고 식물 관찰 질문을 보내 답변을 확인합니다.
   `/api/health`는 API 키 및 워크스페이스 연결을 확인하며, 실제 모델 호출은 대화창에서 확인합니다.

## 보안 및 기능 안내

- API 키는 Node.js 서버에서만 사용됩니다.
- `.env`는 Git에 포함되지 않습니다.
- 왼쪽에서 선택한 사진과 문서(워드, 파워포인트, 엑셀, 텍스트, PDF 등)는 질문과 함께 AnythingLLM으로 전송됩니다.
- AI가 생성한 파일이 AnythingLLM에서 오지 않더라도, 워드/엑셀/텍스트 요청이면 웹앱이 답변 본문으로 파일을 만들어 첨부합니다.
- 이미지는 비전 모델이 직접 보고, 문서는 AnythingLLM 문서 처리기로 읽힌 뒤 답변에 사용됩니다.
- 첨부 없이 글로만 질문할 수도 있습니다.

## 문제 해결

- `설정 필요`: `.env`의 API 키와 workspace slug를 확인합니다.
- `API 키가 올바르지 않습니다`: AnythingLLM의 Developer API에서 발급한 키인지 확인합니다.
- `연결할 수 없습니다`: Docker와 AnythingLLM이 실행 중인지 확인합니다.
- `포트 8765가 이미 사용 중`: 기존에 실행한 `start.bat` 창을 종료합니다.
