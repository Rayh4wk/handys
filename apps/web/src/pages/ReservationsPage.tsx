import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { api, queryKeys } from '../api/client';
import type { InspectionStatus, ReservationView } from '../api/types';
import AuditLogList from '../components/AuditLogList';
import SaveNoticeView from '../components/SaveNoticeView';
import StatusBadge from '../components/StatusBadge';
import { isoToKstInput, kstInputToIso } from '../lib/kst';
import {
  applyServerView,
  byId,
  checkoutText,
  cleaningTimeText,
  isConflict,
  refreshAfterConflict,
  errorText,
  statusOf,
  timeOrMissing,
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
  /** Fallbacks used until the list reflects the saved reservation. */
  saved: ReservationView;
}

export default function ReservationsPage() {
  const q = useQuery({ queryKey: queryKeys.reservations, queryFn: () => api.listReservations() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [result, setResult] = useState<ChangeResult | null>(null);

  const rows = useMemo(() => [...(q.data ?? [])].sort(byId), [q.data]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function select(id: string) {
    setSelectedId(id);
    if (editingId !== id) setEditingId(null);
  }

  return (
    <main className="page">
      <h1>예약·고객 응대</h1>
      <p className="muted page-lead">
        고객 요청에 따라 체크아웃 시각을 변경합니다. 저장하면 청소 일정과의 충돌 여부를 바로
        확인할 수 있습니다.
      </p>

      {q.isPending && <p className="muted">예약 목록을 불러오는 중…</p>}
      {q.isError && <p className="error">예약 목록을 불러오지 못했습니다.</p>}

      {q.data && (
        <div className="table-wrap card flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>예약 번호</th>
                <th>객실</th>
                <th>고객</th>
                <th>체크아웃 예정</th>
                <th>판정</th>
                <th aria-label="작업" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cancelled = r.status === 'CANCELLED';
                return (
                  <tr
                    key={r.id}
                    data-testid={`reservation-row-${r.id}`}
                    className={r.id === selectedId ? 'selected' : undefined}
                    aria-selected={r.id === selectedId}
                    onClick={() => select(r.id)}
                  >
                    <td className="mono">{r.id}</td>
                    <td>{r.roomId}</td>
                    <td>
                      {r.guestName}
                      {cancelled && <span className="tag-cancelled">취소</span>}
                    </td>
                    <td className={r.checkoutAt ? 'mono' : 'missing'}>{checkoutText(r)}</td>
                    <td>
                      <StatusBadge status={statusOf(r)} />
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        disabled={cancelled}
                        title={cancelled ? '취소된 예약은 변경할 수 없습니다.' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(r.id);
                          setEditingId(r.id);
                        }}
                      >
                        체크아웃 변경
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <section className="card detail" aria-label="선택한 예약">
          <h2>
            {selected.id} <span className="muted">· {selected.roomId} · {selected.guestName}</span>
          </h2>

          {editingId === selected.id && selected.status !== 'CANCELLED' && (
            <CheckoutEditor
              key={selected.id}
              reservation={selected}
              onCancel={() => setEditingId(null)}
              onSaved={(r) => {
                setResult(r);
                setEditingId(null);
              }}
            />
          )}

          {result && result.reservationId === selected.id && (
            <ChangeResultPanel result={result} current={selected} />
          )}

          <h3>변경 이력</h3>
          <AuditLogList reservationId={selected.id} />
        </section>
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
  const [input, setInput] = useState(() => isoToKstInput(reservation.checkoutAt));
  // Optimistic lock: the version of the data the user is editing, captured when the editor
  // opens — not the live list value, so a concurrent change (seen via SSE) still yields a 409.
  const [baseVersion, setBaseVersion] = useState(reservation.version);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<SaveNotice | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { checkoutAt: string; reason: string; version: number }) =>
      api.changeCheckout(reservation.id, body),
  });

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
      { checkoutAt, reason: reason.trim(), version: baseVersion },
      {
        onSuccess: (saved) => {
          applyServerView(queryClient, saved);
          onSaved({
            reservationId: saved.id,
            previousCheckoutAt,
            newCheckoutAt: saved.checkoutAt,
            saved,
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
            setInput(isoToKstInput(latest.checkoutAt));
            setBaseVersion(latest.version);
          });
        },
      },
    );
  }

  return (
    <form className="editor" data-testid="checkout-editor" onSubmit={onSubmit}>
      <div className="editor-current">
        현재 체크아웃 예정 <strong>{checkoutText(reservation)}</strong>
      </div>
      <div className="editor-fields">
        <label>
          변경할 체크아웃 (KST)
          <input
            type="datetime-local"
            data-testid="checkout-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
        </label>
        <label className="grow">
          변경 사유 <span className="required">필수</span>
          <input
            type="text"
            data-testid="checkout-reason"
            value={reason}
            placeholder="예: 고객 요청"
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>
      </div>
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

function ChangeResultPanel({ result, current }: { result: ChangeResult; current: ReservationView }) {
  // The judgment follows the latest data (SSE refetch), so an operations fix shows up here.
  const status = statusOf(current) ?? statusOf(result.saved);
  const conflict = status === 'CONFLICT';
  return (
    <section
      className={`result-panel ${status ? `result-${status}` : ''}`}
      data-testid="change-result"
      data-result={status ?? 'UNKNOWN'}
      aria-live="polite"
    >
      <div className="result-head">
        <h3>예약 변경 완료</h3>
        <StatusBadge status={status} />
      </div>
      {conflict && <p className="result-alert">청소 일정 조정 필요</p>}
      <ul className="result-facts">
        <li>
          체크아웃: {timeOrMissing(result.previousCheckoutAt)} → {timeOrMissing(result.newCheckoutAt)}
        </li>
        <li>기존 청소 시작: {cleaningTimeText(current)}</li>
      </ul>
      {status && <p className="result-guidance">{GUIDANCE[status]}</p>}
    </section>
  );
}
