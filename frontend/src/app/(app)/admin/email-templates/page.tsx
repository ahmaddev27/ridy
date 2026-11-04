"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading,
  Heading2,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  Link2,
  Image as ImageIcon,
  Braces,
  Pencil,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { isSafeUrl, sanitizeTemplateHtml } from "@/lib/sanitize-html";
import {
  listTemplates,
  updateTemplate,
  previewTemplate,
  uploadTemplateImage,
  type EmailTemplate,
} from "@/lib/api/email-templates";

export default function EmailTemplatesPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.emailTemplates.${k}`);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [accent, setAccent] = useState("#4f46e5");
  const [footer, setFooter] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");

  const editorRef = useRef<HTMLDivElement>(null);
  const active = templates.find((x) => x.key === activeKey);

  // Load a template into the form + editor.
  const loadInto = useCallback((tpl: EmailTemplate) => {
    setActiveKey(tpl.key);
    setSubject(tpl.subject);
    setAccent(tpl.accent_color ?? "#4f46e5");
    setFooter(tpl.footer_text ?? "");
    // Stored HTML is sanitized before it touches the live DOM (onerror etc.).
    if (editorRef.current) editorRef.current.innerHTML = sanitizeTemplateHtml(tpl.body_html);
  }, []);

  useEffect(() => {
    listTemplates()
      .then((list) => {
        setTemplates(list);
        if (list[0]) loadInto(list[0]);
      })
      .catch(() => {});
  }, [loadInto]);

  function draft() {
    return {
      subject,
      body_html: editorRef.current?.innerHTML ?? "",
      logo_url: null, // the platform Reidey logo is applied automatically
      accent_color: accent,
      footer_text: footer,
    };
  }

  // Debounced live preview.
  useEffect(() => {
    if (!activeKey) return;
    const id = setTimeout(() => {
      previewTemplate(activeKey, draft())
        .then((r) => setPreview(r.html))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, subject, accent, footer]);

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    schedulePreview();
  }

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function schedulePreview() {
    if (!activeKey) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTemplate(activeKey, draft()).then((r) => setPreview(r.html)).catch(() => {});
    }, 500);
  }

  function insertVariable(name: string) {
    exec("insertText", `{{${name}}}`);
  }

  function addLink() {
    const url = window.prompt(c("linkPrompt"), "https://");
    if (url && isSafeUrl(url)) exec("createLink", url);
  }

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await uploadTemplateImage(file);
      exec("insertHTML", `<img src="${url}" style="max-width:100%;border-radius:8px" alt=""/>`);
    } catch (err) {
      toast.error(c("uploadFailed"), { description: err instanceof Error ? err.message : undefined });
    }
  }

  async function save() {
    setBusy(true);
    try {
      const updated = await updateTemplate(activeKey, draft());
      setTemplates((prev) => prev.map((x) => (x.key === activeKey ? updated : x)));
      toast.success(c("saved"));
    } catch (err) {
      toast.error(c("saveFailed"), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <header className="ph">
        <div>
          <h1>{t("pages.emailTemplates.title")}</h1>
          <p>{t("pages.emailTemplates.subtitle")}</p>
        </div>
      </header>

      <div role="group" aria-label={c("chooseTemplate")} className="flex gap-1.5 overflow-x-auto pb-1">
        {templates.map((tpl) => (
          <button
            key={tpl.key}
            type="button"
            onClick={() => loadInto(tpl)}
            className={"chip shrink-0" + (tpl.key === activeKey ? " on" : "")}
          >
            {c(`type_${tpl.key}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Editor */}
        <section className="card">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}><Pencil className="subtle h-4 w-4" />{c("editTitle")}</h2>
          </div>
          <div className="card-body stack">
          <Field label={c("subject")} value={subject} onChange={setSubject} />

          <div className="field">
            <label>{c("body")}</label>
            <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-2 p-1.5">
              <ToolBtn onClick={() => exec("bold")} title={c("tool_bold")}><Bold className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("italic")} title={c("tool_italic")}><Italic className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("underline")} title={c("tool_underline")}><Underline className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("strikeThrough")} title={c("tool_strike")}><Strikethrough className="h-4 w-4" /></ToolBtn>
              <span className="mx-1 h-5 w-px bg-line" />
              <select
                onChange={(e) => {
                  if (e.target.value) exec("fontSize", e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                title={c("fontSize")}
                className="h-[30px] rounded-lg border border-line bg-surface px-1.5 text-xs text-ink"
              >
                <option value="" disabled>
                  {c("fontSize")}
                </option>
                <option value="1">XS</option>
                <option value="2">S</option>
                <option value="3">M</option>
                <option value="5">L</option>
                <option value="6">XL</option>
                <option value="7">XXL</option>
              </select>
              <ToolBtn onClick={() => exec("formatBlock", "H1")} title={c("tool_h1")}><Heading className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("formatBlock", "H2")} title={c("tool_h2")}><Heading2 className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("insertUnorderedList")} title={c("tool_ul")}><List className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("insertOrderedList")} title={c("tool_ol")}><ListOrdered className="h-4 w-4" /></ToolBtn>
              <span className="mx-1 h-5 w-px bg-line" />
              <ToolBtn onClick={() => exec("justifyLeft")} title={c("tool_alignLeft")}><AlignLeft className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("justifyCenter")} title={c("tool_alignCenter")}><AlignCenter className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("justifyRight")} title={c("tool_alignRight")}><AlignRight className="h-4 w-4" /></ToolBtn>
              <span className="mx-1 h-5 w-px bg-line" />
              <ToolBtn onClick={addLink} title={c("tool_link")}><Link2 className="h-4 w-4" /></ToolBtn>
              <label className="icon-btn !h-[30px] !w-[30px] cursor-pointer" title={c("insertImage")}>
                <ImageIcon className="h-4 w-4" />
                <input type="file" accept="image/*" className="hidden" onChange={onImage} />
              </label>
              <ToolBtn onClick={() => exec("undo")} title={c("tool_undo")}><Undo2 className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("redo")} title={c("tool_redo")}><Redo2 className="h-4 w-4" /></ToolBtn>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2 text-[12.5px] text-ink-subtle">
              <span>{c("variablesLabel")}</span>
              {(active?.variables ?? []).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="mono inline-flex h-6 items-center gap-1 rounded-full bg-info-bg px-2 text-xs font-semibold text-info-fg"
                  title={c("insertVariable")}
                >
                  <Braces className="h-3 w-3" /> {v}
                </button>
              ))}
            </div>
            <div
              ref={editorRef}
              contentEditable
              onInput={schedulePreview}
              suppressContentEditableWarning
              className="min-h-[220px] p-3.5 text-sm leading-relaxed outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--primary)] [&_a]:text-ink [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold"
            />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>{c("accent")}</label>
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="input" style={{ padding: 3, height: 40 }} />
            </div>
            <div className="field">
              <label>{c("logo")}</label>
              <div className="dropzone row justify-center" style={{ gap: 10, padding: 8 }}>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-info-bg text-[11px] font-bold text-info-fg">R</span>
                <span className="text-sm">{c("logoAuto")}</span>
              </div>
            </div>
          </div>

          <Field label={c("footer")} value={footer} onChange={setFooter} />

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || !activeKey}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {c("save")}
            </Button>
          </div>
          </div>
        </section>

        {/* Live preview */}
        <section className="card lg:sticky lg:top-[76px]">
          <div className="card-head">
            <div>
              <h2 className="row" style={{ gap: 8 }}><Eye className="subtle h-4 w-4" />{c("preview")}</h2>
              <div className="sub">{c("previewSub")}</div>
            </div>
          </div>
          <div className="card-body">
          {/* sandbox: the preview renders with an opaque origin and no scripts. */}
          <iframe title="preview" sandbox="" className="h-[520px] w-full rounded-lg border border-line" srcDoc={preview} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className="icon-btn !h-[30px] !w-[30px]">
      {children}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input" />
    </div>
  );
}
