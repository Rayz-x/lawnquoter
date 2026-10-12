import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));

import { redirectIfOnboardingOpen } from "./gate";

beforeEach(() => {
  redirect.mockReset();
});

describe("onboarding gate", () => {
  it("sends an unfinished company back to setup", () => {
    redirectIfOnboardingOpen({ onboarding_step: "services" }, true);
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("leaves a finished company alone and sends a failed read back to setup", () => {
    redirectIfOnboardingOpen({}, true);
    redirectIfOnboardingOpen({ onboarding_complete: true, onboarding_step: "team" }, true);
    expect(redirect).not.toHaveBeenCalled();
    redirectIfOnboardingOpen(undefined, false);
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });
});
