using System;
using System.IO;
using System.Reflection;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Installeert het Dash Studio-template. De bestanden zitten als embedded
    /// resources in de plugin, zodat een release uit één DLL bestaat.
    ///
    /// Bijwerken: naast het dashboard staat een versiemarker. Zolang die gelijk
    /// is aan de pluginversie blijft het bestaande bestand staan, zodat
    /// gebruikersaanpassingen niet verdwijnen. Wijkt de marker af, dan wordt het
    /// dashboard vervangen — met een .3smbak-kopie van wat er stond. Zonder die
    /// marker blijft een oude of door SimHub herschreven layout voor altijd
    /// staan en volgt hij nooit meer een propertywijziging.
    /// </summary>
    internal static class OverlayTemplateInstaller
    {
        internal const string FolderName = "3SM Endurance Overlay";
        internal const string DashboardFileName = "3SM Endurance Overlay.djson";
        internal const string VersionFileName = "3SM Endurance Overlay.djson.3smversion";
        internal const string BackupSuffix = ".3smbak";

        private const string DashboardResource = "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson";
        private const string MetadataResource = "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson.metadata";
        private const string ResourcesResource = "ThreeSM.EnduranceConnector.Overlay.Dashboard.djson.ressources";

        internal static string Install(string simHubDirectory, out bool installed)
        {
            installed = false;
            if (string.IsNullOrWhiteSpace(simHubDirectory)) return string.Empty;

            var targetDirectory = Path.Combine(simHubDirectory, "DashTemplates", FolderName);
            var dashboardPath = Path.Combine(targetDirectory, DashboardFileName);
            var metadataPath = dashboardPath + ".metadata";
            var resourcesPath = dashboardPath + ".ressources";
            var markerPath = Path.Combine(targetDirectory, VersionFileName);

            var dashboardExists = File.Exists(dashboardPath);
            var metadataExists = File.Exists(metadataPath);
            var resourcesExist = File.Exists(resourcesPath);
            var currentVersion = ReadMarker(markerPath);
            var targetVersion = AssemblyVersion();
            var outdated = !string.Equals(currentVersion, targetVersion, StringComparison.Ordinal);
            if (dashboardExists && metadataExists && resourcesExist && !outdated) return dashboardPath;

            Directory.CreateDirectory(targetDirectory);
            var assembly = Assembly.GetExecutingAssembly();

            // Alleen het dashboard back-uppen: dat is het bestand dat iemand kan
            // hebben aangepast. De metadata en ressources zijn gegenereerd.
            if (dashboardExists && outdated) Backup(dashboardPath);

            var replaceDashboard = outdated || !dashboardExists;
            if (replaceDashboard) { WriteResource(assembly, DashboardResource, dashboardPath); installed = true; }
            // De metadata moet mee: SimHub zet IsOverlay daarin, en een
            // verkeerde waarde laat het dashboard bij 'Dashboards' staan in
            // plaats van bij 'Overlays', hoe goed het .djson zelf ook is.
            if (!metadataExists || outdated) { WriteResource(assembly, MetadataResource, metadataPath); installed = true; }
            if (!resourcesExist) { WriteResource(assembly, ResourcesResource, resourcesPath); installed = true; }

            if (installed)
            {
                try { File.WriteAllText(markerPath, targetVersion); }
                catch { /* de marker is een optimalisatie, geen eis */ }
            }
            return dashboardPath;
        }

        private static string AssemblyVersion()
        {
            try { return Assembly.GetExecutingAssembly().GetName().Version.ToString(); }
            catch { return "0.0.0.0"; }
        }

        private static string ReadMarker(string path)
        {
            try { return File.Exists(path) ? File.ReadAllText(path).Trim() : null; }
            catch { return null; }
        }

        private static void Backup(string dashboardPath)
        {
            try { File.Copy(dashboardPath, dashboardPath + BackupSuffix, true); }
            catch { /* een mislukte back-up mag de installatie niet blokkeren */ }
        }

        private static void WriteResource(Assembly assembly, string resourceName, string targetPath)
        {
            using (var input = assembly.GetManifestResourceStream(resourceName))
            {
                if (input == null)
                    throw new InvalidOperationException("embedded overlay resource missing: " + resourceName);

                var temporaryPath = targetPath + ".tmp";
                using (var output = new FileStream(temporaryPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    input.CopyTo(output);
                if (File.Exists(targetPath)) File.Delete(targetPath);
                File.Move(temporaryPath, targetPath);
            }
        }
    }
}
