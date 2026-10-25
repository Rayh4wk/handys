import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, queryKeys } from '../api/client';
import { STATUS_LABEL, type InspectionStatus, type ReservationView } from '../api/types';
import AuditLogList from '../components/AuditLogList';
import RemoteChangeNotice from '../components/RemoteChangeNotice';
import SaveNoticeView from '../components/SaveNoticeView';
import StatusBadge from '../components/StatusBadge';
import TimeCompare from '../components/TimeCompare';
import { isoToKstInput, kstInputAfter, kstInputToIso, relativeToNow } from '../lib/kst';
import { focusRow, scrollIntoViewOnNarrow } from '../lib/scroll';
import { useNow } from '../lib/useNow';
import { useServerDraft } from '../lib/useServerDraft';
import {
  ACTION_REQUIRED,
  activeCleaning,
  applyServerView,
  byPriorityThenCleaning,
  checkoutText,
  cleaningText,
  isConflict,
  refreshAfterConflict,
  errorText,
  statusOf,
  type SaveNotice,
} from '../lib/reservation';

type Filter = 'ACTION_REQUIRED' | 'ALL' | InspectionStatus;

const TITLE = '청소 일정 점검';
const FLASH_MS = 2400;

function matches(filter: Filter, r: ReservationView): boolean {
  const s = statusOf(r);
  if (filter === 'ALL') return true;
  if (filter === 'ACTION_REQUIRED') return !!s && ACTION_REQUIRED.has(s);
  return s === filter;
}

/** Screen-reader line for a judgment that just appeared or changed. */
function announcement(r: ReservationView): string {
  const s = statusOf(r);
  if (!s) return '';
  if (ACTION_REQUIRED.has(s)) return `${r.id} ${STATUS_LABEL[s]}`;
  return `${r.id} ${STATUS_LABEL[s]}${s === 'EXCLUDED' ? '로' : '으로'} 변경`;
}

/**
 * Rows that are new or whose judgment changed since the previous list (not on first load):
 * `flash` maps id → a sequence number (alternating animation names restart the highlight) and
 * `message` is the polite announcement for them.
 */
