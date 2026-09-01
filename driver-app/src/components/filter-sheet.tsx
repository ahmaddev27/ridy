import { useState } from "react";
import { Modal, View, Pressable, ScrollView } from "react-native";
import { Text } from "@/components/typography";
import { SectionLabel, PrimaryButton } from "@/components/ui";
import { useColors, radius, isDarkPalette } from "@/lib/theme";
import { t, isRTL } from "@/lib/i18n";

export type SortKey = "new" | "rate" | "total";
export type StatusKey = "all" | "pending" | "accepted" | "completed" | "rejected" | "canceled";

export type OfferFilters = { sort: SortKey; status: StatusKey };
export const DEFAULT_FILTERS: OfferFilters = { sort: "new", status: "all" };

/**
 * Bottom-sheet filter for the offers list: sort, date window and status. All
 * three are wired — sort is applied client-side, date + status drive the query.
 * Presentational chips only; the parent owns the actual filtering.
 */
export function FilterSheet({
  open,
  value,
  onApply,
  onClose,
}: {
  open: boolean;
  value: OfferFilters;
  onApply: (f: OfferFilters) => void;
  onClose: () => void;
}) {
  const c = useColors();
  // Local draft so Reset/Apply behave; seeded each time the sheet opens.
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(4,5,5,0.55)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: isDarkPalette(c) ? c.surface2 : c.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 34,
          ...(isDarkPalette(c) ? { borderTopWidth: 1, borderColor: c.line } : null),
        }}
      >
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: 14 }} />
        {/* Remount per open so the draft re-seeds from the applied filters. */}
        {open && <SheetBody c={c} value={value} onApply={onApply} onClose={onClose} />}
      </View>
    </Modal>
  );
}

function SheetBody({ c, value, onApply, onClose }: { c: ReturnType<typeof useColors>; value: OfferFilters; onApply: (f: OfferFilters) => void; onClose: () => void }) {
  // A tiny controlled draft via closure state on the parent would be cleaner, but
  // keeping it here keeps the sheet self-contained.
  const [draft, setDraft] = useDraft(value);
  const row = isRTL() ? "row-reverse" : "row";

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: "700", textAlign: isRTL() ? "right" : "left", marginBottom: 14 }}>
        {t("filter.title")}
      </Text>

      <Group label={t("filter.sortBy")}>
        <Chips
          c={c}
          options={[
            { k: "new", label: t("filter.newest") },
            { k: "rate", label: t("filter.bestKm") },
            { k: "total", label: t("filter.highestTotal") },
          ]}
          selected={draft.sort}
          onSelect={(k) => setDraft({ ...draft, sort: k as SortKey })}
        />
      </Group>

      <Group label={t("filter.status")}>
        <Chips
          c={c}
          options={[
            { k: "all", label: t("filter.all") },
            { k: "pending", label: t("status.pending") },
            { k: "accepted", label: t("status.accepted") },
            { k: "completed", label: t("status.completed") },
            { k: "rejected", label: t("status.rejected") },
            { k: "canceled", label: t("status.canceled") },
          ]}
          selected={draft.status}
          onSelect={(k) => setDraft({ ...draft, status: k as StatusKey })}
        />
      </Group>

      <View style={{ flexDirection: row, gap: 10, marginTop: 20 }}>
        <Pressable
          onPress={() => setDraft(DEFAULT_FILTERS)}
          style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, backgroundColor: isDarkPalette(c) ? c.surfaceRaised : c.surface }}
        >
          <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "700" }}>{t("filter.reset")}</Text>
        </Pressable>
        <PrimaryButton label={t("filter.apply")} onPress={() => { onApply(draft); onClose(); }} style={{ flex: 1.6 }} />
      </View>
    </ScrollView>
  );
}

function useDraft(value: OfferFilters): [OfferFilters, (f: OfferFilters) => void] {
  const [draft, setDraft] = useState<OfferFilters>(value);
  return [draft, setDraft];
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginBottom: 18 }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

function Chips({ c, options, selected, onSelect }: { c: ReturnType<typeof useColors>; options: { k: string; label: string }[]; selected: string; onSelect: (k: string) => void }) {
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = selected === o.k;
        return (
          <Pressable
            key={o.k}
            onPress={() => onSelect(o.k)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: radius.pill,
              backgroundColor: on ? c.primary : isDarkPalette(c) ? c.surfaceRaised : c.surface,
              borderWidth: 1,
              borderColor: on ? c.primary : c.line,
            }}
          >
            <Text style={{ color: on ? c.primaryInk : c.inkMuted, fontSize: 13.5, fontWeight: "700" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
