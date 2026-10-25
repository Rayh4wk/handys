import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, queryKeys } from '../api/client';
import { STATUS_LABEL, type InspectionStatus, type ReservationView } from '../api/types';
import AuditLogList from '../components/AuditLogList';
import RemoteChangeNotice from '../components/RemoteChangeNotice';
import SaveNoticeView from '../components/SaveNoticeView';
import StatusBadge from '../components/StatusBadge';
import TimeCompare from '../components/TimeCompare';
import { formatKst, formatKstTime, isoToKstInput, kstInputToIso, sameKstDay } from '../lib/kst';
import { focusRow, scrollIntoViewOnNarrow } from '../lib/scroll';
import { useAnnouncer } from '../lib/useAnnouncer';
import { useServerDraft } from '../lib/useServerDraft';
import {
  MISSING,
  NO_TASK,
  activeCleaning,
  applyServerView,
  byId,
  checkoutText,
  isConflict,
  refreshAfterConflict,
  errorText,
  statusOf,
  type SaveNotice,
} from '../lib/reservation';

const GUIDANCE: Record<InspectionStatus, string> = {
  CONFLICT: '체크아웃 이전에 청소가 예정되어 있습니다. 운영 담당자의 일정 조정이 필요합니다.',
  NORMAL: '청소 일정과 충돌하지 않습니다.',
  NEEDS_CHECK: '대응하는 퇴실 청소 작업이 없습니다. 운영 담당자의 확인이 필요합니다.',
  UNDETERMINED: '판정에 필요한 정보가 없습니다. 운영 담당자의 확인이 필요합니다.',
  EXCLUDED: '점검 대상에서 제외된 예약입니다.',
};

interface ChangeResult {
  reservationId: string;
  previousCheckoutAt: string | null;
  newCheckoutAt: string | null;
  /** The reservation as the save returned it (cleaning start at save time, fallback judgment). */
  saved: ReservationView;
  /** Server time of the save's judgment; later cleaning changes are attributed after this. */
  savedAt: string;
}

/** The judgment line a screen reader hears for a change result (also when it later changes). */
function resultAnnouncement(id: string, status: InspectionStatus | null): string {
  if (!status) return `${id} 예약 변경 완료`;
  return status === 'CONFLICT'
    ? `${id} 예약 변경 완료. 청소 일정 조정 필요. ${GUIDANCE.CONFLICT}`
    : `${id} 예약 변경 완료. ${GUIDANCE[status]}`;
}

