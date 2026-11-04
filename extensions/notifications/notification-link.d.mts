export function validateNotificationLink(value: unknown): string;
export function reconnectLink(sessionId: string): string;
export function notificationArgs(message: string, title: string, link?: string): string[];
export function sendMacNotification(
  execFile: (binary: string, args: string[]) => unknown,
  binary: string,
  message: string,
  title: string,
  link?: string,
): void;
