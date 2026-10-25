import type { AuditLogView, InspectionStatus, Me, ReservationView } from './types';

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    const msg = body && typeof body === 'object' && 'message' in body ? body.message : undefined;
    super(Array.isArray(msg) ? msg.join(', ') : String(msg ?? `HTTP ${status}`));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<Me>('POST', '/auth/login', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<Me>('GET', '/auth/me'),
  listReservations: () => request<ReservationView[]>('GET', '/reservations'),
  listInspections: (status?: InspectionStatus) =>
    request<ReservationView[]>(
      'GET',
      `/inspection-results${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  auditLogs: (id: string) =>
    request<AuditLogView[]>('GET', `/reservations/${encodeURIComponent(id)}/audit-logs`),
  changeCheckout: (id: string, body: { checkoutAt: string; reason: string; version: number }) =>
    request<ReservationView>('PATCH', `/reservations/${encodeURIComponent(id)}/checkout`, body),
  rescheduleCleaning: (
    taskId: string,
    body: { scheduledStartAt: string; reason?: string; version: number },
  ) =>
    request<ReservationView>(
      'PATCH',
      `/cleaning-tasks/${encodeURIComponent(taskId)}/schedule`,
      body,
    ),
};

export const queryKeys = {
  me: ['me'] as const,
  reservations: ['reservations'] as const,
  inspections: (s?: string) => ['inspection-results', s ?? 'ALL'] as const,
  auditLogs: (id: string) => ['audit-logs', id] as const,
};