export default function ReservationsPage() {
  const q = useQuery({ queryKey: queryKeys.reservations, queryFn: () => api.listReservations() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [result, setResult] = useState<ChangeResult | null>(null);
  const [returnFocus, setReturnFocus] = useState<{ id: string } | null>(null);

  const rows = useMemo(() => [...(q.data ?? [])].sort(byId), [q.data]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const resultShown = !!result && !!selected && result.reservationId === selected.id;
  const resultCurrent = result ? rows.find((r) => r.id === result.reservationId) ?? result.saved : null;
  const resultStatus = statusOf(resultCurrent);
  const [announced, announce] = useAnnouncer();
  // Every save (and every later judgment change of its result) is announced, even if worded as before.
  useEffect(() => {
    if (result) announce(resultAnnouncement(result.reservationId, resultStatus));
  }, [result, resultStatus, announce]);

  useEffect(() => {
    if (returnFocus) focusRow(`reservation-row-${returnFocus.id}`);
  }, [returnFocus]);

  function select(id: string) {
    setSelectedId(id);
    if (editingId !== id) setEditingId(null);
  }

  function closeDetail() {
    if (!selectedId) return;
    setReturnFocus({ id: selectedId });
    setSelectedId(null);
    setEditingId(null);
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>예약 관리</h1>
      </div>
      {/* Mounted empty before any result so the first announcement is not lost. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="result-announcer">
        {announced}
      </p>

      {q.isPending && <p className="muted state-line">예약 목록을 불러오는 중…</p>}
      {q.isError && <p className="error state-line">예약 목록을 불러오지 못했습니다.</p>}

      {q.data && (
        <div className="split">
          <div className="table-wrap card flush">
            <table className="data-table table-reservations">
              <thead>
                <tr>
                  <th>예약 번호</th>
                  <th>객실</th>
                  <th>고객</th>
                  <th>체크아웃 예정</th>
                  <th>판정</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      표시할 예약이 없습니다.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const cancelled = r.status === 'CANCELLED';
                  const status = statusOf(r);
                  return (
                    <tr
                      key={r.id}
                      data-testid={`reservation-row-${r.id}`}
                      className={[
                        `row-${status ?? 'UNKNOWN'}`,
                        r.id === selectedId ? 'selected' : '',
                        cancelled ? 'row-cancelled' : '',
                      ].join(' ')}
                      aria-current={r.id === selectedId ? 'true' : undefined}
                      onClick={() => select(r.id)}
                    >
                      <td className="cell-id" data-label="예약 번호">
                        <button type="button" className="row-select" aria-label={`${r.id} 상세 보기`}>
                          {r.id}
                        </button>
                      </td>
                      <td data-label="객실">{r.roomId}</td>
                      <td className="cell-guest" data-label="고객">
                        {r.guestName}
                        {cancelled && <span className="tag-cancelled">취소</span>}
                      </td>
                      <td
                        className={r.checkoutAt ? 'cell-time' : 'missing'}
                        data-label="체크아웃 예정"
                      >
                        <span className="time-main">{checkoutText(r)}</span>
                      </td>
                      <td className="cell-status" data-label="판정">
                        <StatusBadge status={status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected ? (
            <section
              className="card detail detail-side"
              aria-label="선택한 예약"
              ref={scrollIntoViewOnNarrow}
              key={selected.id}
            >
              <div className="detail-head">
                <h2 tabIndex={-1} data-detail-heading>
                  {selected.id}
                </h2>
                <StatusBadge status={statusOf(selected)} />
                <button type="button" className="btn-small btn-ghost detail-close" onClick={closeDetail}>
                  목록으로
                </button>
              </div>

              {selected.status === 'CANCELLED' ? (
                <p className="inline-notice notice-muted">취소된 예약은 변경할 수 없습니다.</p>
              ) : editingId === selected.id ? (
                <CheckoutEditor
                  key={selected.id}
                  reservation={selected}
                  onCancel={() => setEditingId(null)}
                  onSaved={(r) => {
                    setResult(r);
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="detail-actions">
                  <button
                    type="button"
                    className={resultShown ? undefined : 'primary'}
                    onClick={() => setEditingId(selected.id)}
                  >
                    체크아웃 변경
                  </button>
                </div>
              )}

              {resultShown && result && <ChangeResultPanel result={result} current={selected} />}

              <h3 className="section-title">변경 이력</h3>
              <AuditLogList reservationId={selected.id} />
            </section>
          ) : (
            <aside className="detail-placeholder">목록에서 예약을 선택하세요.</aside>
          )}
        </div>
      )}
    </main>
  );
}

function CheckoutEditor({
  reservation,
  onSaved,
  onCancel,
}: {
  reservation: ReservationView;
  onSaved(result: ChangeResult): void;
  onCancel(): void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<SaveNotice | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { checkoutAt: string; reason: string; version: number }) =>
      api.changeCheckout(reservation.id, body),
  });
  // Optimistic lock: the save sends draft.baseVersion — the version the input is based on, which
  // follows a newer server value only while the input is untouched (see useServerDraft).
  const draft = useServerDraft(isoToKstInput(reservation.checkoutAt), reservation.version, mutation.isPending);
  const { input } = draft;

  const canSave = !!input && reason.trim().length > 0 && !mutation.isPending;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    let checkoutAt: string;
    try {
      checkoutAt = kstInputToIso(input);
    } catch {
      setNotice({ kind: 'error', message: '체크아웃 시각 형식이 올바르지 않습니다.' });
      return;
    }
    setNotice(null);
    const previousCheckoutAt = reservation.checkoutAt;
    mutation.mutate(
      { checkoutAt, reason: reason.trim(), version: draft.baseVersion },
      {
        onSuccess: (saved) => {
          applyServerView(queryClient, saved);
          onSaved({
            reservationId: saved.id,
            previousCheckoutAt,
            newCheckoutAt: saved.checkoutAt,
            saved,
            savedAt: saved.inspection?.checkedAt ?? new Date().toISOString(),
          });
        },
        onError: (err) => {
          if (!isConflict(err)) {
            setNotice({ kind: 'error', message: errorText(err) });
            return;
          }
          setNotice({ kind: 'conflict' });
          void refreshAfterConflict(queryClient, err, reservation.id).then((latest) => {
            if (!latest) return;
            draft.reset(isoToKstInput(latest.checkoutAt), latest.version);
          });
        },
      },
    );
  }

  return (
    <form className="editor" data-testid="checkout-editor" onSubmit={onSubmit}>
      <div className="editor-current">
        현재 체크아웃 예정 <strong className="tnum">{checkoutText(reservation)}</strong>
      </div>
      <div className="editor-fields">
        <label className="field">
          <span className="field-label">변경할 체크아웃</span>
          <input
            type="datetime-local"
            data-testid="checkout-input"
            value={input}
            onChange={(e) => draft.edit(e.target.value)}
            {...draft.inputProps}
            required
          />
        </label>
        <label className="field grow">
          <span className="field-label">
            변경 사유 <span className="required">필수</span>
          </span>
          <input
            type="text"
            data-testid="checkout-reason"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>
      </div>
      <RemoteChangeNotice
        show={draft.remoteChanged && notice?.kind !== 'conflict'}
        latestAt={reservation.checkoutAt}
        onReload={() => draft.reset(isoToKstInput(reservation.checkoutAt), reservation.version)}
      />
      <SaveNoticeView notice={notice} />
      <div className="editor-actions">
        <button type="submit" className="primary" data-testid="checkout-save" disabled={!canSave}>
          {mutation.isPending ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onCancel} disabled={mutation.isPending}>
          취소
        </button>
      </div>
    </form>
  );
}

/** Cleaning start of `r` in the given format, or 작업 없음 / 정보 누락. */
function cleaningLabel(r: ReservationView, fmt: (iso: string) => string): string {
  const task = activeCleaning(r);
  if (!task) return NO_TASK;
  return task.scheduledStartAt ? fmt(task.scheduledStartAt) : MISSING;
}

function ChangeResultPanel({ result, current }: { result: ChangeResult; current: ReservationView }) {
  // The judgment follows the latest data (SSE refetch), so an operations fix shows up here.
  const status = statusOf(current) ?? statusOf(result.saved);
  const conflict = status === 'CONFLICT';
  const logs = useQuery({
    queryKey: queryKeys.auditLogs(current.id),
    queryFn: () => api.auditLogs(current.id),
  });

  const cleaningAtSave = activeCleaning(result.saved)?.scheduledStartAt ?? null;
  const cleaningNowAt = activeCleaning(current)?.scheduledStartAt ?? null;
  // One format for the whole panel: the date only appears when the times span more than one day.
  const fmt = sameKstDay(result.previousCheckoutAt, result.newCheckoutAt, cleaningAtSave, cleaningNowAt)
    ? (iso: string) => formatKstTime(iso)
    : (iso: string) => formatKst(iso);
  const timeText = (iso: string | null) => (iso ? fmt(iso) : MISSING);
  const savedCleaning = cleaningLabel(result.saved, fmt);
  const cleaningNow = cleaningLabel(current, fmt);

  // Who resolved it: the latest cleaning reschedule after this change, once the judgment is NORMAL.
  const resolvedBy =
    status === 'NORMAL'
      ? (logs.data ?? [])
          .filter((l) => l.action === 'CLEANING_RESCHEDULED' && l.createdAt > result.savedAt)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;

  return (
    <section
      className={`result-panel ${status ? `result-${status}` : ''}`}
      data-testid="change-result"
      data-result={status ?? 'UNKNOWN'}
    >
      <div className="result-done">
        <span className="result-check" aria-hidden />
        <h3>예약 변경 완료</h3>
      </div>
      <ul className="result-facts">
        <li>
          체크아웃: <span className="was">{timeText(result.previousCheckoutAt)}</span> →{' '}
          <span className="now">{timeText(result.newCheckoutAt)}</span>
        </li>
        <li>기존 청소 시작: {savedCleaning}</li>
        {cleaningNow !== savedCleaning && (
          <li data-testid="current-cleaning">현재 청소 시작: {cleaningNow}</li>
        )}
      </ul>
      <div className="result-judgment">
        {conflict && <p className="result-alert">청소 일정 조정 필요</p>}
        {status && (
          <p className="result-guidance">
            <span className="sr-only">{STATUS_LABEL[status]}: </span>
            {GUIDANCE[status]}
          </p>
        )}
        {resolvedBy && (
          <p className="result-resolved" data-testid="result-resolved">
            청소 일정 조정됨 · {resolvedBy.actor.displayName}{' '}
            <time className="tnum" dateTime={resolvedBy.createdAt}>
              {formatKst(resolvedBy.createdAt)}
            </time>
          </p>
        )}
        <TimeCompare
          checkoutAt={current.checkoutAt}
          cleaningAt={cleaningNowAt}
          status={status}
        />
      </div>
    </section>
  );
}
