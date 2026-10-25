import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { api, queryKeys } from '../api/client';
import { STATUS_LABEL, type InspectionStatus, type ReservationView } from '../api/types';
import AuditLogList from '../components/AuditLogList';
import SaveNoticeView from '../components/SaveNoticeView';
import StatusBadge from '../components/StatusBadge';
import TimeCompare from '../components/TimeCompare';
import { isoToKstInput, kstInputToIso } from '../lib/kst';
import { scrollIntoViewOnNarrow } from '../lib/scroll';
import {
  ACTION_REQUIRED,
  STATUS_ORDER,
  activeCleaning,
  applyServerView,
  byPriorityThenId,
  checkoutText,
  cleaningText,
  isConflict,
  refreshAfterConflict,
  errorText,
  statusOf,
  type SaveNotice,
} from '../lib/reservation';

type Filter = 'ACTION_REQUIRED' | 'ALL' | InspectionStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ACTION_REQUIRED', label: '조치 필요' },
  { value: 'ALL', label: '전체' },
  ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

function matches(filter: Filter, r: ReservationView): boolean {
  const s = statusOf(r);
  if (filter === 'ALL') return true;
  if (filter === 'ACTION_REQUIRED') return !!s && ACTION_REQUIRED.has(s);
  return s === filter;
}

export default function OperationsPage() {
  const q = useQuery({ queryKey: queryKeys.inspections(), queryFn: () => api.listInspections() });
  const [filter, setFilter] = useState<Filter>('ACTION_REQUIRED');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    () => (all ?? []).filter((r) => matches(filter, r)).sort(byPriorityThenId),
    [all, filter],
  );
  // Looked up in the full list so the panel stays open when the row leaves the filter.
  const selected = all?.find((r) => r.id === selectedId) ?? null;

  const actionTotal = counts.CONFLICT + counts.NEEDS_CHECK + counts.UNDETERMINED;
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
        <h1>청소 일정 점검</h1>
      </div>

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
        <label className="toolbar-filter">
          보기{' '}
          <select
            data-testid="status-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {all && <span className="muted tnum">{rows.length}건</span>}
      </div>

      {q.isPending && <p className="muted state-line">점검 결과를 불러오는 중…</p>}
      {q.isError && <p className="error state-line">점검 결과를 불러오지 못했습니다.</p>}

      {all && (
        <div className="split">
          <div className="table-wrap card flush">
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
                  const hasCleaningTime = !!activeCleaning(r)?.scheduledStartAt;
                  const status = statusOf(r);
                  const clash = status === 'CONFLICT';
                  return (
                    <tr
                      key={r.id}
                      data-testid={`inspection-row-${r.id}`}
                      className={`clickable row-${status ?? 'UNKNOWN'} ${
                        r.id === selectedId ? 'selected' : ''
                      }`}
                      aria-current={r.id === selectedId ? 'true' : undefined}
                      tabIndex={0}
                      onClick={() => setSelectedId(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(r.id);
                        }
                      }}
                    >
                      <td className="cell-id" data-label="예약 번호">
                        {r.id}
                      </td>
                      <td data-label="객실">{r.roomId}</td>
                      <td
                        className={r.checkoutAt ? 'cell-time cell-checkout' : 'missing'}
                        data-label="체크아웃 예정"
                      >
                        {checkoutText(r)}
                      </td>
                      <td
                        className={
                          hasCleaningTime
                            ? `cell-time cell-cleaning ${clash ? 'clash' : ''}`
                            : 'missing'
                        }
                        data-label="청소 시작 예정"
                      >
                        {cleaningText(r)}
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
            <DetailPanel key={selected.id} reservation={selected} />
          ) : (
            <aside className="detail-placeholder">목록에서 예약을 선택하세요.</aside>
          )}
        </div>
      )}
    </main>
  );
}

function DetailPanel({ reservation }: { reservation: ReservationView }) {
  const status = statusOf(reservation);
  const task = activeCleaning(reservation);
  const editable = !!task && status !== 'EXCLUDED';
  return (
    <aside
      className="card detail detail-side"
      data-testid="detail-panel"
      ref={scrollIntoViewOnNarrow}
    >
      <div className="detail-head">
        <h2>{reservation.id}</h2>
        <StatusBadge status={status} />
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
  const [input, setInput] = useState(() => isoToKstInput(task.scheduledStartAt));
  // Optimistic lock: version of the task as it was when this form opened (see CheckoutEditor).
  const [baseVersion, setBaseVersion] = useState(task.version);
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

  const canSave = !!input && !mutation.isPending;

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
      { scheduledStartAt, ...(memo ? { reason: memo } : {}), version: baseVersion },
      {
        onSuccess: (saved) => {
          applyServerView(queryClient, saved);
          setRecheck(
            saved.inspection
              ? { status: saved.inspection.status, checkedAt: saved.inspection.checkedAt }
              : null,
          );
          setReason('');
          if (saved.cleaningTask) {
            setBaseVersion(saved.cleaningTask.version);
            setInput(isoToKstInput(saved.cleaningTask.scheduledStartAt));
          }
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
            setInput(isoToKstInput(latestTask.scheduledStartAt));
            setBaseVersion(latestTask.version);
          });
        },
      },
    );
  }

  return (
    <form className="editor" onSubmit={onSubmit} aria-label={`${reservation.id} 청소 일정 수정`}>
      <h3>청소 일정 수정</h3>
      <div className="editor-fields">
        <label className="field">
          <span className="field-label">청소 시작</span>
          <input
            type="datetime-local"
            data-testid="cleaning-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
        </label>
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
