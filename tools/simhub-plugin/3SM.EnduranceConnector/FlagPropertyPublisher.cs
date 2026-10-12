using System;
using System.Text;
using SimHub.Plugins;

namespace ThreeSM.EnduranceConnector
{
    // Publiceert de vlag én de paneel-instellingen naar SimHub-properties, zodat het
    // LED-profiel alles LIVE kan lezen: eenmalig installeren, daarna direct effect.
    public sealed class FlagPropertyPublisher
    {
        private const int MaxBoxes = 8;

        private static readonly RaceFlags[] AllFlags = new[]
        {
            RaceFlags.Green, RaceFlags.Yellow, RaceFlags.DoubleYellow, RaceFlags.Red,
            RaceFlags.Blue, RaceFlags.White, RaceFlags.Checkered, RaceFlags.Black,
            RaceFlags.Orange, RaceFlags.Debris, RaceFlags.SafetyCar,
            RaceFlags.VirtualSafetyCar, RaceFlags.FullCourseYellow
        };

        private readonly PluginManager _manager;
        private readonly Type _pluginType;
        private readonly string _prefix;
        private bool _registered;

        public FlagPropertyPublisher(PluginManager manager, Type pluginType, string prefix)
        {
            _manager = manager;
            _pluginType = pluginType ?? typeof(FlagPropertyPublisher);
            _prefix = string.IsNullOrWhiteSpace(prefix) ? "THREESM.Flags" : prefix.Trim();
        }

        // De prefix zoals die bij het starten van SimHub is aangemeld. Een gewijzigde
        // instelling werkt pas na een herstart, dus het profiel mag daar niet op vooruitlopen.
        public string Prefix { get { return _prefix; } }

        public bool Register()
        {
            if (_manager == null) return false;
            if (_registered) return true;
            try
            {
                Add("SpotterColour", "#FF1493");
                Add("TempWater", 110);
                Add("TempOil", 120);
                Add("LowFuelPct", 15);
                Add("BoxCount", 1);
                Add("FlagPhase", 300);
                RegisterOverlay();
                RegisterGroup("");
                for (var box = 1; box <= MaxBoxes; box++) RegisterGroup(".Box" + box);
                _registered = true;
                return true;
            }
            catch { return false; }
        }

        private void RegisterGroup(string group)
        {
            Add(group + ".Active", false);
            Add(group + ".Primary", "none");
            Add(group + ".Text", string.Empty);
            Add(group + ".Colour", "#000000");
            Add(group + ".Layout", "solid");
            Add(group + ".Bits", 0);
            Add(group + ".Severity", 0);
            Add(group + ".DeviceName", string.Empty);
            foreach (var flag in AllFlags) Add(group + "." + NameOf(flag), false);
        }

        private void RegisterOverlay()
        {
            Add("Overlay.Active", false);
            Add("Overlay.Text", string.Empty);
            Add("Overlay.Colour", "#000000");
            Add("Overlay.BlueText", string.Empty);
            Add("Overlay.BlueStyle", 0);
            Add("Overlay.Theme", 0);
            Add("Overlay.DarkMode", true);
            Add("Overlay.ShowAnimation", true);
        }

        public void Publish(FlagState universal, FlagState[] boxes, string[] deviceNames, string text = null, string blueText = null, int blueStyle = 0, int overlayTheme = 0, bool overlayDark = true, bool overlayShowAnimation = true)
        {
            if (_manager == null || !_registered) return;
            try
            {
                PublishGroup("", universal, null, text);
                for (var i = 0; i < MaxBoxes; i++)
                {
                    var state = boxes != null && i < boxes.Length ? boxes[i] : null;
                    var device = deviceNames != null && i < deviceNames.Length ? deviceNames[i] : null;
                    PublishGroup(".Box" + (i + 1), state, device, null);
                }
                Set("Overlay.Active", universal != null && universal.Active);
                Set("Overlay.Text", text ?? string.Empty);
                Set("Overlay.Colour", universal == null ? "#000000" : (universal.ColourHex ?? "#000000"));
                Set("Overlay.BlueText", blueText ?? string.Empty);
                Set("Overlay.BlueStyle", blueStyle);
                Set("Overlay.Theme", overlayTheme);
                Set("Overlay.DarkMode", overlayDark);
                Set("Overlay.ShowAnimation", overlayShowAnimation);
            }
            catch { /* publiceren mag de plugin nooit breken */ }
        }

