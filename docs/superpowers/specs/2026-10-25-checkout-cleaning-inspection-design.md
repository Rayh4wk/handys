# 예약 변경 후 퇴실 청소 일정 불일치 점검 도구 — 설계

원본 요구: 저장소 루트 `GOAL.md`. 이 문서는 GOAL.md를 구현 가능한 수준으로 구체화하며, GOAL.md에 없는 결정은 **[내 결정]**으로 표시한다.

## 1. 의도
체크아웃 시각이 변경된 뒤 퇴실 청소 시작 시각이 체크아웃 이전으로 남아 있는 불일치를 자동 판정·표시하고, 운영 담당자가 청소 일정을 수정해 정상 상태를 재확인하는 흐름(**발견 → 조치 → 재확인**)을 완결한다. 다른 운영 화면에는 SSE로 변경 신호를 보내 2초 이내 갱신한다.

## 2. 목표 / 비목표 / 실패 조건
- 목표: GOAL.md §4 "구현 포함", §12 검증 항목 전부 통과.
- 비목표: GOAL.md §4 "구현 제외" 전부(PMS/OTA, 결제, 인력 배정, 도어락, 메시지 발송, 권한, Push), Redis, 이벤트 재생.
- 실패 조건(동작해도 실패): 정보 부재(청소 없음, 시각 누락)를 `NORMAL`로 판정 / 예약 변경은 저장됐는데 점검 결과가 이전 값 / 오래된 버전으로 덮어쓰기 / SSE 끊김 시 화면이 조용히 오래된 상태 유지.

## 3. 판정 규칙 (순수 함수 `judge`)
적용 순서(먼저 걸리는 것이 판정):
1. 예약 `status = CANCELLED` → `EXCLUDED` / `RESERVATION_CANCELLED`
2. `checkout_at` 없음 → `UNDETERMINED` / `MISSING_CHECKOUT_AT`
3. 활성(`status != CANCELLED`) 퇴실 청소 작업 없음 → `NEEDS_CHECK` / `NO_CHECKOUT_CLEANING_TASK`
4. 청소 `scheduled_start_at` 없음 → `UNDETERMINED` / `MISSING_CLEANING_START`
5. `scheduled_start_at < checkout_at` → `CONFLICT` / `CLEANING_BEFORE_CHECKOUT`
6. 그 외(같거나 늦음) → `NORMAL` / `CLEANING_AFTER_CHECKOUT`

- 비교는 epoch ms 기준(시간대 무관). 재실 청소(`type = STAYOVER`)는 입력에서 제외. **[내 결정]** R-104(체크아웃 누락 + 청소 있음)가 `UNDETERMINED`가 되도록 체크아웃 누락을 청소 부재보다 먼저 본다. 취소된 청소 작업은 "작업 없음"으로 본다.
- 각 reason code는 한국어 근거 문구로 매핑(예: `CLEANING_BEFORE_CHECKOUT` → "체크아웃 이전에 청소 시작 예정").

## 4. 구조
- 저장소: `apps/server/`(NestJS + Prisma + Jest), `apps/web/`(Vite React TS + TanStack Query), `e2e/`(Playwright), 루트 `package.json` 스크립트. 패키지 매니저 npm. **[내 결정]**
- API 경로는 `/api` 접두사 **[내 결정]**(정적 FE와 충돌 방지). Nest가 `apps/web/dist`를 `@nestjs/serve-static`으로 제공.
- 실행: `docker-compose.yml`(app 1 + postgres 1). 로컬 실행은 로컬 PostgreSQL 사용.

## 5. 데이터 모델 (Prisma, PostgreSQL, 시각은 `timestamptz`)
- `reservations`: `id` text PK(예: `R-101`), `room_id` text, `guest_name` text, `checkout_at` timestamptz NULL, `status` enum(`CONFIRMED`,`CANCELLED`), `version` int default 1, `updated_at`.
- `cleaning_tasks`: `id` text PK(예: `C-101`), `reservation_id` FK → reservations, `type` enum(`CHECKOUT`,`STAYOVER`), `scheduled_start_at` timestamptz NULL, `status` enum(`SCHEDULED`,`CANCELLED`), `version` int default 1, `updated_at`. 부분 유니크 인덱스 `(reservation_id) WHERE type='CHECKOUT'` (마이그레이션 raw SQL).
- `inspection_results`: `reservation_id` PK + FK(→ 중복 불가), `status` enum(5개), `reason_code` text, `checked_at` timestamptz.
- `audit_logs`: `id` bigserial, `reservation_id` FK, `action` text(`CHECKOUT_CHANGED`,`CLEANING_RESCHEDULED`), `before` jsonb, `after` jsonb(값 + 판정 상태 포함), `reason` text NULL(변경 사유), `actor_id` text, `actor_role` text, `created_at`.
- 처리자: 서버가 로그인 세션에서 결정(§8-1). 표시 시간대 `Asia/Seoul` **[내 결정]**.

