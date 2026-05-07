import React from "react";
import { Plus, WandSparkles, BarChart3, AlertTriangle, CalendarX } from "lucide-react";
import { Button } from "./Button";

const iconMap = {
  "Add session": <Plus size={16} />,
  "Analyze day": <BarChart3 size={16} />,
  "Analyze week": <BarChart3 size={16} />,
  "Resolve conflicts": <AlertTriangle size={16} />,
  "Auto-complete": <WandSparkles size={16} />,
  "Auto schedule week": <WandSparkles size={16} />,
  "Clear week": <CalendarX size={16} />,
};

export function FloatingActionDock({ actions = [] }) {
  return (
    <div className="ata-floating-dock">
      {actions.map((action, index) => {
        const primary = index === 0 || action.includes("Auto");
        return (
          <Button
            key={action}
            variant={primary ? "primary" : "secondary"}
            size="sm"
            iconLeft={iconMap[action]}
          >
            {action}
          </Button>
        );
      })}
    </div>
  );
}
