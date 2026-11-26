/**
 * Icons generated screens can use with the kit's <Icon name="…" />. Names are lucide's
 * kebab-case names. The SVGs are bundled into the sandbox runtime (the frame has no network), so
 * the list is kept short; src/sandbox/icons.ts maps each name to its lucide component.
 */
export const ICON_NAMES = [
  // actions
  "plus", "minus", "x", "check", "pencil", "trash", "copy", "search", "filter", "download", "upload", "share", "send", "refresh-cw", "undo", "more-horizontal", "more-vertical", "external-link", "link", "settings",
  // navigation
  "chevron-down", "chevron-up", "chevron-left", "chevron-right", "arrow-left", "arrow-right", "arrow-up", "arrow-down", "menu", "home",
  // status
  "alert-triangle", "alert-circle", "info", "help-circle", "check-circle", "x-circle", "circle", "loader", "lock", "unlock", "eye", "eye-off", "bell", "flag", "star", "heart", "thumbs-up", "sparkles", "zap",
  // time
  "calendar", "calendar-check", "calendar-plus", "clock", "timer", "history",
  // people & contact
  "user", "users", "user-plus", "phone", "mail", "message-circle", "map-pin", "globe",
  // money & sales
  "dollar-sign", "credit-card", "wallet", "receipt", "tag", "shopping-cart", "shopping-bag", "package", "truck", "store", "gift", "percent", "trending-up", "trending-down", "bar-chart", "pie-chart",
  // things
  "file", "file-text", "folder", "image", "camera", "clipboard", "clipboard-check", "list", "list-checks", "layout-grid", "inbox", "archive", "bookmark", "printer",
  // trades & places
  "wrench", "hammer", "scissors", "paintbrush", "car", "building", "key", "bed", "utensils", "coffee", "briefcase",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export const isIconName = (n: unknown): n is IconName => typeof n === "string" && (ICON_NAMES as readonly string[]).includes(n);

/** "Calendar", "calendarCheck" and "calendar_check" all mean "calendar-check". */
export function normalizeIconName(n: unknown): string {
  return typeof n === "string" ? n.trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase() : "";
}
