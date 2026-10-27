"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { PasswordInput } from "@/components/ui/password-input";
import { useAsync } from "@/hooks/use-async";
import { usePasskeySupport } from "@/hooks/use-passkey-support";
import { ApiError } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/error-message";
import {
  deletePasskey,
  listPasskeys,
  passkeyRegister,
  passkeyRegisterOptions,
  type Passkey,
} from "@/lib/api/webauthn";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { PasskeyAlreadyRegisteredError, PasskeyCancelledError, createPasskey } from "@/lib/webauthn";

// Well below any plausible server limit, so a long name can't turn into a 422
// that would be misread as "already registered".
const ALIAS_MAX_LENGTH = 40;

/** What identifies a passkey the user never named: the start of its id. */
function shortId(id: Passkey["id"]): string {
  const full = String(id);
  return full.length > 8 ? `${full.slice(0, 8)}…` : full;
}

/** The label shown for a passkey: the name the user gave it, else its short id. */
function passkeyName(passkey: Passkey): string {
  return passkey.alias || shortId(passkey.id);
}

/**
 * The user's passkeys: list, add (browser prompt, then the server) and delete.
 * Adding needs a WebAuthn-capable browser; listing and deleting work anywhere.
 */
export function PasskeySettings() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);

  const { data: passkeys, loading, refetch } = useAsync(listPasskeys);
  // null until known after hydration, so the "unsupported" hint never flashes on capable browsers.
  const supported = usePasskeySupport();
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Passkey | null>(null);
  const [deleting, setDeleting] = useState(false);

  // One localized sentence per failure — the browser's own error text is never shown.
  function addFailureText(e: unknown): string {
    // The step-up check: a 422 naming the password field is a wrong password,
    // not a duplicate credential.
    if (e instanceof ApiError && e.status === 422 && e.errors?.password) {
      return c("passkeyPasswordWrong");
    }
    if (e instanceof PasskeyAlreadyRegisteredError || (e instanceof ApiError && e.status === 422)) {
      return c("passkeyAlreadyRegistered");
    }
    const transient = e instanceof ApiError && (e.status === 429 || e.status >= 500);
    return transient ? apiErrorMessage(e, t) : t("errors.generic");
  }

  /** Resolves true once the passkey is saved, so the form can clear its fields. */
  async function add(alias: string, password: string): Promise<boolean> {
    setAdding(true);
    try {
      const { ceremony_id, options } = await passkeyRegisterOptions(password);
      const credential = await createPasskey(options);
      await passkeyRegister({ ceremonyId: ceremony_id, alias: alias || undefined, credential });
      toast.success(c("passkeyAdded"));
      await refetch();
      return true;
    } catch (e) {
      // Dismissing the browser prompt is a choice, not an error — stay silent.
      if (!(e instanceof PasskeyCancelledError)) {
        toast.error(c("passkeyAddFailed"), { description: addFailureText(e) });
      }
      return false;
    } finally {
      setAdding(false);
    }
  }

  async function doDelete() {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      // 404 = already removed elsewhere: the end state the user asked for.
      await deletePasskey(confirmDel.id).catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      });
      toast.success(c("passkeyDeleted"));
      await refetch();
    } catch (e) {
      toast.error(c("passkeyDeleteFailed"), { description: apiErrorMessage(e, t) });
    } finally {
      setDeleting(false);
      setConfirmDel(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">{c("passkeysTitle")}</h2>
        <p className="mt-1 text-sm text-ink-subtle">{c("passkeysHint")}</p>
      </div>

      <PasskeyList passkeys={passkeys} loading={loading} onRetry={() => void refetch()} onDelete={setConfirmDel} />
      <AddPasskeyForm supported={supported} busy={adding} onAdd={add} />

      <ConfirmModal
        open={confirmDel !== null}
        danger
        title={c("passkeyDelete")}
        message={c("passkeyDeleteConfirm").replace("{name}", confirmDel ? passkeyName(confirmDel) : "")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

function PasskeyList({
  passkeys,
  loading,
  onRetry,
  onDelete,
}: {
  passkeys: Passkey[] | null;
  loading: boolean;
  onRetry: () => void;
  onDelete: (passkey: Passkey) => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);

  if (loading) return <div className="h-16 animate-pulse rounded-xl bg-surface-2" />;

  // A failed load offers a retry instead of an empty list that would read as "no passkeys".
  if (!passkeys) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-6 text-sm text-ink-muted">
        <p>{c("passkeyLoadError")}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink hover:bg-surface-2"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (passkeys.length === 0) return <EmptyState icon={Fingerprint} title={c("passkeysEmpty")} />;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line/70">
      {passkeys.map((passkey) => (
        <PasskeyRow key={passkey.id} passkey={passkey} onDelete={() => onDelete(passkey)} />
      ))}
    </ul>
  );
}

function PasskeyRow({ passkey, onDelete }: { passkey: Passkey; onDelete: () => void }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);
  const name = passkeyName(passkey);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
        <Fingerprint className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          {passkey.alias ? (
            name
          ) : (
            <span dir="ltr" className="font-mono">
              {name}
            </span>
          )}
        </div>
        <div className="text-xs text-ink-subtle">
          {c("passkeyAddedOn").replace("{date}", formatDate(passkey.created_at, locale))}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title={c("passkeyDelete")}
        aria-label={`${c("passkeyDelete")}: ${name}`}
        className="rounded p-1.5 text-ink-subtle hover:bg-danger-bg hover:text-danger-fg"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function AddPasskeyForm({
  supported,
  busy,
  onAdd,
}: {
  supported: boolean | null;
  busy: boolean;
  onAdd: (alias: string, password: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);
  const aliasId = useId();
  const passwordId = useId();
  const [alias, setAlias] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // On failure the password stays, so a typo is fixed instead of retyped.
    if (await onAdd(alias.trim(), password)) {
      setAlias("");
      setPassword("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor={aliasId} className="mb-1 block text-sm font-medium text-ink">
            {c("passkeyAliasLabel")}
          </label>
          <input
            id={aliasId}
            type="text"
            value={alias}
            maxLength={ALIAS_MAX_LENGTH}
            onChange={(e) => setAlias(e.target.value)}
            disabled={supported !== true || busy}
            autoComplete="off"
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line disabled:opacity-60"
          />
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor={passwordId} className="mb-1 block text-sm font-medium text-ink">
            {c("passkeyPasswordLabel")}
          </label>
          <PasswordInput
            id={passwordId}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={supported !== true || busy}
            autoComplete="current-password"
            className="disabled:opacity-60"
          />
        </div>
        <Button type="submit" disabled={supported !== true || busy || password === ""}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {c("passkeyAdd")}
        </Button>
      </div>
      <p className="text-xs text-ink-subtle">{c("passkeyPasswordHint")}</p>
      {supported === false && <p className="text-xs text-ink-subtle">{c("passkeyUnsupported")}</p>}
    </form>
  );
}
