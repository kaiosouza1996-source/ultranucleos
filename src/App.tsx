import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Conexao from "./pages/Conexao";
import Importar from "./pages/Importar";
import Contatos from "./pages/Contatos";
import Tags from "./pages/Tags";
import Atendimento from "./pages/Atendimento";
import CRM from "./pages/CRM";
import Mensagens from "./pages/Mensagens";
import Disparos from "./pages/Disparos";
import Logs from "./pages/Logs";
import Configuracoes from "./pages/Configuracoes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/conexao" element={<Conexao />} />
            <Route path="/atendimento" element={<Atendimento />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/contatos" element={<Contatos />} />
            <Route path="/tags" element={<Tags />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/mensagens" element={<Mensagens />} />
            <Route path="/disparos" element={<Disparos />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
