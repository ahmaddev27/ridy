"use client";

import { useEffect, useState } from "react";

// Logos are vendored in /public/badges: Apple mark from simple-icons (CC0),
// Google Play four-facet geometry from Wikimedia Commons (Google_Play_Arrow_logo.svg),
// rendered monochrome white (facets as white tints) per owner.
const storeLinks = {
  googlePlay: "https://play.google.com/store/apps/details?id=de.reidey.app",
  appStore: "https://apps.apple.com/app/reidey", // TODO(owner): replace with the real https://apps.apple.com/app/id<numeric-id>
};

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);

// Backend (super-admin Settings) is the source of truth; storeLinks is the fallback.
function useStoreLinks() {
  const [links, setLinks] = useState(storeLinks);
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "";
    fetch(`${base}/api/v1/app/stores`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setLinks((prev) => ({
          appStore: isUrl(d?.data?.ios) ? d.data.ios : prev.appStore,
          googlePlay: isUrl(d?.data?.android) ? d.data.android : prev.googlePlay,
        })),
      )
      .catch(() => undefined);
  }, []);
  return links;
}

interface StoreBadgeProps {
  href: string;
  label: string;
  small: string;
  big: string;
  logo: string;
  logoClassName: string;
}

function StoreBadge({ href, label, small, big, logo, logoClassName }: StoreBadgeProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="glass-strong inline-flex items-center gap-3 rounded-2xl px-5 py-3 text-white transition-colors hover:border-white/20"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" aria-hidden className={logoClassName} />
      <span className="text-left leading-none">
        <span className="block text-[10px] uppercase tracking-wide text-white/75">{small}</span>
        <span className="font-heading block text-sm font-semibold text-white">{big}</span>
      </span>
    </a>
  );
}

export function StoreButtons() {
  const links = useStoreLinks();
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
      <StoreBadge
        href={links.appStore}
        label="Reidey im App Store laden"
        small="Laden im"
        big="App Store"
        logo="/badges/apple.svg"
        logoClassName="h-7 w-7"
      />
      <StoreBadge
        href={links.googlePlay}
        label="Reidey bei Google Play"
        small="Jetzt bei"
        big="Google Play"
        logo="/badges/google-play.svg"
        logoClassName="h-7 w-7"
      />
    </div>
  );
}
