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
        private FlagPanelRenderer.PanelInput _previewOverride;
        private bool _raceDemo;
        private long _demoStartMs;
        private FlagPanelRenderer.PanelInput _demoInput;
        private int _selectedBoxIndex;

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

            var navDefs = new[] { ("⛓", "Koppeling"), ("⚑", "Vlaggen"), ("◉", "Status"), ("↑", "Updates") };
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
            _panes.Add(ScrollPane(BuildFlagsPane()));
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
            var extended = UiKit.Toggle("Uitgebreide Pitwall-telemetrie (na relay-update)", _plugin.Settings != null && _plugin.Settings.ExtendedPitwallTelemetryEnabled, v => _plugin.UpdateSettings(s => s.ExtendedPitwallTelemetryEnabled = v));
            optionsStack.Children.Add(extended);
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

        // ================= Vlaggen =================
        private StackPanel BuildFlagsPane()
        {
            var f = _plugin.Settings != null && _plugin.Settings.Flags != null ? _plugin.Settings.Flags : new FlagSettings();
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Header("Vlaggen", "Racevlaggen uit de game, een live paneel-preview en publicatie naar SimHub voor flagboxes en overlays."));
            stack.Children.Add(BuildPreviewCard(f));

            // Detectie
            var detect = new StackPanel();
            detect.Children.Add(UiKit.Sub("Welke vlaggen de module herkent en doorgeeft."));
            detect.Children.Add(UiKit.Toggle("Vlaggen inschakelen", f.Enabled, v => SetFlag(x => x.Enabled = v)));
            var toggles = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            toggles.Children.Add(UiKit.Toggle("Groen", f.ShowGreen, v => SetFlag(x => x.ShowGreen = v)));
            toggles.Children.Add(UiKit.Toggle("Geel", f.ShowYellow, v => SetFlag(x => x.ShowYellow = v)));
            toggles.Children.Add(UiKit.Toggle("Dubbelgeel", f.ShowDoubleYellow, v => SetFlag(x => x.ShowDoubleYellow = v)));
            toggles.Children.Add(UiKit.Toggle("Rood", f.ShowRed, v => SetFlag(x => x.ShowRed = v)));
            toggles.Children.Add(UiKit.Toggle("Blauw", f.ShowBlue, v => SetFlag(x => x.ShowBlue = v)));
            toggles.Children.Add(UiKit.Toggle("Wit", f.ShowWhite, v => SetFlag(x => x.ShowWhite = v)));
            toggles.Children.Add(UiKit.Toggle("Geruit", f.ShowCheckered, v => SetFlag(x => x.ShowCheckered = v)));
            toggles.Children.Add(UiKit.Toggle("Zwart", f.ShowBlack, v => SetFlag(x => x.ShowBlack = v)));
            toggles.Children.Add(UiKit.Toggle("Oranje", f.ShowOrange, v => SetFlag(x => x.ShowOrange = v)));
            toggles.Children.Add(UiKit.Toggle("Debris", f.ShowDebris, v => SetFlag(x => x.ShowDebris = v)));
            toggles.Children.Add(UiKit.Toggle("Safety Car", f.ShowSafetyCar, v => SetFlag(x => x.ShowSafetyCar = v)));
            toggles.Children.Add(UiKit.Toggle("Virtual Safety Car", f.ShowVirtualSafetyCar, v => SetFlag(x => x.ShowVirtualSafetyCar = v)));
            toggles.Children.Add(UiKit.Toggle("Full Course Yellow", f.ShowFullCourseYellow, v => SetFlag(x => x.ShowFullCourseYellow = v)));
            toggles.Children.Add(UiKit.Toggle("Wit (slow car)", f.ShowWhiteSlowCar, v => SetFlag(x => x.ShowWhiteSlowCar = v)));
            toggles.Children.Add(UiKit.Toggle("Wit (laatste ronde)", f.ShowWhiteFinalLap, v => SetFlag(x => x.ShowWhiteFinalLap = v)));
            detect.Children.Add(toggles);
            detect.Children.Add(HoldRow("Finishvlag vasthouden (s)", f.CheckeredHoldMs / 1000, 1, 60, v => SetFlag(x => x.CheckeredHoldMs = v * 1000)));
            detect.Children.Add(HoldRow("Wit/laatste ronde vasthouden (s)", f.WhiteFlagFinalLapDurationMs / 1000, 1, 60, v => SetFlag(x => x.WhiteFlagFinalLapDurationMs = v * 1000)));
            detect.Children.Add(HoldRow("Patroon-timing (ms)", f.FlagPhaseMs, 100, 3000, v => SetFlag(x => x.FlagPhaseMs = v)));
            detect.Children.Add(HoldRow("Vlag vasthouden bij aflopen (tikken)", f.FlagHoldTicks, 0, 30, v => SetFlag(x => x.FlagHoldTicks = v)));
            detect.Children.Add(ComboRow("Vlagprioriteit", new[] { "Normaal", "Spotter heeft voorrang" }, f.FlagsPriority == 2 ? 1 : 0, v => SetFlag(x => x.FlagsPriority = v == 1 ? 2 : 1)));
            detect.Children.Add(ComboRow("Vlaggen in de pitlane", new[] { "Tonen", "Verbergen" }, f.FlagsVisiblePits == 2 ? 1 : 0, v => SetFlag(x => x.FlagsVisiblePits = v == 1 ? 2 : 1)));
            detect.Children.Add(ComboRow("Gele vlag: sectoren", new[] { "Alle sectoren", "Alleen huidige sector" }, f.FlagsVisibleYellowSector == 2 ? 1 : 0, v => SetFlag(x => x.FlagsVisibleYellowSector = v == 1 ? 2 : 1)));
            detect.Children.Add(UiKit.Toggle("Rev gebruikt de auto-redline uit de game (RPM)", f.UseGameRedline, v => SetFlag(x => x.UseGameRedline = v)));
            stack.Children.Add(UiKit.Card(detect, "Vlagdetectie"));

            // Box-selector
            var boxSel = new StackPanel();
            boxSel.Children.Add(UiKit.Sub("4 flagboxen + 4 MLD. Alles hierna geldt per gekozen box."));
            boxSel.Children.Add(HoldRow("Aantal flagboxen (0-4)", f.BoxCount, 0, 4, v => { SetFlag(x => x.BoxCount = v); RefreshFlagsPane(); }));
            boxSel.Children.Add(HoldRow("Aantal MLD (0-4)", f.MldCount, 0, 4, v => { SetFlag(x => x.MldCount = v); RefreshFlagsPane(); }));
            var cfgCombo = UiKit.Combo();
            cfgCombo.Items.Add("Gegroepeerd (alle boxen samen)");
            cfgCombo.Items.Add("Per box");
            cfgCombo.SelectedIndex = f.ConfigurationMode == 1 ? 1 : 0;
            cfgCombo.SelectionChanged += delegate
            {
                var mode = cfgCombo.SelectedIndex;
                SetFlag(x =>
                {
                    if (mode == 0)
                    {
                        var src = x.Box(0);
                        for (var i = 1; i < 8; i++) x.Box(i).CopyDisplayFrom(src);
                    }
                    x.ConfigurationMode = mode;
                });
                RefreshFlagsPane();
            };
            boxSel.Children.Add(UiKit.Row("Configuratie", cfgCombo));
            var boxIndexMap = new List<int>();
            for (var i = 0; i < Math.Min(4, f.BoxCount); i++) boxIndexMap.Add(i);
            for (var i = 0; i < Math.Min(4, f.MldCount); i++) boxIndexMap.Add(4 + i);
            if (boxIndexMap.Count == 0) boxIndexMap.Add(0);
            if (f.ConfigurationMode == 1)
            {
                var selCombo = UiKit.Combo();
                foreach (var idx in boxIndexMap) selCombo.Items.Add(idx >= 4 ? "MLD Box " + (idx - 3) : "Flag Box " + (idx + 1));
                var selPos = boxIndexMap.IndexOf(_selectedBoxIndex);
                selCombo.SelectedIndex = selPos < 0 ? 0 : selPos;
                _selectedBoxIndex = boxIndexMap[selCombo.SelectedIndex];
                selCombo.SelectionChanged += delegate { _selectedBoxIndex = boxIndexMap[selCombo.SelectedIndex]; RefreshFlagsPane(); };
                boxSel.Children.Add(UiKit.Row("Instellen voor", selCombo));
            }
            stack.Children.Add(UiKit.Card(boxSel, "Boxen"));

            // Per-box weergave
            var b = f.Box(f.ConfigurationMode == 0 ? 0 : _selectedBoxIndex);
            var boxCard = new StackPanel();
            boxCard.Children.Add(UiKit.Toggle("Volgt universele vlaggen", b.FollowUniversal, v => SetBox(_selectedBoxIndex, x => x.FollowUniversal = v)));
            var flagToggles = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            flagToggles.Children.Add(UiKit.Toggle("Groen", b.ShowGreen, v => SetBox(_selectedBoxIndex, x => x.ShowGreen = v)));
            flagToggles.Children.Add(UiKit.Toggle("Geel", b.ShowYellow, v => SetBox(_selectedBoxIndex, x => x.ShowYellow = v)));
            flagToggles.Children.Add(UiKit.Toggle("Dubbelgeel", b.ShowDoubleYellow, v => SetBox(_selectedBoxIndex, x => x.ShowDoubleYellow = v)));
            flagToggles.Children.Add(UiKit.Toggle("Rood", b.ShowRed, v => SetBox(_selectedBoxIndex, x => x.ShowRed = v)));
            flagToggles.Children.Add(UiKit.Toggle("Blauw", b.ShowBlue, v => SetBox(_selectedBoxIndex, x => x.ShowBlue = v)));
            flagToggles.Children.Add(UiKit.Toggle("Wit", b.ShowWhite, v => SetBox(_selectedBoxIndex, x => x.ShowWhite = v)));
            flagToggles.Children.Add(UiKit.Toggle("Geruit", b.ShowCheckered, v => SetBox(_selectedBoxIndex, x => x.ShowCheckered = v)));
            flagToggles.Children.Add(UiKit.Toggle("Zwart", b.ShowBlack, v => SetBox(_selectedBoxIndex, x => x.ShowBlack = v)));
            flagToggles.Children.Add(UiKit.Toggle("Oranje", b.ShowOrange, v => SetBox(_selectedBoxIndex, x => x.ShowOrange = v)));
            flagToggles.Children.Add(UiKit.Toggle("Debris", b.ShowDebris, v => SetBox(_selectedBoxIndex, x => x.ShowDebris = v)));
            flagToggles.Children.Add(UiKit.Toggle("Safety Car", b.ShowSafetyCar, v => SetBox(_selectedBoxIndex, x => x.ShowSafetyCar = v)));
            flagToggles.Children.Add(UiKit.Toggle("VSC", b.ShowVirtualSafetyCar, v => SetBox(_selectedBoxIndex, x => x.ShowVirtualSafetyCar = v)));
            flagToggles.Children.Add(UiKit.Toggle("FCY", b.ShowFullCourseYellow, v => SetBox(_selectedBoxIndex, x => x.ShowFullCourseYellow = v)));
            flagToggles.Children.Add(UiKit.Toggle("Wit (slow)", b.ShowWhiteSlowCar, v => SetBox(_selectedBoxIndex, x => x.ShowWhiteSlowCar = v)));
            flagToggles.Children.Add(UiKit.Toggle("Wit (laatste)", b.ShowWhiteFinalLap, v => SetBox(_selectedBoxIndex, x => x.ShowWhiteFinalLap = v)));
            boxCard.Children.Add(flagToggles);
            boxCard.Children.Add(BuildFlagStyles(_selectedBoxIndex, b));
            boxCard.Children.Add(HoldRow("Helderheid (%)", b.Brightness, 0, 100, v => SetBox(_selectedBoxIndex, x => x.Brightness = v)));
            boxCard.Children.Add(ComboRow("Idle-scherm", new[] { "Uit", "Static", "Animated", "Custom" }, b.IdleScreen, v => SetBox(_selectedBoxIndex, x => x.IdleScreen = v)));
            boxCard.Children.Add(ComboRow("Idle-ontwerp", new[] { "3SM-merk (thema)", "Nederlandse vlag" }, b.IdleDesign, v => SetBox(_selectedBoxIndex, x => x.IdleDesign = v)));
            boxCard.Children.Add(ComboRow("Idle-tekening kleur (thema)", ThemeNames(), b.IdleAnimationColour, v => SetBox(_selectedBoxIndex, x => x.IdleAnimationColour = v)));
            boxCard.Children.Add(FieldRow("Idle Custom (leeg = 3SM-logo)", b.IdleCustom, 280, v => SetBox(_selectedBoxIndex, x => x.IdleCustom = (v ?? string.Empty).Trim())));
            boxCard.Children.Add(BuildIdleEditor(_selectedBoxIndex, b));
            boxCard.Children.Add(BuildIdleDesigns(f, _selectedBoxIndex, b));
            boxCard.Children.Add(UiKit.Toggle("Kritieke vlaggen knipperen (rood/zwart)", b.CriticalFlags, v => SetBox(_selectedBoxIndex, x => x.CriticalFlags = v)));
            boxCard.Children.Add(UiKit.Toggle("Gear tonen", b.Gears, v => SetBox(_selectedBoxIndex, x => x.Gears = v)));
            boxCard.Children.Add(ComboRow("Gear-thema", ThemeNames(), b.GearColour, v => SetBox(_selectedBoxIndex, x => x.GearColour = v)));
            boxCard.Children.Add(ColourRow("Redline-kleur (bij thema's)", b.RedlineColour, v => SetBox(_selectedBoxIndex, x => x.RedlineColour = v)));
            boxCard.Children.Add(ComboRow("Gear-stijl", new[] { "As shipped", "Slim", "Bold" }, b.GearStyle, v => SetBox(_selectedBoxIndex, x => x.GearStyle = v)));
            boxCard.Children.Add(ComboRow("Gear-locatie", new[] { "Rechts", "Links", "Beide" }, b.GearLocation - 1, v => SetBox(_selectedBoxIndex, x => x.GearLocation = v + 1)));
            boxCard.Children.Add(UiKit.Toggle("Gear omgekeerd (donker cijfer)", b.GearInverted, v => SetBox(_selectedBoxIndex, x => x.GearInverted = v)));
            boxCard.Children.Add(ComboRow("Redline-gedrag", new[] { "Statisch", "Knipperend" }, b.RedlineBehaviour - 1, v => SetBox(_selectedBoxIndex, x => x.RedlineBehaviour = v + 1)));
            boxCard.Children.Add(ColourRow("Custom kleur 1 (laag toeren)", b.CustomGearColour1, v => SetBox(_selectedBoxIndex, x => x.CustomGearColour1 = v)));
            boxCard.Children.Add(ColourRow("Custom kleur 2 (midden)", b.CustomGearColour2, v => SetBox(_selectedBoxIndex, x => x.CustomGearColour2 = v)));
            boxCard.Children.Add(ColourRow("Custom kleur 3 (hoog)", b.CustomGearColour3, v => SetBox(_selectedBoxIndex, x => x.CustomGearColour3 = v)));
            boxCard.Children.Add(ColourRow("Custom redline 1", b.CustomGearRedlineColour1, v => SetBox(_selectedBoxIndex, x => x.CustomGearRedlineColour1 = v)));
            boxCard.Children.Add(ColourRow("Custom redline 2", b.CustomGearRedlineColour2, v => SetBox(_selectedBoxIndex, x => x.CustomGearRedlineColour2 = v)));
            boxCard.Children.Add(ColourRow("Custom redline 3", b.CustomGearRedlineColour3, v => SetBox(_selectedBoxIndex, x => x.CustomGearRedlineColour3 = v)));
            boxCard.Children.Add(ComboRow("Custom banden", new[] { "3 banden (1-3/4-5/6+)", "2 banden (1-4/5+)" }, b.CustomGearNumColours - 1, v => SetBox(_selectedBoxIndex, x => x.CustomGearNumColours = v + 1)));
            boxCard.Children.Add(HoldRow("Redline midden (%)", b.RedlineMidPct, 0, 100, v => SetBox(_selectedBoxIndex, x => x.RedlineMidPct = v)));
            boxCard.Children.Add(HoldRow("Redline hoog (%)", b.RedlineHighPct, 0, 100, v => SetBox(_selectedBoxIndex, x => x.RedlineHighPct = v)));
            boxCard.Children.Add(HoldRow("Rev-bar startpunt (%)", b.RedlineBarStartPct, 0, 100, v => SetBox(_selectedBoxIndex, x => x.RedlineBarStartPct = v)));
            boxCard.Children.Add(UiKit.Toggle("Rev-bar tonen", b.ShowRedline, v => SetBox(_selectedBoxIndex, x => x.ShowRedline = v)));
            boxCard.Children.Add(UiKit.Toggle("Spotter", b.Spotters, v => SetBox(_selectedBoxIndex, x => x.Spotters = v)));
            boxCard.Children.Add(ComboRow("Spotter-zijde", new[] { "Beide (dubbelpijl)", "Links (pijl links)", "Rechts (pijl rechts)" }, b.SpotterSide - 1, v => SetBox(_selectedBoxIndex, x => x.SpotterSide = v + 1)));
            boxCard.Children.Add(ComboRow("Spotter-modus", new[] { "Vervangt gear", "Over de gear", "Wisselt met gear (knipperend)" }, b.SpotterMode, v => SetBox(_selectedBoxIndex, x => x.SpotterMode = v)));
            boxCard.Children.Add(UiKit.Toggle("Gear wijkt voor de spotterpijl", b.SpotterShiftsGear, v => SetBox(_selectedBoxIndex, x => x.SpotterShiftsGear = v)));
            boxCard.Children.Add(ComboRow("Spotter-animatie", new[] { "Statisch (hoek)", "Glijdt van links naar rechts / rechts naar links" }, b.SpotterAnimation, v => SetBox(_selectedBoxIndex, x => x.SpotterAnimation = v)));
            boxCard.Children.Add(UiKit.Toggle("Spotter knippert", b.SpotterBlink, v => SetBox(_selectedBoxIndex, x => x.SpotterBlink = v)));
            boxCard.Children.Add(UiKit.Toggle("Pit-limiter", b.Pit, v => SetBox(_selectedBoxIndex, x => x.Pit = v)));
            boxCard.Children.Add(ComboRow("Pit-stijl", new[] { "Bands", "Walking light", "Flash together", "Checker", "Bounce" }, b.PitLimiterStyle, v => SetBox(_selectedBoxIndex, x => x.PitLimiterStyle = v)));
            boxCard.Children.Add(UiKit.Toggle("Pit-countdown", b.PitCountdown, v => SetBox(_selectedBoxIndex, x => x.PitCountdown = v)));
            boxCard.Children.Add(UiKit.Toggle("Ignition/engine-start animatie", b.IgnitionEngineStartupAnimation, v => SetBox(_selectedBoxIndex, x => x.IgnitionEngineStartupAnimation = v)));
            boxCard.Children.Add(ComboRow("Engine-start stijl", new[] { "Spark shower", "Fill up", "From the centre", "Pulse", "Icon" }, b.EngineStartStyle, v => SetBox(_selectedBoxIndex, x => x.EngineStartStyle = v)));
            boxCard.Children.Add(UiKit.Toggle("Temperatuur-waarschuwing", b.TemperatureWarning, v => SetBox(_selectedBoxIndex, x => x.TemperatureWarning = v)));
            boxCard.Children.Add(UiKit.Toggle("Low-fuel waarschuwing", b.LowFuel, v => SetBox(_selectedBoxIndex, x => x.LowFuel = v)));
            boxCard.Children.Add(HoldRow("Matrixpositie (0=auto)", b.MatrixPosition, 0, 8, v => SetBoxDevice(_selectedBoxIndex, x => x.MatrixPosition = v)));
            // Device-target: "device:naam" of "arduino:1..4" (één slot per device).
            var targetOptions = new List<string> { "Niet ingesteld" };
            var targetKeys = new List<string> { string.Empty };
            foreach (var name in SimHubDeviceLister.List(_plugin.PluginManager))
            {
                if (string.Equals(name, "Arduino RGB Matrix", StringComparison.OrdinalIgnoreCase)) continue;
                targetOptions.Add(name);
                targetKeys.Add("device:" + name);
            }
            for (var p = 1; p <= 4; p++) { targetOptions.Add("Arduino RGB Matrix · matrix " + p); targetKeys.Add("arduino:" + p); }
            var currentKey = b.TargetKey ?? string.Empty;
            var currentIdx = targetKeys.IndexOf(currentKey);
            if (currentIdx < 0) { targetOptions.Add(currentKey + " (niet in SimHub nu)"); targetKeys.Add(currentKey); currentIdx = targetKeys.Count - 1; }
            var targetCombo = UiKit.Combo();
            foreach (var option in targetOptions) targetCombo.Items.Add(option);
            targetCombo.SelectedIndex = Math.Max(0, currentIdx);
            targetCombo.SelectionChanged += delegate
            {
                var key = targetKeys[Math.Max(0, Math.Min(targetKeys.Count - 1, targetCombo.SelectedIndex))];
                SetFlag(x =>
                {
                    if (!string.IsNullOrEmpty(key))
                        for (var i = 0; i < 8; i++)
                            if (i != _selectedBoxIndex && string.Equals(x.Box(i).TargetKey, key, StringComparison.Ordinal)) x.Box(i).TargetKey = string.Empty;
                    var slot = x.Box(_selectedBoxIndex);
                    slot.TargetKey = key;
                    slot.DeviceName = key.StartsWith("device:", StringComparison.Ordinal) ? key.Substring(7)
                                    : key.StartsWith("arduino:", StringComparison.Ordinal) ? "Arduino RGB Matrix" : string.Empty;
                });
            };
            boxCard.Children.Add(UiKit.Row("Device", targetCombo));
            stack.Children.Add(UiKit.Card(boxCard, (b.IsMld ? "MLD Box " + (_selectedBoxIndex - 3) : "Flag Box " + (_selectedBoxIndex + 1)) + " — weergave"));

            // Globaal: drempels + penalty
            var glob = new StackPanel();
            glob.Children.Add(HoldRow("Water-waarschuwing (°C)", f.TempWarnWater, 0, 200, v => SetFlag(x => x.TempWarnWater = v)));
            glob.Children.Add(HoldRow("Olie-waarschuwing (°C)", f.TempWarnOil, 0, 250, v => SetFlag(x => x.TempWarnOil = v)));
            glob.Children.Add(HoldRow("Low-fuel drempel (%)", f.LowFuelPercent, 0, 100, v => SetFlag(x => x.LowFuelPercent = v)));
            glob.Children.Add(HoldRow("Penalty-waarschuwing vasthouden (s)", f.PenaltyWarningDuration, 1, 60, v => SetFlag(x => x.PenaltyWarningDuration = v)));
            glob.Children.Add(ColourRow("Spotter-kleur", f.SpotterColour, v => SetFlag(x => x.SpotterColour = v)));
            glob.Children.Add(UiKit.Toggle("Redline alleen knipperen in de hoogste versnelling", f.LastGearRedlineOnly, v => SetFlag(x => x.LastGearRedlineOnly = v)));
            glob.Children.Add(UiKit.Toggle("Universeel thema (één thema over alle boxen)", f.UniversalTheme, v => SetFlag(x => x.UniversalTheme = v)));
            glob.Children.Add(ComboRow("Universeel thema", ThemeNames(), f.UniversalThemeId, v => SetFlag(x => x.UniversalThemeId = v)));
            glob.Children.Add(ComboRow("Blauwe-vlag stijl (overlay)", new[] { "Klassiek", "Met klasse", "Met klasse + positie" }, f.BlueFlagStyle, v => SetFlag(x => x.BlueFlagStyle = v)));
            glob.Children.Add(UiKit.Toggle("Overlay: donkere modus", f.OverlayDarkMode, v => SetFlag(x => x.OverlayDarkMode = v)));
            glob.Children.Add(UiKit.Toggle("Overlay: vlag-animatie", f.OverlayShowAnimation, v => SetFlag(x => x.OverlayShowAnimation = v)));
            stack.Children.Add(UiKit.Card(glob, "Globaal"));

            // SimHub / flagbox publicatie
            var pub = new StackPanel();
            pub.Children.Add(UiKit.Toggle("Publiceer vlag-properties", f.PublishProperties, v => SetFlag(x => x.PublishProperties = v)));
            var prefixBox = UiKit.Field(220);
            prefixBox.Text = f.PropertyPrefix ?? string.Empty;
            prefixBox.LostFocus += delegate { SetFlag(x => x.PropertyPrefix = (prefixBox.Text ?? string.Empty).Trim()); };
            pub.Children.Add(UiKit.Row("Property-prefix", prefixBox));
            var pubNote = UiKit.Sub("Voorbeeld: THREESM.Flags.Red, .Primary, .Colour. Prefix-wijziging werkt na een SimHub-herstart.");
            pubNote.Margin = new Thickness(0, 2, 0, 10);
            pub.Children.Add(pubNote);
            pub.Children.Add(UiKit.Toggle("Rijke vlagvelden naar de server sturen (alleen na relay-update)", f.SendFlagFields, v => SetFlag(x => x.SendFlagFields = v)));
            stack.Children.Add(UiKit.Card(pub, "SimHub / flagbox"));

            // Flagboxen
            var boxes = new StackPanel();
            boxes.Children.Add(UiKit.Sub("Elke box leest zijn eigen properties (Box1..Box4). Koppel een SimHub-device en installeer het profiel."));
            boxes.Children.Add(HoldRow("Aantal flagboxen (0-4)", f.BoxCount, 0, 4, v => { SetFlag(x => x.BoxCount = v); RefreshFlagsPane(); }));
            var deviceNames = SimHubDeviceLister.List(_plugin.PluginManager);
            SimHub.Logging.Current.Info("3SM flags: devices=" + deviceNames.Count + (deviceNames.Count > 0 ? " (" + string.Join(", ", deviceNames) + ")" : ""));
            for (var i = 0; i < 4; i++) boxes.Children.Add(BuildBoxSlot(i, f, deviceNames));
            boxes.Children.Add(HoldRow("Profiel gebruikt Box (1-4)", f.ProfileBoxIndex, 1, 4, v => { SetFlag(x => x.ProfileBoxIndex = v); RefreshFlagsPane(); }));
            var kindCombo = UiKit.Combo();
            kindCombo.Items.Add("8x8 RGB-matrix");
            kindCombo.Items.Add("RGB-LED strip");
            kindCombo.Items.Add("TM1638");
            kindCombo.SelectedIndex = string.Equals(f.ProfileKind, "rgb", StringComparison.OrdinalIgnoreCase) ? 1 : string.Equals(f.ProfileKind, "tm1638", StringComparison.OrdinalIgnoreCase) ? 2 : 0;
            kindCombo.SelectionChanged += delegate
            {
                var kind = kindCombo.SelectedIndex == 1 ? "rgb" : kindCombo.SelectedIndex == 2 ? "tm1638" : "matrix";
                SetFlag(x => x.ProfileKind = kind);
                RefreshFlagsPane();
            };
            boxes.Children.Add(UiKit.Row("Profielsoort", kindCombo));
            boxes.Children.Add(HoldRow("LEDs per strip (rgb/tm1638)", f.ProfileLedCount, 1, 300, v => { SetFlag(x => x.ProfileLedCount = v); RefreshFlagsPane(); }));
            var installButton = UiKit.Primary("Installeer flagbox-profiel");
            installButton.HorizontalAlignment = HorizontalAlignment.Left;
            installButton.Click += delegate { InstallFlagProfile(); };
            boxes.Children.Add(installButton);
            var boxNote = UiKit.Sub("Eerst live via SimHub (aanbevolen); lukt dat niet, dan in het LED-instellingenbestand met backup .3smbak.");
            boxNote.Margin = new Thickness(0, 4, 0, 0);
            boxes.Children.Add(boxNote);
            stack.Children.Add(UiKit.Card(boxes, "Flagboxen"));

            stack.Children.Add(BuildPresetsCard(f));
            return stack;
        }

        private UIElement BuildBoxSlot(int index, FlagSettings f, List<string> deviceNames)
        {
            var slot = f.Boxes != null && index < f.Boxes.Length ? f.Boxes[index] : null;
            var follow = slot == null || slot.FollowUniversal;
            var inner = new StackPanel { Margin = new Thickness(4, 4, 0, 4) };

            var combo = UiKit.Combo(true, 260);
            if (deviceNames != null) foreach (var name in deviceNames) combo.Items.Add(name);
            combo.Text = slot == null ? string.Empty : (slot.DeviceName ?? string.Empty);
            combo.LostFocus += delegate { SetBox(index, b => b.DeviceName = (combo.Text ?? string.Empty).Trim()); };
            inner.Children.Add(UiKit.Row("SimHub-device", combo));
            inner.Children.Add(UiKit.Toggle("Volgt universele vlaggen", follow, v => SetBox(index, b => b.FollowUniversal = v)));

            var sideCombo = UiKit.Combo();
            sideCombo.Items.Add("Beide zijden");
            sideCombo.Items.Add("Alleen links");
            sideCombo.Items.Add("Alleen rechts");
            var slotSide = slot == null ? 1 : slot.SpotterSide;
            sideCombo.SelectedIndex = slotSide == 2 ? 1 : slotSide == 3 ? 2 : 0;
            sideCombo.SelectionChanged += delegate
            {
                var chosen = sideCombo.SelectedIndex == 1 ? 2 : sideCombo.SelectedIndex == 2 ? 3 : 1;
                SetBox(index, b => b.SpotterSide = chosen);
            };
            inner.Children.Add(UiKit.Row("Spotter-zijde", sideCombo));

            var wrap = new WrapPanel();
            wrap.Children.Add(UiKit.Toggle("Groen", slot == null || slot.ShowGreen, v => SetBox(index, b => b.ShowGreen = v)));
            wrap.Children.Add(UiKit.Toggle("Geel", slot == null || slot.ShowYellow, v => SetBox(index, b => b.ShowYellow = v)));
            wrap.Children.Add(UiKit.Toggle("Dubbelgeel", slot == null || slot.ShowDoubleYellow, v => SetBox(index, b => b.ShowDoubleYellow = v)));
            wrap.Children.Add(UiKit.Toggle("Rood", slot == null || slot.ShowRed, v => SetBox(index, b => b.ShowRed = v)));
            wrap.Children.Add(UiKit.Toggle("Blauw", slot == null || slot.ShowBlue, v => SetBox(index, b => b.ShowBlue = v)));
            wrap.Children.Add(UiKit.Toggle("Wit", slot == null || slot.ShowWhite, v => SetBox(index, b => b.ShowWhite = v)));
            wrap.Children.Add(UiKit.Toggle("Geruit", slot == null || slot.ShowCheckered, v => SetBox(index, b => b.ShowCheckered = v)));
            wrap.Children.Add(UiKit.Toggle("Zwart", slot == null || slot.ShowBlack, v => SetBox(index, b => b.ShowBlack = v)));
            wrap.Children.Add(UiKit.Toggle("Oranje", slot == null || slot.ShowOrange, v => SetBox(index, b => b.ShowOrange = v)));
            wrap.Children.Add(UiKit.Toggle("Debris", slot == null || slot.ShowDebris, v => SetBox(index, b => b.ShowDebris = v)));
            wrap.Children.Add(UiKit.Toggle("Safety Car", slot == null || slot.ShowSafetyCar, v => SetBox(index, b => b.ShowSafetyCar = v)));
            wrap.Children.Add(UiKit.Toggle("Virtual Safety Car", slot == null || slot.ShowVirtualSafetyCar, v => SetBox(index, b => b.ShowVirtualSafetyCar = v)));
            inner.Children.Add(wrap);

            var expander = UiKit.Section("Box " + (index + 1), inner);
            expander.Expanded += delegate { UiKit.AnimateIn(inner, 6); };
            return expander;
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
            conn.Children.Add(UiKit.InfoRow("Route", "Centrale 3SM-relay via HTTPS"));
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
            stack.Children.Add(UiKit.Card(updateStack, "Pluginupdate"));

            return stack;
        }

        // ================= Live preview =================
        private Border BuildPreviewCard(FlagSettings f)
        {
            var isMatrix = string.Equals(f.ProfileKind, "matrix", StringComparison.OrdinalIgnoreCase);
            var boxCount = Math.Max(1, Math.Min(4, f.BoxCount));

            var stack = new StackPanel();
            stack.Children.Add(UiKit.Sub(isMatrix ? "8×8 RGB-matrix" : "LED-strip · " + f.ProfileLedCount + " LEDs"));

            var panelRow = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 10, 0, 6) };
            var previews = new List<Action<FlagPanelRenderer.PanelInput>>();

            for (var bi = 0; bi < boxCount; bi++)
            {
                var slot = f.Box(bi);
                int cols, rows, cell;
                if (isMatrix && slot.IsMld) { cols = 25; rows = 6; cell = 12; }
                else if (isMatrix) { cols = 8; rows = 8; cell = 32; }
                else { var n = Math.Max(1, f.ProfileLedCount); cols = Math.Min(n, 24); rows = (n + cols - 1) / cols; cell = 16; }

                var grid = new UniformGrid { Rows = rows, Columns = cols, Width = cols * cell, Height = rows * cell, HorizontalAlignment = HorizontalAlignment.Center, Background = UiKit.Bg };
                var cells = new Rectangle[cols * rows];
                for (var i = 0; i < cells.Length; i++)
                {
                    var cellRect = new Rectangle { Fill = Brushes.Black, Margin = new Thickness(1) };
                    cells[i] = cellRect;
                    grid.Children.Add(cellRect);
                }
                var frame = new Border { Background = UiKit.Bg, BorderBrush = UiKit.Border, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(8), Margin = new Thickness(6), Child = grid };

                var column = new StackPanel();
                column.Children.Add(new TextBlock { Text = slot.IsMld ? "MLD " + (bi - 3) : "Box " + (bi + 1), Foreground = UiKit.Muted, HorizontalAlignment = HorizontalAlignment.Center, FontSize = 12, Margin = new Thickness(0, 0, 0, 4) });
                column.Children.Add(frame);
                panelRow.Children.Add(column);

                var slotIndex = bi;
                previews.Add(input => FillPreview(cells, input, slotIndex, isMatrix, cols, rows, f));
            }
            stack.Children.Add(panelRow);

            // Test-knoppen (zoals DNR: vlaggen/gear bekijken zonder een game te starten).
            var tests = new WrapPanel { HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 4) };
            Action<FlagPanelRenderer.PanelInput> setTest = delegate (FlagPanelRenderer.PanelInput input) { _raceDemo = false; _previewOverride = input; };
            tests.Children.Add(TestButton("Live", delegate { _raceDemo = false; _previewOverride = null; }, true));
            tests.Children.Add(TestButton("Race (demo)", delegate { _raceDemo = true; _previewOverride = null; _demoStartMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }, false));
            tests.Children.Add(TestButton("Rood", delegate { setTest(TestInput(RaceFlags.Red)); }, false));
            tests.Children.Add(TestButton("Geel", delegate { setTest(TestInput(RaceFlags.Yellow)); }, false));
            tests.Children.Add(TestButton("Safety Car", delegate { setTest(TestInput(RaceFlags.SafetyCar)); }, false));
            tests.Children.Add(TestButton("Geruit", delegate { setTest(TestInput(RaceFlags.Checkered)); }, false));
            tests.Children.Add(TestButton("Groen", delegate { setTest(TestInput(RaceFlags.Green)); }, false));
            tests.Children.Add(TestButton("Blauw", delegate { setTest(TestInput(RaceFlags.Blue)); }, false));
            tests.Children.Add(TestButton("Zwart", delegate { setTest(TestInput(RaceFlags.Black)); }, false));
            tests.Children.Add(TestButton("Oranje", delegate { setTest(TestInput(RaceFlags.Orange)); }, false));
            tests.Children.Add(TestButton("Debris", delegate { setTest(TestInput(RaceFlags.Debris)); }, false));
            tests.Children.Add(TestButton("Gear", delegate { setTest(new FlagPanelRenderer.PanelInput { Flags = RaceFlags.None, InGame = true, Gear = "4", RpmsPercent = 88 }); }, false));
            tests.Children.Add(TestButton("Spotter L", delegate { setTest(new FlagPanelRenderer.PanelInput { Flags = RaceFlags.None, InGame = true, SpotterLeft = true, Gear = "4", RpmsPercent = 40 }); }, false));
            tests.Children.Add(TestButton("Spotter R", delegate { setTest(new FlagPanelRenderer.PanelInput { Flags = RaceFlags.None, InGame = true, SpotterRight = true, Gear = "4", RpmsPercent = 40 }); }, false));
            stack.Children.Add(tests);

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(60) };
            timer.Tick += delegate
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                FlagPanelRenderer.PanelInput input = null;
                if (_raceDemo) input = DemoInput(now);
                else if (_previewOverride != null) { _previewOverride.NowMs = now; input = _previewOverride; }
                foreach (var preview in previews) preview(input);
            };
            timer.Start();
            panelRow.Unloaded += delegate { timer.Stop(); };

            var card = UiKit.Card(stack, "Live preview");
            UiKit.AnimateIn(card);
            return card;
        }

        private void FillPreview(Rectangle[] cells, FlagPanelRenderer.PanelInput input, int slotIndex, bool isMatrix, int cols, int rows, FlagSettings f)
        {
            string[] colours;
            if (input != null)
            {
                if (isMatrix) colours = FlagPanelRenderer.Frame(cols, rows, input, f.Box(slotIndex), f);
                else
                {
                    var strip = FlagPanelRenderer.FrameStrip(f.ProfileLedCount, input, f.Box(slotIndex), f);
                    colours = new string[cols * rows];
                    for (var i = 0; i < colours.Length; i++) colours[i] = i < strip.Length ? strip[i] : "#000000";
                }
            }
            else
            {
                int fc, fr;
                colours = _plugin.BuildFlagPreview(slotIndex + 1, out fc, out fr);
            }
            if (colours == null) return;
            for (var i = 0; i < cells.Length && i < colours.Length; i++)
            {
                try { cells[i].Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString(colours[i])); }
                catch { }
            }
        }

        private static Button TestButton(string text, Action onClick, bool primary)
        {
            var button = primary ? UiKit.Primary(text) : UiKit.Secondary(text);
            button.Click += delegate { onClick(); };
            return button;
        }

        private static FlagPanelRenderer.PanelInput TestInput(RaceFlags flags)
        {
            return new FlagPanelRenderer.PanelInput { Flags = flags, InGame = true, Gear = "4", RpmsPercent = 60, NowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
        }

        // Race-demo: schakelt door de versnellingen met oplopend toerental en houdt
        // de redline even vast, zodat het redline-knipperen goed zichtbaar is.
        private FlagPanelRenderer.PanelInput DemoInput(long now)
        {
            var elapsed = now - _demoStartMs;
            const int gearMs = 2400;   // totale duur per versnelling
            const int rampMs = 1600;   // toeren opbouwen
            var gear = (int)(elapsed / gearMs) % 6 + 1;
            var phase = elapsed % gearMs;
            var pct = phase < rampMs ? 32 + (phase / (double)rampMs) * 67 : 99; // 32% -> 99% en dan vasthouden
            if (_demoInput == null) _demoInput = new FlagPanelRenderer.PanelInput();
            _demoInput.Flags = RaceFlags.None;
            _demoInput.InGame = true;
            _demoInput.Gear = gear.ToString();
            _demoInput.RpmsPercent = pct;
            _demoInput.PitLimiter = false;
            _demoInput.SpotterLeft = false;
            _demoInput.SpotterRight = false;
            _demoInput.EngineOff = false;
            _demoInput.NowMs = now;
            return _demoInput;
        }

        // ================= Presets =================
        private Border BuildPresetsCard(FlagSettings f)
        {
            var stack = new StackPanel();
            stack.Children.Add(UiKit.Sub("Snelpresets, of sla je eigen configuratie op en pas die later toe."));
            var quick = new WrapPanel { Margin = new Thickness(0, 8, 0, 6) };
            foreach (var quickPreset in QuickPresets())
            {
                var quickButton = UiKit.Secondary(quickPreset.Name);
                var captured = quickPreset;
                quickButton.Click += delegate { _plugin.UpdateSettings(s => s.Flags = captured.Settings.Clone()); RefreshFlagsPane(); };
                quick.Children.Add(quickButton);
            }
            stack.Children.Add(quick);

            var presets = _plugin.Settings != null && _plugin.Settings.FlagPresets != null ? _plugin.Settings.FlagPresets : new List<FlagPreset>();
            var combo = UiKit.Combo();
            foreach (var preset in presets) combo.Items.Add(preset.Name);
            if (combo.Items.Count > 0) combo.SelectedIndex = 0;
            stack.Children.Add(UiKit.Row("Preset", combo));
            var presetGameField = UiKit.Field(160);
            var selPreset = presets.Find(p => string.Equals(p.Name, Convert.ToString(combo.SelectedItem), StringComparison.OrdinalIgnoreCase));
            presetGameField.Text = selPreset == null ? string.Empty : (selPreset.Game ?? string.Empty);
            presetGameField.LostFocus += delegate
            {
                var n = Convert.ToString(combo.SelectedItem);
                if (string.IsNullOrEmpty(n)) return;
                var g = (presetGameField.Text ?? string.Empty).Trim();
                _plugin.UpdateSettings(s => { var p = s.FlagPresets == null ? null : s.FlagPresets.Find(x => string.Equals(x.Name, n, StringComparison.OrdinalIgnoreCase)); if (p != null) p.Game = g; });
            };
            stack.Children.Add(UiKit.Row("Game (leeg = alle)", presetGameField));
            var autoPreset = UiKit.Secondary("Game-preset toepassen");
            autoPreset.HorizontalAlignment = HorizontalAlignment.Left;
            autoPreset.Click += delegate
            {
                var game = Convert.ToString(_plugin.PluginManager == null ? null : _plugin.PluginManager.GetPropertyValue("DataCorePlugin.CurrentGame"));
                _plugin.UpdateSettings(s =>
                {
                    if (s.FlagPresets == null || s.FlagPresets.Count == 0) return;
                    var p = s.FlagPresets.Find(x => x.IsFavorite && string.Equals(x.Game ?? string.Empty, game ?? string.Empty, StringComparison.OrdinalIgnoreCase))
                         ?? s.FlagPresets.Find(x => string.Equals(x.Game ?? string.Empty, game ?? string.Empty, StringComparison.OrdinalIgnoreCase))
                         ?? s.FlagPresets.Find(x => x.IsFavorite && string.IsNullOrEmpty(x.Game))
                         ?? s.FlagPresets[0];
                    if (p != null && p.Settings != null) { s.Flags = p.Settings.Clone(); s.Flags.ActivePresetName = p.Name; }
                });
                RefreshFlagsPane();
            };
            stack.Children.Add(autoPreset);
            var nameField = UiKit.Field();
            stack.Children.Add(UiKit.Row("Naam (opslaan)", nameField));

            var buttons = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            var save = UiKit.Secondary("Opslaan");
            save.Click += delegate
            {
                var name = (nameField.Text ?? string.Empty).Trim();
                if (name.Length == 0) { MessageBox.Show("Geef de preset een naam.", "3SM", MessageBoxButton.OK, MessageBoxImage.Information); return; }
                _plugin.UpdateSettings(s =>
                {
                    if (s.FlagPresets == null) s.FlagPresets = new List<FlagPreset>();
                    var existing = s.FlagPresets.Find(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
                    if (existing != null) { existing.Settings = s.Flags.Clone(); }
                    else s.FlagPresets.Add(new FlagPreset { Name = name, Settings = s.Flags.Clone() });
                    s.Flags.ActivePresetName = name;
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(save);
            var apply = UiKit.Secondary("Toepassen");
            apply.Click += delegate
            {
                var name = Convert.ToString(combo.SelectedItem);
                if (string.IsNullOrEmpty(name)) return;
                _plugin.UpdateSettings(s => { var p = s.FlagPresets == null ? null : s.FlagPresets.Find(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)); if (p != null && p.Settings != null) { s.Flags = p.Settings.Clone(); s.Flags.ActivePresetName = p.Name; } });
                RefreshFlagsPane();
            };
            buttons.Children.Add(apply);
            var fav = UiKit.Secondary("★ Favoriet");
            fav.Click += delegate
            {
                var name = Convert.ToString(combo.SelectedItem);
                if (string.IsNullOrEmpty(name)) return;
                _plugin.UpdateSettings(s =>
                {
                    var p = s.FlagPresets == null ? null : s.FlagPresets.Find(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
                    if (p == null) return;
                    var makeFav = !p.IsFavorite;
                    if (makeFav)
                        foreach (var q in s.FlagPresets)
                            if (q != p && string.Equals(q.Game ?? string.Empty, p.Game ?? string.Empty, StringComparison.OrdinalIgnoreCase)) q.IsFavorite = false;
                    p.IsFavorite = makeFav;
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(fav);
            var export = UiKit.Secondary("Exporteren");
            export.Click += delegate
            {
                var name = Convert.ToString(combo.SelectedItem);
                var p = _plugin.Settings != null && _plugin.Settings.FlagPresets != null ? _plugin.Settings.FlagPresets.Find(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)) : null;
                if (p == null) return;
                var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "3SM-Vlaggen-" + name + ".json", Filter = "JSON|*.json" };
                if (dlg.ShowDialog() == true)
                {
                    try { System.IO.File.WriteAllText(dlg.FileName, Newtonsoft.Json.JsonConvert.SerializeObject(p, Newtonsoft.Json.Formatting.Indented)); }
                    catch (Exception ex) { MessageBox.Show("Exporteren mislukt: " + ex.Message, "3SM", MessageBoxButton.OK, MessageBoxImage.Warning); }
                }
            };
            buttons.Children.Add(export);
            var import = UiKit.Secondary("Importeren");
            import.Click += delegate
            {
                var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "JSON|*.json" };
                if (dlg.ShowDialog() != true) return;
                try
                {
                    var p = Newtonsoft.Json.JsonConvert.DeserializeObject<FlagPreset>(System.IO.File.ReadAllText(dlg.FileName));
                    if (p == null || p.Settings == null) { MessageBox.Show("Geen geldige preset.", "3SM", MessageBoxButton.OK, MessageBoxImage.Information); return; }
                    _plugin.UpdateSettings(s =>
                    {
                        if (s.FlagPresets == null) s.FlagPresets = new List<FlagPreset>();
                        var baseName = string.IsNullOrWhiteSpace(p.Name) ? "Geïmporteerd" : p.Name;
                        var candidate = baseName;
                        var k = 2;
                        while (s.FlagPresets.Exists(q => string.Equals(q.Name, candidate, StringComparison.OrdinalIgnoreCase))) candidate = baseName + " (" + (k++) + ")";
                        p.Name = candidate;
                        s.FlagPresets.Add(p);
                    });
                    RefreshFlagsPane();
                }
                catch (Exception ex) { MessageBox.Show("Importeren mislukt: " + ex.Message, "3SM", MessageBoxButton.OK, MessageBoxImage.Warning); }
            };
            buttons.Children.Add(import);
            var del = UiKit.DangerButton("Verwijderen");
            del.Click += delegate
            {
                var name = Convert.ToString(combo.SelectedItem);
                if (string.IsNullOrEmpty(name)) return;
                _plugin.UpdateSettings(s => { if (s.FlagPresets != null) s.FlagPresets.RemoveAll(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)); });
                RefreshFlagsPane();
            };
            buttons.Children.Add(del);
            stack.Children.Add(buttons);

            return UiKit.Card(stack, "Presets");
        }

        // Per-vlag: patroon / knipperen / tempo (per box).
        private FrameworkElement BuildFlagStyles(int boxIndex, FlagBoxSlot b)
        {
            var names = new[] { "Rood", "Zwart", "Safety Car", "Dubbelgeel", "Geel", "Wit", "Oranje", "Debris", "Blauw", "Groen", "Geruit" };
            var wrap = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
            var panel = new StackPanel();
            panel.Children.Add(UiKit.Sub("Per vlag: patroon, knipperen en tempo (Standaard = zoals geleverd)."));
            for (var i = 0; i < names.Length; i++)
            {
                var idx = i;
                var style = b.StyleOf(idx);
                var row = new WrapPanel { Margin = new Thickness(0, 2, 0, 2) };
                row.Children.Add(new TextBlock { Text = names[i], Width = 82, Foreground = UiKit.Muted, VerticalAlignment = VerticalAlignment.Center });

                var pat = UiKit.Combo();
                pat.Items.Add("Patroon: standaard"); pat.Items.Add("Effen"); pat.Items.Add("Checker"); pat.Items.Add("Rijen");
                pat.SelectedIndex = Math.Max(0, Math.Min(3, style.Pattern + 1));
                pat.SelectionChanged += delegate { SetBox(boxIndex, x => x.StyleOf(idx).Pattern = pat.SelectedIndex - 1); };
                row.Children.Add(pat);

                var bl = UiKit.Combo();
                bl.Items.Add("Knipperen: standaard"); bl.Items.Add("Uit"); bl.Items.Add("Aan");
                bl.SelectedIndex = Math.Max(0, Math.Min(2, style.Blink + 1));
                bl.SelectionChanged += delegate { SetBox(boxIndex, x => x.StyleOf(idx).Blink = bl.SelectedIndex - 1); };
                row.Children.Add(bl);

                var tempo = UiKit.Field(64);
                tempo.Text = style.BlinkMs > 0 ? style.BlinkMs.ToString() : string.Empty;
                tempo.LostFocus += delegate { int v; int.TryParse((tempo.Text ?? string.Empty).Trim(), out v); SetBox(boxIndex, x => x.StyleOf(idx).BlinkMs = v); };
                row.Children.Add(tempo);
                row.Children.Add(new TextBlock { Text = "ms", Foreground = UiKit.Muted, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 0, 0) });

                wrap.Children.Add(row);
            }
            panel.Children.Add(wrap);
            return panel;
        }

        // Idle-ontwerp bibliotheek (per box toepassen; ontwerpen zijn machine-breed).
        private FrameworkElement BuildIdleDesigns(FlagSettings f, int boxIndex, FlagBoxSlot b)
        {
            var panel = new StackPanel();
            panel.Children.Add(UiKit.Sub("Idle-ontwerpen (bibliotheek)"));
            var designs = f.EnsureIdleDesigns();

            var combo = UiKit.Combo();
            foreach (var d in designs) combo.Items.Add(d.Name);
            var selected = designs.FindIndex(d => string.Equals(d.Name, f.IdleDesignName, StringComparison.OrdinalIgnoreCase));
            combo.SelectedIndex = selected < 0 ? 0 : selected;
            combo.SelectionChanged += delegate
            {
                var i = combo.SelectedIndex;
                if (i < 0 || i >= designs.Count) return;
                var d = designs[i];
                SetFlag(x => x.IdleDesignName = d.Name);
                SetBox(boxIndex, s => { s.IdleCustom = d.Image; s.IdleScreen = 3; });
                RefreshFlagsPane();
            };
            panel.Children.Add(UiKit.Row("Ontwerp", combo));

            var nameField = UiKit.Field(180);
            nameField.Text = f.IdleDesignName ?? string.Empty;
            panel.Children.Add(UiKit.Row("Naam", nameField));

            var codeField = UiKit.Field(300);
            codeField.Text = string.Empty;
            panel.Children.Add(UiKit.Row("Deelcode", codeField));

            var buttons = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            var saveName = UiKit.Secondary("Naam opslaan");
            saveName.Click += delegate
            {
                var name = (nameField.Text ?? string.Empty).Trim();
                if (name.Length == 0) return;
                var i = combo.SelectedIndex;
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    if (i >= 0 && i < list.Count) { list[i].Name = name; x.IdleDesignName = name; }
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(saveName);

            var add = UiKit.Secondary("Nieuw");
            add.Click += delegate
            {
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    var name = "Ontwerp " + (list.Count + 1);
                    list.Add(new FlagIdleDesign { Name = name, Image = FlagIdleArt.Default(false, FlagIdleArt.Brand) });
                    x.IdleDesignName = name;
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(add);

            var dup = UiKit.Secondary("Dupliceren");
            dup.Click += delegate
            {
                var i = combo.SelectedIndex;
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    if (i < 0 || i >= list.Count) return;
                    var copy = list[i].Clone();
                    copy.Name = list[i].Name + " kopie";
                    list.Add(copy);
                    x.IdleDesignName = copy.Name;
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(dup);

            var del = UiKit.DangerButton("Verwijderen");
            del.Click += delegate
            {
                var i = combo.SelectedIndex;
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    if (list.Count <= 1 || i < 0 || i >= list.Count) return;
                    if (string.Equals(x.IdleDesignName, list[i].Name, StringComparison.OrdinalIgnoreCase)) x.IdleDesignName = string.Empty;
                    list.RemoveAt(i);
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(del);

            var share = UiKit.Secondary("Delen");
            share.Click += delegate
            {
                var i = combo.SelectedIndex;
                var image = (i >= 0 && i < designs.Count) ? designs[i].Image : b.IdleCustom;
                codeField.Text = ShareCode(image);
                try { System.Windows.Clipboard.SetText(codeField.Text); } catch { }
            };
            buttons.Children.Add(share);

            var paste = UiKit.Secondary("Plakken");
            paste.Click += delegate
            {
                var payload = ParseShareCode(codeField.Text);
                if (payload == null) { MessageBox.Show("Geen geldige deelcode.", "3SM", MessageBoxButton.OK, MessageBoxImage.Information); return; }
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    var name = "Geïmporteerd " + (list.Count + 1);
                    list.Add(new FlagIdleDesign { Name = name, Image = payload });
                    x.IdleDesignName = name;
                });
                RefreshFlagsPane();
            };
            buttons.Children.Add(paste);

            panel.Children.Add(buttons);
            return panel;
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

        // Grafische pixel-editor voor de Custom idle-tekening (per box).
        private FrameworkElement BuildIdleEditor(int boxIndex, FlagBoxSlot b)
        {
            var mld = b.IsMld;
            var w = mld ? 25 : 8;
            var h = mld ? 6 : 8;
            var px = mld ? 16 : 26;

            var art = MatrixArt.Parse(b.IdleCustom);
            var frame = new string[w * h];
            if (art != null && art.Frames.Count > 0)
            {
                var src = art.Frames[0];
                for (var i = 0; i < frame.Length && i < src.Length; i++) frame[i] = src[i];
            }

            var panel = new StackPanel();
            panel.Children.Add(UiKit.Sub("Pixel-editor — klik om te tekenen (Custom)"));

            var penColour = FlagIdleArt.Brand;
            var grid = new UniformGrid { Rows = h, Columns = w, Width = w * px, Height = h * px, HorizontalAlignment = HorizontalAlignment.Left, Background = UiKit.Bg, Margin = new Thickness(0, 4, 0, 6) };
            var buttons = new Button[w * h];
            Action write = null;
            for (var i = 0; i < buttons.Length; i++)
            {
                var index = i;
                var cellButton = new Button { Width = px, Height = px, Padding = new Thickness(0), BorderThickness = new Thickness(1), BorderBrush = UiKit.Border, Background = BrushFor(frame[index]) };
                cellButton.Click += delegate
                {
                    frame[index] = frame[index] == penColour ? null : penColour;
                    cellButton.Background = BrushFor(frame[index]);
                    if (write != null) write();
                };
                buttons[i] = cellButton;
                grid.Children.Add(cellButton);
            }
            panel.Children.Add(grid);

            var combo = UiKit.Combo();
            foreach (var option in new[] { "Oranje", "Wit", "Rood", "Blauw", "Groen", "Geel" }) combo.Items.Add(option);
            combo.SelectedIndex = 0;
            combo.SelectionChanged += delegate { penColour = PenColour(combo.SelectedIndex); };
            panel.Children.Add(UiKit.Row("Pen-kleur", combo));

            var actions = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            var clear = UiKit.Secondary("Wissen");
            clear.Click += delegate
            {
                for (var i = 0; i < frame.Length; i++) { frame[i] = null; buttons[i].Background = BrushFor(null); }
                if (write != null) write();
            };
            actions.Children.Add(clear);
            var reset = UiKit.Secondary("3SM-logo");
            reset.Click += delegate { SetBox(boxIndex, x => { x.IdleCustom = string.Empty; x.IdleScreen = 2; }); RefreshFlagsPane(); };
            actions.Children.Add(reset);
            panel.Children.Add(actions);

            write = delegate
            {
                var payload = MatrixArt.FormatSingle(frame, w, h);
                SetBox(boxIndex, x => { x.IdleCustom = payload; x.IdleScreen = 3; });
                SetFlag(x =>
                {
                    var list = x.EnsureIdleDesigns();
                    var design = list.Find(y => string.Equals(y.Name, x.IdleDesignName, StringComparison.OrdinalIgnoreCase));
                    if (design != null) design.Image = payload;
                });
            };

            return panel;
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

        private void InstallFlagProfile()
        {
            var flagSettings = _plugin.Settings != null ? _plugin.Settings.Flags : null;
            var box = flagSettings != null ? flagSettings.ProfileBoxIndex : 1;
            var kind = flagSettings != null ? flagSettings.ProfileKind : "matrix";
            var slot = flagSettings != null && flagSettings.Boxes != null && box - 1 < flagSettings.Boxes.Length ? flagSettings.Boxes[box - 1] : null;
            var deviceName = slot == null ? null : slot.EffectiveDevice();
            var profile = FlagProfileInstaller.BuildProfile(flagSettings, kind, box);

            string message;
            var ok = SimHubLedProfileHost.InstallForDevice(_plugin.PluginManager, deviceName, profile, out message);
            if (!ok)
            {
                string fileMessage;
                var fileOk = FlagProfileInstaller.InstallProfile(FlagProfileInstaller.SettingsFileFor(kind), profile, out fileMessage);
                message = (message ?? string.Empty) + "\n\nBestandsinstallatie: " + (fileOk ? "OK" : "mislukt") + "\n" + fileMessage;
                ok = fileOk;
            }
            MessageBox.Show(message ?? (ok ? "OK" : "Mislukt"), "3SM flagbox-profiel", MessageBoxButton.OK, ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
        }

        private void RefreshFlagsPane()
        {
            if (_content == null || _panes.Count < 2) return;
            var replacement = ScrollPane(BuildFlagsPane());
            replacement.Visibility = _panes[1].Visibility;
            _content.Children.Remove(_panes[1]);
            _panes[1] = replacement;
            _content.Children.Add(replacement);
            Grid.SetColumn(replacement, 1);
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

        private void SetFlag(Action<FlagSettings> mutate)
        {
            if (mutate == null) return;
            _plugin.UpdateSettings(s => { if (s.Flags == null) s.Flags = new FlagSettings(); mutate(s.Flags); });
        }

        private void SetBox(int index, Action<FlagBoxSlot> mutate)
        {
            SetFlag(x =>
            {
                if (x.ConfigurationMode == 0)
                {
                    for (var i = 0; i < 8; i++) mutate(x.Box(i));
                }
                else mutate(x.Box(index));
            });
        }

        // Device-identiteit blijft altijd per box (ook in gegroepeerde modus).
        private void SetBoxDevice(int index, Action<FlagBoxSlot> mutate)
        {
            SetFlag(x => mutate(x.Box(index)));
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
            var box = UiKit.Field(90);
            box.Text = value.ToString();
            box.LostFocus += delegate
            {
                int parsed;
                if (int.TryParse(box.Text, out parsed) && parsed >= min && parsed <= max) set(parsed);
                else box.Text = value.ToString();
            };
            return new Border { Child = UiKit.Row(label, box) };
        }

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
