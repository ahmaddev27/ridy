/**
 * Allowlist sanitizer for admin-authored e-mail template HTML, run before the
 * stored body is put into the contentEditable editor (innerHTML would otherwise
 * execute e.g. `<img onerror>` in the reidey.de origin). Browser-only: parsing
 * happens in an inert DOMParser document, so nothing loads or runs while we walk it.
 */

// Removed together with their content.
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "APPLET", "FORM", "INPUT",
  "BUTTON", "TEXTAREA", "SELECT", "OPTION", "LINK", "META", "BASE", "SVG", "MATH", "TEMPLATE",
  "NOSCRIPT", "AUDIO", "VIDEO", "SOURCE", "TRACK", "CANVAS", "DIALOG", "PORTAL",
]);

// Kept as-is (with filtered attributes); anything else is unwrapped to its children.
const ALLOWED_TAGS = new Set([
  "A", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "INS", "P", "BR", "DIV", "SPAN",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "IMG", "FONT", "BLOCKQUOTE", "HR",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "CENTER", "SMALL", "SUP", "SUB", "CODE", "PRE",
]);

const ALLOWED_ATTRS = new Set([
  "href", "src", "alt", "title", "style", "align", "size", "color", "face", "width", "height",
  "target", "rel", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "bgcolor", "valign",
]);

const URL_ATTRS = new Set(["href", "src"]);

/** http(s)/mailto/tel, relative paths, anchors and {{template_variables}} only. */
export function isSafeUrl(value: string): boolean {
  const v = value.trim().replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (v === "" || v.startsWith("{{") || v.startsWith("#") || (v.startsWith("/") && !v.startsWith("//"))) return true;
  return /^(https?:|mailto:|tel:)/i.test(v);
}

/** Inline styles are kept for e-mail layout, minus anything that can fetch or run code. */
export function isSafeStyle(value: string): boolean {
  return !/expression\s*\(|javascript:|url\s*\(|@import|behavior\s*:|-moz-binding/i.test(value);
}

function cleanElement(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const keep =
      ALLOWED_ATTRS.has(name) &&
      (!URL_ATTRS.has(name) || isSafeUrl(attr.value)) &&
      (name !== "style" || isSafeStyle(attr.value));
    if (!keep) el.removeAttribute(attr.name);
  }
  if (el.tagName === "A" && el.getAttribute("target") === "_blank") el.setAttribute("rel", "noopener noreferrer");
}

function walk(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    if (DROP.has(el.tagName)) {
      el.remove();
      continue;
    }
    walk(el);
    if (ALLOWED_TAGS.has(el.tagName)) {
      cleanElement(el);
    } else {
      el.replaceWith(...Array.from(el.childNodes));
    }
  }
}

export function sanitizeTemplateHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  walk(doc.body);
  return doc.body.innerHTML;
}
