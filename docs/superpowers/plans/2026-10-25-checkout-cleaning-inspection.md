# 퇴실 청소 일정 불일치 점검 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 체크아웃 변경 후 퇴실 청소 시작 시각 불일치를 자동 판정하고, 청소 일정 수정 → 재점검 → 다른 화면 실시간 갱신까지 완결하는 웹 도구.

**Architecture:** NestJS 단일 인스턴스가 `/api` REST + `/api/events` SSE를 제공하고 빌드된 React SPA를 정적 서빙한다. 모든 쓰기는 예약 행 `FOR UPDATE` 잠금 + 버전 비교 + 판정 upsert + 이력 insert를 하나의 Prisma 트랜잭션으로 처리하고, 커밋 후에만 SSE 신호를 보낸다. FE는 TanStack Query로 조회하며 SSE 신호·재연결·30초 주기·포커스 복귀 시 재조회한다.

**Tech Stack:** Node 22, NestJS 10, Prisma 5, PostgreSQL 15+, Jest + supertest, React 18 + Vite 5 + TypeScript, TanStack Query 5, react-router-dom 6, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-25-checkout-cleaning-inspection-design.md` (원본 요구 `GOAL.md`). 구현자는 spec을 반드시 읽는다.

## Global Constraints

- 판정 상태 정확히 5개: `NORMAL`, `CONFLICT`, `NEEDS_CHECK`, `UNDETERMINED`, `EXCLUDED`. 표시명: 정상 / 불일치 / 확인 필요 / 판정 불가 / 점검 대상 제외.
- Reason code 6개와 문구(고정 copy):
  - `RESERVATION_CANCELLED` → "취소된 예약으로 점검 대상에서 제외"
  - `MISSING_CHECKOUT_AT` → "체크아웃 예정 시각 없음"
  - `NO_CHECKOUT_CLEANING_TASK` → "대응하는 퇴실 청소 작업 없음"
  - `MISSING_CLEANING_START` → "청소 시작 예정 시각 없음"
  - `CLEANING_BEFORE_CHECKOUT` → "체크아웃 이전에 청소 시작 예정"
  - `CLEANING_AFTER_CHECKOUT` → "체크아웃 이후 청소 시작 예정"
- 경계: 청소 시작 == 체크아웃 → `NORMAL`.
- 모든 API는 `/api` 접두사. 시각은 DB `timestamptz`, API는 ISO8601 UTC(`toISOString()`), 화면은 `Asia/Seoul` 표시.
- 쓰기 입력 시각은 오프셋(`Z` 또는 `±HH:MM`) 필수, 없으면 400.
- 처리자 고정 `demo-operator`.
- SSE 이벤트 payload 정확히 `{"type":"reservation.updated","reservationId":"R-101","version":4}`; 커밋 성공 후에만 emit.
- 재조회 주기 30초, 다른 화면 반영 목표 2초 이내.
- Redis, 별도 Push 서버, 이벤트 영구 보관 금지.
- 로컬 DB: `DATABASE_URL` env (dev 기본 `postgresql://$USER@localhost:5432/handys`, 통합테스트 `handys_test`, e2e `handys_e2e`). `.env`는 커밋하지 않고 `.env.example`을 커밋.
- 병렬 작업 중이므로 **구현자는 자기 Task의 Files에 나열된 경로만 `git add` 하여 커밋**한다(`git add -A` 금지). `index.lock` 충돌 시 잠시 후 재시도.

## Review Focus

1. 오프셋 없는 시각 입력(`2026-10-26T13:00`) — 서버 시간대에 따라 다르게 해석되면 안 됨 → 400. (Task 5 테스트)
2. 브라우저 시간대가 KST가 아닌 운영자 — datetime-local 입력은 항상 KST로 해석·표시되어야 함. (Task 6 유닛 테스트 `kst.ts`, Task 7 e2e `timezoneId: 'America/New_York'`)
3. 저장 버튼 연타/두 탭 동시 저장 — 두 번째 요청은 409, 화면은 최신 상태를 재조회하고 안내 문구 표시. (Task 5 통합 + Task 6 UI)
4. 트랜잭션 실패 시 SSE 신호 미발송 — 실패한 변경이 다른 화면 재조회를 유발하거나 상태를 바꾸면 안 됨. (Task 5 테스트)
5. 존재하지 않는 id / 취소 예약 변경 — 404 / 422, 이력·판정 불변. (Task 5 테스트)

---

## 파일 구조

