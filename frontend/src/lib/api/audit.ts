import { apiFetch } from "./client";

export type AuditEntry = {
  id: number;
  action: string;
  actor_id: number | null;
  subject: string | null;
  ip: string | null;
  created_at: string | null;
};

export async function listAuditLogs(): Promise<AuditEntry[]> {
  const res = await apiFetch<{ data: AuditEntry[] }>("/api/v1/audit-logs");
  return res.data;
}
