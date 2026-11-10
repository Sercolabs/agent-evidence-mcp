import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import type { BrowserCheck } from "../engine/check-types.js";
import type { CheckEvaluation } from "../engine/aggregate.js";
import { evaluateUrl } from "../engine/checks/url.js";
import { evaluateText } from "../engine/checks/text.js";
import { evaluateElement } from "../engine/checks/element.js";

export async function evaluateBrowserCheck(
  check: BrowserCheck,
  dir: string,
  screenshot: boolean,
): Promise<CheckEvaluation> {
  if (check.goto === undefined)
    return {
      status: "INCONCLUSIVE",
      expected: {},
      actual: { error: "missing_goto" },
      reason: "browser check requires its own goto URL",
    };
  let browser;
  let evaluationTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: check.timeout_ms,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(check.timeout_ms);
    await page.goto(check.goto, {
      timeout: check.timeout_ms,
      waitUntil: "domcontentloaded",
    });
    const observe = async (): Promise<CheckEvaluation> => {
      switch (check.type) {
        case "url":
          return evaluateUrl(page, check);
        case "text":
          return evaluateText(page, check);
        case "element":
          return evaluateElement(page, check);
        default: {
          const unreachable: never = check;
          throw new Error(String(unreachable));
        }
      }
    };
    const evaluation = await Promise.race([
      observe(),
      new Promise<never>((_, reject) => {
        evaluationTimer = setTimeout(
          () => reject(new Error("browser evaluation timed out")),
          check.timeout_ms,
        );
      }),
    ]);
    clearTimeout(evaluationTimer);
    if (!screenshot) return evaluation;
    try {
      const bytes = await page.screenshot({
        type: "png",
        timeout: check.timeout_ms,
        animations: "disabled",
      });
      const relative = `artifacts/${randomUUID()}.png`;
      mkdirSync(join(dir, "artifacts"), { recursive: true });
      writeFileSync(join(dir, relative), bytes);
      return {
        ...evaluation,
        actual: {
          ...evaluation.actual,
          screenshot: {
            id: `art_${randomUUID()}`,
            kind: "screenshot_after",
            content_type: "image/png",
            created_at: new Date().toISOString(),
            source: "verify-engine",
            storage_uri: relative,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            byte_size: bytes.byteLength,
          },
        },
      };
    } catch {
      return {
        ...evaluation,
        status: evaluation.status === "FAIL" ? "FAIL" : "INCONCLUSIVE",
        actual: { ...evaluation.actual, error: "screenshot_failed" },
        reason: "required screenshot could not be captured or saved",
      };
    }
  } catch {
    return {
      status: "INCONCLUSIVE",
      expected: {},
      actual: { error: "browser_unavailable" },
      reason: "browser setup, navigation, or evaluation could not complete",
    };
  } finally {
    clearTimeout(evaluationTimer);
    await browser?.close().catch(() => {});
  }
}
