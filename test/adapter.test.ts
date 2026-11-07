import { describe, expect, it } from "vitest";
import {
  PI_TOPIC_REGEX,
  contextNeedsDocs,
  buildBillingHeader,
  compareVersions,
  extractDocsSection,
  extractRequiredClaudeCodeVersion,
  getClaudeFooterStatus,
  usageResponseToRateLimitHeaders,
} from "../extensions/index.ts";

/** Shape of `GET /api/oauth/usage` for a healthy account that never bought extra usage. */
const healthyUsage = {
  five_hour: { utilization: 20.0, resets_at: "2026-09-14T07:30:00.913859+00:00", locked_reason: null },
  seven_day: { utilization: 45.0, resets_at: "2026-09-15T14:00:00.913887+00:00", locked_reason: null },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: {
    is_enabled: false,
    monthly_limit: 2000,
    used_credits: 0.0,
    utilization: 0.0,
    disabled_reason: "out_of_credits",
    user_disabled: false,
    spend_limit_reached: false,
  },
};

describe("usageResponseToRateLimitHeaders", () => {
  it("does not reject a healthy account that simply never enabled extra usage", () => {
    expect(usageResponseToRateLimitHeaders(healthyUsage)).toBeNull();
  });

  it("rejects once a primary limit is spent, and reports the credit state", () => {
    const headers = usageResponseToRateLimitHeaders({
      ...healthyUsage,
      five_hour: { utilization: 100.0, resets_at: "2026-09-14T07:30:00.000000+00:00", locked_reason: null },
    });

    expect(headers).toEqual({
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": "five_hour",
      "anthropic-ratelimit-unified-reset": String(Date.parse("2026-09-14T07:30:00.000Z") / 1000),
      "anthropic-ratelimit-unified-overage-status": "rejected",
      "anthropic-ratelimit-unified-overage-disabled-reason": "out_of_credits",
    });
  });

  it("rejects a locked limit even below 100% utilization", () => {
    const headers = usageResponseToRateLimitHeaders({
      ...healthyUsage,
      seven_day: { utilization: 80.0, resets_at: null, locked_reason: "policy_violation" },
    });

    expect(headers?.["anthropic-ratelimit-unified-representative-claim"]).toBe("seven_day");
  });

  it("keeps enabled extra usage out of the rejection state", () => {
    const headers = usageResponseToRateLimitHeaders({
      ...healthyUsage,
      five_hour: { utilization: 100.0, resets_at: null, locked_reason: null },
      extra_usage: { is_enabled: true, disabled_reason: "out_of_credits" },
    });

    expect(headers?.["anthropic-ratelimit-unified-overage-status"]).toBeUndefined();
  });
});

describe("getClaudeFooterStatus", () => {
  it("stays silent on a live response that only advertises disabled extra usage", () => {
    expect(
      getClaudeFooterStatus(
        {
          "anthropic-ratelimit-unified-status": "allowed",
          "anthropic-ratelimit-unified-5h-status": "allowed",
          "anthropic-ratelimit-unified-5h-utilization": "0.19",
          "anthropic-ratelimit-unified-5h-reset": "1789371000",
          "anthropic-ratelimit-unified-representative-claim": "five_hour",
          "anthropic-ratelimit-unified-overage-status": "rejected",
          "anthropic-ratelimit-unified-overage-disabled-reason": "out_of_credits",
        },
        200,
      ),
    ).toBeNull();
  });

  it("reports an error once the request is actually rejected", () => {
    const status = getClaudeFooterStatus(
      {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-representative-claim": "five_hour",
      },
      429,
    );

    expect(status?.severity).toBe("error");
    expect(status?.message).toContain("session limit");
  });
});

describe("claude code version handling", () => {
  it("orders versions numerically, not lexicographically", () => {
    expect(compareVersions("2.1.270", "2.1.98")).toBe(1);
    expect(compareVersions("2.1.226", "2.1.251")).toBe(-1);
    expect(compareVersions("2.1.270", "2.1.270")).toBe(0);
  });

  it("extracts the version Anthropic demands for a gated model", () => {
    expect(
      extractRequiredClaudeCodeVersion(
        "Claude Code 2.1.226 does not support this model; version 2.1.251 or newer is required. Run 'claude update'.",
      ),
    ).toBe("2.1.251");
    expect(extractRequiredClaudeCodeVersion("rate_limit_error")).toBeUndefined();
    expect(extractRequiredClaudeCodeVersion(undefined)).toBeUndefined();
  });
});

