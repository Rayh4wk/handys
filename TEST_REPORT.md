# 시험 보고서

- 실행 일시: 2026-10-25 21:55–22:02 KST, 커밋 `a073c00` 기준
- 실행 구성: Node 22.20.0, PostgreSQL 15.13, Playwright 1.53.2 (Chromium)
- 실행한 명령: `npm test`, `npm run test:int`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run e2e` (e2e는 2회 연속, 모두 exit 0)

## 1. 실행 결과 요약

| 명령 | 결과 |
|---|---|
| `npm test` | 서버 Jest 2 suites, 18 passed / 웹 Vitest 5 files, 69 passed |
| `npm run test:int` | 6 suites, 38 passed (실제 PostgreSQL `handys_test`, 4.5 s) |
| `npm run e2e` | 웹·서버 빌드 후 Playwright 12 passed (14.6 s, 14.6 s), `handys_e2e` 초기화 후 서버 포트 3100 |
| `npm run lint` | `eslint . --max-warnings 0`, 출력 없음(0 problems) |
| `npm run typecheck` | server, web, e2e `tsc --noEmit` 오류 0 |

```
# npm test (apps/server)
PASS src/inspection/judge.spec.ts
PASS src/auth/session.spec.ts
Tests:       18 passed, 18 total
# npm test (apps/web)
 ✓ src/lib/kst.test.ts (9 tests)
 ✓ src/realtime/useRealtime.test.tsx (11 tests)
 ✓ src/auth/AuthProvider.test.tsx (1 test)
 ✓ src/pages/ReservationsPage.test.tsx (18 tests)
 ✓ src/pages/OperationsPage.test.tsx (30 tests)
      Tests  69 passed (69)

# npm run test:int
PASS test/events.int-spec.ts
PASS test/concurrency.int-spec.ts
PASS test/write-api.int-spec.ts
PASS test/read-api.int-spec.ts
PASS test/schema.int-spec.ts
PASS test/auth.int-spec.ts
Tests:       38 passed, 38 total

# npm run e2e
  ✓  1 demo-flow.spec.ts › demo flow: checkout change → conflict on ops → ops reschedules → agent sees normal (1.2s)
  ✓  2 realtime.spec.ts › measures cross-screen latency (1.1s)
  ✓  3 realtime.spec.ts › recovers after SSE disconnect (2.9s)
  ✓  4 realtime.spec.ts › recovers after network offline (1.8s)
  ✓  5 realtime.spec.ts › stale tab gets conflict notice (717ms)
  ✓  6 realtime.spec.ts › open ops form follows a remote change until edited (804ms)
  ✓  7 roles.spec.ts › agent cannot open the operations screen (250ms)
  ✓  8 roles.spec.ts › agent session gets 403 on the cleaning schedule API (236ms)
  ✓  9 roles.spec.ts › anonymous visitor is sent to the login page (99ms)
  ✓ 10 roles.spec.ts › wrong password shows a login error (276ms)
  ✓ 11 visual.spec.ts › login screen fits desktop and phone widths (212ms)
  ✓ 12 visual.spec.ts › role screens fit desktop and phone widths (1.1s)
  12 passed (14.6s)
