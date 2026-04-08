import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import BookingsDashboard from "./pages/BookingsDashboard";
import Operations from "./pages/Operations";
import CalendarView from "./pages/CalendarView";
import Login from "./pages/Login";
import { useAuth } from "./_core/hooks/useAuth";
import { useEffect } from "react";

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
    <Switch>
      <Route path={"/login"} component={Login} />
      <Route path={"/"} component={BookingsDashboard} />
      <Route path={"/calendar"} component={CalendarView} />
      <Route path={"/sync"} component={Operations} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