        // Publiceert de (opgeloste) paneel-instellingen per box + de globale drempels,
        // zodat het gegenereerde LED-profiel alles live kan lezen.
        public void PublishSettings(FlagSettings flags)
        {
            if (_manager == null || !_registered || flags == null) return;
            try
            {
                Set("SpotterColour", flags.SpotterColour ?? "#FF1493");
                Set("TempWater", flags.TempWarnWater);
                Set("TempOil", flags.TempWarnOil);
                Set("LowFuelPct", flags.LowFuelPercent);
                Set("BoxCount", flags.BoxCount);
                Set("FlagPhase", flags.FlagPhaseMs > 0 ? flags.FlagPhaseMs : 300);
                for (var i = 0; i < MaxBoxes; i++)
                {
                    var b = flags.Box(i);
                    var g = ".Box" + (i + 1) + ".Set.";
                    var themeId = flags.UniversalTheme ? flags.UniversalThemeId : b.GearColour;
                    var theme = FlagThemes.For(themeId);
                    var custom = themeId == FlagThemes.Custom;
                    var num = b.CustomGearNumColours == 2 ? 2 : 3;

                    var palTop = custom ? b.CustomGearColour1 : theme.Top;
                    var palMid = custom ? (num == 2 ? b.CustomGearColour3 : b.CustomGearColour2) : theme.Middle;
                    var palBot = custom ? b.CustomGearColour3 : theme.Bottom;
                    var redTop = custom ? b.CustomGearRedlineColour1 : (b.RedlineColour ?? "#FF0000");
                    var redMid = custom ? b.CustomGearRedlineColour2 : (b.RedlineColour ?? "#FF0000");
                    var redBot = custom ? b.CustomGearRedlineColour3 : (b.RedlineColour ?? "#FF0000");

                    Set(g + "Brightness", b.Brightness);
                    Set(g + "Gears", b.Gears);
                    Set(g + "GearStyle", b.GearStyle);
                    Set(g + "GearInverted", b.GearInverted);
                    Set(g + "GearLocation", b.GearLocation);
                    Set(g + "RedlineBehaviour", b.RedlineBehaviour);
                    Set(g + "ShowRedline", b.ShowRedline);
                    Set(g + "RedlineMidPct", b.RedlineMidPct);
                    Set(g + "RedlineHighPct", b.RedlineHighPct);
                    Set(g + "RedlineBarStart", b.RedlineBarStartPct);
                    Set(g + "PalTop", palTop);
                    Set(g + "PalMid", palMid);
                    Set(g + "PalBot", palBot);
                    Set(g + "PalBlend", custom ? false : theme.Blend);
                    Set(g + "RedTop", redTop);
                    Set(g + "RedMid", redMid);
                    Set(g + "RedBot", redBot);
                    Set(g + "Spotters", b.Spotters);
                    Set(g + "SpotterSide", b.SpotterSide);
                    Set(g + "SpotterMode", b.SpotterMode);
                    Set(g + "SpotterAnimation", b.SpotterAnimation);
                    Set(g + "SpotterBlink", b.SpotterBlink);
                    Set(g + "SpotterShiftsGear", b.SpotterShiftsGear);
                    Set(g + "Pit", b.Pit);
                    Set(g + "PitCountdown", b.PitCountdown);
                    Set(g + "PitStyle", b.PitLimiterStyle);
                    Set(g + "EngineStyle", b.EngineStartStyle);
                    Set(g + "Ignition", b.IgnitionEngineStartupAnimation);
                    Set(g + "TempWarn", b.TemperatureWarning);
                    Set(g + "LowFuel", b.LowFuel);
                    Set(g + "Critical", b.CriticalFlags);
                    Set(g + "IdleScreen", b.IdleScreen);
                    var idleTheme = FlagThemes.For(b.IdleAnimationColour);
                    Set(g + "IdleArt", FlagIdleArt.Effective(b, b.IdleScreen, idleTheme.Top) ?? string.Empty);
                    Set(g + "FlagStyles", EncodeFlagStyles(b));
                }
            }
            catch { /* nooit de telemetry breken */ }
        }

        private static string EncodeFlagStyles(FlagBoxSlot b)
        {
            var sb = new StringBuilder();
            for (var i = 0; i < FlagSlotIndex.Count; i++)
            {
                var s = b.StyleOf(i);
                if (i > 0) sb.Append(',');
                sb.Append(s.Pattern).Append(':').Append(s.Blink).Append(':').Append(s.BlinkMs);
            }
            return sb.ToString();
        }

        private void PublishGroup(string group, FlagState state, string deviceName, string text)
        {
            if (state == null) state = FlagState.Empty();
            Set(group + ".DeviceName", deviceName ?? string.Empty);
            Set(group + ".Active", state.Active);
            Set(group + ".Primary", state.Primary ?? "none");
            if (text != null) Set(group + ".Text", text);
            Set(group + ".Colour", state.ColourHex ?? "#000000");
            Set(group + ".Layout", state.Layout ?? "solid");
            Set(group + ".Bits", unchecked((int)(uint)state.Flags));
            Set(group + ".Severity", (int)state.Severity);
            foreach (var flag in AllFlags)
                Set(group + "." + NameOf(flag), (state.Flags & flag) == flag);
        }

        private void Add<T>(string suffix, T defaultValue)
        {
            try { _manager.AddProperty<T>(_prefix + suffix, _pluginType, defaultValue, (string)null); } catch { }
        }

        private void Set(string suffix, object value)
        {
            try { _manager.SetPropertyValue(_prefix + suffix, _pluginType, value); } catch { }
        }

        private static string NameOf(RaceFlags flag)
        {
            switch (flag)
            {
                case RaceFlags.Green: return "Green";
                case RaceFlags.Yellow: return "Yellow";
                case RaceFlags.DoubleYellow: return "DoubleYellow";
                case RaceFlags.Red: return "Red";
                case RaceFlags.Blue: return "Blue";
                case RaceFlags.White: return "White";
                case RaceFlags.Checkered: return "Checkered";
                case RaceFlags.Black: return "Black";
                case RaceFlags.Orange: return "Orange";
                case RaceFlags.Debris: return "Debris";
                case RaceFlags.SafetyCar: return "SafetyCar";
                case RaceFlags.VirtualSafetyCar: return "VirtualSafetyCar";
                case RaceFlags.FullCourseYellow: return "FullCourseYellow";
                default: return flag.ToString();
            }
        }
    }
}
