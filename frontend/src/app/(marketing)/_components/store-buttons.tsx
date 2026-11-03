"use client";

import { useEffect, useState } from "react";

// Logos are vendored in /public/badges: Apple mark from simple-icons (CC0),
// Google Play four-facet mark from Wikimedia Commons (Google_Play_Arrow_logo.svg).
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
      className="inline-flex h-[50px] min-w-[165px] items-center gap-2.5 rounded-[10px] border border-[#a6a6a6] bg-black px-3.5 text-white transition-colors hover:bg-[#111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" aria-hidden className={logoClassName} />
      <span className="text-left leading-none">
        <span className="block text-[10px] font-normal tracking-wide">{small}</span>
        <span className="mt-0.5 block text-[19px] font-semibold tracking-tight">{big}</span>
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
        logoClassName="h-[30px] w-[30px]"
      />
      <StoreBadge
        href={links.googlePlay}
        label="Reidey bei Google Play"
        small="Jetzt bei"
        big="Google Play"
        logo="/badges/google-play.svg"
        logoClassName="h-[28px] w-[26px]"
      />
    </div>
  );
}
