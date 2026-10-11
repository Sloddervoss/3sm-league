using System;
using SimHub.Plugins;

namespace ThreeSM.EnduranceConnector
{
    // Publiceert de vlag naar SimHub-properties zodat LED-flagboxes en overlays
    // (via een SimHub LED-profiel) de vlag kunnen tonen. De plugin praat NIET direct
    // met hardware: SimHub's LED-engine leest deze properties en stuurt de LEDs.
    //
    // Universeel (prefix = Settings.Flags.PropertyPrefix), bv. "THREESM.Flags":
    //   <prefix>.Active / .Primary / .Colour / .Layout / .Bits / .Severity
    //   <prefix>.Green / .Yellow / .DoubleYellow / .Red / .Blue / .White /
    //   .Checkered / .Black / .Orange / .Debris / .SafetyCar / .VirtualSafetyCar
    //
    // Per flagbox (Box1..Box4):
    //   <prefix>.Box1.Active / .Primary / .Colour / .Layout / .Bits / .Severity
    //   <prefix>.Box1.Red / .Box1.Yellow / ...   (bool per vlag)
    //
    // Het SimHub LED-profiel koppelt deze properties aan de LEDs; BoxN gebruik je op
    // de N-de flagbox, of je laat alle boxen de universele set volgen.
    public sealed class FlagPropertyPublisher
    {
        private const int MaxBoxes = 4;

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

        // Eenmalig aanroepen in Init(): universele + per-box properties aanmelden.
        public bool Register()
        {
            if (_manager == null) return false;
            if (_registered) return true;
            try
            {
                RegisterGroup("");
                for (var box = 1; box <= MaxBoxes; box++) RegisterGroup(".Box" + box);
                RegisterOverlay();
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

        // Overlay-klare properties (voor SimHub-dashboards/overlays).
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

        // SimHub API: AddProperty<T>(name, pluginType, value[, description]).
        private void Add<T>(string suffix, T defaultValue)
        {
            try { _manager.AddProperty<T>(_prefix + suffix, _pluginType, defaultValue, (string)null); } catch { }
        }

        // SimHub API: SetPropertyValue(name, pluginType, value).
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