```
package.json                     루트 스크립트 (install:all, build, test, test:int, e2e, start)
.env.example
server/
  package.json, tsconfig*.json, nest-cli.json, jest.config.js, jest.int.config.js
  prisma/schema.prisma
  prisma/migrations/<ts>_init/migration.sql   (부분 유니크 인덱스 포함)
  prisma/seed.ts                  시드 + 전체 점검
  src/main.ts                     /api prefix, ValidationPipe, enableShutdownHooks
  src/app.module.ts
  src/prisma/prisma.service.ts, prisma.module.ts
  src/inspection/judge.ts         순수 판정 함수 + 문구
  src/inspection/inspection.repository.ts
  src/inspection/inspection.service.ts
  src/inspection/inspection.controller.ts   GET /inspection-results, POST /inspection-results/run
  src/reservations/reservation-view.ts       toReservationView
  src/reservations/reservations.controller.ts GET /reservations, PATCH checkout, GET audit-logs
  src/reservations/reservations.service.ts   조회
  src/changes/change.service.ts              두 쓰기 경로 공통 트랜잭션
  src/changes/dto.ts
  src/cleaning/cleaning.controller.ts        PATCH /cleaning-tasks/:id/schedule
  src/events/events.service.ts, events.controller.ts
  test/helpers.ts                 앱 생성, DB 리셋+시드
  test/*.int-spec.ts
  src/inspection/judge.spec.ts
web/
  package.json, vite.config.ts (proxy /api → :3000), index.html, tsconfig.json
  src/main.tsx, App.tsx (router: /reservations, /ops, / → /ops)
  src/api/types.ts, src/api/client.ts
  src/realtime/useRealtime.tsx    EventSource 훅 + context
  src/lib/kst.ts (+ kst.test.ts, vitest)
  src/components/Header.tsx, StatusBadge.tsx
  src/pages/ReservationsPage.tsx, OpsPage.tsx, AuditLogList.tsx
  src/styles.css
e2e/
  package.json, playwright.config.ts, tests/*.spec.ts, global-setup.ts
Dockerfile, docker-compose.yml, .dockerignore
README.md, DESIGN.md, TEST_REPORT.md, AI_USAGE.md
```

## 실행 순서 (Waves)

| Wave | Tasks (병렬) | 선행 |
|---|---|---|
| 1 | Task 1 (server 스캐폴드+DB), Task 2 (web 스캐폴드+kst) | 없음 |
| 2 | Task 3 (판정+조회 API), Task 4 (web API 클라이언트+실시간 훅+헤더) | W1 |
| 3 | Task 5 (쓰기 경로+SSE), Task 6 (web 화면) | W2 |
| 4 | Task 7 (정적 서빙+Playwright+Docker) | W3 |
| 5 | Task 8 (제출 문서) | W4 |

---

### Task 1: 서버 스캐폴드, Prisma 스키마, 시드

**Files:**
- Create: `package.json`(루트), `.env.example`, `server/**` 설정 파일, `server/prisma/schema.prisma`, `server/prisma/migrations/*_init/migration.sql`, `server/prisma/seed.ts`, `server/src/main.ts`, `server/src/app.module.ts`, `server/src/prisma/prisma.service.ts`, `server/src/prisma/prisma.module.ts`, `server/test/helpers.ts`, `server/test/schema.int-spec.ts`, `server/jest.config.js`, `server/jest.int.config.js`

**Interfaces:**
- Produces:
  - Prisma models `Reservation{id, roomId, guestName, checkoutAt: Date|null, status: ReservationStatus, version, updatedAt, cleaningTasks, inspection, auditLogs}`, `CleaningTask{id, reservationId, type: CleaningType, scheduledStartAt: Date|null, status: CleaningStatus, version, updatedAt}`, `InspectionResult{reservationId, status: InspectionStatus, reasonCode: string, checkedAt}`, `AuditLog{id: bigint, reservationId, action, before: Json, after: Json, actorId, createdAt}`; enums `ReservationStatus{CONFIRMED,CANCELLED}`, `CleaningType{CHECKOUT,STAYOVER}`, `CleaningStatus{SCHEDULED,CANCELLED}`, `InspectionStatus{NORMAL,CONFLICT,NEEDS_CHECK,UNDETERMINED,EXCLUDED}`. 테이블명 `@@map`으로 `reservations`, `cleaning_tasks`, `inspection_results`, `audit_logs`, 컬럼 snake_case `@map`, 시각 `@db.Timestamptz(3)`.
  - `PrismaService extends PrismaClient` (global `PrismaModule`).
  - `seedDatabase(prisma: PrismaClient): Promise<void>` exported from `server/prisma/seed.ts` (spec §9 데이터; 점검 결과 생성은 Task 3에서 seed 끝에 `runAll` 호출로 추가 — Task 1에서는 seed가 예약·청소만 넣는다).
  - `test/helpers.ts`: `resetDb(prisma): Promise<void>` (TRUNCATE 4 테이블 CASCADE 후 `seedDatabase`), `createTestApp(overrides?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication>` (main.ts와 같은 prefix/pipe 설정; `configureApp(app)`를 `src/main.ts`에서 export하여 공유).
  - server scripts: `build`, `start:prod`(`node dist/src/main.js` 또는 nest 출력 경로), `test`(unit, `src/**/*.spec.ts`), `test:int`(`DATABASE_URL`=handys_test로 `prisma migrate reset --force --skip-seed` 후 jest `test/**/*.int-spec.ts --runInBand`), `db:migrate`(`prisma migrate deploy`), `db:seed`.
  - 루트 scripts: `install:all`, `build`(web → server), `test`, `test:int`, `e2e`, `start`.

