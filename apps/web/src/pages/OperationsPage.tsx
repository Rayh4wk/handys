import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { api, queryKeys } from '../api/client';
import { STATUS_LABEL, type InspectionStatus, type ReservationView } from '../api/types';
import AuditLogList from '../components/AuditLogList';
import SaveNoticeView from '../components/SaveNoticeView';
import StatusBadge from '../components/StatusBadge';
import { isoToKstInput, kstInputToIso } from '../lib/kst';
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

  return (
    <main className="page">
      <h1>현장 운영 — 청소 일정 점검</h1>

      <div className="summary" role="group" aria-label="판정 요약">
        {STATUS_ORDER.map((s) => (
          <button
            type="button"
            key={s}
            className={`summary-item summary-${s} ${filter === s ? 'active' : ''}`}
            data-testid={`summary-${s}`}
            onClick={() => setFilter(s)}
          >
            <span className="summary-label">{STATUS_LABEL[s]}</span>
            <span className="summary-count">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label>
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
        {all && <span className="muted">{rows.length}건</span>}
      </div>

      {q.isPending && <p className="muted">점검 결과를 불러오는 중…</p>}
      {q.isError && <p className="error">점검 결과를 불러오지 못했습니다.</p>}

      <div className="split">
        {all && (
          <div className="table-wrap card flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>예약 번호</th>
                  <th>객실</th>
                  <th>체크아웃 예정</th>
                  <th>청소 시작 예정</th>
                  <th>판정</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      해당하는 예약이 없습니다.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const cleaning = cleaningText(r);
                  return (
                    <tr
                      key={r.id}
                      data-testid={`inspection-row-${r.id}`}
                      className={`clickable ${r.id === selectedId ? 'selected' : ''}`}
                      aria-selected={r.id === selectedId}
                      tabIndex={0}
                      onClick={() => setSelectedId(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(r.id);
                        }
                      }}
                    >
                      <td className="mono">{r.id}</td>
                      <td>{r.roomId}</td>
                      <td className={r.checkoutAt ? 'mono' : 'missing'}>{checkoutText(r)}</td>
                      <td className={/^\d/.test(cleaning) ? 'mono' : 'missing'}>{cleaning}</td>
                      <td>
                        <StatusBadge status={statusOf(r)} />
                      </td>
                      <td className="reason">{r.inspection?.reasonText ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selected && <DetailPanel key={selected.id} reservation={selected} />}
      </div>
    </main>
  );
}

function DetailPanel({ reservation }: { reservation: ReservationView }) {
  const status = statusOf(reservation);
  const task = activeCleaning(reservation);
  const editable = !!task && status !== 'EXCLUDED';
  return (
    <aside className="card detail detail-side" data-testid="detail-panel">
      <div className="detail-head">
        <h2>{reservation.id}</h2>
        <StatusBadge status={status} />
      </div>
      <dl className="facts">
        <dt>객실</dt>
        <dd>{reservation.roomId}</dd>
        <dt>고객</dt>
        <dd>
          {reservation.guestName}
          {reservation.status === 'CANCELLED' && <span className="tag-cancelled">취소</span>}
        </dd>
        <dt>체크아웃 예정</dt>
        <dd>{checkoutText(reservation)}</dd>
        <dt>청소 시작 예정</dt>
        <dd>{cleaningText(reservation)}</dd>
        <dt>근거</dt>
        <dd>{reservation.inspection?.reasonText ?? '-'}</dd>
      </dl>

      {editable && task && <CleaningForm reservation={reservation} task={task} />}

      <h3>변경 이력</h3>
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
  const [recheck, setRecheck] = useState<InspectionStatus | null>(null);

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
          setRecheck(statusOf(saved));
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
        <label>
          청소 시작 (KST)
          <input
            type="datetime-local"
            data-testid="cleaning-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
        </label>
        <label className="grow">
          메모(사유) <span className="optional">선택</span>
          <input
            type="text"
            data-testid="cleaning-reason"
            value={reason}
            placeholder="예: 체크아웃 지연 반영"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <SaveNoticeView notice={notice} />
      <div className="editor-actions">
        <button type="submit" className="primary" data-testid="cleaning-save" disabled={!canSave}>
          {mutation.isPending ? '저장 중…' : '저장'}
        </button>
        {recheck && (
          <span className={`recheck recheck-${recheck}`} data-testid="recheck-result" role="status">
            재점검 결과: {STATUS_LABEL[recheck]}
          </span>
        )}
      </div>
    </form>
  );
}
