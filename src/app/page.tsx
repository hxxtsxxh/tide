import Workspace from "@/components/Workspace";
import { modeHostLists, serverConfig } from "@/lib/server/config";
export const dynamic = "force-dynamic";
export default function Home() {
  const config = serverConfig();
  return <Workspace hostsByMode={modeHostLists(config)} quota={config.quota} />;
}
