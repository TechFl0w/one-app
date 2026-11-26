import { InboxView } from "@/components/inbox/InboxView";
import { currentDemo, demoInbox } from "@/demo/current";

/** Demo Inbox with sample messages that fit the demo's business (nothing is received in the demo). */
export default async function DemoInbox() {
  const demo = await currentDemo();
  const inbox = demoInbox(demo.type, demo.blueprint.business.name);
  return <InboxView inboundAddress={inbox.address} timezone={demo.blueprint.business.timezone} items={inbox.items} />;
}
