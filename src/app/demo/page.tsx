import { redirect } from "next/navigation";
import { menuPages } from "@/engine/layout";
import { demoBlueprint } from "@/demo/salon";

export default function DemoHome() {
  redirect(`/demo/p/${menuPages(demoBlueprint)[0].id}`);
}
