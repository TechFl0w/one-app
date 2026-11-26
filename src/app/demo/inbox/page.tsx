import { InboxView } from "@/components/inbox/InboxView";
import { currentDemo } from "@/demo/current";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Demo Inbox with sample messages (nothing is received in the demo). */
export default async function DemoInbox() {
  return (
    <InboxView
      inboundAddress="polished-nail-bar@in.buildingwaves.tech"
      timezone={(await currentDemo()).blueprint.business.timezone}
      items={[
        { id: 2, from_address: "elena@example.com", from_name: "Elena Rossi", subject: "Can I move my appointment?", text_body: "Hi! Could I come at 4 instead of 3:30 tomorrow? Thanks, Elena", received_at: hoursAgo(2), read_at: null, forwarded_at: hoursAgo(2) },
        { id: 1, from_address: "orders@supplier.example", from_name: "Nail Supply Co", subject: "Your order #4821 has shipped", text_body: "Your gel polish order is on its way. Tracking: 1Z999AA10123456784", received_at: hoursAgo(26), read_at: hoursAgo(20), forwarded_at: null },
      ]}
    />
  );
}
