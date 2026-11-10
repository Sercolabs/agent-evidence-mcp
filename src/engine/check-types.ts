import type { Page } from "playwright";
import type { FileContainsMatch } from "./checks/file-contains.js";

export type NonBrowserCheck =
  | { readonly type: "file_exists"; readonly path: string }
  | {
      readonly type: "file_contains";
      readonly path: string;
      readonly match: FileContainsMatch;
    }
  | {
      readonly type: "command_exit";
      readonly command: string;
      readonly code: number;
    };
export type BrowserOptions = {
  readonly goto?: string;
  readonly timeout_ms: number;
};
export type UrlCheck = BrowserOptions & {
  readonly type: "url";
  readonly match:
    | { readonly kind: "glob"; readonly value: string }
    | { readonly kind: "regex"; readonly source: string };
};
export type TextCheck = BrowserOptions & {
  readonly type: "text";
  readonly text: string;
  readonly selector?: string;
  readonly state: "visible" | "attached";
};
export type ElementCheck = BrowserOptions & {
  readonly type: "element";
  readonly target:
    | { readonly kind: "selector"; readonly selector: string }
    | {
        readonly kind: "role";
        readonly role: Parameters<Page["getByRole"]>[0];
        readonly name?: string;
      };
  readonly state: "visible" | "attached";
};
export type BrowserCheck = UrlCheck | TextCheck | ElementCheck;
export type ApiCheck = {
  readonly type: "api_response";
  readonly url: string;
  readonly status: number;
  readonly body?: FileContainsMatch;
  readonly timeout_ms: number;
};
export type VerifyCheck =
  | NonBrowserCheck
  | BrowserCheck
  | ApiCheck
  | { readonly type: "final_outcome"; readonly checks: readonly VerifyCheck[] };

export const supportedRoles = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
] as const satisfies readonly Parameters<Page["getByRole"]>[0][];
