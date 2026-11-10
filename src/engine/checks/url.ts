import type { Page } from "playwright";
import type { CheckEvaluation } from "../aggregate.js";
import type { UrlCheck } from "../check-types.js";

function globRegex(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*";
      index++;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += (char ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source + "$");
}

export function evaluateUrl(page: Page, check: UrlCheck): CheckEvaluation {
  const expression =
    check.match.kind === "regex"
      ? new RegExp(check.match.source)
      : globRegex(check.match.value);
  const matched = expression.test(page.url());
  const observed = new URL(page.url());
  observed.username = "";
  observed.password = "";
  observed.search = "";
  observed.hash = "";
  return {
    status: matched ? "PASS" : "FAIL",
    expected: { match: check.match },
    actual: { matched, url: observed.toString() },
    reason: matched ? null : "URL does not match",
  };
}
