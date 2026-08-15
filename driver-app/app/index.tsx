import { Redirect } from "expo-router";

// The root gate (app/_layout) redirects based on auth; send everyone to offers,
// which bounces to /login when there is no session.
export default function Index() {
  return <Redirect href="/offers" />;
}
