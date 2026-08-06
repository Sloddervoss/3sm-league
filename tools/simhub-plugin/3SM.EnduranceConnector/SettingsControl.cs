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
            panel.Children.Add(new TextBlock
            {
                Text = "Verbindt SimHub via outbound HTTPS met 3SM. Telemetry blijft adviserend en wijzigt de planning nooit automatisch.",
                Margin = new Thickness(0, 4, 0, 16),
                TextWrapping = TextWrapping.Wrap,
            });

            var centralMode = new CheckBox
            {
                Content = "Centrale 3SM-relay gebruiken (aanbevolen)",
                IsChecked = settings.UseCentralRelay,
                FontWeight = FontWeights.SemiBold,
                Margin = new Thickness(0, 4, 0, 10),
            };
            centralMode.Checked += delegate { plugin.UpdateSettings(s => s.UseCentralRelay = true); };
            centralMode.Unchecked += delegate { plugin.UpdateSettings(s => s.UseCentralRelay = false); };
            panel.Children.Add(centralMode);

            panel.Children.Add(new TextBlock { Text = "Eenmalig koppelen", FontWeight = FontWeights.Bold, Margin = new Thickness(0, 8, 0, 3) });
            panel.Children.Add(new TextBlock
            {
                Text = "Maak op de 3SM-site een tijdelijke code en vul alleen die code hieronder in. De installatie wordt aan je 3SM-account gekoppeld; race en endurance-team volgen later in de Endurance-tab.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 6),
            });
            var pairingCode = new TextBox { MinWidth = 260, MaxWidth = 420, Padding = new Thickness(8), CharacterCasing = CharacterCasing.Upper };
            panel.Children.Add(pairingCode);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 4) };
            var pairButton = new Button { Content = "Koppelen", Padding = new Thickness(14, 7, 14, 7), MinWidth = 110 };
            var unpairButton = new Button { Content = "Lokale koppeling vergeten", Padding = new Thickness(14, 7, 14, 7), Margin = new Thickness(8, 0, 0, 0), MinWidth = 170 };
            buttons.Children.Add(pairButton);
            buttons.Children.Add(unpairButton);
            panel.Children.Add(buttons);

            var binding = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 10) };
            Action refreshBinding = () =>
            {
                binding.Text = plugin.IsPaired
                    ? "Gekoppeld aan 3SM-account · klaar voor connection-test"
                    : "Nog niet gekoppeld";
            };
            refreshBinding();
            panel.Children.Add(binding);

            pairButton.Click += async delegate
            {
                pairButton.IsEnabled = false;
                unpairButton.IsEnabled = false;
                await plugin.PairAsync(pairingCode.Text);
                centralMode.IsChecked = settings.UseCentralRelay;
                pairingCode.Text = string.Empty;
                refreshBinding();
                pairButton.IsEnabled = true;
                unpairButton.IsEnabled = true;
            };
            unpairButton.Click += delegate
            {
                plugin.Unpair();
                refreshBinding();
            };

            var connection = new StackPanel();
            connection.Children.Add(new TextBlock { Text = "Productierelay: https://api.3stripemotorsport.cc/functions/v1 (vastgezet om tokenlekken te voorkomen)", TextWrapping = TextWrapping.Wrap });
            AddText(connection, "Connector-ID", settings.ConnectorId, value => plugin.UpdateSettings(s => s.ConnectorId = value));
            AddText(connection, "Interval in milliseconden (minimaal 500)", settings.SendIntervalMilliseconds.ToString(), value =>
            {
                int parsed;
                if (int.TryParse(value, out parsed)) plugin.UpdateSettings(s => s.SendIntervalMilliseconds = Math.Max(500, parsed));
            });
            panel.Children.Add(new Expander { Header = "Geavanceerde verbindingsinstellingen", Content = connection, Margin = new Thickness(0, 10, 0, 0) });

            var local = new StackPanel();
            local.Children.Add(new TextBlock { Text = "Alleen voor lokale ontwikkeling/simulator. Zet centrale relay hierboven uit.", TextWrapping = TextWrapping.Wrap });
            AddText(local, "Lokale bridge-URL", settings.BridgeUrl, value => plugin.UpdateSettings(s => s.BridgeUrl = value));
            AddPassword(local, "Lokaal pairingtoken", settings.PairingToken, value => plugin.UpdateSettings(s => s.PairingToken = value));
            AddText(local, "Lokaal event-ID", settings.EventId, value => plugin.UpdateSettings(s => s.EventId = value));
            AddText(local, "Lokaal team-ID", settings.TeamId, value => plugin.UpdateSettings(s => s.TeamId = value));
            AddText(local, "Lokaal coureur-ID", settings.DriverId, value => plugin.UpdateSettings(s => s.DriverId = value));
            panel.Children.Add(new Expander { Header = "Lokale bridgefallback", Content = local, Margin = new Thickness(0, 10, 0, 0) });

            var mappings = new StackPanel();
            AddText(mappings, "Snelheid", settings.SpeedProperty, value => plugin.UpdateSettings(s => s.SpeedProperty = value));
            AddText(mappings, "Huidige ronde", settings.LapProperty, value => plugin.UpdateSettings(s => s.LapProperty = value));
            AddText(mappings, "Voltooide ronden", settings.CompletedLapsProperty, value => plugin.UpdateSettings(s => s.CompletedLapsProperty = value));
            AddText(mappings, "Rondetijd", settings.LapTimeProperty, value => plugin.UpdateSettings(s => s.LapTimeProperty = value));
            AddText(mappings, "Positie", settings.PositionProperty, value => plugin.UpdateSettings(s => s.PositionProperty = value));
            AddText(mappings, "Klassepositie", settings.ClassPositionProperty, value => plugin.UpdateSettings(s => s.ClassPositionProperty = value));
            AddText(mappings, "Brandstof", settings.FuelProperty, value => plugin.UpdateSettings(s => s.FuelProperty = value));
            AddText(mappings, "Brandstof per ronde", settings.FuelPerLapProperty, value => plugin.UpdateSettings(s => s.FuelPerLapProperty = value));
            AddText(mappings, "Geschatte resterende ronden", settings.EstimatedLapsProperty, value => plugin.UpdateSettings(s => s.EstimatedLapsProperty = value));
            AddText(mappings, "Pitlane", settings.PitLaneProperty, value => plugin.UpdateSettings(s => s.PitLaneProperty = value));
            AddText(mappings, "Pitlimiter", settings.PitLimiterProperty, value => plugin.UpdateSettings(s => s.PitLimiterProperty = value));
            AddText(mappings, "Incidenten", settings.IncidentsProperty, value => plugin.UpdateSettings(s => s.IncidentsProperty = value));
            AddText(mappings, "Vlag", settings.FlagProperty, value => plugin.UpdateSettings(s => s.FlagProperty = value));
            AddText(mappings, "Sessietijd", settings.SessionTimeProperty, value => plugin.UpdateSettings(s => s.SessionTimeProperty = value));
            AddText(mappings, "Huidige coureur-ID", settings.CurrentDriverIdProperty, value => plugin.UpdateSettings(s => s.CurrentDriverIdProperty = value));
            AddText(mappings, "Huidige coureurnaam", settings.CurrentDriverNameProperty, value => plugin.UpdateSettings(s => s.CurrentDriverNameProperty = value));
            AddText(mappings, "Auto-ID", settings.CarIdProperty, value => plugin.UpdateSettings(s => s.CarIdProperty = value));
            AddText(mappings, "Autonaam", settings.CarNameProperty, value => plugin.UpdateSettings(s => s.CarNameProperty = value));
            AddText(mappings, "Circuitnaam", settings.TrackNameProperty, value => plugin.UpdateSettings(s => s.TrackNameProperty = value));
            AddText(mappings, "Circuitconfiguratie", settings.TrackConfigProperty, value => plugin.UpdateSettings(s => s.TrackConfigProperty = value));
            panel.Children.Add(new Expander { Header = "Geavanceerde SimHub-propertymapping", Content = mappings, Margin = new Thickness(0, 10, 0, 0) });

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
