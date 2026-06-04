import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { MobileBottomNav } from "./MobileBottomNav";
import { useEngineBootstrap } from "@/lib/engine";

export default function AppLayout() {
  useEngineBootstrap();
  return (
    <div className="relative min-h-screen w-full flex">
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopBar />
        <main
          className="flex-1 min-w-0 px-4 sm:px-5 md:px-8 py-4 sm:py-6 md:py-8 relative z-[1] scrollbar-thin overflow-x-hidden pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-8"
        >
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