function useJudgmentChanges(all: ReservationView[] | undefined) {
  const previous = useRef<Map<string, InspectionStatus | null> | null>(null);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!all) return;
    const before = previous.current;
    previous.current = new Map(all.map((r) => [r.id, statusOf(r)] as const));
    if (!before) return;
    const changed = [...all]
      .sort(byPriorityThenCleaning)
      .filter((r) => !before.has(r.id) || before.get(r.id) !== statusOf(r));
    if (changed.length === 0) return;
    const n = ++seq.current;
    setFlash((f) => ({ ...f, ...Object.fromEntries(changed.map((r) => [r.id, n])) }));
    setMessage(changed.map(announcement).filter(Boolean).join(', '));
    timers.current.push(
      window.setTimeout(() => {
        setFlash((f) => {
          const next = { ...f };
          for (const r of changed) if (next[r.id] === n) delete next[r.id];
          return next;
        });
      }, FLASH_MS),
    );
  }, [all]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  return { flash, message };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export default function OperationsPage() {
  const q = useQuery({ queryKey: queryKeys.inspections(), queryFn: () => api.listInspections() });
  const [filter, setFilter] = useState<Filter>('ACTION_REQUIRED');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: 'row' | 'cleaning'; id: string; n: number } | null>(
    null,
  );
  const now = useNow();

  const all = q.data;
  const counts = useMemo(() => {
    const c: Record<InspectionStatus, number> = {
      CONFLICT: 0,
      NEEDS_CHECK: 0,
      UNDETERMINED: 0,
      NORMAL: 0,
      EXCLUDED: 0,
    };
    for (const r of all ?? []) {
      const s = statusOf(r);
      if (s) c[s] += 1;
    }
    return c;
  }, [all]);
  const rows = useMemo(
    () => (all ?? []).filter((r) => matches(filter, r)).sort(byPriorityThenCleaning),
    [all, filter],
  );
  // Looked up in the full list so the panel stays open when the row leaves the filter.
  const selected = all?.find((r) => r.id === selectedId) ?? null;
  const { flash, message } = useJudgmentChanges(all);

  const actionTotal = counts.CONFLICT + counts.NEEDS_CHECK + counts.UNDETERMINED;

  useEffect(() => {
    document.title = all && actionTotal > 0 ? `(${actionTotal}) ${TITLE}` : TITLE;
  }, [all, actionTotal]);
  useEffect(
    () => () => {
      document.title = TITLE;
    },
    [],
  );

  const focusSeq = useRef(0);
  const requestFocus = (target: 'row' | 'cleaning', id: string) =>
    setFocusRequest({ target, id, n: ++focusSeq.current });

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.target === 'row') {
      focusRow(`inspection-row-${focusRequest.id}`);
      return;
    }
    const panel = document.querySelector<HTMLElement>('[data-testid="detail-panel"]');
    const target =
      panel?.querySelector<HTMLElement>('[data-testid="cleaning-input"]') ??
      panel?.querySelector<HTMLElement>('[data-detail-heading]');
    target?.focus();
  }, [focusRequest]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  function move(delta: 1 | -1) {
    const list = rowsRef.current;
    if (list.length === 0) return;
    const i = list.findIndex((r) => r.id === selectedRef.current);
    const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + delta));
    const id = list[next].id;
    setSelectedId(id);
    requestFocus('row', id);
  }

  // j / k move the selection anywhere on the page except while typing.
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        moveRef.current(e.key === 'j' ? 1 : -1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onListKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('row-select')) return;
    e.preventDefault();
    move(e.key === 'ArrowDown' ? 1 : -1);
  }

  function closeDetail() {
    if (!selectedId) return;
    const id = selectedId;
    setSelectedId(null);
    requestFocus('row', id);
  }

  const summaryButton = (st: InspectionStatus) => (
    <button
      type="button"
      key={st}
      className={`summary-item summary-${st} ${counts[st] > 0 ? 'has-items' : 'is-zero'} ${
        filter === st ? 'active' : ''
      }`}
      data-testid={`summary-${st}`}
      aria-pressed={filter === st}
      onClick={() => setFilter(st)}
    >
      <span className="summary-label">{STATUS_LABEL[st]}</span>
      <span className="summary-count">{counts[st]}</span>
    </button>
  );

  return (
    <main className="page">
      <div className="page-head">
        <h1>{TITLE}</h1>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="judgment-announcer">
        {message}
      </p>

      <div className="summary" role="group" aria-label="판정 요약">
        <div
          className={`summary-group summary-group-action ${
            filter === 'ACTION_REQUIRED' ? 'active' : ''
          }`}
        >
          <button
            type="button"
            className="summary-group-label"
            data-testid="summary-ACTION_REQUIRED"
            aria-pressed={filter === 'ACTION_REQUIRED'}
            onClick={() => setFilter('ACTION_REQUIRED')}
          >
            조치 필요 <b className="tnum">{actionTotal}</b>
          </button>
          <div className="summary-items">
            {(['CONFLICT', 'NEEDS_CHECK', 'UNDETERMINED'] as const).map(summaryButton)}
          </div>
        </div>
        <div className="summary-group summary-group-rest">
          <span className="summary-group-label">조치 불필요</span>
          <div className="summary-items">{(['NORMAL', 'EXCLUDED'] as const).map(summaryButton)}</div>
        </div>
      </div>

      <div className="toolbar">
        <button
          type="button"
          className={`filter-all ${filter === 'ALL' ? 'active' : ''}`}
          data-testid="summary-ALL"
          aria-pressed={filter === 'ALL'}
          onClick={() => setFilter('ALL')}
        >
          전체 <b className="tnum">{all?.length ?? 0}</b>
        </button>
        {all && <span className="muted tnum">{rows.length}건 표시</span>}
      </div>

      {q.isPending && <p className="muted state-line">점검 결과를 불러오는 중…</p>}
      {q.isError && <p className="error state-line">점검 결과를 불러오지 못했습니다.</p>}

      {all && (
        <div className="split">
          <div className="table-wrap card flush" onKeyDown={onListKey}>
            <table className="data-table table-inspections">
              <thead>
                <tr>
                  <th>예약 번호</th>
                  <th>객실</th>
                  <th className="th-time">체크아웃 예정</th>
                  <th className="th-time">청소 시작 예정</th>
                  <th>판정</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr className="row-empty">
                    <td colSpan={6} className="empty">
                      {filter === 'ACTION_REQUIRED'
                        ? '조치가 필요한 예약이 없습니다.'
                        : '해당하는 예약이 없습니다.'}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const cleaningAt = activeCleaning(r)?.scheduledStartAt ?? null;
                  const status = statusOf(r);
                  const clash = status === 'CONFLICT';
                  const flashSeq = flash[r.id];
                  return (
                    <tr
                      key={r.id}
                      data-testid={`inspection-row-${r.id}`}
                      className={[
                        'clickable',
                        `row-${status ?? 'UNKNOWN'}`,
                        r.id === selectedId ? 'selected' : '',
                        flashSeq ? `row-flash row-flash-${flashSeq % 2}` : '',
                      ].join(' ')}
                      aria-current={r.id === selectedId ? 'true' : undefined}
                      onClick={() => setSelectedId(r.id)}
                    >
                      <td className="cell-id" data-label="예약 번호">
                        <button
                          type="button"
                          className="row-select"
                          aria-label={`${r.id} 상세 보기`}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            setSelectedId(r.id);
                            requestFocus('cleaning', r.id);
                          }}
                        >
                          {r.id}
                        </button>
                      </td>
                      <td data-label="객실">{r.roomId}</td>
                      <td
                        className={r.checkoutAt ? 'cell-time cell-checkout' : 'missing'}
                        data-label="체크아웃 예정"
                      >
                        {checkoutText(r)}
                      </td>
                      <td
                        className={cleaningAt ? `cell-time cell-cleaning ${clash ? 'clash' : ''}` : 'missing'}
                        data-label="청소 시작 예정"
                      >
                        <span className="time-main">{cleaningText(r)}</span>
                        {cleaningAt && (
                          <span className="time-rel" data-testid="cleaning-relative">
                            {relativeToNow(cleaningAt, now)}
                          </span>
                        )}
                      </td>
                      <td className="cell-status" data-label="판정">
                        <StatusBadge status={status} />
                      </td>
                      <td className="reason" data-label="근거">
                        {r.inspection?.reasonText ?? '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected ? (
            <DetailPanel key={selected.id} reservation={selected} onClose={closeDetail} />
          ) : (
            <aside className="detail-placeholder">목록에서 예약을 선택하세요.</aside>
          )}
        </div>
      )}
    </main>
  );
}

