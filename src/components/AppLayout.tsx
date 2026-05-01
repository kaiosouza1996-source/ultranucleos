import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { useEngineBootstrap } from "@/lib/engine";

export default function AppLayout() {
  useEngineBootstrap();
  return (
    <div className="relative min-h-screen w-full flex">
      <AppSidebar />
      <main className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-8 relative z-[1] scrollbar-thin overflow-x-hidden">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
