import type { CheckEvaluation } from "../aggregate.js";
import type { ApiCheck } from "../check-types.js";

export async function evaluateApiResponse(
  check: ApiCheck,
): Promise<CheckEvaluation> {
  const expected = {
    status: check.status,
    ...(check.body ? { body: check.body } : {}),
  };
  try {
    const response = await fetch(check.url, {
      signal: AbortSignal.timeout(check.timeout_ms),
      redirect: "follow",
    });
    let bodyMatched = true;
    if (check.body) {
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1024 * 1024) throw new Error("body_limit");
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      bodyMatched =
        check.body.kind === "text"
          ? body.includes(check.body.value)
          : new RegExp(check.body.source).test(body);
    } else {
      await response.body?.cancel();
    }
    const matched = response.status === check.status && bodyMatched;
    return {
      status: matched ? "PASS" : "FAIL",
      expected,
      actual: { status: response.status, body_matched: bodyMatched },
      reason: matched ? null : "HTTP response does not match",
    };
  } catch {
    return {
      status: "INCONCLUSIVE",
      expected,
      actual: { error: "http_unavailable" },
      reason: "HTTP request or body could not complete within limits",
    };
  }
}
