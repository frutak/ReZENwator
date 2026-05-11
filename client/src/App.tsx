import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { useAuth } from "./_core/hooks/useAuth";
import { useEffect, lazy, Suspense } from "react";
import { Spinner } from "./components/ui/spinner";

const BookingsDashboard = lazy(() => import("./pages/BookingsDashboard"));
const Operations = lazy(() => import("./pages/Operations"));
const CalendarView = lazy(() => import("./pages/CalendarView"));
const PricingDashboard = lazy(() => import("./pages/PricingDashboard"));
const TransferMatching = lazy(() => import("./pages/TransferMatching"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user?.viewAccess === "cleaning") {
      if (location === "/" || location === "/sync" || location === "/analytics") {
        setLocation("/calendar");
      }
    }
  }, [user, loading, location, setLocation]);

  return (
    <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-background"><Spinner /></div>}>
      <Switch>
        <Route path={"/login"} component={Login} />
        <Route path={"/"} component={BookingsDashboard} />
        <Route path={"/calendar"} component={CalendarView} />
        <Route path={"/pricing"} component={PricingDashboard} />
        <Route path={"/transfers"} component={TransferMatching} />
        <Route path={"/analytics"} component={Analytics} />
        <Route path={"/sync"} component={Operations} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <LanguageProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
