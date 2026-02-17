import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 解析 trpc/Zod 错误消息，将 JSON 格式的 ZodError 转为可读的中文提示。
 * 如果不是 Zod JSON 格式，则返回原始消息。
 */
export function parseErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].message) {
      // 提取所有 Zod issue 的 message，用分号连接
      return parsed.map((issue: any) => issue.message).join("；");
    }
  } catch {
    // 不是 JSON 格式，返回原始消息
  }
  return message;
}