function DetailPanel({ reservation, onClose }: { reservation: ReservationView; onClose(): void }) {
  const status = statusOf(reservation);
  const task = activeCleaning(reservation);
  const editable = !!task && status !== 'EXCLUDED';
  return (
    <aside
      className="card detail detail-side"
      data-testid="detail-panel"
      aria-labelledby="detail-heading"
      ref={scrollIntoViewOnNarrow}
    >
      <div className="detail-head">
        <h2 id="detail-heading" tabIndex={-1} data-detail-heading>
          {reservation.id}
        </h2>
        <StatusBadge status={status} />
        <button type="button" className="btn-small btn-ghost detail-close" onClick={onClose}>
          목록으로
        </button>
      </div>
      {reservation.inspection?.reasonText && (
        <p className={`detail-reason reason-${status ?? 'UNKNOWN'}`}>
          {reservation.inspection.reasonText}
        </p>
      )}
      <TimeCompare
        checkoutAt={reservation.checkoutAt}
        cleaningAt={task?.scheduledStartAt ?? null}
        status={status}
      />
      <dl className="facts">
        <dt>객실</dt>
        <dd>{reservation.roomId}</dd>
        <dt>고객</dt>
        <dd>
          {reservation.guestName}
          {reservation.status === 'CANCELLED' && <span className="tag-cancelled">취소</span>}
        </dd>
        <dt>체크아웃 예정</dt>
        <dd className={reservation.checkoutAt ? 'tnum strong' : 'missing'}>
          {checkoutText(reservation)}
        </dd>
        <dt>청소 시작 예정</dt>
        <dd className={task?.scheduledStartAt ? 'tnum strong' : 'missing'}>
          {cleaningText(reservation)}
        </dd>
      </dl>

      {editable && task && <CleaningForm reservation={reservation} task={task} />}

      <h3 className="section-title">변경 이력</h3>
      <AuditLogList reservationId={reservation.id} />
    </aside>
  );
}

