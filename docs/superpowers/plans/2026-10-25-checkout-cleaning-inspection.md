# 퇴실 청소 일정 불일치 점검 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 체크아웃 변경 후 퇴실 청소 시작 시각 불일치를 자동 판정하고, 예약 담당자(체크아웃 변경)와 현장 운영 담당자(청소 일정 조치)가 서로 다른 화면에서 변경 → 발견 → 조치 → 재확인을 실시간으로 이어가는 웹 도구.

**Architecture:** NestJS 단일 인스턴스가 `/api` REST + `/api/events` SSE를 제공하고 빌드된 React SPA를 정적 서빙한다. 고정 데모 계정 2개로 서명 쿠키 세션을 발급하고 전역 가드가 인증·역할을 검사한다. 모든 쓰기는 예약 행 `FOR UPDATE` 잠금 + 버전 비교 + 판정 upsert + 이력 insert를 하나의 Prisma 트랜잭션으로 처리하고, 커밋 후에만 SSE 신호를 보낸다. FE는 TanStack Query로 조회하며 SSE 신호·재연결·30초 주기·포커스 복귀 시 재조회한다.

**Tech Stack:** Node 22, NestJS 10, Prisma 5, PostgreSQL 15+, Jest + supertest, React 18 + Vite 5 + TypeScript, TanStack Query 5, react-router-dom 6, vitest + @testing-library/react, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-25-checkout-cleaning-inspection-design.md` (원본 요구 `GOAL.md`, 특히 §5 판정 기준, §12 검증, §15 역할). 구현자는 spec을 반드시 읽는다.

## Global Constraints

- **TypeScript 오류 0, ESLint 오류 0** (사용자 요구). 루트 `npm run typecheck`, `npm run lint`가 모든 앱(server src/test/prisma, web src, e2e)에서 통과해야 Task 완료. `any`, 미사용 변수, react-hooks 위반 금지.
- 모노레포: 서비스별 폴더 `apps/server`, `apps/web`, 브라우저 테스트 `apps/e2e`. 루트 `package.json`이 npm workspaces(`apps/*`)로 묶고 의존성은 루트에서 `npm install` 한 번(루트 `package-lock.json` 하나). 앱별 스크립트는 `npm run <script> -w apps/<name>`.

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
- 데모 계정(비밀번호 둘 다 `demo1234`): `agent` → `{id:'agent-01', displayName:'예약 담당 김예약', role:'RESERVATION_AGENT'}`, `ops` → `{id:'ops-01', displayName:'현장 운영 박현장', role:'OPERATIONS_MANAGER'}`.
- 체크아웃 변경 = `RESERVATION_AGENT`만, 청소 일정 변경 = `OPERATIONS_MANAGER`만 (BE 403). 처리자·역할은 세션에서만 결정, 본문 필드로 받지 않음(정의되지 않은 필드 400).
- FE 경로: `/login`, `/reservations`(예약·고객 응대), `/operations`(현장 운영). `/` → 로그인 역할의 홈 또는 `/login`.
- SSE 이벤트 payload 정확히 `{"type":"reservation.updated","reservationId":"R-101","version":4}`; 커밋 성공 후에만 emit.
- 재조회 주기 30초, 다른 화면 반영 목표 2초 이내.
- Redis, 별도 Push 서버, 이벤트 영구 보관, 청소 담당자 화면 구현 금지.
- 로컬 DB: `DATABASE_URL` env (dev `postgresql://$USER@localhost:5432/handys`, 통합테스트 `handys_test`, e2e `handys_e2e`). `.env`는 커밋하지 않고 `.env.example`을 커밋.
- 병렬 작업 중이므로 **구현자는 자기 Task의 Files에 나열된 경로만 `git add` 하여 커밋**한다(`git add -A` 금지). `index.lock` 충돌 시 잠시 후 재시도. 다른 Task 소유 파일은 수정하지 않는다(Modify에 적힌 것만 예외).

## Review Focus

1. 오프셋 없는 시각 입력(`2026-10-26T13:00`) — 서버 시간대에 따라 다르게 해석되면 안 됨 → 400. (Task 8 테스트)
2. 브라우저 시간대가 KST가 아닌 운영자 — datetime-local 입력은 항상 KST로 해석·표시. (Task 2 `kst.test.ts`, Task 9 e2e `timezoneId: 'America/New_York'`)
3. 저장 버튼 연타/두 탭 동시 저장 — 두 번째 요청 409, 화면은 최신 상태 재조회 + 안내 문구. (Task 8 통합, Task 7 UI, Task 9 e2e)
4. 위조된 처리자/역할 — 본문 `actorId`/`role`, 변조된 쿠키, 다른 역할의 API 직접 호출 → 400/401/403, 이력은 세션 계정. (Task 4, Task 8 테스트)
5. 트랜잭션 실패 시 SSE 미발송 및 부분 저장 없음. (Task 8 테스트)

---

## 파일 구조

```
package.json                     루트 스크립트 (install:all, build, test, test:int, e2e, start)
.env.example
apps/server/
  package.json, tsconfig*.json, nest-cli.json, jest.config.js, jest.int.config.js
  prisma/schema.prisma, prisma/migrations/<ts>_init/migration.sql, prisma/seed.ts
  src/main.ts                     configureApp(app) export: /api prefix, ValidationPipe, cookie-parser
  src/app.module.ts
  src/prisma/prisma.service.ts, prisma.module.ts
  src/auth/accounts.ts, session.ts, auth.guard.ts, roles.decorator.ts, current-user.decorator.ts, auth.controller.ts, auth.module.ts
  src/inspection/judge.ts (+ judge.spec.ts), inspection.repository.ts, inspection.service.ts, inspection.controller.ts, inspection.module.ts
  src/reservations/reservation-view.ts, reservations.service.ts, reservations.controller.ts, reservations.module.ts
  src/changes/change.service.ts, dto.ts, changes.module.ts
  src/cleaning/cleaning.controller.ts
  src/events/events.service.ts, events.controller.ts, events.module.ts
  test/helpers.ts, test/*.int-spec.ts
apps/web/
  vite.config.ts (proxy /api → :3000), index.html, src/main.tsx, App.tsx
  src/lib/kst.ts (+test)
  src/api/types.ts, client.ts
  src/auth/AuthProvider.tsx, LoginPage.tsx, RequireRole.tsx
  src/realtime/useRealtime.tsx (+test)
  src/components/Header.tsx, StatusBadge.tsx, AuditLogList.tsx
  src/pages/ReservationsPage.tsx, OperationsPage.tsx (+tests)
  src/styles.css
apps/e2e/ package.json, playwright.config.ts, global-setup.ts, tests/*.spec.ts
Dockerfile, docker-compose.yml, .dockerignore
README.md, DESIGN.md, TEST_REPORT.md, AI_USAGE.md
```

## 실행 순서 (Waves)

| Wave | Tasks (병렬) | 선행 |
|---|---|---|
| 1 | Task 1 (server 스캐폴드+DB), Task 2 (web 스캐폴드+kst) | 없음 |
| 1.5 | Task 11 (모노레포 재구성: apps/* + npm workspaces) | W1 |
| 2 | Task 3 (판정 함수), Task 4 (인증·권한), Task 5 (web 클라이언트·인증·실시간·헤더) | W1.5 |
| 3 | Task 6 (점검 서비스+조회 API), Task 7 (web 역할별 화면) | W2 |
| 4 | Task 8 (쓰기 경로+SSE) | W3 |
| 4.5 | Task 12 (ESLint·typecheck 게이트) | W4 + Task 7 |
| 5 | Task 9 (정적 서빙+Playwright+Docker) | W4.5 |
| 5.5 | Task 13 (UI 완성도 + 로컬 실행 경로 + 시각 검수) | W5 |
| 6 | Task 10 (제출 문서) | W5.5 |

---

### Task 1: 서버 스캐폴드, Prisma 스키마, 시드

**Files:**
- Create: 루트 `package.json`, `.env.example`, `apps/server/` 설정 파일(package.json, tsconfig, nest-cli, jest.config.js, jest.int.config.js), `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/*_init/migration.sql`, `apps/server/prisma/seed.ts`, `apps/server/src/main.ts`, `apps/server/src/app.module.ts`, `apps/server/src/prisma/prisma.service.ts`, `apps/server/src/prisma/prisma.module.ts`, `apps/server/test/helpers.ts`, `apps/server/test/schema.int-spec.ts`

**Interfaces:**
- Produces:
  - Prisma models: `Reservation{id, roomId, guestName, checkoutAt: Date|null, status: ReservationStatus, version Int @default(1), updatedAt}`, `CleaningTask{id, reservationId, type: CleaningType, scheduledStartAt: Date|null, status: CleaningStatus, version, updatedAt}`, `InspectionResult{reservationId @id, status: InspectionStatus, reasonCode: String, checkedAt}`, `AuditLog{id BigInt @id @default(autoincrement()), reservationId, action String, before Json, after Json, reason String?, actorId String, actorRole String, createdAt}`; enums `ReservationStatus{CONFIRMED,CANCELLED}`, `CleaningType{CHECKOUT,STAYOVER}`, `CleaningStatus{SCHEDULED,CANCELLED}`, `InspectionStatus{NORMAL,CONFLICT,NEEDS_CHECK,UNDETERMINED,EXCLUDED}`. 테이블 `@@map` `reservations`/`cleaning_tasks`/`inspection_results`/`audit_logs`, 컬럼 snake_case `@map`, 시각 `@db.Timestamptz(3)`. 관계 FK.
  - `PrismaService extends PrismaClient implements OnModuleInit` (global `PrismaModule`).
  - `apps/server/prisma/seed.ts`: `export async function seedDatabase(prisma: PrismaClient): Promise<void>` (예약·청소만; 판정 생성은 Task 6이 추가). 직접 실행 시 seedDatabase 호출. `package.json`의 `prisma.seed` 설정.
  - `apps/server/src/main.ts`: `export function configureApp(app: INestApplication): void` (`setGlobalPrefix('api')`, `ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})`, `cookie-parser`, `enableShutdownHooks`). bootstrap은 `PORT` env(기본 3000).
  - `apps/server/test/helpers.ts`: `resetDb(prisma: PrismaClient): Promise<void>` (`TRUNCATE audit_logs, inspection_results, cleaning_tasks, reservations RESTART IDENTITY CASCADE` 후 `seedDatabase`), `createTestApp(override?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication>` (AppModule + configureApp + init).
  - server scripts: `build`, `start:dev`, `start:prod`, `test`(unit `src/**/*.spec.ts`), `test:int`(`DATABASE_URL`을 handys_test로 두고 `prisma migrate reset --force --skip-seed` 후 jest `test/**/*.int-spec.ts --runInBand`; env는 `dotenv -e .env.test` 또는 `TEST_DATABASE_URL` 기본값 사용), `db:migrate`(`prisma migrate deploy`), `db:seed`.
  - 루트 scripts: `install:all`(server, web, e2e npm install), `build`(web → server), `test`(server unit + web), `test:int`, `e2e`, `start`.

- [ ] **Step 1:** Nest 10 프로젝트를 `apps/server/`에 생성(git init 금지), Prisma 5, cookie-parser 설치, schema 작성. 시드(기준일 2026-10-26, `+09:00`):
  - R-101 room 301, 체크아웃 11:00, C-101 CHECKOUT 11:30
  - R-102 room 302, 13:00, C-102 CHECKOUT 13:30
  - R-103 room 303, 12:00, C-103 **STAYOVER** 14:00 (퇴실 청소 없음)
  - R-104 room 304, 체크아웃 null, C-104 CHECKOUT 12:30
  - R-105 room 305, CANCELLED, 11:00, C-105 CHECKOUT 12:00
  - R-106 room 306, 11:00, C-106 CHECKOUT 11:00
  - guestName 임의 가명.
- [ ] **Step 2:** `prisma migrate dev --name init --create-only`로 생성 후 SQL 끝에 `CREATE UNIQUE INDEX "cleaning_tasks_one_checkout_per_reservation" ON "cleaning_tasks"("reservation_id") WHERE "type" = 'CHECKOUT';` 추가. `createdb handys handys_test handys_e2e`(이미 있으면 무시). `apps/server/.env`(dev), `apps/server/.env.test`(test) 로컬 생성(커밋 X), `.env.example` 커밋.
- [ ] **Step 3: 실패 테스트** `apps/server/test/schema.int-spec.ts`:
  - `seeds six reservations` — `resetDb` 후 count 6.
  - `rejects a second CHECKOUT task for the same reservation` — R-102 CHECKOUT 추가 → P2002 reject.
  - `allows a STAYOVER task next to a CHECKOUT task`.
  - `stores timestamptz` — R-101 `checkoutAt.toISOString() === '2026-10-26T02:00:00.000Z'`.
- [ ] **Step 4:** `npm run test:int -w apps/server` → PASS.
- [ ] **Step 5:** `npm run build -w apps/server` 성공, `start:prod` 기동 후 `curl -s localhost:3000/api/x` 가 404 JSON → 종료.
- [ ] **Step 6: Commit** `feat(server): scaffold NestJS + Prisma schema and seed`

### Task 2: 웹 스캐폴드 + KST 변환 유틸

**Files:**
- Create: `apps/web/**` (Vite react-ts 템플릿 기반, 불필요 데모 파일 제거), `apps/web/src/lib/kst.ts`, `apps/web/src/lib/kst.test.ts`

**Interfaces:**
- Produces (`apps/web/src/lib/kst.ts`), 모두 브라우저 시간대와 무관:
  - `formatKst(iso: string | null): string` → `"10/26 13:00"` (`MM/DD HH:mm`), null → `""`.
  - `formatKstTime(iso: string | null): string` → `"13:00"`, null → `""`.
  - `formatKstDateTime(iso: string): string` → `"2026-10-26 13:00:05"`.
  - `isoToKstInput(iso: string | null): string` → `"2026-10-26T13:00"`, null → `""`.
  - `kstInputToIso(value: string): string` → `"2026-10-26T13:00"` → `"2026-10-26T04:00:00.000Z"`; 형식 불일치 throw.
- web: 의존성 react 18, @tanstack/react-query 5, react-router-dom 6, vitest, jsdom, @testing-library/react, @testing-library/jest-dom. scripts `dev`(proxy `/api` → `http://localhost:3000`), `build`, `test`(`TZ=America/New_York vitest run`).

- [ ] **Step 1: 실패 테스트** `kst.test.ts`:
  - `kstInputToIso('2026-10-26T13:00') === '2026-10-26T04:00:00.000Z'`
  - `isoToKstInput('2026-10-26T04:00:00.000Z') === '2026-10-26T13:00'`
  - `formatKst('2026-10-26T02:30:00.000Z') === '10/26 11:30'`, `formatKstTime('2026-10-26T02:30:00.000Z') === '11:30'`
  - `formatKst(null) === ''`, `kstInputToIso('garbage')` throws
  - 왕복 날짜 경계: `isoToKstInput(kstInputToIso('2026-10-26T00:15')) === '2026-10-26T00:15'`
- [ ] **Step 2:** FAIL 확인 → 구현 → `npm test -w apps/web` PASS, `npm run build -w apps/web` 성공.
- [ ] **Step 3: Commit** `feat(web): scaffold Vite React app with KST time utils`

### Task 3: 판정 함수 (순수)

**Files:**
- Create: `apps/server/src/inspection/judge.ts`, `apps/server/src/inspection/judge.spec.ts`

**Interfaces:**
- Produces: `type InspectionStatusCode = 'NORMAL'|'CONFLICT'|'NEEDS_CHECK'|'UNDETERMINED'|'EXCLUDED'`; `type ReasonCode` (6개); `interface JudgeInput { reservationStatus: 'CONFIRMED'|'CANCELLED'; checkoutAt: Date|null; checkoutCleaning: { status: 'SCHEDULED'|'CANCELLED'; scheduledStartAt: Date|null } | null }`; `interface JudgeResult { status: InspectionStatusCode; reasonCode: ReasonCode }`; `judge(input: JudgeInput): JudgeResult` (spec §3 순서); `REASON_TEXT: Record<ReasonCode, string>`.

- [ ] **Step 1: 실패 테스트** `judge.spec.ts` (checkout = `2026-10-26T04:00:00Z`):
  - cleaning 02:30Z → `{CONFLICT, CLEANING_BEFORE_CHECKOUT}`; 04:30Z → `{NORMAL, CLEANING_AFTER_CHECKOUT}`; 04:00Z → NORMAL; 03:59:59.999Z → CONFLICT
  - checkoutCleaning null → `{NEEDS_CHECK, NO_CHECKOUT_CLEANING_TASK}` (**NORMAL 아님**); cleaning CANCELLED → NEEDS_CHECK
  - checkoutAt null + cleaning 있음 → `{UNDETERMINED, MISSING_CHECKOUT_AT}`; checkoutAt null + cleaning null → MISSING_CHECKOUT_AT
  - scheduledStartAt null → `{UNDETERMINED, MISSING_CLEANING_START}`
  - reservation CANCELLED(+충돌 시각) → `{EXCLUDED, RESERVATION_CANCELLED}`
  - `REASON_TEXT.CLEANING_BEFORE_CHECKOUT === '체크아웃 이전에 청소 시작 예정'`
- [ ] **Step 2:** `npx jest src/inspection/judge.spec.ts` (server) FAIL → 구현 → PASS.
- [ ] **Step 3: Commit** `feat(server): pure inspection judge rules`

### Task 4: 인증·권한 (서버)

**Files:**
- Create: `apps/server/src/auth/accounts.ts`, `session.ts`, `auth.guard.ts`, `roles.decorator.ts`, `current-user.decorator.ts`, `auth.controller.ts`, `auth.module.ts`, `apps/server/src/auth/session.spec.ts`, `apps/server/test/auth.int-spec.ts`
- Modify: `apps/server/src/app.module.ts`(AuthModule import), `apps/server/test/helpers.ts`(`loginAs` 추가)

**Interfaces:**
- Produces:
  - `accounts.ts`: `type Role = 'RESERVATION_AGENT'|'OPERATIONS_MANAGER'`; `interface Account { id: string; username: string; displayName: string; role: Role }`; `DEMO_ACCOUNTS: Account[]`(Global Constraints 값); `findAccountById(id): Account|undefined`; `verifyCredentials(username, password): Account|null` (비밀번호 `demo1234`, `crypto.timingSafeEqual`).
  - `session.ts`: `signSession(accountId: string, secret: string): string` (`<id>.<base64url HMAC-SHA256>`), `verifySession(token: string|undefined, secret: string): string|null`. secret = `process.env.SESSION_SECRET ?? 'dev-only-secret'`.
  - 쿠키명 `sid`, `httpOnly`, `sameSite: 'lax'`, `path: '/'`.
  - `AuthGuard` (APP_GUARD로 등록, AuthModule에서 provide): `@Public()` 핸들러 통과, 그 외 쿠키 검증 실패 → 401, `request.user = Account`; `@Roles(...roles: Role[])` 메타 있으면 역할 불일치 → 403 `{message: 'FORBIDDEN_ROLE'}`. 비-`/api` 요청(정적 파일)은 가드가 적용되지 않음(Nest 라우트가 아니므로).
  - `@CurrentUser()` param decorator → `Account`.
  - HTTP: `POST /api/auth/login` `@Public()` `{username, password}` → 200 `{username, displayName, role}` + Set-Cookie, 실패 401 `{message:'INVALID_CREDENTIALS'}`; `POST /api/auth/logout` → 쿠키 clear 204; `GET /api/auth/me` → 계정 또는 401.
  - `test/helpers.ts`: `loginAs(app: INestApplication, username: 'agent'|'ops'): Promise<supertest.Agent>` (로그인 쿠키 유지 agent; supertest `request.agent(app.getHttpServer())`).
  - 다른 Task는 변경 핸들러에 `@Roles('RESERVATION_AGENT')` 등을 붙이고 `@CurrentUser() user: Account`로 처리자를 얻는다.

- [ ] **Step 1: 실패 테스트** `session.spec.ts`: 서명 왕복 → id; 서명 변조(`agent-01.xxx`) → null; id 바꿔치기(`ops-01.<agent 서명>`) → null; undefined → null.
- [ ] **Step 2: 실패 테스트** `auth.int-spec.ts`:
  - 잘못된 비밀번호 → 401; `agent`/`demo1234` → 200 `{role:'RESERVATION_AGENT', displayName:'예약 담당 김예약'}` + `sid` 쿠키 HttpOnly.
  - 로그인 후 `GET /api/auth/me` → ops 계정; 쿠키 없이 → 401; 변조 쿠키 → 401.
  - logout 후 me → 401.
  - 역할 가드 검증용으로 테스트 내에서 `@Roles('OPERATIONS_MANAGER')` 붙인 테스트 전용 컨트롤러를 `Test.createTestingModule`에 추가하여 agent → 403, ops → 200 확인.
- [ ] **Step 3:** 구현 → `npm test -w apps/server`, `npm run test:int -w apps/server` PASS.
- [ ] **Step 4: Commit** `feat(server): demo accounts, signed-cookie session and role guard`

### Task 5: 웹 API 클라이언트 + 인증 + 실시간 훅 + 헤더

**Files:**
- Create: `apps/web/src/api/types.ts`, `apps/web/src/api/client.ts`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/auth/LoginPage.tsx`, `apps/web/src/auth/RequireRole.tsx`, `apps/web/src/realtime/useRealtime.tsx`, `apps/web/src/realtime/useRealtime.test.tsx`, `apps/web/src/components/Header.tsx`, `apps/web/src/components/StatusBadge.tsx`, `apps/web/src/components/AuditLogList.tsx`, `apps/web/src/App.tsx`(라우터 골격, 페이지는 placeholder `<h1>`), `apps/web/src/main.tsx`, `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 2 kst; spec §7 API 계약.
- Produces:
  - `types.ts`: `InspectionStatus`; `Role`; `Me { username; displayName; role: Role }`; `ReservationView { id; roomId; guestName; checkoutAt: string|null; status: 'CONFIRMED'|'CANCELLED'; version: number; cleaningTask: { id; scheduledStartAt: string|null; status: 'SCHEDULED'|'CANCELLED'; version: number } | null; inspection: { status: InspectionStatus; reasonCode: string; reasonText: string; checkedAt: string } | null }`; `AuditLogView { id: string; action: 'CHECKOUT_CHANGED'|'CLEANING_RESCHEDULED'; before: { checkoutAt?: string|null; scheduledStartAt?: string|null; inspectionStatus: InspectionStatus|null }; after: (same); reason: string|null; actor: { id; displayName; role: Role }; createdAt: string }`; `STATUS_LABEL`, `ROLE_LABEL` (`RESERVATION_AGENT` → "예약·고객 응대", `OPERATIONS_MANAGER` → "현장 운영"), `ACTION_LABEL` ("체크아웃 변경" / "청소 일정 수정").
  - `client.ts`: `class ApiError extends Error { status: number; body: any }` (fetch `credentials: 'same-origin'`); `api.login(username, password): Promise<Me>`, `api.logout()`, `api.me(): Promise<Me>`, `api.listReservations()`, `api.listInspections(status?: InspectionStatus)`, `api.auditLogs(id)`, `api.changeCheckout(id, {checkoutAt, reason, version})`, `api.rescheduleCleaning(taskId, {scheduledStartAt, reason?, version})`. `queryKeys = { me: ['me'], reservations: ['reservations'], inspections: (s?: string) => ['inspection-results', s ?? 'ALL'], auditLogs: (id: string) => ['audit-logs', id] }`.
  - `AuthProvider` + `useAuth(): { me: Me|null; loading: boolean; login(u,p): Promise<Me>; logout(): Promise<void> }`. 401 응답 시 me=null.
  - `RequireRole({role, children})`: 비로그인 → `/login` 리다이렉트, 다른 역할 → `data-testid="forbidden-notice"` "이 화면은 {ROLE_LABEL[role]} 담당자 전용입니다." + 자기 홈 링크.
  - `LoginPage`: `data-testid="login-username"`, `login-password`, `login-submit`, 데모 계정 안내(agent / ops, 비밀번호 demo1234), 성공 시 역할 홈(`RESERVATION_AGENT` → `/reservations`, `OPERATIONS_MANAGER` → `/operations`), 실패 `data-testid="login-error"`.
  - `useRealtime.tsx`: `RealtimeProvider`(로그인 상태에서만 EventSource(`/api/events`) 1개), `useRealtime(): { state: 'connecting'|'open'|'reconnecting'|'disconnected'; lastUpdatedAt: Date|null; paused: boolean; pause(): void; resume(): void }`. open 시 `queryClient.invalidateQueries()` 전체; `reservation.updated` 시 `['reservations']`, `['inspection-results']`, `['audit-logs', reservationId]` invalidate; `heartbeat` 무시; onerror → `reconnecting`(브라우저 자동 재연결; readyState CLOSED면 3초 후 재생성); `pause()` close → `disconnected`; `resume()` 재생성. `lastUpdatedAt` = reservations 또는 inspection-results 쿼리 마지막 성공 시각. 이벤트 수신 시 `window.__lastSseEvent = { receivedAt: Date.now(), data }`.
  - QueryClient 기본: `refetchInterval: 30_000`, `refetchOnWindowFocus: true`, `staleTime: 0`, 401은 재시도 안 함.
  - `Header`: 현재 계정 displayName + 역할 배지, 로그아웃 `data-testid="logout"`, 연결 상태 `data-testid="sse-state"` `data-state={state}` (연결됨/재연결 중/끊김/연결 중), `data-testid="last-updated"`, `data-testid="sse-toggle"` ("실시간 연결 끊기(시연용)"/"다시 연결"), 끊김·재연결 중 경고 "실시간 연결이 끊겼습니다. 화면이 최신이 아닐 수 있습니다." (역할별 내비 없음 — 각 역할은 자기 화면만).
  - `StatusBadge({status})`: `data-testid="status-badge"`, `data-status={status}`.
  - `AuditLogList({reservationId})`: `useQuery(auditLogs)`, 항목 `data-testid="audit-log-item"` — 시각(KST), ACTION_LABEL, 값 전→후(KST, null "정보 없음"), 판정 전→후 라벨, 사유(없으면 "-"), 변경자 `displayName (ROLE_LABEL)`. 빈 목록 "변경 이력이 없습니다.".

- [ ] **Step 1: 실패 테스트** `useRealtime.test.tsx` (가짜 EventSource로 `globalThis.EventSource` 대체):
  - `invalidates all queries when connection opens`
  - `invalidates reservation queries on reservation.updated` — `['audit-logs','R-101']` 포함
  - `ignores heartbeat`
  - `pause closes the EventSource and sets disconnected`; `resume opens a new one`
- [ ] **Step 2:** FAIL → 구현 → `npm test -w apps/web` PASS, build 성공.
- [ ] **Step 3: Commit** `feat(web): API client, demo login, realtime SSE provider and header`

### Task 6: 점검 서비스 + 조회 API

**Files:**
- Create: `apps/server/src/inspection/inspection.repository.ts`, `inspection.service.ts`, `inspection.controller.ts`, `inspection.module.ts`, `apps/server/src/reservations/reservation-view.ts`, `reservations.service.ts`, `reservations.controller.ts`, `reservations.module.ts`, `apps/server/test/read-api.int-spec.ts`
- Modify: `apps/server/src/app.module.ts`, `apps/server/prisma/seed.ts`(끝에 전체 판정 생성)

**Interfaces:**
- Consumes: Task 3 `judge`, `REASON_TEXT`; Task 4 가드(조회는 로그인만 필요 — 별도 데코레이터 불필요), `loginAs`, `findAccountById`.
- Produces:
  - `type Tx = Prisma.TransactionClient` (inspection.repository.ts에서 export).
  - `InspectionRepository.upsert(tx: Tx, reservationId: string, result: JudgeResult, checkedAt: Date): Promise<void>`.
  - `InspectionService.recheck(tx: Tx, reservationId: string): Promise<JudgeResult>` — tx로 예약 + `type=CHECKOUT` 작업 조회 → judge → upsert.
  - `InspectionService.runAll(): Promise<{ checked: number }>` — 예약마다 `prisma.$transaction(tx => recheck(tx,id))`.
  - `reservation-view.ts`: `ReservationView`(Task 5 types와 동일 형태), `RESERVATION_VIEW_INCLUDE`, `toReservationView(row): ReservationView` (cleaningTask = CHECKOUT 타입 작업, 없으면 null).
  - `ReservationsService.list(): Promise<ReservationView[]>` (id asc); `getView(db: Tx | PrismaService, id: string): Promise<ReservationView>` (없으면 `NotFoundException`); `auditLogs(id): Promise<AuditLogView[]>` 최신순(`createdAt desc, id desc`), `actor`는 `findAccountById`로 displayName 해석, 예약 없으면 404.
  - HTTP: `GET /api/reservations`, `GET /api/reservations/:id/audit-logs`, `GET /api/inspection-results?status=` (status ∈ 5개 아니면 400; 결과는 ReservationView[] 필터), `POST /api/inspection-results/run` → `{checked}` (두 역할 모두 허용).

- [ ] **Step 1: 실패 테스트** `read-api.int-spec.ts` (`resetDb` + `loginAs(app,'ops')`):
  - 비로그인 `GET /api/reservations` → 401.
  - 시드 후 판정: R-101 NORMAL, R-102 NORMAL, R-103 NEEDS_CHECK(cleaningTask null), R-104 UNDETERMINED + reasonText "체크아웃 예정 시각 없음", R-105 EXCLUDED, R-106 NORMAL; id 오름차순 6건 (agent 로그인으로도 동일하게 조회됨).
  - `?status=NEEDS_CHECK` → `['R-103']`; `?status=BOGUS` → 400.
  - `POST /api/inspection-results/run` 3회 → `inspection_results` count 6 유지, 상태 동일, `checked === 6`.
  - audit-logs: `R-999` → 404, R-101 → `[]`.
- [ ] **Step 2:** FAIL → 구현 → `npm run test:int -w apps/server` PASS.
- [ ] **Step 3: Commit** `feat(server): inspection recheck service and read APIs`

### Task 7: 웹 역할별 화면

**Files:**
- Create: `apps/web/src/pages/ReservationsPage.tsx`, `apps/web/src/pages/OperationsPage.tsx`, `apps/web/src/pages/ReservationsPage.test.tsx`, `apps/web/src/pages/OperationsPage.test.tsx`
- Modify: `apps/web/src/App.tsx`(라우트 연결: `/reservations` = `RequireRole role="RESERVATION_AGENT"`, `/operations` = `RequireRole role="OPERATIONS_MANAGER"`), `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5 전부, Task 2 kst.
- Produces (e2e가 의존하는 `data-testid`):
  - **ReservationsPage** (`/reservations`): 제목 "예약·고객 응대". 표 행 `data-testid="reservation-row-R-101"`: 예약 번호, 객실, 고객, 체크아웃 예정(null "정보 누락"), 판정 `StatusBadge`. 행의 "체크아웃 변경" 버튼 → 편집 영역 `data-testid="checkout-editor"`: 기존 체크아웃 표시, `data-testid="checkout-input"`(datetime-local, 기존 값 prefill), `data-testid="checkout-reason"`(필수, 비면 저장 비활성), `data-testid="checkout-save"`. 취소 예약은 변경 버튼 비활성. 저장 성공 시 `data-testid="change-result"` 패널:
    - 제목 "예약 변경 완료", "체크아웃: {이전 HH:mm} → {새 HH:mm}", "기존 청소 시작: {HH:mm 또는 '작업 없음'}"
    - CONFLICT(`data-result="CONFLICT"`): "청소 일정 조정 필요" 강조 + "체크아웃 이전에 청소가 예정되어 있습니다. 운영 담당자의 일정 조정이 필요합니다."
    - NORMAL: "청소 일정과 충돌하지 않습니다." / NEEDS_CHECK: "대응하는 퇴실 청소 작업이 없습니다. 운영 담당자의 확인이 필요합니다." / UNDETERMINED: "판정에 필요한 정보가 없습니다. 운영 담당자의 확인이 필요합니다."
    - 결과 패널의 판정은 이후 SSE 재조회로 바뀌면 현재 판정을 따라 갱신(`data-result`도 갱신) — 운영 담당자 조치 후 예약 담당자 화면에 정상 반영.
    - 선택 행 하단에 `AuditLogList`(공통 조회).
  - **OperationsPage** (`/operations`): 제목 "현장 운영 — 청소 일정 점검". 요약 카운트 `data-testid="summary-CONFLICT"` 등(5개). 필터 `data-testid="status-filter"` select: `ACTION_REQUIRED`(기본, "조치 필요": CONFLICT·NEEDS_CHECK·UNDETERMINED), `ALL`("전체"), 5개 상태. 정렬 CONFLICT → NEEDS_CHECK → UNDETERMINED → NORMAL → EXCLUDED, 동률 id asc. 행 `data-testid="inspection-row-R-101"`: 예약 번호, 객실, 체크아웃 예정 | 청소 시작 예정 나란히(작업 없음 → "작업 없음", 시각 null → "정보 누락"), `StatusBadge`, 근거. 행 클릭 → `data-testid="detail-panel"`: 예약 요약, `AuditLogList`, 청소 작업 있고 EXCLUDED 아니면 `data-testid="cleaning-input"` + `data-testid="cleaning-reason"`(선택) + `data-testid="cleaning-save"`. 저장 성공 시 `data-testid="recheck-result"` "재점검 결과: {라벨}". 상세 패널은 필터에서 빠져도(정상 처리) 선택 유지.
  - 공통: 409 → `data-testid="conflict-notice"` "다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다." + 관련 쿼리 invalidate + 편집값을 최신으로 재설정; 그 외 오류 `data-testid="error-notice"`(서버 message). 저장 중 버튼 비활성.

- [ ] **Step 1: 실패 테스트** (vitest, `api` mock):
  - `OperationsPage.test.tsx`: `defaults to action-required filter sorted CONFLICT first` (fixture: R-101 CONFLICT, R-102 NORMAL, R-103 NEEDS_CHECK, R-104 UNDETERMINED → 행 순서 R-101, R-103, R-104, R-102 미표시); `shows 작업 없음 for R-103 and 정보 누락 for R-104`; `shows conflict notice on 409 and refetches`.
  - `ReservationsPage.test.tsx`: `save disabled without reason`; `shows 청소 일정 조정 필요 result after CONFLICT response` (응답 fixture CONFLICT, 청소 11:30 → 패널에 "예약 변경 완료", "기존 청소 시작: 11:30", 안내 문구); `sends checkoutAt as UTC ISO and reason` (`changeCheckout` 호출 인자 `{checkoutAt:'2026-10-26T04:00:00.000Z', reason:'고객 요청', version:1}`).
- [ ] **Step 2:** FAIL → 구현 → `npm test -w apps/web` PASS, build 성공.
- [ ] **Step 3: Commit** `feat(web): role-based reservations and operations screens`

### Task 8: 쓰기 경로(트랜잭션·잠금·버전·권한·이력) + SSE

**Files:**
- Create: `apps/server/src/changes/change.service.ts`, `dto.ts`, `changes.module.ts`, `apps/server/src/cleaning/cleaning.controller.ts`, `apps/server/src/events/events.service.ts`, `events.controller.ts`, `events.module.ts`, `apps/server/test/write-api.int-spec.ts`, `apps/server/test/concurrency.int-spec.ts`, `apps/server/test/events.int-spec.ts`
- Modify: `apps/server/src/reservations/reservations.controller.ts`(PATCH checkout), `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `InspectionService.recheck`, `InspectionRepository`, `Tx`, `ReservationsService.getView`, Task 4 `Roles`, `CurrentUser`, `Account`, `loginAs`.
- Produces:
  - `dto.ts`: `ChangeCheckoutDto { checkoutAt: string; reason: string; version: number }`, `RescheduleCleaningDto { scheduledStartAt: string; reason?: string; version: number }`. 시각 `@Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/)` + `Date.parse` 유효성, version `@IsInt() @Min(1)`, reason: checkout은 trim 후 1~200자 필수, cleaning은 선택 ≤200자(빈 문자열 → null 저장).
  - `ChangeService.changeCheckout(reservationId: string, dto: ChangeCheckoutDto, actor: Account): Promise<ReservationView>`; `ChangeService.rescheduleCleaning(taskId: string, dto: RescheduleCleaningDto, actor: Account): Promise<ReservationView>`. spec §6 순서. 잠금 `tx.$queryRaw\`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE\``. 청소 경로: task로 reservation_id 조회(없으면 404, STAYOVER 작업 → 422) → 예약 잠금 → task 재조회 후 version 비교. 버전 불일치 → `ConflictException({ message: 'VERSION_CONFLICT', current: ReservationView })`. 취소 예약 → `UnprocessableEntityException({message:'RESERVATION_CANCELLED'})`. 이력: `CHECKOUT_CHANGED` before/after `{ checkoutAt, inspectionStatus }`, `CLEANING_RESCHEDULED` before/after `{ scheduledStartAt, inspectionStatus }`, `reason`, `actorId = actor.id`, `actorRole = actor.role`. 커밋 후 `events.emit({type:'reservation.updated', reservationId, version: 예약 version})`. 청소 변경 시 예약 version은 바뀌지 않음(task version만 +1).
  - Controllers: `PATCH /api/reservations/:id/checkout` `@Roles('RESERVATION_AGENT')`; `PATCH /api/cleaning-tasks/:id/schedule` `@Roles('OPERATIONS_MANAGER')`.
  - `EventsService.emit(e: { type: 'reservation.updated'; reservationId: string; version: number }): void`; `stream(): Observable<MessageEvent>` (Subject merge 25초 `{type:'heartbeat'}`). `GET /api/events` `@Sse()` (로그인 필요, 두 역할).

- [ ] **Step 1: 실패 테스트** `write-api.int-spec.ts` (각 테스트 `resetDb`; agent = `loginAs(app,'agent')`, ops = `loginAs(app,'ops')`):
  - `detects conflict when checkout moves 11:00→13:00 while cleaning stays 11:30` — agent PATCH R-101 `{checkoutAt:'2026-10-26T13:00:00+09:00', reason:'고객 요청 레이트 체크아웃', version:1}` → 200, CONFLICT, reasonText '체크아웃 이전에 청소 시작 예정', version 2.
  - `becomes NORMAL after ops moves cleaning to 13:30` — ops PATCH C-101 `{scheduledStartAt:'2026-10-26T13:30:00+09:00', version:1}` → NORMAL.
  - `equal times are NORMAL` — C-101을 11:00으로 → NORMAL.
  - `audit logs record reason and session actor` — 위 두 변경 후 R-101 이력 2건 최신순: [0] `CLEANING_RESCHEDULED`, before.inspectionStatus CONFLICT → after NORMAL, actor `{id:'ops-01', role:'OPERATIONS_MANAGER'}`; [1] `CHECKOUT_CHANGED`, reason '고객 요청 레이트 체크아웃', actor `agent-01`.
  - `enforces roles on the server` — agent가 PATCH cleaning → 403, ops가 PATCH checkout → 403, 비로그인 → 401; 모두 DB 불변.
  - `rejects body-supplied actor or role` — `{..., actorId:'ops-01'}` → 400, `{..., role:'OPERATIONS_MANAGER'}` → 400.
  - `rejects invalid input` — 오프셋 없는 `'2026-10-26T13:00'` → 400, `'2026-13-40T99:00:00Z'` → 400, `version: 0` → 400, reason 공백 `'  '` → 400, reason 201자 → 400.
  - `stale version returns 409 with current view and changes nothing` — version 1 두 번 → 두 번째 409, `body.current.version === 2`, 이력 1건.
  - `unknown reservation 404, unknown task 404, STAYOVER task 422`.
  - `cancelled reservation change is 422 and inspection stays EXCLUDED`.
  - `rolls back reservation change when inspection save fails` — `createTestApp(b => b.overrideProvider(InspectionRepository).useValue({ upsert: () => Promise.reject(new Error('boom')) }))` → 500; R-101 checkoutAt `2026-10-26T02:00:00.000Z`, version 1, 이력 0, inspection 이전 그대로.
  - `emits SSE only after commit` — `EventsService.emit` spy: 실패 케이스 0회, 성공 케이스 `{type:'reservation.updated', reservationId:'R-101', version:2}` 1회.
  - `persists after app restart` — 변경 후 `app.close()`, 새 `createTestApp()` + 새 로그인 → 값·판정·이력 유지.
- [ ] **Step 2: 실패 테스트** `concurrency.int-spec.ts`:
  - `only one of two concurrent writers with same version wins` — 같은 version PATCH 2개 `Promise.all` → `[200, 409]`.
  - `concurrent checkout and cleaning edits leave inspection consistent with final values` — 20회: agent의 R-101 checkout 변경과 ops의 C-101 변경을 동시에(각 현재 version, 시각은 반복마다 다른 값으로 CONFLICT/NORMAL 교차) → 반복 후 DB 최종 값으로 `judge` 재계산 == 저장된 inspection.
- [ ] **Step 3: 실패 테스트** `events.int-spec.ts`: `app.listen(0)`, ops 로그인 쿠키로 Node `fetch('/api/events')` 스트림 읽기 → agent PATCH 후 2초 내 `data: {"type":"reservation.updated","reservationId":"R-101","version":2}` 수신; 쿠키 없이 `/api/events` → 401.
- [ ] **Step 4:** 구현 → `npm run test:int -w apps/server`, `npm test -w apps/server` 전부 PASS.
- [ ] **Step 5: Commit** `feat(server): transactional role-checked changes with locking, audit and SSE`

### Task 9: 정적 서빙 + Playwright e2e + Docker

**Files:**
- Create: `apps/e2e/package.json`, `apps/e2e/playwright.config.ts`, `apps/e2e/global-setup.ts`, `apps/e2e/helpers.ts`, `apps/e2e/tests/demo-flow.spec.ts`, `apps/e2e/tests/realtime.spec.ts`, `apps/e2e/tests/roles.spec.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- Modify: `apps/server/src/app.module.ts`(ServeStaticModule: `rootPath` = `process.env.WEB_DIST ?? join(__dirname, '<to repo>/web/dist')`, `exclude: ['/api/(.*)']`, SPA fallback), 루트 `package.json`(`e2e`)

**Interfaces:**
- Consumes: Task 7 testid, Task 8 API.
- Produces: `npm run e2e` — 루트 build 후 Playwright. global-setup이 `DATABASE_URL=…/handys_e2e`로 `prisma migrate reset --force`(시드 포함), `webServer`가 같은 DB로 `PORT=3100` 기동. `workers: 1`. `apps/e2e/helpers.ts`: `openAs(browser, 'agent'|'ops', opts?)` → 새 context(`timezoneId: 'America/New_York'`)에서 로그인 후 역할 홈 페이지 반환. 테스트 간 간섭 방지: demo-flow → R-101, 지연 측정 → R-106, SSE 끊김 → R-102 체크아웃, offline → R-102 청소, stale tab → R-104 청소. 각 테스트는 현재 값을 읽고 상대적으로 변경(재실행 가능) — 단 demo-flow는 global-setup 리셋 직후 시드 값 전제.

- [ ] **Step 1: e2e** `demo-flow.spec.ts` — 예약 담당 브라우저 A(`/reservations`), 현장 운영 브라우저 B(`/operations`, 필터 "전체"): B에서 R-101 NORMAL → A에서 R-101 체크아웃 `2026-10-26T13:00`, 사유 "고객 요청" 저장 → A `change-result` "예약 변경 완료", "기존 청소 시작: 11:30", `data-result="CONFLICT"` → B의 R-101 `data-status="CONFLICT"` + "체크아웃 이전에 청소 시작 예정" 2초 내 → B에서 필터 "조치 필요"로 R-101 최상단 확인 → 행 클릭, 이력에 "고객 요청"·"예약 담당 김예약" → 청소 `2026-10-26T13:30` 저장 → `recheck-result` "정상", 청소 열 "10/26 13:30" → 이력 2건 → A의 R-101 배지 NORMAL, `change-result` `data-result="NORMAL"` 2초 내.
- [ ] **Step 2: e2e** `realtime.spec.ts`:
  - `measures cross-screen latency` — A PATCH 응답 시각과 B 배지 변화 시각 차 5회, 각 < 2000ms, `apps/e2e/latency.json`에 기록.
  - `recovers after SSE disconnect` — B `sse-toggle` → `data-state="disconnected"` → A 변경 → 2초 후 B는 이전 상태 유지 → 다시 연결 → 2초 내 최신 반영, `data-state="open"`.
  - `recovers after network offline` — B context `setOffline(true)` → A 변경 → `setOffline(false)` → 10초 내 최신 반영.
  - `stale tab gets conflict notice` — ops 탭 2개가 R-104 청소 수정: 탭2 `sse-toggle` 끊기 → 탭1 저장 → 탭2 저장 → `conflict-notice`.
- [ ] **Step 3: e2e** `roles.spec.ts`: agent로 `/operations` 접근 → `forbidden-notice`; agent context에서 `page.request.patch('/api/cleaning-tasks/C-102/schedule', …)` → 403; 비로그인 `/reservations` → `/login`; 잘못된 비밀번호 → `login-error`.
- [ ] **Step 4:** `npx playwright install chromium` 후 `npm run e2e` → PASS.
- [ ] **Step 5:** Dockerfile(multi-stage: web build → server build + `prisma generate` → runtime `node:22-slim`(openssl 설치), CMD: `npx prisma migrate deploy && (SEED_ON_START=true면 db:seed) && node dist/...`), docker-compose(`postgres:16` healthcheck, `app` depends_on healthy, `DATABASE_URL`, `SESSION_SECRET`, `SEED_ON_START=true`, 3000 포트, DB 볼륨).
- [ ] **Step 6: Commit** `feat: serve SPA from Nest, Playwright e2e, Docker Compose`

### Task 10: 제출 문서

**Files:**
- Create: `README.md`, `DESIGN.md`, `TEST_REPORT.md`, `AI_USAGE.md`

**Interfaces:**
- Consumes: GOAL.md, spec, plan, 실제 테스트 출력, `apps/e2e/latency.json`, git log, 리뷰 기록(컨트롤러가 전달).

- [ ] **Step 1:** `npm test`, `npm run test:int`, `npm run e2e` 실행 후 출력 캡처.
- [ ] **Step 2:** `README.md` — 문제 정의(핸디즈에 현재 문제가 있다고 주장하지 않음), 대상 사용자·역할(청소 담당자 제외 및 "실제 청소 담당자가 변경 내용을 전달받고 확인했는지는 검증 범위 밖"), 가정·판정 기준 표, 범위/제외, 데모 계정, 실행 방법(Docker Compose, 로컬), 시연 7단계(두 브라우저).
- [ ] **Step 3:** `DESIGN.md` — 구조도(mermaid), 데이터 모델·제약, 트랜잭션·잠금·버전, 인증·역할 검사, API, 실시간 처리·장애 복구, Redis/Push 제외 이유와 도입 조건, Outbox 검토 조건.
- [ ] **Step 4:** `TEST_REPORT.md` — GOAL §12 + 권한 항목: 시험 조건 / 예상 / 실제 / 근거 테스트명; 지연 실측값; 미해결 사항(실제 사실만).
- [ ] **Step 5:** `AI_USAGE.md` — 이 세션에서 실제 수행한 요청·리뷰 발견·수정만(근거: git log, 리뷰 기록). 꾸며내지 않음.
- [ ] **Step 6: Commit** `docs: README, DESIGN, TEST_REPORT, AI_USAGE`

### Task 11: 모노레포 재구성 (apps/* + npm workspaces)

**Files:**
- Move: `server/` → `apps/server/`, `web/` → `apps/web/` (`git mv`, 이력 보존)
- Modify: 루트 `package.json`(`"private": true`, `"workspaces": ["apps/*"]`, 스크립트를 `-w apps/<name>`로), 루트 `.gitignore`, 앱 안의 경로 의존 설정(jest/prisma/tsconfig/test helper/스크립트에 있는 상대 경로), `apps/server/.env.example`·`.env.example` 위치 정리
- Delete: `apps/server/package-lock.json`, `apps/web/package-lock.json` (루트 lockfile 하나로 대체), 앱별 node_modules

**Interfaces:**
- Produces: 루트에서 `npm install` → 루트 `package-lock.json` + hoisted `node_modules`. 루트 스크립트: `build`(web → server), `test`(server unit + web), `test:int`, `e2e`(apps/e2e 존재 시), `start`. 각 앱 패키지 이름: `@handys/server`, `@handys/web` (`"private": true`). 이후 Task의 명령은 `npm run <script> -w apps/server` 형식.

- [ ] **Step 1:** `git mv server apps/server`, `git mv web apps/web`; 앱별 lockfile·node_modules 삭제; 루트 workspaces 설정 후 루트에서 `npm install`.
- [ ] **Step 2:** Prisma가 hoisted `@prisma/client`로 generate 되는지 확인(`npx prisma generate -w apps/server` 또는 apps/server 스크립트), 경로 의존 설정 수정.
- [ ] **Step 3: 검증** — `npm test`(루트) PASS(server unit + web 6개), `npm run test:int -w apps/server` PASS, `npm run build`(루트) 성공, `git status`에 `server/`·`web/` 잔재 없음.
- [ ] **Step 4: Commit** `refactor: restructure into apps/* npm workspaces monorepo`

### Task 12: ESLint + typecheck 게이트

**Files:**
- Create: `eslint.config.mjs`(루트, flat config)
- Modify: 루트 `package.json`(devDependencies + scripts `lint`, `typecheck`), `apps/server/package.json`·`apps/web/package.json`(`typecheck` 스크립트), 오류가 난 소스 파일(최소 수정), 필요 시 `apps/server/tsconfig.json`(test/, prisma/ 포함한 typecheck용 설정)

**Interfaces:**
- Produces: 루트 `npm run lint` = `eslint .` (오류 0, `--max-warnings 0`), 루트 `npm run typecheck` = 모든 workspace `typecheck`(server: `tsc --noEmit -p tsconfig.json`이 src·test·prisma 포함, web: `tsc --noEmit -p tsconfig.json`). 이후 Task(9, 10)와 최종 점검의 완료 조건.
- 규칙: `@eslint/js` recommended + `typescript-eslint` recommended(type-aware 불필요) 전체, web에 `eslint-plugin-react-hooks` recommended + `eslint-plugin-react-refresh`(only-export-components warn → 0 warning 기준이므로 위반 시 수정), 테스트 파일은 globals(jest/vitest) 설정. ignore: `**/dist`, `**/node_modules`, `**/coverage`, `apps/server/prisma/migrations`, `.superpowers`.

- [ ] **Step 1:** devDependencies 설치(루트): `eslint@^9`, `@eslint/js@^9`, `typescript-eslint@^8`, `globals`, `eslint-plugin-react-hooks@^5`, `eslint-plugin-react-refresh`.
- [ ] **Step 2:** config 작성 후 `npm run lint`, `npm run typecheck` 실행 → 오류 목록 확보.
- [ ] **Step 3:** 오류를 규칙 끄기가 아닌 코드 수정으로 해결(불가피한 경우만 라인 단위 disable + 이유 주석).
- [ ] **Step 4: 검증** — `npm run lint`(0 problems), `npm run typecheck`(출력 없음), `npm test`, `npm run test:int` 모두 PASS, `npm run build` 성공.
- [ ] **Step 5: Commit** `chore: add ESLint flat config and typecheck gate; fix violations`

### Task 13: UI 완성도 + 로컬 실행 경로 + 시각 검수

사용자가 직접 로컬에서 두 브라우저로 시연·검수한다. 기능 테스트 외에 **화면을 실제로 띄워 눈으로 확인**하는 단계.

**Files:**
- Modify: `apps/web/src/styles.css`, `apps/web/src/**/*.tsx`(마크업·클래스, **data-testid와 고정 문구는 유지**), `apps/web/vite.config.ts`(proxy target을 `API_PORT` env로, 기본 3000), 루트 `package.json`(`setup`, `dev` 스크립트), `apps/server/package.json`(필요 시)
- Create: `apps/e2e/tests/visual.spec.ts`(스크린샷 캡처 — 단언은 레이아웃 기본만: 가로 스크롤 없음, 주요 영역 visible), `docs/screenshots/*.png`

**Interfaces:**
- Produces: 루트 `npm run setup` = dev DB(`handys`) `prisma migrate deploy` + 시드(재실행 가능하도록 시드 전 리셋 또는 upsert); 루트 `npm run dev` = 서버 watch(`PORT` env, 기본 3000) + Vite dev(5173, `/api` → `http://localhost:${API_PORT ?? 3000}`) 동시 실행(`concurrently` devDependency 허용). README(Task 10)가 이 명령을 인용.

- [ ] **Step 1:** `frontend-design` 스킬을 Skill 도구로 불러 지침에 따라 미적 방향 결정(차분한 운영 도구, 정보 밀도 높되 판독성 우선, 한국어 타이포그래피 — `Pretendard` 등 웹폰트는 CDN 허용, 없으면 system-ui). 판정 배지 색·아이콘·대비(WCAG AA), 표의 체크아웃|청소 나란히 비교 시각화(충돌 시 청소 시각 강조), 결과 패널 위계("예약 변경 완료" vs "청소 일정 조정 필요"), 빈 상태/로딩/오류/409 안내, 연결 상태 배지, 로그인 화면(데모 계정 안내 카드), 1280px·768px·390px 반응형.
- [ ] **Step 2:** `npm run setup` + `npm run dev`로 실제 띄우고(포트 3000 점유 시 `PORT=3200 API_PORT=3200`), Playwright로 agent·ops 화면을 1280/390 폭에서 캡처: 로그인, 예약 화면 초기, 체크아웃 13:00 저장 후 결과 패널(CONFLICT), 운영 화면 조치 필요 목록, 상세 패널+이력, 청소 13:30 저장 후 정상. 스크린샷을 직접 Read로 보고 문제 목록 작성 → 수정 → 재캡처. 최종본을 `docs/screenshots/`에 저장.
- [ ] **Step 3: 검증** — `npm test`, `npm run lint`, `npm run typecheck`, `npm run e2e` 모두 PASS(기존 testid 흐름 회귀 없음).
- [ ] **Step 4: Commit** `feat(web): polish role screens UI, local dev scripts, visual QA screenshots`

### Task 10 보강 (AI_USAGE 근거)
- Task 10 Step 5의 근거로 SDD ledger(`.superpowers/sdd/.../progress.md`)의 Ruling·리뷰 발견·수정 기록을 사용한다. 컨트롤러는 ledger 삭제 전에 Task 10 구현자에게 ledger 경로를 넘긴다.
