import type { Page } from "playwright";
import type { CheckEvaluation } from "../aggregate.js";
import type { TextCheck } from "../check-types.js";

export async function evaluateText(
  page: Page,
  check: TextCheck,
): Promise<CheckEvaluation> {
  const scope = page.locator(check.selector ?? "body");
  const matched = await scope.evaluateAll(
    (elements, input) => {
      const parentOf = (node: Node): Element | null => {
        const root = node.getRootNode();
        return (
          node.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
        );
      };
      const renderedText = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (input.state === "attached") return node.textContent ?? "";
          const parent = parentOf(node);
          if (parent === null) return "";
          const style = getComputedStyle(parent);
          if (style.visibility === "hidden" || style.visibility === "collapse")
            return "";
          const range = document.createRange();
          range.selectNodeContents(node);
          return Array.from(range.getClientRects()).some(
            (rect) => rect.width > 0 && rect.height > 0,
          )
            ? (node.textContent ?? "")
            : "";
        }
        if (!(node instanceof Element)) return "";
        const assigned =
          node instanceof HTMLSlotElement
            ? node.assignedNodes({ flatten: true })
            : [];
        const children =
          assigned.length > 0
            ? assigned
            : (node.shadowRoot?.childNodes ?? node.childNodes);
        if (input.state === "attached")
          return Array.from(children, renderedText).join("");
        const style = getComputedStyle(node);
        if (style.display === "none" || style.contentVisibility === "hidden")
          return "";
        if (node.tagName === "BR") return "\n";
        const text = Array.from(children, renderedText).join("");
        return style.display.startsWith("inline") ||
          style.display === "contents"
          ? text
          : `\n${text}\n`;
      };
      return elements.some((element) => {
        for (
          let parent = parentOf(element);
          parent && input.state === "visible";
          parent = parentOf(parent)
        ) {
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.contentVisibility === "hidden")
            return false;
        }
        const text = renderedText(element);
        return text
          .replace(/\s+/g, " ")
          .trim()
          .includes(input.text.replace(/\s+/g, " ").trim());
      });
    },
    { text: check.text, state: check.state },
  );
  return {
    status: matched ? "PASS" : "FAIL",
    expected: { text: check.text, state: check.state },
    actual: { matched },
    reason: matched ? null : "text does not match",
  };
}
