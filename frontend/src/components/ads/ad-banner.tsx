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
      {/* Image-first: the ad is just the image + a CTA button, no promo text. */}
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* Small "Sponsored" tag, top-start. */}
      <span className="absolute top-3 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 ltr:left-3 rtl:right-3">
        {t("screens.ads.slotSponsored")}
      </span>

      {/* CTA button, pinned bottom-end (right). */}
      {ad.link_url && (
        <div className="absolute bottom-4 z-10 ltr:right-4 rtl:left-4">
          <a href={ad.link_url} target="_blank" rel="noopener noreferrer nofollow" tabIndex={active ? 0 : -1}>
            <Button variant="secondary" size="sm">
              {cta}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}
