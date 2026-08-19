import { redirect } from "next/navigation";

// Shards now live as a tab inside System Health. Keep the old link working.
export default function ShardsRedirect() {
  redirect("/admin/system-health");
}
