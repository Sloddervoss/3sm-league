using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using SimHub.Plugins;

namespace ThreeSM.EnduranceConnector
{
    public sealed class LedDriverSettings
    {
        public string DeviceName;
        public string DriverName;
        public object Settings;
    }

    // Installeert een gegenereerd profiel rechtstreeks in de LIVE SimHub LED-settings
    // (via reflectie + Save()), zoals DNR doet. Hierdoor overschrijft SimHub de
    // wijziging niet bij het afsluiten. Alles is defensief: bij twijfel faalt het
    // stil en blijft de file-gebaseerde installatie als terugvaloptie.
    public static class SimHubLedProfileHost
    {
        private static readonly BindingFlags BF = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        private static readonly string[] DriverMembers = { "MatrixDriver", "LedsDriver", "RawDriver", "ButtonsDriver", "EncodersDriver" };

        public static List<LedDriverSettings> ReadDrivers(PluginManager pluginManager)
        {
            var result = new List<LedDriverSettings>();
            try
            {
                foreach (var device in Devices(pluginManager))
                {
                    if (device == null) continue;
                    var deviceName = NameOf(device);
                    foreach (var instance in InstancesOf(device))
                    {
                        if (instance == null) continue;
                        AddDriversFrom(result, instance, deviceName);
                        var module = GetMember(instance, "ledModuleSettings");
                        if (module != null) AddDriversFrom(result, module, deviceName);
                    }
                }
                result.AddRange(ReadPluginHosted(pluginManager));
            }
            catch { /* nooit laten stuklopen */ }
            return result;
        }

        // Arduino-LED's worden door SimHub gehost door de SerialDashPlugin (niet DevicesPlugin).
        // Zonder deze lijst blijft de device-keuze leeg op een typische rig.
        public static List<LedDriverSettings> ReadPluginHosted(PluginManager pluginManager)
        {
            var result = new List<LedDriverSettings>();
            try
            {
                var settings = GetMember(GetPluginByTypeName(pluginManager, "SimHub.Plugins.OutputPlugins.Dash.SerialDashPlugin"), "Settings");
                if (settings == null) return result;
                var hosted = new[]
                {
                    new { Member = "RGBLedsDriver", Name = "Arduino RGB LEDs", Driver = "LedsDriver" },
                    new { Member = "TM1638LedsDriver", Name = "TM1638 LEDs", Driver = "LedsDriver" },
                    new { Member = "RGBMatrixDriver", Name = "Arduino RGB Matrix", Driver = "MatrixDriver" },
                };
                foreach (var entry in hosted)
                {
                    var driverSettings = GetMember(GetMember(settings, entry.Member), "Settings");
                    if (driverSettings != null && GetMember(driverSettings, "Profiles") is IEnumerable)
                        result.Add(new LedDriverSettings { DeviceName = entry.Name, DriverName = entry.Driver, Settings = driverSettings });
                }
            }
            catch { }
            return result;
        }

        private static void AddDriversFrom(List<LedDriverSettings> result, object module, string deviceName)
        {
            foreach (var driver in DriverMembers)
            {
                var settings = GetMember(GetMember(module, driver), "Settings");
                if (settings != null && GetMember(settings, "Profiles") is IEnumerable)
                    result.Add(new LedDriverSettings { DeviceName = deviceName, DriverName = driver, Settings = settings });
            }
            var leds = GetMember(GetMember(module, "ledsDriver"), "Settings");
            if (leds != null && GetMember(leds, "Profiles") is IEnumerable)
                result.Add(new LedDriverSettings { DeviceName = deviceName, DriverName = "MatrixDriver", Settings = leds });
        }

        // Kiest de driver voor een box: op device-naam als die is toegewezen, anders
        // de eerste matrix-driver (of anders de eerste met een profielenlijst).
        public static LedDriverSettings PickDriver(List<LedDriverSettings> drivers, string deviceName)
        {
            if (drivers == null || drivers.Count == 0) return null;
            if (!string.IsNullOrWhiteSpace(deviceName))
            {
                var byName = drivers.FirstOrDefault(d => string.Equals(d.DeviceName, deviceName, StringComparison.OrdinalIgnoreCase));
                if (byName != null) return byName;
            }
            return drivers.FirstOrDefault(d => string.Equals(d.DriverName, "MatrixDriver", StringComparison.OrdinalIgnoreCase)) ?? drivers[0];
        }

