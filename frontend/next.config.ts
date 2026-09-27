import type { NextConfig } from "next";

// Must match EXTENSION_STORE_URL in src/lib/extension.ts.
const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/jkejjdjgoknicbejmgcmojgdeljnaean";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Nothing uses next/image; don't run the image optimizer for arbitrary hosts.
  images: { unoptimized: true },
  async redirects() {
    return [
      // The old sideloadable extension zip (pre-audit build) is gone — the Chrome
      // Web Store listing is the only install path.
      { source: "/downloads/reidey-extension.zip", destination: EXTENSION_STORE_URL, permanent: false },
    ];
  },
};

export default nextConfig;
