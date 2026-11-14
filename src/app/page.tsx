import Workspace from "@/components/Workspace";
import { serverConfig } from "@/lib/server/config";
export const dynamic = "force-dynamic";
export default function Home() {
  const config = serverConfig();
  return <Workspace hosts={config.sourceHosts} quota={config.quota} />;
}
