import { apiFetch } from "./client";

export async function startRegistration(input: {
  company_name: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ email: string }> {
  const res = await apiFetch<{ data: { email: string } }>("/api/v1/register", {
    method: "POST",
    body: input,
    withCsrf: true,
  });
  return res.data;
}

export async function verifyRegistration(email: string, otp: string): Promise<void> {
  await apiFetch("/api/v1/register/verify", {
    method: "POST",
    body: { email, otp },
    withCsrf: true,
  });
}

export async function resendOtp(email: string): Promise<void> {
  await apiFetch("/api/v1/register/resend", {
    method: "POST",
    body: { email },
    withCsrf: true,
  });
}
