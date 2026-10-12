import { describe, expect, it } from "vitest";
import { leadTaskIsOverdue, openLeadTasks, taskTitleError } from "./tasks";

describe("lead tasks", () => {
  it("requires a title and rejects a blank one", () => {
    expect(taskTitleError("  ")).toBe("Add a task title.");
    expect(taskTitleError("Call back")).toBeNull();
  });

  it("keeps open tasks and drops completed ones", () => {
    const open = openLeadTasks([
      { id: "1", completedAt: null },
      { id: "2", completedAt: "2026-10-10T12:00:00.000Z" },
    ]);
    expect(open.map((task) => task.id)).toEqual(["1"]);
  });

  it("marks an open task overdue the day after it is due", () => {
    expect(leadTaskIsOverdue({ dueOn: "2026-10-09", completedAt: null }, "2026-10-10")).toBe(true);
    expect(leadTaskIsOverdue({ dueOn: "2026-10-10", completedAt: null }, "2026-10-10")).toBe(false);
    expect(leadTaskIsOverdue({ dueOn: "2026-10-09", completedAt: "2026-10-09T12:00:00.000Z" }, "2026-10-10")).toBe(false);
    expect(leadTaskIsOverdue({ dueOn: null, completedAt: null }, "2026-10-10")).toBe(false);
  });
});