## 6. 쓰기 처리 (두 PATCH 공통)
하나의 `prisma.$transaction` 안에서:
1. `SELECT ... FROM reservations WHERE id=$1 FOR UPDATE` (청소 변경 시에도 해당 예약 행을 먼저 잠금 → 같은 예약에 대한 두 경로 직렬화).
2. 대상 행의 `version`과 요청 `version` 비교, 다르면 `409 Conflict`(body: 최신 view 포함).
3. 값 변경 + `version + 1`.
4. 최신 예약·청소 재조회 → `judge` → `inspection_results` upsert.
5. `audit_logs` insert(before/after: 변경 필드, 판정 상태).
6. 커밋 후 `EventsService.emit({type:'reservation.updated', reservationId, version})`.
- 점검 저장 실패 시 전체 롤백(테스트는 InspectionRepository를 실패하도록 override).
- 입력 검증: `class-validator` — `checkoutAt`/`scheduledStartAt` ISO8601(오프셋 포함) 필수, `version` 양의 정수, 체크아웃 변경 `reason` 필수(공백 제외 1~200자), 청소 변경 `reason` 선택(≤200자). 정의되지 않은 필드(`actorId`, `role` 등)는 400 — 처리자·역할을 본문에서 받지 않는다. 없는 id → 404. 취소 예약의 체크아웃/청소 변경 → `422` **[내 결정]**.

