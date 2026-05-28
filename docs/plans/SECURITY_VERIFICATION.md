# 보안 검증 가이드 (Security Verification Guide)

이 문서는 프로젝트의 보안 핵심 요소인 **Supabase Storage 버킷 화이트리스트** 검증 절차와 도구 사용법을 설명합니다.

## 개요

이 프로젝트의 API 엔드포인트(`api/upload.ts`, `api/create-signed-url.ts`)는 보안을 위해 특정 버킷에 대해서만 접근을 허용합니다. `service_role` 키를 사용하여 Storage에 접근하므로, 화이트리스트가 올바르게 작동하는지 정기적으로 검증하는 것이 매우 중요합니다.

## 허용된 버킷 (Allowed Buckets)

현재 시스템에서 허용하는 버킷 목록은 다음과 같습니다:
- `chat-imgs`: 채팅 이미지 업로드용
- `chat-videos`: 채팅 비디오 업로드용
- `chat-docs`: 채팅 문서 업로드용

## 검증 도구

검증을 위해 전용 테스트 스크립트가 마련되어 있습니다.

- **위치**: `scripts/test-bucket-security.ts`
- **기능**: 허용된 버킷과 비허용 버킷(공격 시나리오)에 대해 API 로직이 올바르게 차단/허용하는지 시뮬레이션합니다.

## 검증 실행 방법

터미널에서 다음 명령어를 실행하여 보안 테스트를 수행할 수 있습니다:

```bash
npx tsx scripts/test-bucket-security.ts
```

### 기대 결과 (Success Criteria)

테스트 실행 시 다음과 같은 결과가 출력되어야 정상입니다:
- `✅ [Allowed: chat-imgs]`: 허용 확인
- `✅ [Blocked: secret-bucket]`: 비허용 버킷 차단 확인
- `✅ [Blocked: case sensitive mismatch]`: 대소문자 구분 차단 확인
- `✅ ALL SECURITY TESTS PASSED`: 모든 테스트 통과

## 보안 유지 관리 지침

1. **버킷 추가 시**: 새로운 버킷을 추가해야 할 경우, `api/_lib/storage.ts`(계획됨) 또는 각 API 파일의 화이트리스트를 업데이트하고 테스트 스크립트의 `testBuckets` 목록에도 추가하여 검증해야 합니다.
2. **정기 검증**: 주요 API 로직 변경 시 반드시 위 검증 명령어를 실행하여 회귀 테스트(Regression Test)를 수행하십시오.

---
*최종 업데이트: 2026-05-04*
