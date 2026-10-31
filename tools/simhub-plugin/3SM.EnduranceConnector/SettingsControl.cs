using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace ThreeSM.EnduranceConnector
{
    // 3SM instellingen-UI in DNR-achtige stijl: dark theme, oranje accent, sidebar
    // met icoon+label en accent-selectie, card-gebaseerde content en live preview.
    // Originele implementatie (geen DNR-code gekopieerd).
    public sealed class SettingsControl : UserControl
    {
        private readonly EnduranceConnectorPlugin _plugin;
        private Grid _content;
        private readonly List<UIElement> _panes = new List<UIElement>();

        public SettingsControl(EnduranceConnectorPlugin plugin)
        {
            _plugin = plugin;
            try { Resources.MergedDictionaries.Add(Theme.Dictionary()); } catch { /* valt terug op default-stijl */ }

            // ---------- Sidebar ----------
            var sidebarStack = new StackPanel { Margin = new Thickness(0, 6, 0, 10) };
            var wordmark = new Image
            {
                Source = EnduranceConnectorPlugin.LoadImageResource("Assets.wordmark.png"),
                Stretch = Stretch.Uniform, Margin = new Thickness(16, 16, 16, 6), MaxHeight = 64, HorizontalAlignment = HorizontalAlignment.Left,
            };
            sidebarStack.Children.Add(wordmark);
            sidebarStack.Children.Add(new TextBlock { Text = "v" + _plugin.InstalledVersion, Foreground = UiKit.Muted, FontSize = 11, Margin = new Thickness(18, 0, 16, 14) });

            var navDefs = new[] { ("⛓", "Koppeling"), ("◉", "Status"), ("↑", "Updates") };
            for (var i = 0; i < navDefs.Length; i++)
            {
                var index = i;
                sidebarStack.Children.Add(UiKit.NavItem(navDefs[i].Item1, navDefs[i].Item2, i == 0, () => SelectPane(index)));
            }

            var sidebar = new Border { Width = 216, Background = UiKit.Surface, BorderBrush = UiKit.Border, BorderThickness = new Thickness(0, 0, 1, 0) };
            sidebar.Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = sidebarStack };

            // ---------- Content ----------
            _content = new Grid { Background = UiKit.Bg };
            _panes.Add(ScrollPane(BuildKoppelingPane()));
            _panes.Add(ScrollPane(BuildStatusPane()));
            _panes.Add(ScrollPane(BuildUpdatesPane()));
            foreach (var pane in _panes) { Grid.SetColumn(pane, 1); _content.Children.Add(pane); }
            for (var i = 1; i < _panes.Count; i++) _panes[i].Visibility = Visibility.Collapsed;

            // ---------- Root ----------
            var root = new Grid { Background = UiKit.Bg };
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(216) });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(sidebar, 0);
            Grid.SetColumn(_content, 1);
            root.Children.Add(sidebar);
            root.Children.Add(_content);
            Content = root;
        }

        private void SelectPane(int index)
        {
            if (_content == null) return;
            for (var i = 0; i < _panes.Count; i++)
                _panes[i].Visibility = (i == index) ? Visibility.Visible : Visibility.Collapsed;
            UiKit.AnimateIn(_panes[index]);
        }

        private static Border ScrollPane(UIElement content)
        {
            var stack = new StackPanel { Margin = new Thickness(26, 22, 26, 24) };
            if (content is Panel panel)
            {
                var children = new List<UIElement>();
                foreach (UIElement child in panel.Children) children.Add(child);
                foreach (var child in children) { panel.Children.Remove(child); stack.Children.Add(child); }
            }
            else stack.Children.Add(content);
            return new Border { Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = stack } };
        }

        // ================= Koppeling =================
        private StackPanel BuildKoppelingPane()
        {
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Header("Koppel je SimHub", "Eenmalig instellen. Daarna herkent 3SM dit apparaat automatisch."));

            var pairingCard = new Border { BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(16), Margin = new Thickness(0, 0, 0, 14) };
            var statusGrid = new Grid();
            statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(54) });
            statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var statusIcon = new Border { Width = 42, Height = 42, CornerRadius = new CornerRadius(21), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            var statusIconText = new TextBlock { FontSize = 20, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            statusIcon.Child = statusIconText;
            Grid.SetColumn(statusIcon, 0);
            statusGrid.Children.Add(statusIcon);
            var pairingStack = new StackPanel();
            var pairingEyebrow = UiKit.Eyebrow("Apparaatstatus");
            var pairingTitle = new TextBlock { FontSize = 18, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 5, 0, 4) };
            var pairingDetail = UiKit.Sub(string.Empty);
            pairingStack.Children.Add(pairingEyebrow);
            pairingStack.Children.Add(pairingTitle);
            pairingStack.Children.Add(pairingDetail);
            Grid.SetColumn(pairingStack, 1);
            statusGrid.Children.Add(pairingStack);
            pairingCard.Child = statusGrid;
            stack.Children.Add(pairingCard);

            var setupStack = new StackPanel();
            setupStack.Children.Add(UiKit.Eyebrow("In drie stappen gekoppeld"));
            setupStack.Children.Add(StepRow("1", "Maak een koppelcode", "Open de 3SM-site en maak in de Endurance-tab een tijdelijke code."));
            setupStack.Children.Add(StepRow("2", "Vul de code hieronder in", "De code bestaat uit 8 tekens en kan maar één keer worden gebruikt."));
            setupStack.Children.Add(StepRow("3", "Koppel dit apparaat", "Race- en teamtoewijzing beheer je later centraal op de 3SM-site."));
            var codeLabel = new TextBlock { Text = "TIJDELIJKE KOPPELCODE", Foreground = UiKit.Muted, FontSize = 11, FontWeight = FontWeights.Bold, Margin = new Thickness(0, 10, 0, 5) };
            setupStack.Children.Add(codeLabel);
            var pairingCode = new TextBox
            {
                Width = 360, MaxLength = 12, Padding = new Thickness(12, 9, 12, 9), CharacterCasing = CharacterCasing.Upper, TextAlignment = TextAlignment.Center,
                FontFamily = new FontFamily("Consolas"), FontSize = 21, FontWeight = FontWeights.Bold, Background = UiKit.Bg, Foreground = UiKit.Text,
                BorderBrush = UiKit.Accent, BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left, CaretBrush = UiKit.Text,
            };
            setupStack.Children.Add(pairingCode);
            var pairButton = UiKit.Primary("APPARAAT KOPPELEN");
            pairButton.HorizontalAlignment = HorizontalAlignment.Left;
            setupStack.Children.Add(pairButton);
            var note = UiKit.Sub("🔒 De code wordt rechtstreeks met de beveiligde 3SM-relay uitgewisseld en niet lokaal opgeslagen.");
            note.Margin = new Thickness(0, 6, 0, 0);
            setupStack.Children.Add(note);
            var setupCard = UiKit.Card(setupStack, "Verbinden");
            stack.Children.Add(setupCard);

            var optionsStack = new StackPanel();
            var diagnostics = UiKit.Toggle("Remote diagnostics inschakelen", _plugin.Settings != null && _plugin.Settings.DiagnosticsEnabled, v => { _plugin.UpdateSettings(s => s.DiagnosticsEnabled = v); _plugin.ApplyDiagnosticsSettings(); });
            optionsStack.Children.Add(diagnostics);
            var extended = UiKit.Toggle("Uitgebreide Pitwall-telemetrie", _plugin.Settings != null && _plugin.Settings.ExtendedPitwallTelemetryEnabled, v => _plugin.UpdateSettings(s => s.ExtendedPitwallTelemetryEnabled = v));
            optionsStack.Children.Add(extended);
            var tyres = UiKit.Toggle("Bandenmeting meesturen", _plugin.Settings != null && _plugin.Settings.TyreTelemetryEnabled, v => _plugin.UpdateSettings(s => s.TyreTelemetryEnabled = v));
            optionsStack.Children.Add(tyres);
            // 0.7.2.0: standaard aan (ontbrekende sleutel = aan). Alleen uitzetten als een
            // machine bewust geen eigen iRacing-lezer naast SimHub wil.
            var irSdk = UiKit.Toggle("iRacing-kanalen rechtstreeks lezen (wielsnelheid, remdruk, stuurhoek)", _plugin.Settings != null && _plugin.Settings.IrSdkDirectRead, v => _plugin.UpdateSettings(s => s.IrSdkDirectReadEnabled = v));
            optionsStack.Children.Add(irSdk);
            var unpairButton = UiKit.DangerButton("Koppeling verwijderen");
            unpairButton.HorizontalAlignment = HorizontalAlignment.Left;
            optionsStack.Children.Add(unpairButton);
            stack.Children.Add(UiKit.Card(optionsStack, "Opties"));

            Action refreshBinding = delegate
            {
                var paired = _plugin.IsPaired;
                pairingCard.Background = paired ? UiKit.B("#12291F") : UiKit.B("#2A2013");
                pairingCard.BorderBrush = paired ? UiKit.Ok : UiKit.Warn;
                statusIcon.Background = paired ? UiKit.B("#1E4D38") : UiKit.B("#4A3A1C");
                statusIconText.Foreground = paired ? UiKit.Ok : UiKit.Warn;
                statusIconText.Text = paired ? "✓" : "!";
                pairingEyebrow.Foreground = paired ? UiKit.Ok : UiKit.Warn;
                pairingTitle.Foreground = paired ? UiKit.Ok : UiKit.Warn;
                pairingTitle.Text = paired ? "Gekoppeld en klaar voor gebruik" : "Dit apparaat is nog niet gekoppeld";
                pairingDetail.Text = paired
                    ? "Telemetry kan veilig via de centrale 3SM-relay worden verstuurd."
                    : "Koppel SimHub met een tijdelijke 3SM-code. Zonder koppeling wordt geen telemetry verstuurd.";
                setupCard.Visibility = paired ? Visibility.Collapsed : Visibility.Visible;
                pairingCode.IsEnabled = !paired;
                pairButton.IsEnabled = !paired;
                unpairButton.Visibility = paired ? Visibility.Visible : Visibility.Collapsed;
            };
            refreshBinding();

            pairButton.Click += async delegate
            {
                pairButton.IsEnabled = false;
                await _plugin.PairAsync(pairingCode.Text);
                pairingCode.Text = string.Empty;
                refreshBinding();
            };
            unpairButton.Click += delegate { _plugin.Unpair(); refreshBinding(); };

            return stack;
        }

        // ================= Status =================
        private StackPanel BuildStatusPane()
        {
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Header("Status", "Wat de connector lokaal uitleest en succesvol naar 3SM heeft verzonden."));

            var conn = new StackPanel();
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 15, Foreground = UiKit.Text, Margin = new Thickness(0, 4, 0, 3) };
            status.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding("Status") { Source = _plugin });
            conn.Children.Add(status);
            var pairingState = new TextBlock();
            var style = new Style(typeof(TextBlock));
            style.Setters.Add(new Setter(TextBlock.TextProperty, "Nog niet gekoppeld aan de 3SM-site"));
            style.Setters.Add(new Setter(TextBlock.ForegroundProperty, UiKit.Warn));
            var trigger = new System.Windows.DataTrigger { Binding = new System.Windows.Data.Binding("IsPaired") { Source = _plugin }, Value = true };
            trigger.Setters.Add(new Setter(TextBlock.TextProperty, "✓ Gekoppeld met de 3SM-site"));
            trigger.Setters.Add(new Setter(TextBlock.ForegroundProperty, UiKit.Ok));
            style.Triggers.Add(trigger);
            pairingState.Style = style;
            conn.Children.Add(pairingState);
            conn.Children.Add(new Border { Height = 1, Background = UiKit.Border, Margin = new Thickness(0, 12, 0, 10) });
            conn.Children.Add(UiKit.InfoRow("Route", "Centrale 3SM-relay via HTTPS · api.3stripemotorsport.cc"));
            conn.Children.Add(UiKit.InfoRow("Zonder koppeling", "Lokaal op deze pc · 127.0.0.1:8787 (verlaat het apparaat niet)"));
            conn.Children.Add(UiKit.InfoRow("Authenticatie", "Beveiligd apparaat-token"));
            conn.Children.Add(UiKit.InfoRow("Updates", "RSA-ondertekend en SHA-256 gecontroleerd"));
            stack.Children.Add(UiKit.Card(conn, "Centrale verbinding"));

            var tel = new StackPanel();
            var summary = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = UiKit.Text, FontFamily = new FontFamily("Consolas"), FontSize = 12.5, LineHeight = 20, Margin = new Thickness(0, 8, 0, 0) };
            summary.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding("LastTelemetrySummary") { Source = _plugin });
            tel.Children.Add(summary);
            stack.Children.Add(UiKit.Card(tel, "Laatst verzonden telemetry"));

            return stack;
        }

        // ================= Updates =================
        private StackPanel BuildUpdatesPane()
        {
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Header("Updates", "Controleer veilig op een nieuwe pluginversie en installeer die met gecontroleerde SimHub-herstart."));

            var updateStack = new StackPanel();
            updateStack.Children.Add(new TextBlock { Text = "Geïnstalleerde versie: " + _plugin.InstalledVersion, Foreground = UiKit.Text, Margin = new Thickness(0, 4, 0, 6) });
            var updateStatus = UiKit.Sub(string.Empty);
            updateStatus.Margin = new Thickness(0, 0, 0, 10);
            updateStatus.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding("UpdateStatus") { Source = _plugin });
            updateStack.Children.Add(updateStatus);
            var buttons = new WrapPanel();
            var install = UiKit.Primary("Update installeren en SimHub herstarten");
            install.SetBinding(Button.IsEnabledProperty, new System.Windows.Data.Binding("UpdateAvailable") { Source = _plugin });
            install.Click += async delegate { await _plugin.InstallAvailableUpdateAsync(); };
            buttons.Children.Add(install);
            var check = UiKit.Secondary("Nu op updates controleren");
            check.Click += async delegate { check.IsEnabled = false; try { await _plugin.CheckForUpdateNowAsync(); } finally { check.IsEnabled = true; } };
            buttons.Children.Add(check);
            updateStack.Children.Add(buttons);
            var autoWrap = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
            autoWrap.Children.Add(UiKit.Toggle(
                "Automatisch bijwerken (download op de achtergrond, installeren op een veilig moment)",
                _plugin.Settings == null || _plugin.Settings.AutoUpdateEnabled,
                v => _plugin.UpdateSettings(s => s.AutoUpdateEnabled = v)));
            updateStack.Children.Add(autoWrap);
            var autoNote = UiKit.Sub("Downloadt stil op de achtergrond en installeert nooit tijdens een game: bij het starten van SimHub of pas na 30 minuten zonder game, met maximaal één automatische herstart per 24 uur. Windows vraagt nog om bevestiging.");
            autoNote.Margin = new Thickness(0, 2, 0, 0);
            updateStack.Children.Add(autoNote);
            stack.Children.Add(UiKit.Card(updateStack, "Pluginupdate"));

            return stack;
        }

        private static Border StepRow(string number, string title, string detail)
        {
            var grid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(38) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var badge = new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(14), Background = UiKit.B("#2A1E15"), BorderBrush = UiKit.Accent, BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            badge.Child = new TextBlock { Text = number, Foreground = UiKit.AccentSoft, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(badge, 0);
            grid.Children.Add(badge);
            var copy = new StackPanel();
            copy.Children.Add(new TextBlock { Text = title, Foreground = UiKit.Text, FontWeight = FontWeights.SemiBold, FontSize = 13 });
            copy.Children.Add(new TextBlock { Text = detail, Foreground = UiKit.Muted, TextWrapping = TextWrapping.Wrap, FontSize = 12, Margin = new Thickness(0, 2, 0, 0) });
            Grid.SetColumn(copy, 1);
            grid.Children.Add(copy);
            return new Border { Child = grid };
        }
    }
}
