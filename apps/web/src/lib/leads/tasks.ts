export type LeadTaskRecord = {
  id: string;
  title: string;
  dueOn: string | null;
  completedAt: string | null;
};

export function taskTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Add a task title.";
  if (trimmed.length > 200) return "Keep the task title under 200 characters.";
  return null;
}

export function openLeadTasks<T extends { completedAt: string | null }>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.completedAt == null);
}

/** Due dates are calendar dates. Overdue starts the next day. Completed tasks are not overdue. */
export function leadTaskIsOverdue(
  task: { dueOn: string | null; completedAt: string | null },
  today: string,
): boolean {
  if (task.completedAt || !task.dueOn) return false;
  return task.dueOn < today;
}
