using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using SimHub.Plugins;

namespace ThreeSM.EnduranceConnector
{
    // Best-effort lijst van de LED-devices die SimHub kent (via reflectie op
    // SimHub.Plugins.Devices.DevicesPlugin, net als DNR doet). Bij een andere
    // SimHub-versie of een fout blijft de lijst leeg en kan de gebruiker de naam
    // handmatig invullen. Vormt de keuzelijst per flagbox-slot.
    public static class SimHubDeviceLister
    {
        private const BindingFlags BF = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        public static List<string> List(PluginManager pluginManager)
        {
            var names = new List<string>();
            try
            {
                if (pluginManager == null) return names;
                var type = FindType("SimHub.Plugins.Devices.DevicesPlugin");
                if (type == null) return names;

                var getPlugin = typeof(PluginManager).GetMethods()
                    .FirstOrDefault(m => m.Name == "GetPlugin" && m.IsGenericMethod && m.GetParameters().Length == 0);
                if (getPlugin == null) return names;

                var instance = getPlugin.MakeGenericMethod(type).Invoke(pluginManager, null);
                if (instance == null) return names;

                var devices = (GetMember(GetMember(instance, "DevicesPluginSettings"), "Devices") as IEnumerable)
                              ?? (GetMember(instance, "Devices") as IEnumerable);
                if (devices == null) return names;

                foreach (var device in devices)
                {
                    if (device == null) continue;
                    var name = NameOf(device);
                    if (!string.IsNullOrWhiteSpace(name) && !names.Contains(name)) names.Add(name.Trim());
                }
                // Plugin-hosted Arduino LED's (SerialDashPlugin) — hier zitten de
                // RGB-LEDs / matrix / TM1638 die SimHub niet in DevicesPlugin toont.
                try
                {
                    var settings = GetMember(GetPlugin(pluginManager, "SimHub.Plugins.OutputPlugins.Dash.SerialDashPlugin"), "Settings");
                    foreach (var member in new[] { "RGBLedsDriver", "TM1638LedsDriver", "RGBMatrixDriver" })
                    {
                        var driverSettings = GetMember(GetMember(settings, member), "Settings");
                        if (driverSettings != null && GetMember(driverSettings, "Profiles") is IEnumerable)
                        {
                            var name = member == "RGBLedsDriver" ? "Arduino RGB LEDs"
                                     : member == "TM1638LedsDriver" ? "TM1638 LEDs"
                                     : "Arduino RGB Matrix";
                            if (!names.Contains(name)) names.Add(name);
                        }
                    }
                }
                catch { }
                names.Sort(StringComparer.OrdinalIgnoreCase);
            }
            catch { /* device-lijst is optioneel; nooit laten stuklopen */ }
            return names;
        }

        private static string NameOf(object device)
        {
            foreach (var member in new[] { "MainDisplayName", "Name", "AutomaticName", "DeviceName", "DisplayName" })
            {
                var value = GetMember(device, member) as string;
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            try { return Convert.ToString(device); } catch { return null; }
        }

        private static object GetMember(object target, string name)
        {
            if (target == null || string.IsNullOrEmpty(name)) return null;
            try
            {
                var type = target.GetType();
                var property = type.GetProperty(name, BF);
                if (property != null && property.CanRead) return property.GetValue(target, null);
                var field = type.GetField(name, BF);
                if (field != null) return field.GetValue(target);
            }
            catch { }
            return null;
        }

        private static object GetPlugin(PluginManager pluginManager, string fullName)
        {
            try
            {
                var type = FindType(fullName);
                var getPlugin = typeof(PluginManager).GetMethods().FirstOrDefault(m => m.Name == "GetPlugin" && m.IsGenericMethod && m.GetParameters().Length == 0);
                if (type == null || getPlugin == null || pluginManager == null) return null;
                return getPlugin.MakeGenericMethod(type).Invoke(pluginManager, null);
            }
            catch { return null; }
        }

        private static Type FindType(string fullName)
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var type = assembly.GetType(fullName);
                    if (type != null) return type;
                }
                catch { }
            }
            return null;
        }
    }
}
