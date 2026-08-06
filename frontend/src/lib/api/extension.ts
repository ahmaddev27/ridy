import { apiFetch } from "./client";

export async function issueExtensionToken(): Promise<string> {
  const res = await apiFetch<{ data: { token: string } }>("/api/v1/extension/token", {
    method: "POST",
    withCsrf: true,
  });
  return res.data.token;
}