## 7. API (`/api` 접두사)
| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/reservations` | 예약 view 목록 |
| POST | `/auth/login` | `{username, password}` → 세션 쿠키, `{username, displayName, role}` |
| POST | `/auth/logout` | 쿠키 삭제 |
| GET | `/auth/me` | 현재 계정 또는 401 |
| PATCH | `/reservations/:id/checkout` | **RESERVATION_AGENT만**. `{checkoutAt, reason, version}` → 최신 view |
| PATCH | `/cleaning-tasks/:id/schedule` | **OPERATIONS_MANAGER만**. `{scheduledStartAt, reason?, version}` → 최신 view |
| GET | `/inspection-results?status=` | 판정 목록(필터) |
| POST | `/inspection-results/run` | 전체 재점검(멱등 upsert) **[내 결정]** — GOAL §12 "동일 점검 반복" 검증용·시연용 |
| GET | `/reservations/:id/audit-logs` | 최신순 이력 |
| GET | `/events` | SSE, 25초 heartbeat |

Reservation view: `{id, roomId, guestName, checkoutAt, status, version, cleaningTask: {id, scheduledStartAt, status, version} | null, inspection: {status, reasonCode, reasonText, checkedAt}}`. 정렬은 id 오름차순.

## 8. 화면 (한 SPA, 역할별 라우트 — GOAL §15)
- `/login`: 데모 계정 로그인. 로그인 후 역할별 홈으로 이동(에이전트 → `/reservations`, 운영 → `/operations`). 다른 역할의 화면 URL 접근 시 "이 화면은 ○○ 담당자 전용입니다" 안내(FE), API는 BE에서 403.
- `/reservations` 예약·고객 응대 화면: 예약 번호·객실·체크아웃 예정·판정 표시, 변경 시각 + 변경 사유 입력. 저장 결과 패널: 항상 "예약 변경 완료" + 기존 청소 시작 시각 + 판정별 후속 안내 — CONFLICT: "체크아웃 이전에 청소가 예정되어 있습니다. 운영 담당자의 일정 조정이 필요합니다." / NORMAL: "청소 일정과 충돌하지 않습니다." / NEEDS_CHECK: "대응하는 퇴실 청소 작업이 없습니다. 운영 담당자의 확인이 필요합니다." / UNDETERMINED: "판정에 필요한 정보가 없습니다. 운영 담당자의 확인이 필요합니다." 청소 수정 권한 없음.
- `/operations` 현장 운영 화면: 점검 결과 표(예약 번호, 객실, 체크아웃 예정과 청소 시작 예정 나란히, 판정 배지, 근거). 정렬 우선순위 CONFLICT → NEEDS_CHECK → UNDETERMINED → NORMAL → EXCLUDED. 기본 필터 "조치 필요"(앞 3개), "전체"·상태별 선택 가능(정상 건 조회). 행 선택 시 상세 패널: 변경 이력(시각, 액션, 전→후 값, 판정 전→후, 변경 사유, 변경자 이름·역할), 청소 시간 + 메모(사유) 수정 폼. 체크아웃 수정 권한 없음.
- 409 시 "다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다." 표시 후 재조회.
- 공통 헤더: 실시간 연결 상태(연결됨/재연결 중/끊김), 마지막 갱신 시각, 시연용 "실시간 연결 끊기/다시 연결" 토글.
- 실시간 훅: 화면당 EventSource 1개, open 시 전체 invalidate, 메시지 시 invalidate(`reservations`, `inspection-results`, 해당 audit-logs), 30초 `refetchInterval`, `refetchOnWindowFocus`.

## 8-1. 데모 계정과 권한 (GOAL §15)
- 고정 계정 2개(가입 없음): `agent` / `demo1234` → `{id:'agent-01', displayName:'예약 담당 김예약', role:'RESERVATION_AGENT'}`, `ops` / `demo1234` → `{id:'ops-01', displayName:'현장 운영 박현장', role:'OPERATIONS_MANAGER'}` **[내 결정]**.
- 세션: HMAC 서명 쿠키(`sid`, HttpOnly, SameSite=Lax, 내용 = 계정 id + 서명, 비밀키 `SESSION_SECRET` env, 기본 개발값). 서버 재시작 후에도 유효 **[내 결정]**.
- 전역 가드: `/api/auth/login` 외 모든 `/api` 경로는 로그인 필요(401). 변경 API는 `@Roles` 가드로 역할 검사(403). 조회·SSE는 두 역할 모두 허용.
- 처리자(`actor_id`, `actor_role`)는 세션 계정에서만 채운다.
- 청소 담당자 화면 제외. 실제 청소 담당자가 변경을 전달받고 확인했는지는 검증 범위 밖(README·TEST_REPORT에 명시).

## 9. 시드
기준일 2026-10-26 KST **[내 결정]**:
- R-101 체크아웃 11:00, 청소 11:30 (시연에서 13:00으로 변경 → CONFLICT, 청소 13:30 → NORMAL)
- R-102 13:00 / 13:30 → NORMAL
- R-103 12:00 / 청소 없음(재실 청소만 있음) → NEEDS_CHECK
- R-104 체크아웃 없음 / 12:30 → UNDETERMINED
- R-105 취소 → EXCLUDED
- R-106 11:00 / 11:00 → NORMAL(경계)
시드 후 전체 점검 실행.

## 10. 검증
- 단위(Jest): `judge` 경계값 전부.
- 통합(Jest + 실제 PostgreSQL `handys_test`, supertest): GOAL §12의 서버 항목(검출, 수정 후 정상, 같음, 작업 없음, 누락, 취소, 롤백, 409, 동시 수정 일치, 재시작 후 유지, 반복 점검 중복 없음, 커밋 후에만 SSE emit).
- 권한(통합): 비로그인 401, 에이전트의 청소 변경 403, 운영의 체크아웃 변경 403, 본문 `actorId` 400, 이력 처리자 = 세션 계정.
- 브라우저(Playwright, 빌드된 앱 + `handys_e2e` DB): 에이전트 브라우저와 운영 브라우저를 별도 컨텍스트로 열어 변경·발견·조치·재확인, 갱신 시간 측정(<2s), SSE 끊김 중 변경 → 재연결 후 최신 반영.
- 문서: `README.md`, `DESIGN.md`, `TEST_REPORT.md`(실측값), `AI_USAGE.md`(실제 수행한 검토·수정만).

## 11. 빌더에게 맡기는 것
컴포넌트 구조, 스타일(깔끔한 운영 도구, 판정 배지 색), Nest 모듈 구성, 테스트 헬퍼.
