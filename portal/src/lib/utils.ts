import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getThumbnailUrl(img: string, width: number = 400) {
  if (!img) return "";
  return `/api/thumbnail?img=${encodeURIComponent(img)}&w=${width}`;
}
