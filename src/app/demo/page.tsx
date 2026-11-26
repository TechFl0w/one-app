import { redirect } from "next/navigation";
import { menuPages } from "@/engine/layout";
import { currentDemo } from "@/demo/current";

export default async function DemoHome() {
  redirect(`/demo/p/${menuPages((await currentDemo()).blueprint)[0].id}`);
}
