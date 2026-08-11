import { apiFetch } from "./client";

/** Company owner activates/renews by entering the admin-generated code. */
export async function activateCompany(email: string, password: string, code: string): Promise<void> {
  await apiFetch("/api/v1/company/activate", {
    method: "POST",
    body: { email, password, code },
    withCsrf: true,
  });
}
