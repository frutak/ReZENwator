import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import { useEffect, lazy, Suspense } from "react";
import { Spinner } from "./components/ui/spinner";

const BookingsDashboard = lazy(() => import("./pages/BookingsDashboard"));
const Operations = lazy(() => import("./pages/Operations"));
const CalendarView = lazy(() => import("./pages/CalendarView"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user?.viewAccess === "cleaning") {
      if (location === "/" || location === "/sync") {
        setLocation("/calendar");
      }
    }
  }, [user, loading, location, setLocation]);

  return (
    <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-background"><Spinner size="lg" /></div>}>
      <Switch>
        <Route path={"/login"} component={Login} />
        <Route path={"/"} component={BookingsDashboard} />
        <Route path={"/calendar"} component={CalendarView} />
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
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
