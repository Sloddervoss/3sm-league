using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using SimHub.Plugins;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Publiceert de stintmomentopname als SimHub-properties. Het Dash Studio-
    /// dashboard leest alleen deze properties; het heeft geen netwerktoegang nodig.
    /// </summary>
    public sealed class OverlayPropertyPublisher
    {
        private const string DefaultPrefix = "THREESM.Overlay";
        private const int StalePlanSeconds = 180;

        private readonly PluginManager _manager;
        private readonly Type _pluginType;
        private readonly string _prefix;
        private bool _registered;
        private string _lastSignature;

        public OverlayPropertyPublisher(PluginManager manager, Type pluginType, string prefix)
        {
            _manager = manager;
            _pluginType = pluginType ?? typeof(OverlayPropertyPublisher);
            var value = string.IsNullOrWhiteSpace(prefix) ? DefaultPrefix : prefix.Trim().TrimEnd('.');
            _prefix = value;
        }

        public bool Register()
        {
            if (_manager == null) return false;
            if (_registered) return true;
            try
            {
                Add("Current.DriverName", "\u2014");
                Add("Current.DriverNameUpper", "\u2014");
                Add("Current.StintIndex", 0);
                Add("Current.IsOverdue", false);
                Add("Current.TyreChange", false);
                Add("Current.ExpectedLaps", 0);
                Add("Current.StartAt", string.Empty);
                Add("Current.EndAt", string.Empty);
                Add("Current.AverageLap", "\u2014");
                Add("Current.BestLap", "\u2014");
                Add("Current.AverageSeconds", 0d);
                Add("Current.BestSeconds", 0d);
                Add("Current.AverageDelta", "\u2014");

                Add("Next.DriverName", "\u2014");
                Add("Next.DriverNameUpper", "\u2014");
                Add("Next.StintIndex", 0);
                Add("Next.MinutesUntilStart", -1);
                Add("Next.TyreChange", false);
                Add("Next.ExpectedLaps", 0);
                Add("Next.StartAt", string.Empty);
                Add("Next.EndAt", string.Empty);

                Add("Race.PlannedMinutes", 0);
                Add("Race.PlannedStartAt", string.Empty);
                Add("Race.PlannedEndAt", string.Empty);

                Add("Plan.AgeSeconds", -1);
                Add("Plan.Revision", string.Empty);
                Add("Plan.HasData", false);
                Add("Plan.Error", string.Empty);

                Add("Team.Name", "\u2014");
                Add("Team.CarNumber", string.Empty);
                Add("Event.Name", "\u2014");

                Add("Self.IsDriving", false);
                Add("Self.IracingId", string.Empty);
                Add("Current.IsSelf", false);
                Add("Current.MinutesRemaining", -1);
                Add("Next.IsSelf", false);

                Add("Order.Summary", "\u2014");
                Add("Order.Count", 0);
                for (var slot = 1; slot <= 8; slot++) Add("Order.Driver" + slot, "\u2014");
                Add("Pace.Summary", "\u2014");
                Add("Warnings", string.Empty);

                _registered = true;
                return true;
            }
            catch
            {
                return false;
            }
        }

        public void Publish(OverlaySnapshot snapshot, int planAgeSeconds, string lastError)
        {
            if (_manager == null || !_registered) return;
            try
            {
                var current = snapshot == null ? null : snapshot.Current;
                var next = snapshot == null ? null : snapshot.Next;
                var warnings = BuildWarnings(snapshot, planAgeSeconds, lastError);
                var orderSummary = BuildOrderSummary(snapshot);
                var paceSummary = BuildPaceSummary(snapshot);

                var signature = string.Join("|", new[]
                {
                    snapshot == null ? string.Empty : snapshot.Revision,
                    current == null ? string.Empty : current.StintId,
                    current == null ? string.Empty : current.DriverName,
                    current == null || !current.StintIndex.HasValue ? string.Empty : current.StintIndex.Value.ToString(CultureInfo.InvariantCulture),
                    current != null && current.IsOverdue == true ? "1" : "0",
                    current == null || !current.AverageSeconds.HasValue ? string.Empty : current.AverageSeconds.Value.ToString(CultureInfo.InvariantCulture),
                    current == null || !current.BestSeconds.HasValue ? string.Empty : current.BestSeconds.Value.ToString(CultureInfo.InvariantCulture),
                    next == null ? string.Empty : next.DriverName,
                    next == null || !next.MinutesUntilStart.HasValue ? string.Empty : next.MinutesUntilStart.Value.ToString(CultureInfo.InvariantCulture),
                    next != null && next.TyreChange == true ? "1" : "0",
                    orderSummary,
                    paceSummary,
                    warnings,
                    planAgeSeconds.ToString(CultureInfo.InvariantCulture),
                    lastError ?? string.Empty
                });
                if (string.Equals(signature, _lastSignature, StringComparison.Ordinal)) return;
                _lastSignature = signature;

                var self = snapshot == null ? null : snapshot.Self;
                Set("Self.IsDriving", self != null && self.IsDriving == true);
                Set("Self.IracingId", Text(self == null ? null : self.IracingId, string.Empty));

                Set("Current.DriverName", Text(current == null ? null : current.DriverName));
                Set("Current.IsSelf", current != null && current.IsSelf == true);
                Set("Current.MinutesRemaining", current != null && current.MinutesRemaining.HasValue
                    ? (int)Math.Round(current.MinutesRemaining.Value) : -1);
                Set("Current.DriverNameUpper", Upper(current == null ? null : current.DriverName));
                Set("Current.StintIndex", current != null && current.StintIndex.HasValue ? current.StintIndex.Value : 0);
                Set("Current.IsOverdue", current != null && current.IsOverdue == true);
                Set("Current.TyreChange", current != null && current.TyreChange == true);
                Set("Current.ExpectedLaps", current != null && current.ExpectedLaps.HasValue ? current.ExpectedLaps.Value : 0);
                Set("Current.StartAt", Text(current == null ? null : current.StartAt, string.Empty));
                Set("Current.EndAt", Text(current == null ? null : current.EndAt, string.Empty));
                Set("Current.AverageLap", FormatLap(current == null ? null : current.AverageSeconds));
                Set("Current.BestLap", FormatLap(current == null ? null : current.BestSeconds));
                Set("Current.AverageSeconds", current != null && current.AverageSeconds.HasValue ? (double)current.AverageSeconds.Value : 0d);
                Set("Current.BestSeconds", current != null && current.BestSeconds.HasValue ? (double)current.BestSeconds.Value : 0d);
                Set("Current.AverageDelta", FormatDelta(
                    current == null ? null : current.AverageSeconds,
                    current == null ? null : current.BestSeconds));

                Set("Next.DriverName", Text(next == null ? null : next.DriverName));
                Set("Next.IsSelf", next != null && next.IsSelf == true);
                Set("Next.DriverNameUpper", Upper(next == null ? null : next.DriverName));
                Set("Next.StintIndex", next != null && next.StintIndex.HasValue ? next.StintIndex.Value : 0);
                Set("Next.MinutesUntilStart", next != null && next.MinutesUntilStart.HasValue ? (int)Math.Round(next.MinutesUntilStart.Value) : -1);
                Set("Next.TyreChange", next != null && next.TyreChange == true);
                Set("Next.ExpectedLaps", next != null && next.ExpectedLaps.HasValue ? next.ExpectedLaps.Value : 0);
                Set("Next.StartAt", Text(next == null ? null : next.StartAt, string.Empty));
                Set("Next.EndAt", Text(next == null ? null : next.EndAt, string.Empty));

                var race = snapshot == null ? null : snapshot.Race;
                Set("Race.PlannedMinutes", race != null && race.PlannedDurationMinutes.HasValue ? (int)Math.Round(race.PlannedDurationMinutes.Value) : 0);
                Set("Race.PlannedStartAt", Text(race == null ? null : race.PlannedStartAt, string.Empty));
                Set("Race.PlannedEndAt", Text(race == null ? null : race.PlannedEndAt, string.Empty));

                Set("Plan.AgeSeconds", planAgeSeconds);
                Set("Plan.Revision", Text(snapshot == null ? null : snapshot.Revision, string.Empty));
                Set("Plan.HasData", snapshot != null);
                Set("Plan.Error", Text(lastError, string.Empty));

                var team = snapshot == null ? null : snapshot.Team;
                var eventInfo = snapshot == null ? null : snapshot.Event;
                Set("Team.Name", Text(team == null ? null : team.Name));
                Set("Team.CarNumber", Text(team == null ? null : team.CarNumber, string.Empty));
                Set("Event.Name", Text(eventInfo == null ? null : eventInfo.Name));

                Set("Order.Summary", orderSummary);
                var order = snapshot == null || snapshot.Order == null ? new OverlayStint[0] : snapshot.Order;
                Set("Order.Count", order.Length);
                for (var slot = 1; slot <= 8; slot++)
                    Set("Order.Driver" + slot, slot <= order.Length ? Text(order[slot - 1] == null ? null : order[slot - 1].DriverName) : "\u2014");
                Set("Pace.Summary", paceSummary);
                Set("Warnings", warnings);
            }
            catch
            {
                // Publiceren mag de plugin nooit breken.
            }
        }

        private static string BuildOrderSummary(OverlaySnapshot snapshot)
        {
            if (snapshot == null || snapshot.Order == null || snapshot.Order.Length == 0) return "\u2014";
            var builder = new StringBuilder();
            string last = null;
            for (var i = 0; i < snapshot.Order.Length; i++)
            {
                var stint = snapshot.Order[i];
                var name = stint == null ? null : stint.DriverName;
                if (string.IsNullOrWhiteSpace(name)) name = "Coureur";
                name = name.Trim();
                // Een dubbele stint levert twee keer dezelfde naam op; die
                // slaan we over zodat de reeks de wissels toont, niet de
                // stintgrenzen.
                if (last != null && string.Equals(last, name, StringComparison.OrdinalIgnoreCase)) continue;
                if (builder.Length > 0) builder.Append(" > ");
                builder.Append(name);
                last = name;
            }
            return builder.Length == 0 ? "\u2014" : builder.ToString();
        }

        private static string BuildPaceSummary(OverlaySnapshot snapshot)
        {
            if (snapshot == null || snapshot.Pace == null || snapshot.Pace.Length == 0) return "\u2014";
            var builder = new StringBuilder();
            for (var i = 0; i < snapshot.Pace.Length; i++)
            {
                var pace = snapshot.Pace[i];
                if (pace == null) continue;
                if (builder.Length > 0) builder.Append(" \u00b7 ");
                builder.Append(string.IsNullOrWhiteSpace(pace.DriverName) ? "Coureur" : pace.DriverName.Trim());
                builder.Append(' ').Append(FormatLap(pace.AverageSeconds));
            }
            return builder.Length == 0 ? "\u2014" : builder.ToString();
        }

        private static string BuildWarnings(OverlaySnapshot snapshot, int planAgeSeconds, string lastError)
        {
            var warnings = new List<string>();
            if (snapshot != null && snapshot.Warnings != null)
            {
                for (var i = 0; i < snapshot.Warnings.Length; i++)
                    AddWarning(warnings, FriendlyWarning(snapshot.Warnings[i]));
            }
            AddWarning(warnings, FriendlyWarning(lastError));
            if (snapshot != null && planAgeSeconds > StalePlanSeconds)
                AddWarning(warnings, FriendlyWarning("stale_plan"));
            if (snapshot == null && string.IsNullOrWhiteSpace(lastError))
                AddWarning(warnings, FriendlyWarning("no_plan"));
            return string.Join(",", warnings.ToArray());
        }

        private static string FriendlyWarning(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return string.Empty;
            switch (code.Trim())
            {
                case "not_bound": return "geen actief event";
                case "invalid_device": return "apparaat niet gekoppeld";
                case "network_error": return "geen verbinding";
                case "rate_limited": return "even wachten";
                case "db_unavailable": return "server niet bereikbaar";
                case "invalid_contract": return "ongeldige data";
                case "plan_empty": return "geen planning";
                case "no_current_stint": return "geen actieve stint";
                case "stale_plan": return "planning is oud";
                case "no_plan": return "nog geen planning";
                default:
                    return code.StartsWith("http_", StringComparison.Ordinal) ? "serverfout" : code.Trim();
            }
        }

        private static void AddWarning(List<string> warnings, string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            var normalized = value.Trim();
            if (normalized.Length == 0) return;
            if (!warnings.Contains(normalized)) warnings.Add(normalized);
        }

        private static string Text(string value)
        {
            return Text(value, "\u2014");
        }

        private static string Text(string value, string fallback)
        {
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        }

        private static string Upper(string value)
        {
            var text = Text(value);
            return string.Equals(text, "\u2014", StringComparison.Ordinal) ? text : text.ToUpperInvariant();
        }

        private static string FormatDelta(decimal? average, decimal? best)
        {
            if (!average.HasValue || !best.HasValue || average.Value <= 0 || best.Value <= 0) return "\u2014";
            var delta = average.Value - best.Value;
            return (delta >= 0 ? "+" : string.Empty) + delta.ToString("0.000", CultureInfo.InvariantCulture);
        }

        private static string FormatLap(decimal? seconds)
        {
            if (!seconds.HasValue || seconds.Value <= 0) return "\u2014";
            var value = TimeSpan.FromSeconds((double)seconds.Value);
            var minutes = (int)Math.Floor(value.TotalMinutes);
            return minutes.ToString(CultureInfo.InvariantCulture) + ":"
                + value.Seconds.ToString("00", CultureInfo.InvariantCulture) + "."
                + value.Milliseconds.ToString("000", CultureInfo.InvariantCulture);
        }

        private void Add<T>(string suffix, T defaultValue)
        {
            try { _manager.AddProperty<T>(_prefix + "." + suffix, _pluginType, defaultValue, (string)null); } catch { }
        }

        private void Set(string suffix, object value)
        {
            try { _manager.SetPropertyValue(_prefix + "." + suffix, _pluginType, value); } catch { }
        }
    }
}
