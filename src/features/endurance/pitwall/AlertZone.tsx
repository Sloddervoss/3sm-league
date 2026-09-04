interface Alert {
  severity: "high" | "medium" | "info";
  message: string;
}

interface Props {
  alerts: Alert[];
}

export const AlertZone = ({ alerts }: Props) => {
  /* Hidden when no alerts active */
  if (!alerts || alerts.length === 0) return null;

  const severityOrder = { high: 0, medium: 1, info: 2 };
  const sorted = [...alerts].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return (
    <div className="space-y-1">
      {sorted.map((alert, i) => (
        <div
          key={i}
          className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
            alert.severity === "high"
              ? "bg-red-500/15 text-red-300 ring-1 ring-red-500/20"
              : alert.severity === "medium"
                ? "bg-yellow-500/10 text-yellow-300 ring-1 ring-yellow-500/15"
                : "bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/10"
          }`}
        >
          {alert.message}
        </div>
      ))}
    </div>
  );
};