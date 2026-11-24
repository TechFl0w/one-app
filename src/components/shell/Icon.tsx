import {
  Box,
  Calendar,
  CalendarClock,
  Car,
  ClipboardList,
  CreditCard,
  FileText,
  Home,
  Inbox,
  LayoutGrid,
  MessageCircle,
  Package,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icons a page can use (blueprint `page.icon`). Unknown names fall back to a grid. */
export const PAGE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  sun: Sun,
  calendar: Calendar,
  schedule: CalendarClock,
  users: Users,
  sparkles: Sparkles,
  settings: Settings,
  payments: CreditCard,
  orders: ShoppingBag,
  products: Package,
  inbox: Inbox,
  messages: MessageCircle,
  documents: FileText,
  tasks: ClipboardList,
  star: Star,
  car: Car,
  tools: Wrench,
  box: Box,
};

export function PageIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && PAGE_ICONS[name]) || LayoutGrid;
  return <Icon className={className} aria-hidden strokeWidth={1.8} />;
}
