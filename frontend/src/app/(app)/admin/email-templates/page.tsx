"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Bold, Heading, Link2, Image as ImageIcon, Braces } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
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
    if (editorRef.current) editorRef.current.innerHTML = tpl.body_html;
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
    const url = window.prompt("URL", "https://");
    if (url) exec("createLink", url);
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
    <div className="space-y-6">
      <PageHeader tkey="emailTemplates" />

      {/* Template switcher */}
      <div className="flex gap-2">
        {templates.map((tpl) => (
          <button
            key={tpl.key}
            onClick={() => loadInto(tpl)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              tpl.key === activeKey ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
            }`}
          >
            {c(`type_${tpl.key}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editor */}
        <Card className="space-y-4 p-5">
          <Field label={c("subject")} value={subject} onChange={setSubject} />

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{c("body")}</label>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 border-slate-300 bg-slate-50 p-1.5">
              <ToolBtn onClick={() => exec("bold")} title="Bold"><Bold className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={() => exec("formatBlock", "H2")} title="Heading"><Heading className="h-4 w-4" /></ToolBtn>
              <ToolBtn onClick={addLink} title="Link"><Link2 className="h-4 w-4" /></ToolBtn>
              <label className="cursor-pointer rounded p-1.5 text-slate-600 hover:bg-slate-200" title={c("insertImage")}>
                <ImageIcon className="h-4 w-4" />
                <input type="file" accept="image/*" className="hidden" onChange={onImage} />
              </label>
              <span className="mx-1 h-5 w-px bg-slate-300" />
              {(active?.variables ?? []).map((v) => (
                <button
                  key={v}
                  onClick={() => insertVariable(v)}
                  className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-200"
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
              className="min-h-[220px] rounded-b-lg border border-slate-300 p-3 text-sm leading-relaxed outline-none focus:border-slate-900 [&_a]:text-slate-900 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{c("accent")}</label>
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-full rounded-lg border border-slate-300" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{c("logo")}</label>
              <div className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 text-xs text-slate-400">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[10px] font-bold text-white">R</span>
                {c("logoAuto")}
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
        </Card>

        {/* Live preview */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-500">{c("preview")}</h3>
          <iframe title="preview" className="h-[520px] w-full rounded-lg border border-slate-200" srcDoc={preview} />
        </Card>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="rounded p-1.5 text-slate-600 hover:bg-slate-200">
      {children}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
      />
    </div>
  );
}
