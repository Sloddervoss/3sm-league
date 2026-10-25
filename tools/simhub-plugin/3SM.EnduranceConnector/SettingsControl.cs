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

            var navDefs = new[] { ("⛓", "Koppeling"), ("◉", "Status"), ("▣", "Research"), ("↑", "Updates") };
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
            _panes.Add(ScrollPane(BuildResearchPane()));
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
            var extended = UiKit.Toggle("Uitgebreide Pitwall-telemetrie (na relay-update)", _plugin.Settings != null && _plugin.Settings.ExtendedPitwallTelemetryEnabled, v => _plugin.UpdateSettings(s => s.ExtendedPitwallTelemetryEnabled = v));
            optionsStack.Children.Add(extended);
            var tyres = UiKit.Toggle("Bandenmeting meesturen (na relay-update)", _plugin.Settings != null && _plugin.Settings.TyreTelemetryEnabled, v => _plugin.UpdateSettings(s => s.TyreTelemetryEnabled = v));
            optionsStack.Children.Add(tyres);
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

        // ================= Research =================
        // Lokale opname, standaard uit. Alles wat hier staat is bediening van de recorder;
        // de opname zelf draait op de telemetrythread en schrijft via een eigen wachtrij.
        private StackPanel BuildResearchPane()
        {
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Header("Research-opname",
                "Legt telemetrie lokaal vast voor onderzoek. Standaard uit; niets verlaat dit apparaat vanzelf."));

            var record = new StackPanel();
            record.Children.Add(UiKit.Toggle("Research-opname inschakelen (lokaal)",
                _plugin.Settings != null && _plugin.Settings.ResearchEnabled,
                value => _plugin.SetResearchEnabled(value)));

            var statusText = new TextBlock
            {
                TextWrapping = TextWrapping.Wrap,
                FontFamily = new FontFamily("Consolas"),
                FontSize = 12.5,
                LineHeight = 19,
                Foreground = UiKit.Text,
                Margin = new Thickness(0, 10, 0, 0),
            };
            statusText.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding("ResearchStatusText") { Source = _plugin });
            record.Children.Add(statusText);

            var buttons = new WrapPanel { Margin = new Thickness(0, 10, 0, 0) };
            var pause = UiKit.Secondary("Pauzeren");
            pause.Click += delegate { _plugin.SetResearchPaused(true); };
            var resume = UiKit.Secondary("Hervatten");
            resume.Click += delegate { _plugin.SetResearchPaused(false); };
            var export = UiKit.Secondary("Exporteren…");
            export.Click += delegate { ExportResearchSession(); };
            var remove = UiKit.DangerButton("Researchdata verwijderen");
            remove.Click += delegate
            {
                var answer = MessageBox.Show(
                    "Alle lokale researchbestanden op deze pc worden verwijderd, inclusief de salt waarmee de pseudonieme ID wordt gemaakt.\n\nDoorgaan?",
                    "Researchdata verwijderen", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (answer == MessageBoxResult.Yes) _plugin.DeleteResearchData();
            };
            buttons.Children.Add(pause);
            buttons.Children.Add(resume);
            buttons.Children.Add(export);
            buttons.Children.Add(remove);
            record.Children.Add(buttons);
            stack.Children.Add(UiKit.Card(record, "Opname"));

            var markers = new StackPanel();
            var combo = UiKit.Combo(false, 260);
            foreach (var name in ResearchEventNames.All) combo.Items.Add(name);
            combo.SelectedIndex = 0;
            markers.Children.Add(UiKit.RowControl("Protocolmarker", combo, "Zet een herhaalbare marker in hetzelfde JSONL-bestand."));
            var mark = UiKit.Primary("MARKER PLAATSEN");
            mark.HorizontalAlignment = HorizontalAlignment.Left;
            mark.Click += delegate
            {
                ResearchEventKind kind;
                if (!ResearchEventNames.TryParse(combo.SelectedItem as string, out kind)) return;
                _plugin.MarkResearch(kind, "handmatig vanuit SimHub");
            };
            markers.Children.Add(mark);
            var markerNote = UiKit.Sub("Markers worden ook automatisch gezet op de flanken: garage, stint, pit entry, pitbox, bandenwissel, reset en sessie-einde.");
            markerNote.Margin = new Thickness(0, 8, 0, 0);
            markers.Children.Add(markerNote);
            stack.Children.Add(UiKit.Card(markers, "Protocol"));

            var privacy = new StackPanel();
            var privacyText = UiKit.Sub(
                "Er worden geen rijders- of teamnamen opgeslagen. De kopregel bevat een pseudonieme ID (SHA-256 van de rijders-ID met een lokale salt). " +
                "Die salt gaat nooit mee met een export. Bestanden staan lokaal en worden alleen gekopieerd als je zelf op Exporteren klikt.");
            privacy.Children.Add(privacyText);
            stack.Children.Add(UiKit.Card(privacy, "Privacy"));

            return stack;
        }

        private void ExportResearchSession()
        {
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                Title = "Research-sessie exporteren",
                Filter = "JSONL-bestand (*.jsonl)|*.jsonl|Alle bestanden (*.*)|*.*",
                FileName = "research-sessie.jsonl",
                OverwritePrompt = true,
            };
            if (dialog.ShowDialog() != true) return;
            var message = _plugin.ExportResearchSession(dialog.FileName);
            MessageBox.Show(message, "Research exporteren", MessageBoxButton.OK, MessageBoxImage.Information);
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

        private static Button TestButton(string text, Action onClick, bool primary)
        {
            var button = primary ? UiKit.Primary(text) : UiKit.Secondary(text);
            button.Click += delegate { onClick(); };
            return button;
        }

        private static string ShareCode(string payload)
        {
            return "3SM-IDLE1:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload ?? string.Empty));
        }

        private static string ParseShareCode(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return null;
            var text = code.Trim().Trim('"', '\'', '`');
            const string prefix = "3SM-IDLE1:";
            if (!text.StartsWith(prefix, StringComparison.Ordinal)) return null;
            try { return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(text.Substring(prefix.Length))); }
            catch { return null; }
        }

        private static Brush BrushFor(string colour)
        {
            if (string.IsNullOrEmpty(colour)) { var off = new SolidColorBrush(Color.FromRgb(0x16, 0x18, 0x1F)); off.Freeze(); return off; }
            try { return new SolidColorBrush((Color)ColorConverter.ConvertFromString(colour)); }
            catch { return Brushes.Black; }
        }

        private static string PenColour(int index)
        {
            switch (index)
            {
                case 1: return "#FFFFFF";
                case 2: return "#E8000D";
                case 3: return "#21468B";
                case 4: return "#00FF00";
                case 5: return "#FFFF00";
                default: return FlagIdleArt.Brand;
            }
        }

        // ---- helpers ----
        private static TextBlock Block(string text, double top, double right, double bottom, double left)
        {
            var t = UiKit.Sub(text);
            t.Margin = new Thickness(left, top, right, bottom);
            return t;
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

        private static string[] ThemeNames()
        {
            var names = new List<string>();
            for (var i = 0; i < FlagThemes.All.Length; i++) names.Add(FlagThemes.All[i].Name);
            return names.ToArray();
        }

        private static readonly string[] PaletteColours = new[]
        {
            "#FFFFFF", "#FF6B1A", "#FFAA70", "#FF1493", "#FF0000", "#E8000D",
            "#FF4500", "#FF8C00", "#FFD400", "#FFFF00", "#AEEA00", "#00FF00",
            "#00E676", "#00E5FF", "#00B0FF", "#21468B", "#0000FF", "#6A00FF",
            "#B000FF", "#FF00FF", "#8B0034", "#808080", "#C0C0C0", "#000000"
        };

        private Border ColourRow(string label, string current, Action<string> set)
        {
            var swatch = new Button { Width = 40, Height = 22, Background = BrushFor(current), BorderBrush = UiKit.Border, BorderThickness = new Thickness(1), Cursor = Cursors.Hand };
            var field = UiKit.Field(96);
            field.Text = current ?? string.Empty;
            field.LostFocus += delegate { var v = (field.Text ?? string.Empty).Trim(); set(v); swatch.Background = BrushFor(v); };

            var popup = new Popup { PlacementTarget = swatch, Placement = PlacementMode.Bottom, StaysOpen = false, AllowsTransparency = true };
            var palette = new UniformGrid { Columns = 6 };
            foreach (var c in PaletteColours)
            {
                var cc = c;
                var cellButton = new Button { Width = 22, Height = 22, Margin = new Thickness(1), Background = BrushFor(cc), BorderThickness = new Thickness(0), Cursor = Cursors.Hand };
                cellButton.Click += delegate { set(cc); field.Text = cc; swatch.Background = BrushFor(cc); popup.IsOpen = false; };
                palette.Children.Add(cellButton);
            }
            popup.Child = new Border { Background = UiKit.Surface, BorderBrush = UiKit.Border, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(4), Child = palette };
            swatch.Click += delegate { popup.IsOpen = true; };

            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(swatch);
            row.Children.Add(field);
            return new Border { Child = UiKit.Row(label, row) };
        }

        private static Border ComboRow(string label, string[] options, int selectedIndex, Action<int> set)
        {
            var combo = UiKit.Combo();
            foreach (var option in options) combo.Items.Add(option);
            combo.SelectedIndex = Math.Max(0, Math.Min(options.Length - 1, selectedIndex));
            combo.SelectionChanged += delegate { set(combo.SelectedIndex); };
            return new Border { Child = UiKit.Row(label, combo) };
        }

        private static Border HoldRow(string label, int value, int min, int max, Action<int> set)
        {
            return new Border { Child = UiKit.SliderRow(label, value, min, max, set) };
        }

        // Slider-rij met een klein LED-previewtje van het bijbehorende icoon.
        // Het paneeltje staat in een eigen kolom achter de waarde; de glyph-plaatsing
        // binnen het paneel blijft gelijk aan de echte box (FlagPanelRenderer.GlyphCentered).
        private static Border SliderPreviewRow(string label, int value, int min, int max, Action<int> set, string[] art, string colour)
        {
            var preview = UiKit.MiniPanel(RenderArt(art, colour), 8, 8, 4);
            preview.VerticalAlignment = VerticalAlignment.Center;
            preview.ToolTip = UiKit.Tip("Zo ziet dit waarschuwingsicoon er op de box uit.");
            return new Border { Child = UiKit.SliderRow(label, value, min, max, set, string.Empty, 190, preview) };
        }

        private static Border SegmentedRow(string label, string[] options, int selectedIndex, Action<int> set, string hint = null)
        {
            return new Border { Child = UiKit.RowControl(label, UiKit.Segmented(options, selectedIndex, set), hint) };
        }

        // Tekent een glyph (5x7-kunst) gecentreerd in een paneel, voor inline previews.
        private static string[] RenderArt(string[] art, string colour, int columns = 8, int rows = 8)
        {
            var leds = new string[columns * rows];
            for (var i = 0; i < leds.Length; i++) leds[i] = "#000000";
            if (art == null) return leds;
            var w = 0;
            foreach (var line in art) if (line.Length > w) w = line.Length;
            var ox = (columns - w) / 2;
            var oy = (rows - art.Length) / 2;
            if (oy < 0) oy = 0;
            for (var y = 0; y < art.Length; y++)
                for (var x = 0; x < art[y].Length; x++)
                    if (art[y][x] == '#' && ox + x >= 0 && ox + x < columns && oy + y >= 0 && oy + y < rows)
                        leds[(oy + y) * columns + ox + x] = colour;
            return leds;
        }

        private static readonly string[] LowFuelGlyph = { "####.", "#..##", "#..##", "####.", "####.", "####.", "####." };
        private static readonly string[] TempGlyph = { "..##.", "..#..", "..##.", "..#..", ".###.", "#####", ".###." };
        // Gelijk aan FlagPanelRenderer.OilArt, zodat de preview toont wat de box doet.
        private static readonly string[] OilGlyph = { "...##", "..##.", ".####", "##..#", "##..#", "##..#", ".####" };

        private static Border FieldRow(string label, string value, double width, Action<string> set)
        {
            var box = UiKit.Field(width);
            box.Text = value ?? string.Empty;
            box.LostFocus += delegate { set(box.Text); };
            return new Border { Child = UiKit.Row(label, box) };
        }

        private static List<FlagPreset> QuickPresets()
        {
            return new List<FlagPreset>
            {
                new FlagPreset { Name = "iRacing standaard", Settings = new FlagSettings() },
                new FlagPreset { Name = "Endurance", Settings = PanelBare(s => { for (var i = 0; i < 8; i++) s.Box(i).IdleScreen = 0; }) },
                new FlagPreset { Name = "Alleen vlaggen", Settings = PanelBare(s => { for (var i = 0; i < 8; i++) { var b = s.Box(i); b.Gears = false; b.ShowRedline = false; b.Spotters = false; b.Pit = false; b.TemperatureWarning = false; b.LowFuel = false; b.IdleScreen = 0; } }) },
                new FlagPreset { Name = "Strip compact", Settings = new FlagSettings { ProfileKind = "rgb", ProfileLedCount = 8 } },
            };
        }

        private static FlagSettings PanelBare(Action<FlagSettings> mutate)
        {
            var s = new FlagSettings();
            s.Box(0);
            if (mutate != null) mutate(s);
            return s;
        }
    }
}
