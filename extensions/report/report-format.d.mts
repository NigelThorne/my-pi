export type ReportStatus = "done" | "pending" | "blocked";

export interface ReportStep {
  status: ReportStatus;
  text: string;
}

export function parseReportStep(line: string): ReportStep | undefined;