- [ ] **Step 1:** Nest 10 프로젝트를 `server/`에 수동 생성(@nestjs/cli 사용 가능, git init 하지 말 것), Prisma 5 설치, schema 작성. 시드 데이터(기준일 2026-10-26, KST `+09:00`):
  - R-101 room 301, 체크아웃 11:00, C-101 CHECKOUT 11:30
  - R-102 room 302, 13:00, C-102 13:30
  - R-103 room 303, 12:00, C-103 **STAYOVER** 14:00 (퇴실 청소 없음)
  - R-104 room 304, 체크아웃 null, C-104 CHECKOUT 12:30
  - R-105 room 305, CANCELLED, 체크아웃 11:00, C-105 CHECKOUT 12:00
  - R-106 room 306, 11:00, C-106 CHECKOUT 11:00
  - guestName은 임의 가명(예: "김하늘").
- [ ] **Step 2:** `prisma migrate dev --name init --create-only`로 마이그레이션 생성 후 SQL 끝에 추가: `CREATE UNIQUE INDEX "cleaning_tasks_one_checkout_per_reservation" ON "cleaning_tasks"("reservation_id") WHERE "type" = 'CHECKOUT';` 로컬 DB `handys`, `handys_test`, `handys_e2e` 생성(`createdb`).
- [ ] **Step 3: 실패 테스트 작성** `server/test/schema.int-spec.ts`:
  - `seeds six reservations` — `resetDb` 후 `reservation.count() === 6`.
  - `rejects a second CHECKOUT task for the same reservation` — R-102에 CHECKOUT 작업 추가 시 `create` reject(P2002).
  - `allows a STAYOVER task next to a CHECKOUT task` — R-102에 STAYOVER 추가 성공.
  - `stores timestamptz` — R-101 `checkoutAt.toISOString() === '2026-10-26T02:00:00.000Z'`.
- [ ] **Step 4:** `npm run test:int --prefix server` → PASS.
- [ ] **Step 5:** `npm run build --prefix server` 성공, `npm run start:prod --prefix server` 후 `curl localhost:3000/api` 가 Nest 404 JSON 반환(앱 기동 확인) 후 종료.
- [ ] **Step 6: Commit** `feat(server): scaffold NestJS + Prisma schema and seed`

### Task 2: 웹 스캐폴드 + KST 변환 유틸

**Files:**
- Create: `web/**` (Vite react-ts), `web/src/lib/kst.ts`, `web/src/lib/kst.test.ts`

**Interfaces:**
- Produces (`web/src/lib/kst.ts`):
  - `formatKst(iso: string | null): string` → `"10/26 13:00"` 형식(`MM/DD HH:mm`), null → `""`(호출 측이 "정보 누락"/"작업 없음" 표시).
  - `formatKstDateTime(iso: string): string` → `"2026-10-26 13:00:05"` (이력·마지막 갱신용).
  - `isoToKstInput(iso: string | null): string` → datetime-local 값 `"2026-10-26T13:00"`, null → `""`.
  - `kstInputToIso(value: string): string` → `"2026-10-26T13:00"` → `"2026-10-26T04:00:00.000Z"`; 형식 불일치 시 throw.
  - 모두 브라우저 시간대와 무관해야 함(`Intl.DateTimeFormat` with `timeZone: 'Asia/Seoul'` 또는 고정 +9h 산술).
- web scripts: `dev`(vite, proxy `/api` → `http://localhost:3000`, SSE 위해 proxy 기본값으로 충분), `build`, `test`(vitest run).

- [ ] **Step 1: 실패 테스트** `kst.test.ts` (vitest), `process.env.TZ`와 무관해야 하므로 `vitest` 실행을 `TZ=America/New_York`로 하는 script `test` 설정:
  - `kstInputToIso('2026-10-26T13:00') === '2026-10-26T04:00:00.000Z'`
  - `isoToKstInput('2026-10-26T04:00:00.000Z') === '2026-10-26T13:00'`
  - `formatKst('2026-10-26T02:30:00.000Z') === '10/26 11:30'`
  - `formatKst(null) === ''`
  - `kstInputToIso('garbage')` throws
  - 왕복: `isoToKstInput(kstInputToIso('2026-10-26T00:15')) === '2026-10-26T00:15'` (날짜 경계)
