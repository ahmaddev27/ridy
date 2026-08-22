"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { getLiveAds, type CurrentAd } from "@/lib/api/ads";

const ROTATE_MS = 4000;

/** Resolve a possibly same-origin-relative ad image URL against the API host. */
function resolveImage(url: string | null): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `${process.env.NEXT_PUBLIC_API_URL ?? ""}${url}`;
}

/**
 * Full-width landscape banner slider for platform ads (super-admin authored).
 * Renders nothing when no ad is live (so pages don't reserve empty space). With
 * a single live ad it renders statically; with several it auto-advances every
 * 4s, pausing while hovered or focused, with clickable dot indicators.
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

  // Auto-advance only with more than one ad and while not paused.
  useEffect(() => {
    if (count <= 1 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(id);
  }, [count, paused]);

  // Keep the active index valid if the ad set changes size.
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
      <div className="relative h-[300px] w-full">
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

function AdSlide({
  ad,
  active,
  t,
}: {
  ad: CurrentAd;
  active: boolean;
  t: (k: string) => string;
}) {
  const imageSrc = resolveImage(ad.image_url);
  const cta = ad.cta_label?.trim() || t("screens.ads.slotDefaultCta");
  // Non-active slides are removed from the tab/pointer flow so hidden CTAs
  // aren't focusable.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !active;
  }, [active]);

  return (
    <div
      ref={ref}
      aria-hidden={!active}
      className={`absolute inset-0 transition-opacity duration-700 ${
        active ? "z-10 opacity-100" : "z-0 opacity-0"
      }`}
    >
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* Dark scrim for legibility of the left-aligned overlay text. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent rtl:bg-gradient-to-l" />

      <div className="relative flex h-full flex-col justify-center gap-1.5 p-4 sm:gap-2 sm:p-6 md:max-w-[60%]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
          {t("screens.ads.slotSponsored")}
        </span>
        <h3 className="text-lg font-bold text-white sm:text-2xl">{ad.title}</h3>
        {ad.body && <p className="truncate text-sm text-white/80">{ad.body}</p>}
        {ad.link_url && (
          <div className="mt-1.5">
            <a href={ad.link_url} target="_blank" rel="noopener noreferrer nofollow" tabIndex={active ? 0 : -1}>
              <Button variant="secondary" size="sm">
                {cta}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
