using System;
using System.Windows;
using System.Windows.Controls;

namespace ThreeSM.EnduranceConnector
{
    public sealed class SettingsControl : UserControl
    {
        public SettingsControl(EnduranceConnectorPlugin plugin)
        {
            var settings = plugin.Settings;
            var panel = new StackPanel { Margin = new Thickness(18) };
            panel.Children.Add(new TextBlock { Text = "3SM Endurance Connector", FontSize = 22, FontWeight = FontWeights.Bold });
            panel.Children.Add(new TextBlock { Text = "Lokale technische spike. Alleen loopback bridge; planning wordt nooit automatisch gewijzigd.", Margin = new Thickness(0, 4, 0, 16), TextWrapping = TextWrapping.Wrap });
            AddText(panel, "Bridge-URL", settings.BridgeUrl, value => settings.BridgeUrl = value);
            AddPassword(panel, "Pairingtoken", settings.PairingToken, value => settings.PairingToken = value);
            AddText(panel, "Endurance event-ID", settings.EventId, value => settings.EventId = value);
            AddText(panel, "Team-ID", settings.TeamId, value => settings.TeamId = value);
            AddText(panel, "Coureur-ID", settings.DriverId, value => settings.DriverId = value);
            AddText(panel, "Connector-ID", settings.ConnectorId, value => settings.ConnectorId = value);
            AddText(panel, "Interval in milliseconden (minimaal 500)", settings.SendIntervalMilliseconds.ToString(), value => { int parsed; if (int.TryParse(value, out parsed)) settings.SendIntervalMilliseconds = Math.Max(500, parsed); });

            var mappings = new StackPanel();
            AddText(mappings, "Snelheid", settings.SpeedProperty, value => settings.SpeedProperty = value);
            AddText(mappings, "Huidige ronde", settings.LapProperty, value => settings.LapProperty = value);
            AddText(mappings, "Voltooide ronden", settings.CompletedLapsProperty, value => settings.CompletedLapsProperty = value);
            AddText(mappings, "Rondetijd", settings.LapTimeProperty, value => settings.LapTimeProperty = value);
            AddText(mappings, "Positie", settings.PositionProperty, value => settings.PositionProperty = value);
            AddText(mappings, "Klassepositie", settings.ClassPositionProperty, value => settings.ClassPositionProperty = value);
            AddText(mappings, "Brandstof", settings.FuelProperty, value => settings.FuelProperty = value);
            AddText(mappings, "Brandstof per ronde", settings.FuelPerLapProperty, value => settings.FuelPerLapProperty = value);
            AddText(mappings, "Geschatte resterende ronden", settings.EstimatedLapsProperty, value => settings.EstimatedLapsProperty = value);
            AddText(mappings, "Pitlane", settings.PitLaneProperty, value => settings.PitLaneProperty = value);
            AddText(mappings, "Pitlimiter", settings.PitLimiterProperty, value => settings.PitLimiterProperty = value);
            AddText(mappings, "Incidenten", settings.IncidentsProperty, value => settings.IncidentsProperty = value);
            AddText(mappings, "Vlag", settings.FlagProperty, value => settings.FlagProperty = value);
            AddText(mappings, "Sessietijd", settings.SessionTimeProperty, value => settings.SessionTimeProperty = value);
            panel.Children.Add(new Expander { Header = "Geavanceerde SimHub-propertymapping", Content = mappings, Margin = new Thickness(0, 14, 0, 0) });

            panel.Children.Add(new TextBlock { Text = "Status", FontWeight = FontWeights.Bold, Margin = new Thickness(0, 18, 0, 3) });
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap };
            status.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding("Status") { Source = plugin });
            panel.Children.Add(status);
            Content = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = panel };
        }

        private static void AddText(Panel panel, string label, string initial, Action<string> changed)
        {
            panel.Children.Add(new TextBlock { Text = label, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 3) });
            var input = new TextBox { Text = initial ?? string.Empty, MinWidth = 420, Padding = new Thickness(6) };
            input.TextChanged += delegate { changed(input.Text.Trim()); };
            panel.Children.Add(input);
        }

        private static void AddPassword(Panel panel, string label, string initial, Action<string> changed)
        {
            panel.Children.Add(new TextBlock { Text = label, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 8, 0, 3) });
            var input = new PasswordBox { Password = initial ?? string.Empty, MinWidth = 420, Padding = new Thickness(6) };
            input.PasswordChanged += delegate { changed(input.Password); };
            panel.Children.Add(input);
        }
    }
}