describe("buildBillingHeader", () => {
  it("samples the first user message and keeps Claude Code's field order", () => {
    expect(buildBillingHeader([{ role: "user", content: "hi" }], "pi", true)).toMatch(
      /^x-anthropic-billing-header: cc_version=\d+(?:\.\d+)+\.[0-9a-f]{3}; cc_entrypoint=pi; cch=00000;$/,
    );
  });

  it("omits cch for non first-party endpoints", () => {
    expect(buildBillingHeader([{ role: "user", content: "hi" }], "pi", false)).not.toContain("cch=");
  });
});

describe("extractDocsSection", () => {
  const docs =
    "Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):\n- Main documentation: /x/README.md";

  it("removes only the <docs> element from XML-sectioned prompts, keeping project context and skills", () => {
    const prompt = [
      "You are an expert coding assistant.",
      "<rules>\n- be concise\n</rules>",
      `<docs>\n${docs}\n</docs>`,
      "<project_context>\n<project_instructions path=\"/a/AGENTS.md\">\nRoute web via subagents.\n</project_instructions>\n</project_context>",
      "<skills>\nThe following skills provide specialized instructions.\n<available_skills>\n</available_skills>\n</skills>",
      "<cwd>\n/home\n</cwd>",
    ].join("\n\n");
    const result = extractDocsSection(prompt);
    expect(result?.docsSection).toBe(docs);
    expect(result?.strippedPrompt).toBe(
      prompt.replace(`<docs>\n${docs}\n</docs>\n\n`, ""),
    );
    expect(result?.strippedPrompt).toContain("Route web via subagents.");
    expect(result?.strippedPrompt).toContain("<skills>\nThe following skills");
    expect(result?.strippedPrompt).not.toContain("<docs>");
    expect(result?.strippedPrompt).not.toContain("</docs>");
  });

  it("still stops at the legacy markdown project context heading", () => {
    const prompt = `Intro\n\n${docs}\n\n# Project Context\n\nAGENTS rules\n\n<available_skills>\n</available_skills>`;
    const result = extractDocsSection(prompt);
    expect(result?.docsSection).toBe(docs);
    expect(result?.strippedPrompt).toBe("Intro\n\n# Project Context\n\nAGENTS rules\n\n<available_skills>\n</available_skills>");
  });

  it("returns null when the docs marker is absent", () => {
    expect(extractDocsSection("no docs here")).toBeNull();
  });

  it("strips the Pi 1.3 docs element, whose wording changed to 'the harness itself'", () => {
    const docs13 =
      "Pi documentation (read only when the user asks about the harness itself, its SDK, extensions, themes, skills, or TUI):\n- Main documentation: /x/README.md";
    const prompt = [
      "You are a coding assistant running inside pi, a coding agent harness.",
      `<docs>\n${docs13}\n</docs>`,
      "<project_context>\nrules\n</project_context>",
    ].join("\n\n");
    const result = extractDocsSection(prompt);
    expect(result?.docsSection).toBe(docs13);
    expect(result?.strippedPrompt).not.toContain("<docs>");
    expect(result?.strippedPrompt).toContain("<project_context>\nrules\n</project_context>");
  });
});

describe("docs reinjection trigger", () => {
  it("fires on harness topics only, not on the bare word pi", () => {
    for (const yes of ["how do I write a pi extension?", "Pi extensions and skills", "fix my pi-sdk session", "edit ~/.pi/agent/settings.json", "add a prompt template", "registerTool signature", "@earendil-works/pi-ai types"]) {
      expect(PI_TOPIC_REGEX.test(yes), yes).toBe(true);
    }
    for (const no of ["upgrade the Raspberry Pi 5", "the pi-ui service is down", "check pi-cron jobs", "lets do it", "what is pi to 5 digits"]) {
      expect(PI_TOPIC_REGEX.test(no), no).toBe(false);
    }
  });

  it("stays on once any user message in the context asked about the harness (cache-stable prefix)", () => {
    const earlier = [
      { role: "user", content: "write a pi extension", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2 },
      { role: "user", content: "lets do it", timestamp: 3 },
    ] as never;
    expect(contextNeedsDocs(earlier, false)).toBe(true);
    expect(contextNeedsDocs([{ role: "user", content: "lets do it", timestamp: 1 }] as never, false)).toBe(false);
    expect(contextNeedsDocs([{ role: "user", content: "lets do it", timestamp: 1 }] as never, true)).toBe(true);
  });
});
