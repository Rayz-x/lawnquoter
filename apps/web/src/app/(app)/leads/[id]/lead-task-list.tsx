import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { leadTaskIsOverdue, openLeadTasks, type LeadTaskRecord } from "@/lib/leads/tasks";
import { addLeadTaskForm, completeLeadTaskForm } from "./task-actions";

export function LeadTaskList({
  leadId,
  tasks,
  today,
  canEdit,
}: {
  leadId: string;
  tasks: readonly LeadTaskRecord[];
  today: string;
  canEdit: boolean;
}) {
  const open = openLeadTasks(tasks);
  return (
    <Card data-testid="lead-tasks">
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {open.length === 0 ? <p className="text-sm text-muted-foreground">No open tasks.</p> : null}
        <ul className="flex flex-col gap-2">
          {open.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {task.title}
                {task.dueOn ? <span className="text-muted-foreground"> · due {task.dueOn}</span> : null}
              </span>
              {leadTaskIsOverdue(task, today) ? (
                <Badge variant="outline" className="border-destructive/40 text-destructive">
                  Overdue
                </Badge>
              ) : null}
              {canEdit ? (
                <form action={completeLeadTaskForm.bind(null, leadId, task.id)}>
                  <Button type="submit" variant="outline" size="sm">
                    Done
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <form action={addLeadTaskForm.bind(null, leadId)} className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-40 flex-1 flex-col gap-1.5">
              <Label htmlFor="lead-task-title">New task</Label>
              <Input id="lead-task-title" name="title" maxLength={200} required placeholder="Call back" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-task-due">Due</Label>
              <Input id="lead-task-due" name="dueOn" type="date" />
            </div>
            <Button type="submit" variant="secondary">
              Add task
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
