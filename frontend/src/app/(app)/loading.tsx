import { Preloader } from "@/components/brand/preloader";

// Rendered inside the app shell's <main>: the sidebar and topbar stay visible
// during client navigations instead of a full-screen splash covering them.
export default function Loading() {
  return <Preloader inline />;
}
