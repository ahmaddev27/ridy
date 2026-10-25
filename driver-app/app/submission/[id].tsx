/**
 * One submission in full: everything the driver sent, what the company
 * decided, and the photo of the Beleg.
 *
 * ## Empty is absent
 *
 * A field the driver did not fill is not drawn at all, rather than shown as a
 * blank or a dash: most receipts are not fuel, and a fuel block of empty rows
 * on a car wash tells the driver nothing.
 *
 * ## The photo is fetched with the token, by the native image loader
 *
 * The file is private. `api.submissionDocumentSource` gives the loader the
 * bearer header, so the bytes stream to disk instead of through a base64 JS
 * string, and there is no URL that works without the session. It has a loading
 * and a failure state with a retry: on a weak connection a broken box would
 * read as "the receipt is gone".
 */
import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "@/components/icons";
import { Text } from "@/components/typography";
import { SectionLabel } from "@/components/ui";
import { api, ApiError, type SubmissionFull } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, intlLocale } from "@/lib/i18n";
import {
  amountLabel,
  cleanText,
  clockLabel,
  dayLabel,
  decimalLabel,
  instantLabel,
  kmLabel,
} from "@/lib/submission-detail";
import { useColors, cardStyle, type Palette } from "@/lib/theme";

type Line = { label: string; value: string };
type Group = { title: string; lines: Line[] };

const text = (v: string | boolean | null | undefined) => (typeof v === "string" ? cleanText(v) : null);

/** Keeps only the lines that have a value, and only the groups that have lines. */
function compact(groups: Group[]): Group[] {
  return groups.filter((g) => g.lines.length > 0);
}

function lines(entries: [string, string | null][]): Line[] {
  return entries.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}

function receiptGroups(f: SubmissionFull["fields"]): Group[] {
  const loc = intlLocale();
  const pay = text(f.payment_method);
  const payment = pay === "bar" ? t("receipt.cash") : pay === "uberweisung" ? t("receipt.transfer") : null;
  const when = [dayLabel(text(f.receipt_date), loc), clockLabel(text(f.receipt_time))].filter(Boolean).join(" · ");
  return compact([
    {
      title: t("subs.d.receiptGroup"),
      lines: lines([
        [t("receipt.date"), when === "" ? null : when],
        [t("receipt.amount"), amountLabel(text(f.amount))],
        [t("receipt.category"), text(f.category)],
        [t("receipt.merchant"), text(f.merchant_name)],
        [t("receipt.city"), [text(f.plz), text(f.city)].filter(Boolean).join(" ") || null],
        [t("receipt.payment"), payment],
        [t("receipt.description"), text(f.description)],
      ]),
    },
    {
      title: t("subs.d.fuelGroup"),
      lines: lines([
        [t("receipt.litres"), decimalLabel(text(f.litres), "l")],
        [t("receipt.pricePerLitre"), decimalLabel(text(f.price_per_litre), "€/l")],
        [t("receipt.odometer"), kmLabel(text(f.odometer_km))],
        [t("receipt.range"), kmLabel(text(f.range_km))],
      ]),
    },
  ]);
}

function noteGroups(f: SubmissionFull["fields"]): Group[] {
  const loc = intlLocale();
  const type = text(f.note_type);
  const start = [dayLabel(text(f.start_date), loc), clockLabel(text(f.start_time))].filter(Boolean).join(" · ");
  const end = [dayLabel(text(f.end_date), loc), clockLabel(text(f.end_time))].filter(Boolean).join(" · ");
  return compact([
    {
      title: t("subs.d.noteGroup"),
      lines: lines([
        [t("note.type"), type ? t(`note.type.${type}`) : null],
        [t("note.vehicle"), text(f.vehicle_plate)],
        [t("subs.d.noteText"), text(f.note_text)],
      ]),
    },
    {
      title: t("subs.d.when"),
      lines: lines([
        [t("subs.d.fullDay"), f.is_full_day === true ? t("subs.d.yes") : null],
        [t("subs.d.from"), start === "" ? null : start],
        [t("subs.d.to"), end === "" ? null : end],
      ]),
    },
  ]);
}

function statusLabel(status: string): string {
  if (status === "accepted") return t("subs.status.accepted");
  if (status === "rejected") return t("subs.status.rejected");
  return t("subs.status.pending");
}

