import React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initialDark = stored ? stored === "dark" : prefersDark;
      setIsDark(initialDark);
      if (initialDark) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    } catch {
      // no-op
    }
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // no-op
    }
    if (next) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          onClick={toggleTheme}
          className="text-muted-foreground hover:text-foreground"
        >
          <Sun className={cn("h-4 w-4", isDark ? "hidden" : "block")} />
          <Moon className={cn("h-4 w-4", isDark ? "block" : "hidden")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isDark ? "Modo claro" : "Modo oscuro"}
      </TooltipContent>
    </Tooltip>
  );
}
