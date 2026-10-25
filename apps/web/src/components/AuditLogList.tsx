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

function StatusText({ snap }: { snap: AuditSnapshot }) {
  return <span className={`st st-${snap.inspectionStatus ?? 'NONE'}`}>{statusOf(snap)}</span>;
}

export default function AuditLogList({ reservationId }: { reservationId: string }) {
  const q = useQuery({
    queryKey: queryKeys.auditLogs(reservationId),
    queryFn: () => api.auditLogs(reservationId),
  });

  if (q.isPending) return <p className="muted state-line">이력을 불러오는 중…</p>;
  if (q.isError) return <p className="error state-line">변경 이력을 불러오지 못했습니다.</p>;
  if (q.data.length === 0) {
    return (
      <p className="muted empty-line" data-testid="audit-log-empty">
        변경 이력이 없습니다.
      </p>
    );
  }

  return (
    <ol className="audit-list">
      {q.data.map((log) => (
        <li key={log.id} className={`audit-item audit-${log.action}`} data-testid="audit-log-item">
          <div className="audit-head">
            <strong>{ACTION_LABEL[log.action] ?? log.action}</strong>
            <time className="tnum" dateTime={log.createdAt}>
              {formatKstDateTime(log.createdAt)}
            </time>
          </div>
          <dl className="audit-diff">
            <dt>{log.action === 'CHECKOUT_CHANGED' ? '체크아웃' : '청소 시작'}</dt>
            <dd className="tnum">
              <span className="was">{valueOf(log, log.before)}</span> →{' '}
              <span className="now">{valueOf(log, log.after)}</span>
            </dd>
            <dt>판정</dt>
            <dd>
              <StatusText snap={log.before} /> → <StatusText snap={log.after} />
            </dd>
            <dt>사유</dt>
            <dd>{log.reason?.trim() ? log.reason : '-'}</dd>
            <dt>변경자</dt>
            <dd>
              {log.actor.displayName}{' '}
              <span className="muted">({ROLE_LABEL[log.actor.role] ?? log.actor.role})</span>
            </dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}