        public static bool InstallForDevice(PluginManager pluginManager, string deviceName, JObject profile, out string message)
        {
            message = null;
            var drivers = ReadDrivers(pluginManager);
            if (drivers.Count == 0)
            {
                message = "Geen SimHub LED-driver gevonden. Valt terug op bestandsinstallatie.";
                return false;
            }
            var driver = PickDriver(drivers, deviceName);
            return Install(driver, profile, out message);
        }

        public static bool Install(LedDriverSettings driver, JObject profile, out string message)
        {
            message = null;
            try
            {
                if (driver == null || driver.Settings == null) { message = "Geen LED-driver gevonden."; return false; }
                var settings = driver.Settings;
                var type = ResolveProfileType(settings);
                if (type == null) { message = "Profieltype onbekend; valt terug op bestandsinstallatie."; return false; }

                var instance = profile.ToObject(type);

                Guid id;
                if (!Guid.TryParse(Convert.ToString(profile["ProfileId"]), out id)) id = Guid.NewGuid();

                var remove = settings.GetType().GetMethod("RemoveProfile", new[] { typeof(Guid), typeof(bool) });
                try { remove?.Invoke(settings, new object[] { id, false }); } catch { }

                var add = settings.GetType().GetMethod("AddProfile", new[] { type, typeof(bool) })
                          ?? settings.GetType().GetMethods().FirstOrDefault(m => m.Name == "AddProfile" && m.GetParameters().Length == 2);
                if (add == null) { message = "AddProfile niet gevonden; valt terug op bestandsinstallatie."; return false; }
                add.Invoke(settings, new object[] { instance, false });

                settings.GetType().GetMethod("Save", Type.EmptyTypes)?.Invoke(settings, null);

                message = "Profiel \"" + (Convert.ToString(profile["Name"]) ?? "3SM Flags") + "\" live geïnstalleerd op '"
                        + (driver.DeviceName ?? driver.DriverName ?? "device") + "'.";
                return true;
            }
            catch (Exception ex)
            {
                message = "Live-installatie mislukt: " + (ex.InnerException ?? ex).Message;
                return false;
            }
        }

        private static Type ResolveProfileType(object settings)
        {
            try
            {
                var property = settings.GetType().GetProperty("Profiles", BF);
                var type = property == null ? null : property.PropertyType;
                if (type != null && type.IsGenericType) return type.GetGenericArguments()[0];
            }
            catch { }
            return FindType("SimHub.Plugins.DataPlugins.RGBDriver.Settings.Profile");
        }

        private static IEnumerable Devices(PluginManager pluginManager)
        {
            try
            {
                if (pluginManager == null) return new List<object>();
                var type = FindType("SimHub.Plugins.Devices.DevicesPlugin");
                if (type == null) return new List<object>();
                var getPlugin = typeof(PluginManager).GetMethods().FirstOrDefault(m => m.Name == "GetPlugin" && m.IsGenericMethod && m.GetParameters().Length == 0);
                if (getPlugin == null) return new List<object>();
                var instance = getPlugin.MakeGenericMethod(type).Invoke(pluginManager, null);
                if (instance == null) return new List<object>();
                return (GetMember(GetMember(instance, "DevicesPluginSettings"), "Devices") as IEnumerable)
                       ?? (GetMember(instance, "Devices") as IEnumerable)
                       ?? new List<object>();
            }
            catch { return new List<object>(); }
        }

        private static IEnumerable<object> InstancesOf(object device)
        {
            var result = new List<object>();
            if (device == null) return result;
            try
            {
                IEnumerable instances = null;
                var method = device.GetType().GetMethod("GetInstances", BF, null, Type.EmptyTypes, null);
                if (method != null) instances = method.Invoke(device, null) as IEnumerable;
                if (instances != null)
                {
                    foreach (var item in instances) if (item != null) result.Add(item);
                    return result;
                }
            }
            catch { }
            result.Add(device);
            if (GetMember(device, "Devices") is IEnumerable nested)
                foreach (var item in nested) if (item != null) result.Add(item);
            return result;
        }

        private static string NameOf(object device)
        {
            foreach (var member in new[] { "MainDisplayName", "CustomName", "Name", "AutomaticName", "DeviceName" })
            {
                var value = GetMember(device, member) as string;
                if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
            }
            return null;
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

        private static object GetPluginByTypeName(PluginManager pluginManager, string fullName)
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
                try { var type = assembly.GetType(fullName); if (type != null) return type; }
                catch { }
            }
            return null;
        }
    }
}