```

테스트 계층: 판정 경계값은 단위 테스트(`judge.spec.ts`), 트랜잭션·잠금·동시 수정·권한은 실제 PostgreSQL을 쓰는 통합 테스트(`apps/server/test/*.int-spec.ts`, supertest), 두 화면 간 갱신·재연결은 빌드된 앱을 대상으로 한 Playwright 테스트(`e2e/tests`)에서 확인한다. 웹 단위 테스트는 `TZ=America/New_York`, e2e는 `timezoneId: America/New_York`에서 실행해 KST 변환이 브라우저 시간대에 의존하지 않음을 함께 확인한다.

## 2. GOAL §12 검증 항목

근거 표기: `[unit]` 서버 Jest, `[web]` Vitest, `[int]` 통합 테스트, `[e2e]` Playwright. 큰따옴표 안은 테스트 이름이다.

| # | 시험 조건 | 예상 결과 | 실제 결과 | 근거 |
|---|---|---|---|---|
| 1 | 체크아웃 11:00 → 13:00 변경, 청소 11:30 유지 | 불일치 검출 | `CONFLICT` / `CLEANING_BEFORE_CHECKOUT`, 결과 패널에 "청소 일정 조정 필요" | `[unit]` judge.spec "cleaning before checkout -> CONFLICT" / `[int]` write-api "detects conflict when checkout moves 11:00→13:00 while cleaning stays 11:30" / `[e2e]` demo-flow |
| 2 | 청소를 13:30으로 수정 | 재점검 결과 정상 | `NORMAL`, 운영 화면 "재점검 결과: 정상", 예약 화면도 정상으로 갱신 | `[int]` write-api "becomes NORMAL after ops moves cleaning to 13:30" / `[web]` OperationsPage "saves cleaning schedule and shows recheck result, keeping the detail panel" / `[e2e]` demo-flow |
| 3 | 청소와 체크아웃 시각이 같음 | 기준에 따라 정상 | 같으면 `NORMAL`, 1 ms 앞서면 `CONFLICT` | `[unit]` judge.spec "cleaning exactly at checkout -> NORMAL", "1ms before checkout -> CONFLICT" / `[int]` write-api "equal times are NORMAL" |
| 4 | 청소 작업 없음 | 확인 필요 표시 | 작업 없음·취소된 작업 모두 `NEEDS_CHECK`, 표에 "작업 없음" | `[unit]` judge.spec "no cleaning task -> NEEDS_CHECK", "cancelled cleaning -> NEEDS_CHECK" / `[int]` read-api "lists judged reservations for %s" (R-103) / `[web]` OperationsPage "shows 작업 없음 for R-103 and 정보 누락 for R-104" |
| 5 | 필수 시각 누락 | 판정 불가 및 원인 표시 | 체크아웃 누락 → `UNDETERMINED`/`MISSING_CHECKOUT_AT`(청소 유무와 무관), 청소 시각 누락 → `UNDETERMINED`/`MISSING_CLEANING_START`, 화면에 "정보 누락"과 근거 문구 | `[unit]` judge.spec "missing checkoutAt with cleaning -> UNDETERMINED", "missing checkoutAt without cleaning -> MISSING_CHECKOUT_AT", "missing scheduledStartAt -> UNDETERMINED", "reason text" / `[web]` ReservationsPage "renders the table with 정보 누락 for missing checkout and disabled change for cancelled" |
| 6 | 취소 예약 | 점검 대상 제외 | 시각이 충돌해도 `EXCLUDED`, 변경 시도는 422이고 판정은 `EXCLUDED` 유지, 변경 버튼 비활성 | `[unit]` judge.spec "cancelled reservation -> EXCLUDED even if conflicting" / `[int]` write-api "cancelled reservation change is 422 and inspection stays EXCLUDED" / `[web]` ReservationsPage (#5와 같은 테스트) |
| 7 | 판정 저장 중 오류 | 예약 변경까지 롤백 | `InspectionRepository.upsert` 실패 시 500, 체크아웃·청소 시각과 version 원래 값, 이력 0건, 점검 결과 이전 값. SSE 미발행 | `[int]` write-api "rolls back reservation change when inspection save fails", "emits nothing when the transaction fails" |
| 8 | 두 사용자가 같은 데이터를 수정 | 오래된 버전의 덮어쓰기 방지 | 오래된 version은 409 + `current`, DB 변경 없음. 같은 version 동시 요청은 [200, 409]. 편집 폼은 입력값의 기준 version을 보낸다. 입력칸을 건드리지 않았으면 새 값·version을 따라가고, 고친 뒤라면 입력값과 이전 version을 유지하고 "다른 사용자가 HH:mm으로 변경했습니다"·"최신 값 불러오기"를 표시(저장 시 409). 409 시 안내 후 최신 값으로 재설정 | `[int]` write-api "stale version returns 409 with current view and changes nothing", concurrency "only one of two concurrent writers with same version wins" / `[web]` OperationsPage "follows a newer cleaning value (and its version) while the input is untouched", "keeps a typed value and its old version after a remote change, with a notice", ReservationsPage "follows a newer checkout …", "keeps a typed checkout …", 두 화면 "'최신 값 불러오기' adopts …", "treats a 409 without current as a conflict: notice, refetch, reset to latest", "shows conflict notice on 409 …" / `[e2e]` realtime "stale tab gets conflict notice", "open ops form follows a remote change until edited" |
| 9 | 예약과 청소 일정 동시 수정 | 최종 저장값과 점검 결과 일치 | 체크아웃·청소 동시 변경 20회 반복 후 `judge(최종 DB 값)` = 저장된 판정, 이력 40건. 전체 재점검과 변경이 겹쳐도 오래된 판정을 쓰지 않음 | `[int]` concurrency "concurrent checkout and cleaning edits leave inspection consistent with final values", "concurrent runAll and checkout change leave inspection consistent with final values", "runAll waits for the reservation lock and never writes a stale judgment" |
| 10 | 다른 운영 화면을 열어 둔 상태에서 변경 | 정상 연결 시 2초 안에 갱신 | 5회 측정 최대 4 ms(응답 종료 기준), 36 ms(요청 시작 기준). 데모 흐름에서 운영·예약 화면 모두 e2e 대기 제한 2초 안에 갱신(정밀한 값은 지연 측정 테스트) | `[e2e]` realtime "measures cross-screen latency", demo-flow / `[int]` events "streams reservation.updated as an unnamed event after a change", write-api "emits SSE only after commit" / `[web]` useRealtime "invalidates reservation queries on reservation.updated" |
| 11 | SSE 연결 해제 중 변경 | 재연결 후 최신 상태 복구 | 끊긴 동안(2초) 이전 값 유지 + 끊김 경고, 다시 연결 후 2초 안에 최신 값. 네트워크 오프라인(1초) 후 복구 시 최신 값과 연결 상태 복원(약 0.6초, Task 9 보고) | `[e2e]` realtime "recovers after SSE disconnect", "recovers after network offline" / `[web]` useRealtime "invalidates all queries when connection opens", "goes to reconnecting on error and recreates after 3s when CLOSED", "pause closes the EventSource and sets disconnected", "resume opens a new one" |
| 12 | BE 재시작 | 저장된 예약·점검·이력 유지 | 변경 후 Nest 앱을 닫고 새로 생성해도 체크아웃·version·판정(`CONFLICT`)·이력(처리자 포함) 유지. 종료 시 열린 SSE 스트림이 닫혀 종료가 멈추지 않음 | `[int]` write-api "persists after app restart", events "app.close() completes open SSE streams instead of hanging" |
| 13 | 동일 점검 반복 | 결과 중복 생성 없음 | 전체 재점검 3회 후 점검 결과 6건 그대로, 판정 동일. 같은 예약의 두 번째 퇴실 청소 작업은 DB가 거부 | `[int]` read-api "run is ops-only and idempotent", schema "rejects a second CHECKOUT task for the same reservation", "allows a STAYOVER task next to a CHECKOUT task" |

참고: #12는 같은 테스트 프로세스 안에서 Nest 애플리케이션을 닫았다가 다시 만드는 방식이다. 운영체제 프로세스 재시작이나 컨테이너 재시작은 자동 테스트하지 않았다. 세션은 서명 쿠키라 서버 메모리 상태가 없다.

## 3. 갱신 지연 실측 (#10)

- 측정: `e2e/tests/realtime.spec.ts` "measures cross-screen latency". R-106의 체크아웃을 번갈아 바꿔 정상 ↔ 불일치를 5회 만든다.
- 방법: 예약 담당자 브라우저의 PATCH 시각은 Playwright `request.timing()`(요청 시작·응답 종료, epoch ms)에서 얻는다. 운영 브라우저에서는 MutationObserver가 판정 배지의 `data-status`가 바뀐 순간의 `Date.now()`를 기록한다. 두 브라우저는 같은 기계의 시계를 쓴다.
- 서버는 커밋 직후 SSE를 보내고 그다음 PATCH 응답을 쓰므로, 응답 종료 기준 값은 거의 0에 가깝다. 요청 시작 기준 값은 저장 왕복 시간을 포함한다.
- 결과 파일: `e2e/latency.json`(생성물, gitignore 대상). 아래는 이번 실행(2026-10-25 21:06 KST) 값이다.

| 기준 | 표본(ms) | 최소 / 최대 / 평균 | 목표 |
|---|---|---|---|
| 저장 응답 종료 → 운영 화면 배지 변경 | 4, 2, 3, 2, 2 | 2 / 4 / 3 | 2000 ms |
| 저장 요청 시작 → 운영 화면 배지 변경 | 36, 9, 11, 22, 8 | 8 / 36 / 17 | 2000 ms |

같은 기계, localhost, 브라우저 2개 기준이다. 실제 네트워크 지연이나 동시 접속 부하는 반영되지 않았다. Task 9 구현 당시 두 차례 실행 값도 같은 범위였다(응답 종료 기준 2~4 ms, 요청 시작 기준 9~39 ms).

## 4. 역할·권한 및 기타 항목

| 시험 조건 | 예상 결과 | 실제 결과 | 근거 |
|---|---|---|---|
| 비로그인으로 API 호출 | 401 | 조회·변경·SSE 모두 401 | `[int]` read-api "requires login", events "requires login", write-api "enforces roles on the server", auth "me returns the logged-in account; 401 without or with tampered cookie" |
| 비로그인으로 화면 접근 | 로그인 화면으로 이동 | `/login`으로 이동 | `[e2e]` roles "anonymous visitor is sent to the login page" |
| 예약 담당자가 청소 일정 변경 API 호출 | 403, 데이터 변경 없음 | 403, 스냅샷 동일 | `[int]` write-api "enforces roles on the server", auth "role guard › agent gets 403, ops gets 200, anonymous gets 401" / `[e2e]` roles "agent session gets 403 on the cleaning schedule API" |
| 현장 운영 담당자가 체크아웃 변경 API 호출 | 403, 데이터 변경 없음 | 403, 스냅샷 동일 | `[int]` write-api "enforces roles on the server" |
| 예약 담당자가 `/operations` 접근 | 전용 화면 안내, 운영 화면 미표시 | 안내 표시 | `[e2e]` roles "agent cannot open the operations screen" |
| 요청 본문에 `actorId`·`role` 포함 | 400, 변경 없음 | 400, 스냅샷 동일 | `[int]` write-api "rejects body-supplied actor or role" |
| 이력의 처리자 | 세션 계정과 사유 기록 | `actor` = 세션 계정(이름·역할), 사유 기록, 빈 메모는 NULL | `[int]` write-api "audit logs record reason and session actor", "stores empty cleaning reason as null" |
| 두 역할의 조회 | 둘 다 판정 목록 조회 가능 | 200, 판정 포함 | `[int]` read-api "lists judged reservations for %s" (ops, agent) |
| 세션 쿠키 변조·다른 키 | 거부 | 거부 | `[unit]` session.spec "rejects a tampered signature", "rejects a swapped id", "rejects a different secret", "rejects undefined and malformed tokens" |
| 빈 `SESSION_SECRET` | 기본 키로 대체 | 미설정·빈 문자열 모두 기본 키 | `[unit]` session.spec "falls back when SESSION_SECRET is unset or empty" |
| 잘못된 비밀번호, 로그인·로그아웃 | 401·오류 표시 / HttpOnly 쿠키 / 쿠키 삭제 | 기대대로 동작 | `[int]` auth "rejects a wrong password", "logs in with an HttpOnly sid cookie", "logout clears the session" / `[e2e]` roles "wrong password shows a login error" / `[web]` AuthProvider "clears me when a mutation fails with 401" |
| 잘못된 입력(존재하지 않는 날짜, 오프셋 없는 시각, 소수 version, 누락 필드, 빈 사유) | 400 | 400 | `[int]` write-api "rejects invalid input" |
| 없는 예약·작업, 재실 청소 작업 변경 | 404 / 422 | 404, 404, 422 | `[int]` write-api "unknown reservation 404, unknown task 404, STAYOVER task 422" |
| 취소된 청소 작업 변경 | 422 `CLEANING_TASK_CANCELLED`, 변경 없음 | 422, DB 스냅샷 동일, 이력 0건 | `[int]` write-api "rescheduling a cancelled cleaning task is 422 and changes nothing" |
| 전체 재점검 권한 | 운영 담당만 200 | 예약 담당 403, 운영 담당 200 | `[int]` read-api "run is ops-only and idempotent" |
| 저장 실패 문구 | 서버·영문 메시지 미노출 | 알려진 코드는 한국어, 그 밖의 400·5xx·네트워크 오류는 공통 문구. 사유·메모 200자 제한 | `[web]` OperationsPage "maps %i %s to Korean", "shows a generic Korean message for unmapped failures (%s)", "caps the memo at 200 characters" / ReservationsPage "shows error notice on other failures", "caps the reason at 200 characters" |
| 재점검 결과 표시 | 이후 판정이 바뀌면 사라짐 | 새 판정(checkedAt 변경) 도착 시 숨김 | `[web]` OperationsPage "hides the recheck result once a newer judgment arrives" |
| 결과 패널 청소 시작 | 저장 시점 값 유지, 변경 시 현재 값 추가 | "기존 청소 시작: 11:30" 유지, "현재 청소 시작: 13:30" 추가 | `[web]` ReservationsPage "keeps the cleaning start from save time and shows the current one when it changes" |
| 시각 저장 형식 | `timestamptz` | `timestamptz`로 저장, 시점 일치 | `[int]` schema "stores timestamptz" |
| KST 입력·표시 변환 | 브라우저 시간대와 무관하게 KST | 날짜 경계 포함 왕복 일치 | `[web]` kst "kstInputToIso converts KST local input to UTC ISO", "round-trips across the date boundary" 외 |
| 운영 화면 실시간 알림 | 판정이 바뀌거나 새로 온 행 강조, 탭 제목에 조치 필요 건수, 스크린리더 안내 | 첫 로드는 강조 없음, 변경 행만 강조(동작 줄이기 설정에서는 정지 강조), "(3) 청소 일정 점검", "R-107 불일치, R-104 정상으로 변경" | `[web]` OperationsPage "highlights and announces rows whose judgment changed, not the first load", "puts the action-required count in the tab title" |
| 운영 목록 정렬·효율 | 판정 우선순위 안에서 청소 시작 오름차순(없음은 뒤), 남은 시간, j/k·화살표 이동, Enter로 청소 입력칸, 체크아웃 +30분, 체크아웃보다 이른 시각 경고(저장은 허용) | 기대대로 동작 | `[web]` OperationsPage "sorts each status group by cleaning start, missing last, then id", "shows how far away each cleaning start is", "rows are buttons named by reservation; j/k and arrows move the selection", "Enter on a row opens it and focuses the cleaning input", "shows the checkout next to the cleaning input, fills +30 min and warns when earlier" / kst "relativeToNow" |
| 결과 패널 안내·표시 | 결과가 비어 있는 live region으로 안내, 판정 배지 1개, 운영 조치자·시각 표시, 날짜가 갈리면 날짜 포함 | 기대대로 동작 | `[web]` ReservationsPage "announces through a live region that exists before the result", "shows one judgment badge and demotes the change button while a result is shown", "credits the operations fix when the judgment becomes NORMAL", "adds dates to the result when the times span two days" |
| 좁은 화면 상세 닫기 | "목록으로"로 닫고 행으로 포커스 복귀 | 기대대로 동작 | `[web]` OperationsPage "목록으로 closes the detail panel and returns focus to the row" |
| 화면 폭 1280px / 390px | 가로 스크롤 없음, 주요 영역 표시 | 통과 | `[e2e]` visual "login screen fits desktop and phone widths", "role screens fit desktop and phone widths" |

## 5. 검증 범위 밖

- 실제 청소 담당자가 변경 내용을 전달받고 확인했는지는 검증 범위 밖이다. 청소 담당자 화면을 구현하지 않았다.
- 정상 판정은 시간상 충돌이 없다는 뜻이다. 인력 확보, 다음 입실 전 청소 완료, 실제 퇴실 여부는 확인하지 않는다.
- 운영 시간 절감이나 고객 불편 감소는 측정하지 않았다.

## 6. 미해결 사항과 한계

| 항목 | 내용 |
|---|---|
| 커밋 후 알림 유실 | 커밋 직후 SSE 발행 전에 서버가 종료되면 그 알림은 사라진다. 재연결 시 전체 재조회 또는 30초 주기 재조회로 복구한다. 이벤트 저장·재생은 범위 밖이다. |
| BE 재시작 시험 방식 | #12는 프로세스 내 앱 재생성으로 확인했다. 실제 프로세스·컨테이너 재시작은 자동화하지 않았다. |
| 타입 정보 기반 lint 미사용 | ESLint는 typescript-eslint `recommended`(타입 정보 미사용)다. `no-floating-promises` 같은 규칙은 적용되지 않는다. |
| 세션 | 만료·폐기·`Secure` 플래그가 없다. 데모 계정 범위로 둔 결정이다. |
| 시드 재실행 | `prisma db seed` 자체는 멱등이 아니다(같은 id로 `create`). 로컬은 `npm run setup`이 DB를 초기화하고, Docker는 예약이 0건일 때만 시드한다. |
| 전체 재점검 중 예약 삭제 | `runAll` 도중 예약이 삭제되면 그 지점에서 중단된다. 예약 삭제 기능이 없어 현재 경로로는 발생하지 않는다. |
| 판정 입력의 Invalid Date | `judge`는 `NaN` 시각을 거르지 않는다. 입력은 DB `timestamptz`와 검증된 ISO 문자열에서만 오므로 현재 경로로는 도달하지 않는다. |
| 웹 폰트 | Pretendard를 CDN(jsDelivr)에서 받는다. 오프라인이면 시스템 한글 글꼴로 대체된다. |
| 날짜 입력 표시 형식 | `datetime-local` 입력칸 표시 형식은 브라우저 로캘을 따른다. 저장소의 스크린샷은 en-US 헤드리스 Chromium에서 찍었다. |
| e2e 테스트 격리 | e2e는 DB 하나를 순서대로(`workers: 1`) 쓰며, 테스트마다 다른 예약을 쓰거나 현재 값 기준으로 상대 변경한다. demo-flow만 시드 직후 값(R-101)을 전제한다. |