- [ ] **Step 2:** `npm test --prefix web` → FAIL.
- [ ] **Step 3:** 구현 → PASS. `npm run build --prefix web` 성공.
- [ ] **Step 4: Commit** `feat(web): scaffold Vite React app with KST time utils`

### Task 3: 판정 함수 + 점검 서비스 + 조회 API

**Files:**
- Create: `server/src/inspection/judge.ts`, `judge.spec.ts`, `inspection.repository.ts`, `inspection.service.ts`, `inspection.controller.ts`, `inspection.module.ts`, `server/src/reservations/reservation-view.ts`, `reservations.service.ts`, `reservations.controller.ts`, `reservations.module.ts`, `server/test/read-api.int-spec.ts`
- Modify: `server/src/app.module.ts`, `server/prisma/seed.ts`(끝에 전체 점검)

**Interfaces:**
- Consumes: Task 1 Prisma models, `PrismaService`, `createTestApp`, `resetDb`.
- Produces:
  - `judge.ts`: `type InspectionStatusCode = 'NORMAL'|'CONFLICT'|'NEEDS_CHECK'|'UNDETERMINED'|'EXCLUDED'`; `type ReasonCode` (6개); `interface JudgeInput { reservationStatus: 'CONFIRMED'|'CANCELLED'; checkoutAt: Date|null; checkoutCleaning: { status: 'SCHEDULED'|'CANCELLED'; scheduledStartAt: Date|null } | null }`; `interface JudgeResult { status: InspectionStatusCode; reasonCode: ReasonCode }`; `judge(input: JudgeInput): JudgeResult`; `REASON_TEXT: Record<ReasonCode, string>` (Global Constraints 문구); 규칙 순서는 spec §3.
  - `type Tx = Prisma.TransactionClient`.
  - `InspectionRepository.upsert(tx: Tx, reservationId: string, result: JudgeResult, checkedAt: Date): Promise<void>` (reservationId 기준 upsert).
  - `InspectionService.recheck(tx: Tx, reservationId: string): Promise<JudgeResult>` — tx로 예약과 `type=CHECKOUT` 작업 조회 → judge → repository.upsert.
  - `InspectionService.runAll(): Promise<{ checked: number }>` — 예약마다 각자 트랜잭션으로 recheck.
  - `reservation-view.ts`: `interface ReservationView { id; roomId; guestName; checkoutAt: string|null; status: 'CONFIRMED'|'CANCELLED'; version: number; cleaningTask: { id; scheduledStartAt: string|null; status; version } | null; inspection: { status; reasonCode; reasonText; checkedAt: string } | null }`; `RESERVATION_VIEW_INCLUDE` (Prisma include: CHECKOUT 작업, inspection); `toReservationView(row): ReservationView`. `cleaningTask`는 CHECKOUT 타입만(취소 작업도 포함하여 보여주되 판정은 judge가 처리).
  - `ReservationsService.list(): Promise<ReservationView[]>` (id asc), `ReservationsService.getView(tx: Tx | PrismaService, id: string): Promise<ReservationView>` (없으면 `NotFoundException`), `ReservationsService.auditLogs(id): Promise<AuditLogView[]>` with `AuditLogView { id: string; action; before; after; actorId; createdAt: string }` 최신순, 없는 예약 404.
  - HTTP: `GET /api/reservations`, `GET /api/reservations/:id/audit-logs`, `GET /api/inspection-results?status=CONFLICT` → `ReservationView[]` 중 inspection.status 필터(잘못된 status 값 → 400), `POST /api/inspection-results/run` → `{checked}`.
  - `seed.ts`: seed 후 각 예약 판정 생성(judge + upsert 직접 사용 가능).

- [ ] **Step 1: 실패 테스트** `judge.spec.ts` (기준 checkout = `2026-10-26T04:00:00Z`):
  - cleaning 02:30Z → `{CONFLICT, CLEANING_BEFORE_CHECKOUT}`
  - cleaning 04:30Z → `{NORMAL, CLEANING_AFTER_CHECKOUT}`
  - cleaning 04:00Z(동일) → NORMAL
  - cleaning 03:59:59.999Z → CONFLICT
  - checkoutCleaning null → `{NEEDS_CHECK, NO_CHECKOUT_CLEANING_TASK}` (**NORMAL 아님**)
  - cleaning status CANCELLED → NEEDS_CHECK
  - checkoutAt null + cleaning 있음 → `{UNDETERMINED, MISSING_CHECKOUT_AT}`
  - checkoutAt null + cleaning null → UNDETERMINED / MISSING_CHECKOUT_AT
  - scheduledStartAt null → `{UNDETERMINED, MISSING_CLEANING_START}`
  - reservation CANCELLED (+ 충돌 시각) → `{EXCLUDED, RESERVATION_CANCELLED}`
  - `REASON_TEXT.CLEANING_BEFORE_CHECKOUT === '체크아웃 이전에 청소 시작 예정'`
