"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { getCurrentAd, type CurrentAd } from "@/lib/api/ads";

/**
 * Renders the current live platform ad (super-admin authored) as a tasteful
 * card. Renders nothing when there is no live ad or the fetch fails, so it
 * never disrupts the host page.
 */
export function AdSlot({ layout = "row" }: { layout?: "row" | "stacked" }) {
  const { t } = useI18n();
  const [ad, setAd] = useState<CurrentAd | null>(null);

  useEffect(() => {
    getCurrentAd()
      .then(setAd)
      .catch(() => setAd(null));
  }, []);

  if (!ad) return null;

  const cta = ad.cta_label?.trim() || t("screens.ads.slotDefaultCta");
  // Uploaded images are stored as same-origin relative URLs; resolve against the
  // API host so they load in development too (same-origin behind the edge in prod).
  const imageSrc =
    ad.image_url && !ad.image_url.startsWith("http")
      ? `${process.env.NEXT_PUBLIC_API_URL ?? ""}${ad.image_url}`
      : ad.image_url;

  const stacked = layout === "stacked";

  return (
    <Card className="overflow-hidden">
      <div className={stacked ? "flex flex-col" : "flex flex-col gap-4 sm:flex-row"}>
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt=""
            className={
              stacked
                ? "aspect-[3/4] w-full object-cover"
                : "h-40 w-full shrink-0 object-cover sm:h-auto sm:w-48"
            }
          />
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            {t("screens.ads.slotSponsored")}
          </span>
          <h3 className="text-base font-semibold text-ink">{ad.title}</h3>
          {ad.body && <p className="text-sm text-ink-muted">{ad.body}</p>}
          {ad.link_url && (
            <div className="mt-2">
              <a href={ad.link_url} target="_blank" rel="noopener noreferrer nofollow">
                <Button variant="secondary" size="sm">
                  {cta}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </a>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