function CleaningForm({
  reservation,
  task,
}: {
  reservation: ReservationView;
  task: NonNullable<ReservationView['cleaningTask']>;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  // The judgment returned by this save; shown only while it is still the latest judgment.
  const [recheck, setRecheck] = useState<{ status: InspectionStatus; checkedAt: string } | null>(
    null,
  );
  const recheckStatus =
    recheck && reservation.inspection?.checkedAt === recheck.checkedAt ? recheck.status : null;

  const mutation = useMutation({
    mutationFn: (body: { scheduledStartAt: string; reason?: string; version: number }) =>
      api.rescheduleCleaning(task.id, body),
  });
  // Optimistic lock: the save sends draft.baseVersion, the version the input was based on.
  const draft = useServerDraft(isoToKstInput(task.scheduledStartAt), task.version, mutation.isPending);
  const { input } = draft;

  const canSave = !!input && !mutation.isPending;
  const checkoutAt = reservation.checkoutAt;
  const beforeCheckout = (() => {
    if (!checkoutAt || !input) return false;
    try {
      return Date.parse(kstInputToIso(input)) < Date.parse(checkoutAt);
    } catch {
      return false;
    }
  })();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    let scheduledStartAt: string;
    try {
      scheduledStartAt = kstInputToIso(input);
    } catch {
      setNotice({ kind: 'error', message: '청소 시작 시각 형식이 올바르지 않습니다.' });
      return;
    }
    setNotice(null);
    setRecheck(null);
    const memo = reason.trim();
    mutation.mutate(
      { scheduledStartAt, ...(memo ? { reason: memo } : {}), version: draft.baseVersion },
      {
        onSuccess: (saved) => {
          if (saved.cleaningTask) {
            draft.reset(isoToKstInput(saved.cleaningTask.scheduledStartAt), saved.cleaningTask.version);
          }
          applyServerView(queryClient, saved);
          setRecheck(
            saved.inspection
              ? { status: saved.inspection.status, checkedAt: saved.inspection.checkedAt }
              : null,
          );
          setReason('');
        },
        onError: (err) => {
          if (!isConflict(err)) {
            setNotice({ kind: 'error', message: errorText(err) });
            return;
          }
          setNotice({ kind: 'conflict' });
          void refreshAfterConflict(queryClient, err, reservation.id).then((latest) => {
            const latestTask = latest?.cleaningTask;
            if (!latestTask) return;
            draft.reset(isoToKstInput(latestTask.scheduledStartAt), latestTask.version);
          });
        },
      },
    );
  }

  return (
    <form className="editor" onSubmit={onSubmit} aria-label={`${reservation.id} 청소 일정 수정`}>
      <h3>청소 일정 수정</h3>
      <div className="editor-fields">
        <div className="field">
          <label className="field-label" htmlFor="cleaning-input">
            청소 시작
          </label>
          <input
            id="cleaning-input"
            type="datetime-local"
            data-testid="cleaning-input"
            value={input}
            onChange={(e) => draft.edit(e.target.value)}
            aria-describedby="cleaning-checkout"
            required
          />
          <div className="field-aside" id="cleaning-checkout">
            <span>
              체크아웃{' '}
              <b className={checkoutAt ? 'tnum' : 'missing'} data-testid="cleaning-checkout">
                {checkoutText(reservation)}
              </b>
            </span>
            {checkoutAt && (
              <button
                type="button"
                className="btn-small btn-ghost"
                data-testid="cleaning-fill-30"
                aria-label="체크아웃 +30분"
                onClick={() => draft.edit(kstInputAfter(checkoutAt, 30))}
              >
                +30분
              </button>
            )}
          </div>
          {beforeCheckout && (
            <p className="field-warn" data-testid="cleaning-before-checkout">
              체크아웃보다 이른 시각입니다.
            </p>
          )}
        </div>
        <label className="field grow">
          <span className="field-label">
            메모(사유) <span className="optional">선택</span>
          </span>
          <input
            type="text"
            data-testid="cleaning-reason"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {draft.remoteChanged && notice?.kind !== 'conflict' && (
        <RemoteChangeNotice
          latestAt={task.scheduledStartAt}
          onReload={() => draft.reset(isoToKstInput(task.scheduledStartAt), task.version)}
        />
      )}
      <SaveNoticeView notice={notice} />
      <div className="editor-actions">
        <button type="submit" className="primary" data-testid="cleaning-save" disabled={!canSave}>
          {mutation.isPending ? '저장 중…' : '저장'}
        </button>
        {recheckStatus && (
          <span
            className={`recheck recheck-${recheckStatus}`}
            data-testid="recheck-result"
            role="status"
          >
            재점검 결과: {STATUS_LABEL[recheckStatus]}
          </span>
        )}
      </div>
    </form>
  );
}