- [ ] **Step 2:** `npm test --prefix server` → FAIL, 구현 → PASS.
- [ ] **Step 3: 실패 테스트** `read-api.int-spec.ts`:
  - `GET /api/reservations` 시드 후: R-101 NORMAL, R-102 NORMAL, R-103 NEEDS_CHECK(cleaningTask null — STAYOVER 제외), R-104 UNDETERMINED + reasonText "체크아웃 예정 시각 없음", R-105 EXCLUDED, R-106 NORMAL. 6건 id 오름차순.
  - `GET /api/inspection-results?status=NEEDS_CHECK` → `['R-103']`; `?status=BOGUS` → 400.
  - `POST /api/inspection-results/run` 3회 → `inspection_results` count 6 유지, 상태 동일.
  - `GET /api/reservations/R-999/audit-logs` → 404; R-101 → `[]`.
- [ ] **Step 4:** `npm run test:int --prefix server` → PASS.
- [ ] **Step 5: Commit** `feat(server): inspection rules, recheck service and read APIs`

### Task 4: 웹 API 클라이언트 + 실시간 훅 + 헤더

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/realtime/useRealtime.tsx`, `web/src/components/Header.tsx`, `web/src/components/StatusBadge.tsx`, `web/src/App.tsx`(라우터 골격, 빈 페이지 placeholder), `web/src/main.tsx`, `web/src/styles.css`, `web/src/realtime/useRealtime.test.tsx`

**Interfaces:**
- Consumes: Task 2 `kst.ts`; spec §7 API 계약(`ReservationView` 형태는 Task 3과 동일 — types.ts에 그대로 정의).
- Produces:
  - `types.ts`: `ReservationView`, `AuditLogView`, `InspectionStatus`, `STATUS_LABEL: Record<InspectionStatus,string>`(정상/불일치/확인 필요/판정 불가/점검 대상 제외).
  - `client.ts`: `class ApiError extends Error { status: number; body: unknown }`; `api.listReservations(): Promise<ReservationView[]>`; `api.listInspections(status?: InspectionStatus)`; `api.auditLogs(id)`; `api.changeCheckout(id, {checkoutAt, version}): Promise<ReservationView>`; `api.rescheduleCleaning(taskId, {scheduledStartAt, version}): Promise<ReservationView>`; `api.runInspection()`. Query keys: `queryKeys = { reservations: ['reservations'], inspections: (s?) => ['inspection-results', s ?? 'ALL'], auditLogs: (id) => ['audit-logs', id] }`.
  - `useRealtime.tsx`: `RealtimeProvider` (QueryClient 사용, EventSource(`/api/events`) 1개), `useRealtime(): { state: 'connecting'|'open'|'reconnecting'|'disconnected'; lastUpdatedAt: Date|null; lastEventAt: Date|null; paused: boolean; pause(): void; resume(): void }`. 동작: open 시 `invalidateQueries()` 전체; `reservation.updated` 메시지 시 reservations, inspection-results, `['audit-logs', reservationId]` invalidate; onerror 시 `reconnecting`(브라우저 자동 재연결), `pause()`는 EventSource close 후 `disconnected`, `resume()`은 새로 연결. `lastUpdatedAt`은 reservations 쿼리 `dataUpdatedAt` 기반. 이벤트 수신 시 `window.__lastSseEvent = {receivedAt: performance.timeOrigin + performance.now(), data}` 기록(e2e 지연 측정용).
  - QueryClient 기본: `refetchInterval: 30_000`, `refetchOnWindowFocus: true`, `staleTime: 0`.
  - `Header`: 내비(예약 변경 `/reservations`, 운영 점검 `/ops`), 연결 상태 배지(연결됨/재연결 중/끊김) `data-testid="sse-state"` 에 state 값을 `data-state` 속성으로, 마지막 갱신 `data-testid="last-updated"`, 토글 버튼 `data-testid="sse-toggle"`("실시간 연결 끊기"/"다시 연결"), 끊김 상태에서 경고 문구 "실시간 연결이 끊겼습니다. 화면이 최신이 아닐 수 있습니다.".
  - `StatusBadge({status})`: `data-testid="status-badge"`, `data-status={status}`, 라벨 STATUS_LABEL.

- [ ] **Step 1: 실패 테스트** `useRealtime.test.tsx` (vitest + jsdom + @testing-library/react, 가짜 EventSource 클래스로 `globalThis.EventSource` 대체):
  - `invalidates all queries when connection opens` — open 이벤트 후 QueryClient의 `invalidateQueries` spy 호출.
  - `invalidates reservation queries on reservation.updated` — message `{type:'reservation.updated',reservationId:'R-101',version:2}` 후 `['audit-logs','R-101']` 포함 invalidate.
  - `pause closes the EventSource and sets disconnected`; `resume opens a new one`.
- [ ] **Step 2:** FAIL 확인 → 구현 → `npm test --prefix web` PASS, `npm run build --prefix web` 성공.
- [ ] **Step 3: Commit** `feat(web): API client, realtime SSE provider and header`

### Task 5: 쓰기 경로(트랜잭션·잠금·버전·이력) + SSE

**Files:**
- Create: `server/src/changes/change.service.ts`, `server/src/changes/dto.ts`, `server/src/changes/changes.module.ts`, `server/src/cleaning/cleaning.controller.ts`, `server/src/events/events.service.ts`, `server/src/events/events.controller.ts`, `server/src/events/events.module.ts`, `server/test/write-api.int-spec.ts`, `server/test/concurrency.int-spec.ts`, `server/test/events.int-spec.ts`
- Modify: `server/src/reservations/reservations.controller.ts`(PATCH checkout 추가), `server/src/app.module.ts`

**Interfaces:**
- Consumes: `InspectionService.recheck`, `InspectionRepository`, `ReservationsService.getView`, `toReservationView`, `Tx`.
- Produces:
  - `dto.ts`: `ChangeCheckoutDto { checkoutAt: string; version: number }`, `RescheduleCleaningDto { scheduledStartAt: string; version: number }` — 시각은 `@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/)` + 유효 날짜 검증, version `@IsInt() @Min(1)`. ValidationPipe `whitelist`, `forbidNonWhitelisted`, `transform`.
  - `ChangeService.changeCheckout(reservationId: string, dto: ChangeCheckoutDto): Promise<ReservationView>`; `ChangeService.rescheduleCleaning(taskId: string, dto: RescheduleCleaningDto): Promise<ReservationView>`. 공통: spec §6 순서. 잠금은 `tx.$queryRaw\`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE\``. 청소 경로는 먼저 task의 reservation_id 조회(없으면 404) → 예약 잠금 → task 재조회 후 version 비교. 버전 불일치 → `ConflictException({ message: 'VERSION_CONFLICT', current: ReservationView })`. 취소 예약 → `UnprocessableEntityException`. 이력: action `CHECKOUT_CHANGED` before/after `{ checkoutAt, inspectionStatus }`, `CLEANING_RESCHEDULED` before/after `{ scheduledStartAt, inspectionStatus }`, actorId `demo-operator`. 트랜잭션 커밋 후 `events.emit`.
  - `EventsService.emit(e: { type: 'reservation.updated'; reservationId: string; version: number }): void`; `EventsService.stream(): Observable<MessageEvent>` (Subject + 25초 heartbeat `{type:'heartbeat'}`; FE는 heartbeat 무시). `GET /api/events` `@Sse()`.
  - HTTP: `PATCH /api/reservations/:id/checkout`, `PATCH /api/cleaning-tasks/:id/schedule` → 200 `ReservationView`.

