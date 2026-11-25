import type { Blueprint } from "@/schema/blueprint";
import { EditProvider, type EditMode } from "@/components/edit/EditProvider";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import type { ChatItem } from "@/agent/transcript";
import { SandboxProvider } from "@/components/sandbox/SandboxProvider";
import { ThemeStyle } from "@/theme/ThemeStyle";
import type { SandboxBridge } from "@/sandbox/protocol";

export function AppShell({
  blueprint,
  mode,
  basePath,
  businesses,
  footer,
  banner,
  transcript,
  sandbox,
  children,
}: {
  /** Data access for generated components rendered in the browser. */
  sandbox: SandboxBridge;
  /** Owner chat so far (server mode). */
  transcript?: ChatItem[];
  blueprint: Blueprint;
  mode: EditMode;
  basePath: string;
  businesses?: { id: string; name: string }[];
  footer?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <EditProvider blueprint={blueprint} mode={mode}>
    <SandboxProvider value={{ bridge: sandbox, basePath }}>
    <ThemeStyle />
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <Sidebar basePath={basePath} businesses={businesses} footer={footer} />
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
    <ChatPanel mode={mode} initialTranscript={transcript} />
    </SandboxProvider>
    </EditProvider>
  );
}
