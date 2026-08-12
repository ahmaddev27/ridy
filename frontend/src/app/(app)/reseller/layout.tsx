import { ResellerGuard } from "@/components/auth/reseller-guard";

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  return <ResellerGuard>{children}</ResellerGuard>;
}