- [ ] **Step 1: 실패 테스트** `write-api.int-spec.ts` (각 테스트 `resetDb`):
  - `detects conflict when checkout moves 11:00→13:00 while cleaning stays 11:30` — PATCH R-101 `{checkoutAt:'2026-10-26T13:00:00+09:00', version:1}` → 200, `inspection.status === 'CONFLICT'`, `reasonText === '체크아웃 이전에 청소 시작 예정'`, `version === 2`.
  - `becomes NORMAL after cleaning moved to 13:30` — 이어서 PATCH C-101 `{scheduledStartAt:'2026-10-26T13:30:00+09:00', version:1}` → NORMAL.
  - `equal times are NORMAL` — C-101을 체크아웃과 같은 11:00으로 → NORMAL.
  - `writes audit logs with before/after and actor` — 위 두 변경 후 R-101 audit-logs 2건 최신순, 첫 건 action `CLEANING_RESCHEDULED`, `before.inspectionStatus === 'CONFLICT'`, `after.inspectionStatus === 'NORMAL'`, `actorId === 'demo-operator'`.
  - `stale version returns 409 with current view and changes nothing` — version 1로 두 번 PATCH → 두 번째 409, body.current.version === 2, audit 1건.
  - `rejects time without offset` — `'2026-10-26T13:00'` → 400, `version: 0` → 400, 추가 필드 → 400.
  - `unknown reservation 404, unknown task 404`.
  - `cancelled reservation change is 422 and leaves inspection EXCLUDED`.
  - `rolls back reservation change when inspection save fails` — `createTestApp(b => b.overrideProvider(InspectionRepository).useValue({ upsert: () => Promise.reject(new Error('boom')) }))`; PATCH → 500; DB의 R-101 checkoutAt 여전히 02:00Z, version 1, audit 0건, inspection 그대로.
  - `does not emit SSE when transaction fails` — 위 상황에서 `EventsService.emit` spy 미호출; 성공 케이스에서는 `{type:'reservation.updated', reservationId:'R-101', version:2}`로 1회 호출.
  - `persists after app restart` — 변경 후 `app.close()`, 새 `createTestApp()`으로 GET → 변경값·판정·이력 유지.
