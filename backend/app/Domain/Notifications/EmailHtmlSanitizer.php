<?php

namespace App\Domain\Notifications;

use DOMDocument;
use DOMElement;
use DOMNode;

/**
 * Allowlist sanitizer for admin-authored email HTML.
 *
 * Replaces a regex blocklist that `<img src=x/onerror=…>` or an entity-encoded
 * `jav&#x61;script:` slipped through. Only known formatting elements and
 * attributes survive; URLs must be relative, a {{variable}}, or http(s)/mailto/tel
 * (images may also be data:image/*). Uses the bundled DOM extension — no new
 * dependency.
 */
class EmailHtmlSanitizer
{
    /** Elements kept as-is (children are sanitized recursively). */
    private const ALLOWED_TAGS = [
        'a', 'abbr', 'b', 'blockquote', 'br', 'center', 'code', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4',
        'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup',
        'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
    ];

    /** Elements removed together with their content. */
    private const DROP_WITH_CONTENT = [
        'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'template',
        'noscript', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'title', 'head',
    ];

    private const ALLOWED_ATTRS = [
        'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class', 'color', 'colspan',
        'dir', 'face', 'height', 'href', 'rowspan', 'size', 'src', 'style', 'target', 'title', 'valign', 'width',
    ];

    private const URL_ATTRS = ['href', 'src'];

    private const LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'];

    public function sanitize(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        // {{variables}} are substituted AFTER sanitizing; shield them so libxml's
        // URI escaping of href/src cannot turn "{{action_url}}" into "%7B%7B…".
        $tokens = [];
        $shielded = preg_replace_callback('/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/', function ($m) use (&$tokens) {
            $key = 'RIDYTPLVAR'.count($tokens).'X';
            $tokens[$key] = '{{'.$m[1].'}}';

            return $key;
        }, $html) ?? '';

        $doc = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $doc->loadHTML(
            '<?xml encoding="utf-8"?><div id="ridy-root">'.$shielded.'</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET,
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $root = $doc->getElementById('ridy-root');
        if ($root === null) {
            return '';
        }

        $this->cleanChildren($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }

        return strtr($out, $tokens);
    }

    private function cleanChildren(DOMNode $node): void
    {
        // Snapshot: the loop mutates the child list.
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child->nodeType === XML_COMMENT_NODE || $child->nodeType === XML_PI_NODE) {
                $node->removeChild($child);

                continue;
            }
            if (! $child instanceof DOMElement) {
                continue; // text nodes are escaped on output
            }

            $tag = strtolower($child->nodeName);
            if (in_array($tag, self::DROP_WITH_CONTENT, true)) {
                $node->removeChild($child);

                continue;
            }

            $this->cleanChildren($child);

            if (! in_array($tag, self::ALLOWED_TAGS, true)) {
                // Unknown wrapper: keep its (already clean) content, drop the tag.
                while ($child->firstChild !== null) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);

                continue;
            }

            $this->cleanAttributes($child, $tag);
        }
    }

    private function cleanAttributes(DOMElement $el, string $tag): void
    {
        foreach (iterator_to_array($el->attributes) as $attr) {
            $name = strtolower($attr->nodeName);
            $value = (string) $attr->nodeValue;

            $keep = in_array($name, self::ALLOWED_ATTRS, true)
                && (! in_array($name, self::URL_ATTRS, true) || $this->safeUrl($value, $tag === 'img' && $name === 'src'))
                && ($name !== 'style' || $this->safeStyle($value));

            if (! $keep) {
                $el->removeAttribute($attr->nodeName);
            }
        }

        if ($tag === 'a' && $el->hasAttribute('target')) {
            $el->setAttribute('rel', 'noopener noreferrer');
        }
    }

    /** Relative, a shielded {{variable}}, or an allowed scheme. */
    private function safeUrl(string $value, bool $isImage): bool
    {
        // nodeValue is already entity-decoded; drop whitespace/control chars that
        // browsers ignore inside a scheme ("java\tscript:").
        $normalized = strtolower((string) preg_replace('/[\x00-\x20\x7f]+/', '', $value));

        if (! preg_match('/^([a-z][a-z0-9+.\-]*):/', $normalized, $m)) {
            return true; // no scheme: relative, anchor or template variable
        }

        if ($isImage && str_starts_with($normalized, 'data:image/') && ! str_starts_with($normalized, 'data:image/svg')) {
            return true;
        }

        return in_array($m[1], self::LINK_SCHEMES, true);
    }

    private function safeStyle(string $value): bool
    {
        return ! preg_match('/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|url\s*\(/i', $value);
    }
}