function Rows({ c, row, group }: { c: Palette; row: "row" | "row-reverse"; group: Group }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>{group.title}</SectionLabel>
      <View style={{ ...cardStyle(c), padding: 14, gap: 12 }}>
        {group.lines.map((l) => (
          <View key={l.label} style={{ flexDirection: row, justifyContent: "space-between", gap: 16 }}>
            <Text style={{ color: c.inkSubtle, fontSize: 13.5, flexShrink: 0 }}>{l.label}</Text>
            <Text
              style={{ color: c.ink, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: isRTL() ? "left" : "right" }}
            >
              {l.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type PhotoState = "loading" | "ready" | "failed";

function Photo({
  c,
  id,
  fleetWide,
  attempt,
  onRetry,
}: {
  c: Palette;
  id: string;
  fleetWide: boolean;
  attempt: number;
  onRetry: () => void;
}) {
  const [state, setState] = useState<PhotoState>("loading");
  // Rebuilt per attempt, so the retry is a fresh request and not a cached miss.
  const source = fleetWide ? api.fleetSubmissionDocumentSource(id) : api.submissionDocumentSource(id);

  useEffect(() => setState("loading"), [attempt]);

  if (source === null) return <Text style={{ color: c.danger }}>{t("subs.d.photoFailed")}</Text>;
  return (
    <View style={{ ...cardStyle(c), padding: 8, minHeight: 120, justifyContent: "center" }}>
      {state !== "failed" && (
        <Image
          key={attempt}
          source={source}
          resizeMode="contain"
          accessibilityLabel={t("subs.d.photo")}
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
          style={{ width: "100%", aspectRatio: 3 / 4, opacity: state === "ready" ? 1 : 0 }}
        />
      )}
      {state === "loading" && (
        <View style={{ position: "absolute", alignSelf: "center", alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={c.ink} />
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("subs.d.photoLoading")}</Text>
        </View>
      )}
      {state === "failed" && (
        <View style={{ alignItems: "center", gap: 10, padding: 12 }}>
          <Text style={{ color: c.danger, fontWeight: "700", textAlign: "center" }}>{t("subs.d.photoFailed")}</Text>
          <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: c.ink, fontWeight: "700", textDecorationLine: "underline" }}>{t("subs.d.retry")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function SubmissionDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const row = isRTL() ? "row-reverse" : "row";
  const { id } = useLocalSearchParams<{ id: string }>();
  // An owner reads the company's submission through the read-only fleet route.
  const { isOwner } = useAuth();

  const [item, setItem] = useState<SubmissionFull | null>(null);
  const [error, setError] = useState<"gone" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItem((await (isOwner ? api.fleetSubmission(String(id)) : api.submission(String(id)))).data);
    } catch (e) {
      // 404 is the server's one answer for "not yours" and "not there".
      setError(e instanceof ApiError && e.status === 404 ? "gone" : "failed");
    }
  }, [id, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = item ? (item.subject === "receipt" ? receiptGroups(item.fields) : noteGroups(item.fields)) : [];
  const doc = item?.document;
  const sent = instantLabel(item?.created_at, intlLocale());
  const decided = instantLabel(item?.decided_at, intlLocale());
  const reason = cleanText(item?.reason);
  const rejected = item?.status === "rejected";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10}>
          <ChevronLeft size={24} color={c.ink} strokeWidth={1.8} style={isRTL() ? { transform: [{ scaleX: -1 }] } : undefined} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>
          {item ? (item.subject === "receipt" ? t("subs.kind.receipt") : t("subs.kind.note")) : t("subs.d.title")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 16 }}>
        {item === null && error === null && (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator color={c.ink} />
          </View>
        )}

        {error !== null && (
          <View style={{ ...cardStyle(c), padding: 16, gap: 10 }}>
            <Text style={{ color: c.danger, fontWeight: "700", fontSize: 14.5 }}>
              {error === "gone" ? t("subs.d.notFound") : t("subs.d.failed")}
            </Text>
            {error === "failed" && (
              <Pressable onPress={() => void load()} accessibilityRole="button" hitSlop={8}>
                <Text style={{ color: c.ink, fontWeight: "700", textDecorationLine: "underline" }}>{t("subs.d.retry")}</Text>
              </Pressable>
            )}
          </View>
        )}

        {item !== null && (
          <>
            <Rows
              c={c}
              row={row}
              group={{
                title: t("subs.d.status"),
                lines: lines([
                  [t("subs.driver"), item.driver?.name ?? null],
                  [t("subs.d.status"), statusLabel(item.status)],
                  [t("subs.d.sent"), sent],
                  [t("subs.d.decided"), decided],
                  [t("subs.reason"), rejected ? reason : null],
                ]),
              }}
            />
            {groups.map((g) => (
              <Rows key={g.title} c={c} row={row} group={g} />
            ))}
            {item.subject === "receipt" && doc && (
              <View style={{ gap: 8 }}>
                <SectionLabel>{t("subs.d.photo")}</SectionLabel>
                {!doc.available && <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.d.photoNone")}</Text>}
                {doc.available && doc.mime === "application/pdf" && (
                  <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.d.photoPdf")}</Text>
                )}
                {doc.available && doc.mime !== "application/pdf" && (
                  <Photo c={c} id={item.id} fleetWide={isOwner} attempt={attempt} onRetry={() => setAttempt((n) => n + 1)} />
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