- [ ] **Step 2: 실패 테스트** `concurrency.int-spec.ts`:
  - `only one of two concurrent writers with same version wins` — 같은 version으로 PATCH 2개 `Promise.all` → 상태코드 정렬 `[200, 409]`.
  - `concurrent checkout and cleaning edits leave inspection consistent with final values` — 20회 반복: R-101 checkout 변경과 C-101 schedule 변경을 동시에(각 현재 version) → 각 반복 후 DB 최종 값으로 `judge` 재계산 결과 == 저장된 inspection.
- [ ] **Step 3: 실패 테스트** `events.int-spec.ts`: 앱을 `app.listen(0)`으로 띄우고 Node 22 `fetch`로 `/api/events` 스트림을 읽어, PATCH 후 2초 안에 `data: {"type":"reservation.updated","reservationId":"R-101","version":2}` 수신.
- [ ] **Step 4:** 구현 → `npm run test:int --prefix server` 전부 PASS, `npm test --prefix server` PASS.
- [ ] **Step 5: Commit** `feat(server): transactional checkout/cleaning changes with locking, audit and SSE`

### Task 6: 웹 화면 (예약 변경 / 운영 점검)

**Files:**
- Create: `web/src/pages/ReservationsPage.tsx`, `web/src/pages/OpsPage.tsx`, `web/src/pages/AuditLogList.tsx`, `web/src/pages/OpsPage.test.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: Task 4 `api`, `queryKeys`, `ApiError`, `useRealtime`, `StatusBadge`, `Header`, Task 2 kst 유틸.
- Produces (e2e가 의존하는 `data-testid`):
  - 예약 변경 화면: 행 `data-testid="reservation-row-R-101"`, 그 안 `data-testid="checkout-input"`(datetime-local), `data-testid="checkout-save"`. 저장 성공 시 행 판정 즉시 갱신(응답으로 캐시 `setQueryData` 후 invalidate).
  - 운영 화면: 표 행 `data-testid="inspection-row-R-101"` (열: 예약 번호, 객실, 체크아웃 예정(null → "정보 누락"), 청소 시작 예정(작업 없음 → "작업 없음", 시각 null → "정보 누락"), 판정 `StatusBadge`, 근거 reasonText), 상태 필터 `data-testid="status-filter"`(select: 전체 + 5개), 요약 카운트(불일치 N건 등). 행 클릭 → 상세 패널 `data-testid="detail-panel"`: 이력 목록 `data-testid="audit-log-item"`(시각 KST, 액션 한국어 "체크아웃 변경"/"청소 일정 수정", 변경 전→후, 판정 전→후, 처리자), 청소 작업 있으면 `data-testid="cleaning-input"` + `data-testid="cleaning-save"`. EXCLUDED 예약은 수정 폼 비활성.
  - 409 응답 시 `data-testid="conflict-notice"` "다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다." 표시 + 관련 쿼리 invalidate; 400/422/500은 `data-testid="error-notice"`에 서버 message.
  - 저장 중 버튼 비활성(연타 방지).

- [ ] **Step 1: 실패 테스트** `OpsPage.test.tsx` (vitest, `api` 모듈 mock):
  - `shows 작업 없음 and 확인 필요 for reservation without checkout cleaning` (R-103 fixture).
  - `shows 정보 누락 for missing checkout` (R-104).
  - `shows conflict notice on 409 and refetches` — `rescheduleCleaning`가 `ApiError(409)` reject → notice 표시, `listInspections` 재호출.
- [ ] **Step 2:** FAIL → 구현 → `npm test --prefix web` PASS, `npm run build --prefix web` 성공.
- [ ] **Step 3:** 수동 확인: 서버(`npm run start:dev --prefix server`, dev DB 마이그레이트+시드) + `npm run dev --prefix web` 띄우고 `/ops`에서 6건 표시 확인(curl 또는 Playwright 스크린샷).
- [ ] **Step 4: Commit** `feat(web): reservation change and ops inspection screens`

### Task 7: 정적 서빙 + Playwright e2e + Docker

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/tests/demo-flow.spec.ts`, `e2e/tests/realtime.spec.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- Modify: `server/src/app.module.ts`(ServeStaticModule: `rootPath` = `WEB_DIST` env 또는 `../web/dist` 기준 경로, `exclude: ['/api/(.*)']`), 루트 `package.json`(`e2e` script)

**Interfaces:**
- Consumes: Task 5 API, Task 6 testid.
- Produces: `npm run e2e` (루트) — `npm run build` 후 Playwright 실행. global-setup이 `DATABASE_URL=…/handys_e2e`로 `prisma migrate reset --force`(시드 포함), `webServer`가 같은 DB로 `PORT=3100` 서버 기동. `workers: 1`. 테스트 간 간섭 방지를 위해 spec마다 다른 예약을 사용: demo-flow → R-101, 지연 측정 → R-106, SSE 끊김 → R-102 체크아웃, offline → R-102 청소, stale tab → R-104 청소. 각 테스트는 현재 값을 읽고 상대적으로 변경(재실행 가능)한다.

- [ ] **Step 1: e2e 작성** `demo-flow.spec.ts` (`timezoneId: 'America/New_York'` 컨텍스트로 Review Focus 2 검증): 두 페이지 A(`/reservations`), B(`/ops`) 각각 별도 context. B에서 R-101 NORMAL 확인 → A에서 R-101 체크아웃 `2026-10-26T13:00` 저장 → B의 R-101 배지 `data-status="CONFLICT"` 및 "체크아웃 이전에 청소 시작 예정" 2초 내 표시(`toHaveAttribute(..., {timeout: 2000})`) → B에서 행 클릭, 청소 `2026-10-26T13:30` 저장 → NORMAL, 청소 열 "10/26 13:30" → 이력 2건 표시 → A 화면도 NORMAL로 갱신.
- [ ] **Step 2: e2e 작성** `realtime.spec.ts`:
  - `measures cross-screen latency` — A의 PATCH 응답 시각과 B의 배지 변경 시각 차이를 5회 측정, 각 < 2000ms, 결과를 `test.info().annotations`와 `e2e/latency.json`에 기록(TEST_REPORT용).
  - `recovers after SSE disconnect` — B에서 `sse-toggle` 클릭 → `data-state="disconnected"` → A에서 변경 → B는 2초 후에도 이전 상태(주기 재조회 30초 전) → `sse-toggle` 다시 클릭 → 2초 내 최신 반영, `sse-state` open.
  - `recovers after network offline` — B context `setOffline(true)` → A 변경 → `setOffline(false)` → 재연결 후 최신 상태(timeout 10s).
  - `stale tab gets conflict notice` — 두 탭이 같은 R-102 청소 수정: 탭1 저장 후 탭2가 (SSE pause로 오래된 버전 유지) 저장 → `conflict-notice` 표시.
- [ ] **Step 3:** `npx playwright install chromium` 후 `npm run e2e` → PASS. 
- [ ] **Step 4:** Dockerfile(multi-stage: deps → web build → server build + prisma generate → runtime `node:22-slim`, 기동 시 `prisma migrate deploy && (SEED_ON_START=true면 seed) && node dist/...`), docker-compose(`postgres:16` healthcheck + `app` depends_on healthy, 포트 3000).
- [ ] **Step 5: Commit** `feat: serve SPA from Nest, Playwright e2e, Docker Compose`

### Task 8: 제출 문서

**Files:**
- Create: `README.md`, `DESIGN.md`, `TEST_REPORT.md`, `AI_USAGE.md`

**Interfaces:**
- Consumes: GOAL.md, spec, 실제 테스트 실행 출력, `e2e/latency.json`, git log.

- [ ] **Step 1:** 전체 테스트 실행 후 출력 캡처: `npm test`, `npm run test:int`, `npm run e2e`.
- [ ] **Step 2:** `README.md` — 문제 정의(핸디즈에 현재 문제가 있다고 주장하지 않는다는 문장 포함), 대상 사용자, 가정·판정 기준 표, 구현 범위/제외, 실행 방법(Docker Compose, 로컬), 시연 7단계.
- [ ] **Step 3:** `DESIGN.md` — 구조도(mermaid), 데이터 모델·제약, 트랜잭션·잠금·버전, API, 실시간 처리·장애 복구, Redis/Push 제외 이유와 도입 조건, Outbox 검토 조건.
- [ ] **Step 4:** `TEST_REPORT.md` — GOAL §12 표 각 항목: 시험 조건 / 예상 / 실제 / 근거 테스트 이름; 지연 실측값; 미해결 사항(실제 사실만).
- [ ] **Step 5:** `AI_USAGE.md` — 이 세션에서 실제 수행한 요청·리뷰 발견·수정만(리뷰 기록, git log 근거). 꾸며내지 않음.
- [ ] **Step 6: Commit** `docs: README, DESIGN, TEST_REPORT, AI_USAGE`
