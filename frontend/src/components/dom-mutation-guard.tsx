"use client";

import { useEffect } from "react";

/**
 * Browser translators (Google Translate, Edge/Brave/Samsung built-ins) and some
 * extensions wrap or replace text nodes behind React's back. React then calls
 * `parent.insertBefore(new, ref)` / `parent.removeChild(child)` with a node that
 * is no longer a child of `parent` and the whole tree crashes with
 * "Failed to execute 'insertBefore' on 'Node'" (NotFoundError).
 *
 * `translate="no"` + `<meta name="google" content="notranslate">` stop Chrome's own
 * translator, but not every vendor honours them. This is the widely used,
 * behaviour-preserving guard: when the reference node was moved away, fall back to
 * appending (insertBefore) or skip (removeChild) instead of throwing. In the normal,
 * un-mutated case the original method runs untouched.
 */
export function DomMutationGuard() {
  useEffect(() => {
    const proto = Node.prototype as Node & { __reideyGuarded?: boolean };
    if (proto.__reideyGuarded) return;
    proto.__reideyGuarded = true;

    const origRemove = proto.removeChild;
    const origInsert = proto.insertBefore;

    proto.removeChild = function <T extends Node>(this: Node, child: T): T {
      if (child.parentNode !== this) return child;
      return origRemove.call(this, child) as T;
    };
    proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
      if (ref && ref.parentNode !== this) return origInsert.call(this, node, null) as T;
      return origInsert.call(this, node, ref) as T;
    };
  }, []);

  return null;
}
