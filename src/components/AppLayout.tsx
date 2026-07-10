import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { MobileBottomNav } from "./MobileBottomNav";
import { SimulationModeBanner } from "./SimulationModeBanner";
import { useEngineBootstrap } from "@/lib/engine";

export default function AppLayout() {
  useEngineBootstrap();
  return (
    <div className="relative min-h-screen w-full flex flex-col">
      {/* Assinatura visual da marca: faixa do gradiente Áurea fixa no topo e no
          rodapé da tela inteira, em toda a aplicação. */}
      <div aria-hidden className="fixed top-0 inset-x-0 h-[3px] bg-gradient-brand z-50 pointer-events-none" />
      <div aria-hidden className="fixed bottom-0 inset-x-0 h-[3px] bg-gradient-brand z-50 pointer-events-none" />
      <SimulationModeBanner />
      <div className="relative flex-1 w-full flex min-h-0">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <MobileTopBar />
          <main
            className="flex-1 min-w-0 px-4 sm:px-5 lg:px-8 py-4 sm:py-6 lg:py-8 relative z-[1] scrollbar-thin overflow-x-hidden pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-8"
          >
            <div className="max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </div>
  );
}
