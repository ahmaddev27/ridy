"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { getLiveAds, type CurrentAd } from "@/lib/api/ads";

const ROTATE_MS = 4000;

/** Resolve a possibly same-origin-relative ad image URL against the API host. */
function resolveImage(url: string | null): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${url}`;
}

/**
 * Full-width banner slider for platform ads (super-admin authored). Image-only:
 * the admin uploads one image per device (mobile / tablet / desktop) with its own
 * baked-in button, and the WHOLE image is the click target — no CTA button. The
 * container's aspect ratio matches each device's image, so nothing is cropped.
 * Renders nothing when no ad is live; auto-advances every 4s (pausing on hover)
 * once there's more than one, with clickable dot indicators.
 */
export function AdBanner() {
  const { t } = useI18n();
  const [ads, setAds] = useState<CurrentAd[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    getLiveAds()
      .then(setAds)
      .catch(() => setAds([]));
  }, []);

  const count = ads.length;

  useEffect(() => {
    if (count <= 1 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(id);
  }, [count, paused]);

  useEffect(() => {
    if (index >= count && count > 0) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  const current = Math.min(index, count - 1);

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-line bg-surface"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Aspect matches each device's image so object-cover never crops it. */}
      <div className="relative aspect-[16/10] w-full sm:aspect-[5/2] lg:aspect-[4/1]">
        {ads.map((ad, i) => (
          <AdSlide key={ad.id} ad={ad} active={i === current} t={t} />
        ))}
      </div>

      {count > 1 && (
        <div className="absolute bottom-3 start-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rtl:translate-x-1/2">
          {ads.map((ad, i) => (
            <button
              key={ad.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${t("screens.ads.slotSponsored")} ${i + 1}`}
              aria-current={i === current}
              className={`h-2 rounded-full transition-all ${
                i === current ? "w-5 bg-white" : "w-2 bg-white/60 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdSlide({ ad, active, t }: { ad: CurrentAd; active: boolean; t: (k: string) => string }) {
  // Non-active slides are removed from the tab/pointer flow.
  const ref = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !active;
  }, [active]);

  return (
    <a
      ref={ref}
      href={ad.link_url ?? undefined}
      target="_blank"
      rel="noopener noreferrer nofollow"
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      aria-label={t("screens.ads.slotSponsored")}
      className={`absolute inset-0 block transition-opacity duration-700 ${
        active ? "z-10 opacity-100" : "z-0 opacity-0"
      }`}
    >
      {/* The whole image is the ad and the click target — one image per device. */}
      <picture>
        <source media="(min-width: 1024px)" srcSet={resolveImage(ad.image_desktop)} />
        <source media="(min-width: 640px)" srcSet={resolveImage(ad.image_tablet)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolveImage(ad.image_mobile)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </picture>

      {/* Small "Sponsored" tag, top-start. */}
      <span className="absolute top-3 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 ltr:left-3 rtl:right-3">
        {t("screens.ads.slotSponsored")}
      </span>
    </a>
  );
}
