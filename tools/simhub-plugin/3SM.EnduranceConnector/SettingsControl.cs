using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// 3SM-stijl instellingenpaneel: donker thema + oranje accent, met een zijbalk-menu
    /// dat de bestaande instellingen groepeert. Functionele logica is identiek aan de
    /// oude lijst; alleen de presentatie is herwerkt. De plugin blijft een pure data-zender.
    /// </summary>
    public sealed class SettingsControl : UserControl
    {
        private static readonly SolidColorBrush Bg            = Brush("#17181C");
        private static readonly SolidColorBrush PanelBg       = Brush("#1F2127");
        private static readonly SolidColorBrush PanelBgAlt    = Brush("#262932");
        private static readonly SolidColorBrush BorderColor   = Brush("#2E323E");
        private static readonly SolidColorBrush TextMain      = Brush("#F4F5F7");
        private static readonly SolidColorBrush TextMuted     = Brush("#9AA1B0");
        private static readonly SolidColorBrush Accent        = Brush("#FF6B1A");
        private static readonly SolidColorBrush AccentText    = Brush("#FF9A5C");
        private static readonly SolidColorBrush StatusOk      = Brush("#3DD68C");
        private static readonly SolidColorBrush StatusWarn    = Brush("#FFC24B");

        private static SolidColorBrush Brush(string hex)
        {
            var color = (Color)ColorConverter.ConvertFromString(hex);
            return new SolidColorBrush(color);
        }

        private static Thickness T(double all) { return new Thickness(all); }
        private static Thickness T(double h, double v) { return new Thickness(h, v, h, v); }

        private readonly EnduranceConnectorPlugin _plugin;

        public SettingsControl(EnduranceConnectorPlugin plugin)
        {
            _plugin = plugin;

            // ---------- Zijbalk ----------
            var sidebar = new Border { Width = 210, Background = Bg, BorderBrush = BorderColor, BorderThickness = new Thickness(0, 0, 1, 0) };
            var sidebarStack = new StackPanel();

            // Logo / branding
            var wordmark = new Image { Source = EnduranceConnectorPlugin.LoadImageResource("Assets.wordmark.png"), Stretch = Stretch.Uniform, Margin = new Thickness(14, 16, 14, 18), MaxHeight = 78, HorizontalAlignment = HorizontalAlignment.Left };
            sidebarStack.Children.Add(wordmark);

            var navItems = new[] { ("Koppeling", "⛓"), ("Verbinding", "●"), ("Status", "◉"), ("Updates", "↑") };
            for (int i = 0; i < navItems.Length; i++)
            {
                var paneIndex = i;
                var item = navItems[i];
                var rb = new RadioButton
                {
                    GroupName = "nav", Content = item.Item2 + "  " + item.Item1, IsChecked = (i == 0),
                    FontSize = 13, Foreground = TextMuted, Margin = new Thickness(10, 3, 10, 3),
                    Padding = new Thickness(12, 9, 12, 9), HorizontalContentAlignment = HorizontalAlignment.Left,
                };
                rb.Checked += (s, e) => { SelectPane(paneIndex); };
                sidebarStack.Children.Add(rb);
            }
            sidebar.Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = sidebarStack };

            // ---------- Inhoud (4 panes) ----------
            var content = new Grid { Background = PanelBg };
            _content = content;
            content.Children.Add(BuildKoppelingPane());
            content.Children.Add(BuildVerbindingPane());
            content.Children.Add(BuildStatusPane());
            content.Children.Add(BuildUpdatesPane());
            for (int i = 1; i < content.Children.Count; i++) content.Children[i].Visibility = Visibility.Collapsed;

            // ---------- Layout ----------
            var root = new Grid { Background = PanelBg };
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(210) });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(sidebar, 0);
            Grid.SetColumn(content, 1);
            root.Children.Add(sidebar);
            root.Children.Add(content);

            Content = root;
        }

        private Grid _content;
        private void SelectPane(int index)
        {
            if (_content == null) return;
            for (int i = 0; i < _content.Children.Count; i++)
                _content.Children[i].Visibility = (i == index) ? Visibility.Visible : Visibility.Collapsed;
        }

        // ---------- Pane: Koppeling ----------
        private Border BuildKoppelingPane()
        {
            var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 22) };
            stack.Children.Add(SectionTitle("Koppeling", "Verbind deze installatie eenmalig met je 3SM-account."));

            var pairingCard = new Border { BorderThickness = T(1), CornerRadius = new CornerRadius(8), Padding = T(14), Margin = new Thickness(0, 6, 0, 14) };
            var pairingCardStack = new StackPanel();
            var pairingEyebrow = new TextBlock { Text = "KOPPELSTATUS", FontSize = 11, FontWeight = FontWeights.Bold };
            var pairingTitle = new TextBlock { FontSize = 18, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 7, 0, 3) };
            var pairingDetail = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = TextMain };
            pairingCardStack.Children.Add(pairingEyebrow);
            pairingCardStack.Children.Add(pairingTitle);
            pairingCardStack.Children.Add(pairingDetail);
            pairingCard.Child = pairingCardStack;
            stack.Children.Add(pairingCard);

            stack.Children.Add(Block("Maak op de 3SM-site een tijdelijke code en vul alleen die code hieronder in. De installatie wordt aan je 3SM-account gekoppeld; race en endurance-team volgen later in de Endurance-tab.", 0, 2, 0, 12));

            var pairingCode = new TextBox { MinWidth = 300, MaxWidth = 420, Padding = new Thickness(8), CharacterCasing = CharacterCasing.Upper, Background = PanelBgAlt, Foreground = TextMain, BorderBrush = BorderColor };
            stack.Children.Add(pairingCode);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 10, 0, 4) };
            var pairButton = StyleAction("Koppelen");
            var unpairButton = StyleSecondary("Koppeling verwijderen");
            buttons.Children.Add(pairButton);
            buttons.Children.Add(unpairButton);
            stack.Children.Add(buttons);

            Action refreshBinding = () =>
            {
                var paired = _plugin.IsPaired;
                pairingCard.Background = paired ? Brush("#173529") : Brush("#342719");
                pairingCard.BorderBrush = paired ? StatusOk : StatusWarn;
                pairingEyebrow.Foreground = paired ? StatusOk : StatusWarn;
                pairingTitle.Foreground = paired ? StatusOk : StatusWarn;
                pairingTitle.Text = paired ? "✓ GEKOPPELD MET DE 3SM-SITE" : "NIET GEKOPPELD MET DE 3SM-SITE";
                pairingDetail.Text = paired
                    ? "Dit apparaat is veilig aan je 3SM-account gekoppeld en kan telemetry naar de centrale 3SM-relay sturen."
                    : "Maak op de 3SM-site een tijdelijke code en koppel dit apparaat voordat telemetry kan worden verstuurd.";
                pairingCode.IsEnabled = !paired;
                pairButton.IsEnabled = !paired;
                unpairButton.IsEnabled = paired;
            };
            refreshBinding();

            pairButton.Click += async delegate
            {
                pairButton.IsEnabled = false; unpairButton.IsEnabled = false;
                await _plugin.PairAsync(pairingCode.Text);
                pairingCode.Text = string.Empty;
                refreshBinding();
            };
            unpairButton.Click += delegate { _plugin.Unpair(); refreshBinding(); };

            return WrappedPane(stack);
        }

        // ---------- Pane: Verbinding ----------
        private Border BuildVerbindingPane()
        {
            var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 22) };
            stack.Children.Add(SectionTitle("Verbinding", "De connector verstuurt telemetry veilig via de centrale 3SM-relay."));

            var connectionCard = new Border { Background = PanelBgAlt, BorderBrush = BorderColor, BorderThickness = T(1), CornerRadius = new CornerRadius(8), Padding = T(14), Margin = new Thickness(0, 4, 0, 14) };
            var connectionStack = new StackPanel();
            connectionStack.Children.Add(new TextBlock { Text = "CENTRALE 3SM-RELAY", Foreground = AccentText, FontWeight = FontWeights.Bold, FontSize = 11 });
            connectionStack.Children.Add(Block("De relaybestemming, telemetryvelden en verzendinstellingen worden automatisch door 3SM beheerd. Er zijn geen lokale instellingen nodig.", 7, 0, 0, 0));
            connectionCard.Child = connectionStack;
            stack.Children.Add(connectionCard);
            return WrappedPane(stack);
        }

        // ---------- Pane: Status ----------
        private Border BuildStatusPane()
        {
            var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 22) };
            stack.Children.Add(SectionTitle("Status", "Wat de connector lokaal uitleest en succesvol naar 3SM heeft verzonden."));

            var connectionCard = new Border { Background = PanelBgAlt, BorderBrush = BorderColor, BorderThickness = T(1), CornerRadius = new CornerRadius(8), Padding = T(14), Margin = new Thickness(0, 0, 0, 12) };
            var connectionStack = new StackPanel();
            connectionStack.Children.Add(new TextBlock { Text = "VERBINDING", Foreground = AccentText, FontWeight = FontWeights.Bold, FontSize = 11 });
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 15, Foreground = TextMain, Margin = new Thickness(0, 7, 0, 3) };
            status.SetBinding(TextBlock.TextProperty, new Binding("Status") { Source = _plugin });
            connectionStack.Children.Add(status);
            var pairingState = new TextBlock();
            var pairingStateStyle = new Style(typeof(TextBlock));
            pairingStateStyle.Setters.Add(new Setter(TextBlock.TextProperty, "Nog niet gekoppeld aan de 3SM-site"));
            pairingStateStyle.Setters.Add(new Setter(TextBlock.ForegroundProperty, StatusWarn));
            var pairedTrigger = new DataTrigger { Binding = new Binding("IsPaired") { Source = _plugin }, Value = true };
            pairedTrigger.Setters.Add(new Setter(TextBlock.TextProperty, "✓ Gekoppeld met de 3SM-site"));
            pairedTrigger.Setters.Add(new Setter(TextBlock.ForegroundProperty, StatusOk));
            pairingStateStyle.Triggers.Add(pairedTrigger);
            pairingState.Style = pairingStateStyle;
            connectionStack.Children.Add(pairingState);
            connectionCard.Child = connectionStack;
            stack.Children.Add(connectionCard);

            var telemetryCard = new Border { Background = PanelBgAlt, BorderBrush = BorderColor, BorderThickness = T(1), CornerRadius = new CornerRadius(8), Padding = T(14), Margin = new Thickness(0, 0, 0, 12) };
            var telemetryStack = new StackPanel();
            telemetryStack.Children.Add(new TextBlock { Text = "LAATST VERZONDEN TELEMETRY", Foreground = AccentText, FontWeight = FontWeights.Bold, FontSize = 11 });
            var telemetry = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = TextMain, FontFamily = new FontFamily("Consolas"), FontSize = 12.5, LineHeight = 20, Margin = new Thickness(0, 8, 0, 0) };
            telemetry.SetBinding(TextBlock.TextProperty, new Binding("LastTelemetrySummary") { Source = _plugin });
            telemetryStack.Children.Add(telemetry);
            telemetryCard.Child = telemetryStack;
            stack.Children.Add(telemetryCard);

            return WrappedPane(stack);
        }

        // ---------- Pane: Updates ----------
        private Border BuildUpdatesPane()
        {
            var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 22) };
            stack.Children.Add(SectionTitle("Updates", "Controleer veilig op een nieuwe pluginversie en installeer die met gecontroleerde SimHub-herstart."));

            var updateCard = new Border { Background = PanelBgAlt, BorderBrush = BorderColor, BorderThickness = T(1), CornerRadius = new CornerRadius(8), Padding = T(14) };
            var updateStack = new StackPanel();
            updateStack.Children.Add(new TextBlock { Text = "PLUGINUPDATE", Foreground = AccentText, FontWeight = FontWeights.Bold, FontSize = 11 });
            updateStack.Children.Add(new TextBlock { Text = "Geïnstalleerde versie: " + _plugin.InstalledVersion, Foreground = TextMain, Margin = new Thickness(0, 7, 0, 2) });
            var updateStatus = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = TextMuted, Margin = new Thickness(0, 2, 0, 9) };
            updateStatus.SetBinding(TextBlock.TextProperty, new Binding("UpdateStatus") { Source = _plugin });
            updateStack.Children.Add(updateStatus);
            var updateButtons = new StackPanel { Orientation = Orientation.Horizontal };
            var installButton = StyleAction("Update installeren en SimHub herstarten");
            installButton.SetBinding(Button.IsEnabledProperty, new Binding("UpdateAvailable") { Source = _plugin });
            installButton.Click += async delegate { await _plugin.InstallAvailableUpdateAsync(); };
            updateButtons.Children.Add(installButton);

            var updateButton = StyleSecondary("Nu op updates controleren");
            updateButton.Click += async delegate
            {
                updateButton.IsEnabled = false;
                try { await _plugin.CheckForUpdateNowAsync(); }
                finally { updateButton.IsEnabled = true; }
            };
            updateButtons.Children.Add(updateButton);
            updateStack.Children.Add(updateButtons);
            updateCard.Child = updateStack;
            stack.Children.Add(updateCard);

            return WrappedPane(stack);
        }

        // ---------- Helpers ----------
        private static Border WrappedPane(UIElement child)
        {
            return new Border { Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = child } };
        }

        private static TextBlock SectionTitle(string title, string subtitle)
        {
            title = title ?? string.Empty;
            subtitle = subtitle ?? string.Empty;
            var block = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 14) };
            block.Inlines.Add(new System.Windows.Documents.Run(title + "\n") { FontSize = 20, FontWeight = FontWeights.Bold, Foreground = TextMain });
            if (subtitle.Length > 0)
                block.Inlines.Add(new System.Windows.Documents.Run(subtitle) { FontSize = 12.5, Foreground = TextMuted });
            return block;
        }

        private static TextBlock Block(string text, double top, double right, double bottom, double left)
        {
            return new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Foreground = TextMuted, Margin = new Thickness(left, top, right, bottom), FontSize = 12.5 };
        }

        private static Button StyleAction(string text)
        {
            return new Button
            {
                Content = text, Padding = new Thickness(16, 8, 16, 8), MinWidth = 120, Margin = new Thickness(0, 0, 8, 0),
                Background = Accent, Foreground = Brushes.White, FontWeight = FontWeights.Bold, BorderThickness = T(0),
            };
        }

        private static Button StyleSecondary(string text)
        {
            return new Button
            {
                Content = text, Padding = new Thickness(16, 8, 16, 8), MinWidth = 140,
                Background = PanelBgAlt, Foreground = TextMain, BorderBrush = Accent, BorderThickness = T(1),
            };
        }
    }
}