import type { Page } from "playwright";
import type { CheckEvaluation } from "../aggregate.js";
import type { ElementCheck } from "../check-types.js";

export async function evaluateElement(
  page: Page,
  check: ElementCheck,
): Promise<CheckEvaluation> {
  const locator =
    check.target.kind === "selector"
      ? page.locator(check.target.selector)
      : page.getByRole(check.target.role, {
          name: check.target.name,
          exact: true,
          includeHidden: check.state === "attached",
        });
  const count = await locator.count();
  let matched = check.state === "attached" && count > 0;
  if (check.state === "visible") {
    for (let index = 0; index < count && !matched; index++)
      matched = await locator.nth(index).isVisible();
  }
  return {
    status: matched ? "PASS" : "FAIL",
    expected: { target: check.target, state: check.state },
    actual: { matched },
    reason: matched ? null : "element does not match",
  };
}
