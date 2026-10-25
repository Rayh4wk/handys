import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client';
import { ACTION_LABEL, ROLE_LABEL, STATUS_LABEL, type AuditLogView, type AuditSnapshot } from '../api/types';
import { formatKst, formatKstDateTime } from '../lib/kst';

const NONE = '정보 없음';

function valueOf(log: AuditLogView, snap: AuditSnapshot): string {
  const v = log.action === 'CHECKOUT_CHANGED' ? snap.checkoutAt : snap.scheduledStartAt;
  return v ? formatKst(v) : NONE;
}

function statusOf(snap: AuditSnapshot): string {
  return snap.inspectionStatus ? STATUS_LABEL[snap.inspectionStatus] : NONE;
}

export default function AuditLogList({ reservationId }: { reservationId: string }) {
  const q = useQuery({
    queryKey: queryKeys.auditLogs(reservationId),
    queryFn: () => api.auditLogs(reservationId),
  });

  if (q.isPending) return <p className="muted">이력을 불러오는 중…</p>;
  if (q.isError) return <p className="error">변경 이력을 불러오지 못했습니다.</p>;
  if (q.data.length === 0) return <p className="muted" data-testid="audit-log-empty">변경 이력이 없습니다.</p>;

  return (
    <ol className="audit-list">
      {q.data.map((log) => (
        <li key={log.id} className="audit-item" data-testid="audit-log-item">
          <div className="audit-head">
            <time dateTime={log.createdAt}>{formatKstDateTime(log.createdAt)}</time>
            <strong>{ACTION_LABEL[log.action] ?? log.action}</strong>
          </div>
          <dl>
            <dt>{log.action === 'CHECKOUT_CHANGED' ? '체크아웃' : '청소 시작'}</dt>
            <dd>
              {valueOf(log, log.before)} → {valueOf(log, log.after)}
            </dd>
            <dt>판정</dt>
            <dd>
              {statusOf(log.before)} → {statusOf(log.after)}
            </dd>
            <dt>사유</dt>
            <dd>{log.reason?.trim() ? log.reason : '-'}</dd>
            <dt>변경자</dt>
            <dd>
              {log.actor.displayName} ({ROLE_LABEL[log.actor.role] ?? log.actor.role})
            </dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}
