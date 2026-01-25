import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Search from "./pages/Search";
import Results from "./pages/Results";
import SearchProgress from "./pages/SearchProgress";
import Recharge from "./pages/Recharge";
import History from "./pages/History";
import Admin from "./pages/Admin";
import AdminLogin from "./pages/AdminLogin";
import PaymentDetail from "./pages/PaymentDetail";
import Feedback from "./pages/Feedback";
import About from "./pages/About";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";
import Roadmap from "./pages/Roadmap";
import TpsSearch from "./pages/TpsSearch";
import TpsTask from "./pages/TpsTask";
import TpsHistory from "./pages/TpsHistory";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/reset-password/:token" component={ResetPassword} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/search" component={Search} />
      <Route path="/results/:taskId" component={Results} />
      <Route path="/progress/:taskId" component={SearchProgress} />
      <Route path="/recharge" component={Recharge} />
      <Route path="/payment/:orderId" component={PaymentDetail} />
      <Route path="/history" component={History} />
      <Route path="/feedback" component={Feedback} />
      <Route path="/roadmap" component={Roadmap} />
      <Route path="/tps" component={TpsSearch} />
      <Route path="/tps/task/:taskId" component={TpsTask} />
      <Route path="/tps/history" component={TpsHistory} />
      <Route path="/about" component={About} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/contact" component={Contact} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin" component={Admin} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
