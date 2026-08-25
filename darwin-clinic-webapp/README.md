# 다윈 통증의학과 - 환자용/관리자용 웹앱

## 1. Supabase 테이블 만들기 (아직 안 하셨다면)
1. Supabase 대시보드 → 좌측 메뉴 **SQL Editor** → New query
2. 이 프로젝트에 포함된 `supabase-schema.sql` 내용을 전부 붙여넣고 **Run**
3. 좌측 **Table Editor**에서 `appointments`, `messages` 테이블이 생겼는지 확인

## 2. 로컬에서 테스트하기
```bash
npm install
npm run dev
```
`.env` 파일에 이미 Supabase 접속 정보가 채워져 있어요. 브라우저에서 `http://localhost:5173` 접속해서 환자용/관리자용이 잘 되는지 확인하세요. (관리자 PIN: `2025`)

## 3. GitHub에 올리기
```bash
git init
git add .
git commit -m "다윈 통증의학과 웹앱 초기 버전"
```
GitHub에서 새 저장소(Repository)를 만든 뒤:
```bash
git remote add origin (본인 저장소 주소)
git branch -M main
git push -u origin main
```
`.env`는 `.gitignore`에 포함되어 있어서 GitHub에는 올라가지 않아요 — 이건 정상이에요, 다음 단계에서 Vercel에 직접 입력해요.

## 4. Vercel로 배포하기
1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. "Add New..." → "Project" → 방금 만든 GitHub 저장소 선택
3. **Environment Variables**에 아래 2개를 추가:
   - `VITE_SUPABASE_URL` = `https://szygzgbnvwiiouiywueq.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (anon public 키)
4. **Deploy** 클릭 → 몇 분 뒤 `https://프로젝트이름.vercel.app` 주소가 생성돼요

## 5. 환자에게 안내하기
그 주소로 접속 후 iOS는 Safari 공유 버튼 → "홈 화면에 추가", Android는 Chrome 메뉴 → "앱 설치"를 누르면 아이콘이 생기고 앱처럼 실행돼요.

## 아이콘 추가하기 (선택)
`public/icons/icon-192.png`, `public/icons/icon-512.png` 자리에 병원 로고 이미지를 넣으면 홈 화면 아이콘이 병원 로고로 표시돼요. 지금은 아이콘 파일이 없어서 기본 아이콘으로 보일 수 있어요.

## ⚠️ 지금 알아두셔야 할 보안 수준
- 지금 구조는 **환자 인증이 이름/전화번호/생년월일 입력 수준**이고, 관리자 인증은 **고정 PIN**이에요. 실제 진료 정보를 다루는 서비스라면 출시 전에:
  - 환자: 휴대폰 본인인증(SMS OTP) 등 실제 인증 도입
  - 관리자: Supabase Auth 기반 로그인(이메일+비밀번호 또는 소셜)으로 교체
  - Supabase RLS 정책을 더 세밀하게 (지금은 anon 키로 전체 읽기/쓰기가 가능한 상태)
  를 권장드려요. 이 부분도 원하시면 다음 단계로 작업해드릴게요.
