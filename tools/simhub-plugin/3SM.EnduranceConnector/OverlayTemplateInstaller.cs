using System;
using System.IO;
using System.Reflection;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Installeert het Dash Studio-template bij de eerste start. De bestanden zitten
    /// als embedded resources in de plugin, zodat een release uit één DLL bestaat.
    /// Bestaande templates worden nooit overschreven: gebruikersaanpassingen blijven
    /// staan. Verwijder de map om opnieuw te laten installeren.
    /// </summary>
    internal static class OverlayTemplateInstaller
    {
        internal const string FolderName = "3SM Endurance Overlay";
        internal const string DashboardFileName = "3SM Endurance Overlay.djson";

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
            var dashboardExists = File.Exists(dashboardPath);
            var metadataExists = File.Exists(metadataPath);
            var resourcesExist = File.Exists(resourcesPath);
            if (dashboardExists && metadataExists && resourcesExist) return dashboardPath;

            Directory.CreateDirectory(targetDirectory);
            var assembly = Assembly.GetExecutingAssembly();
            if (!dashboardExists) { WriteResource(assembly, DashboardResource, dashboardPath); installed = true; }
            if (!metadataExists) { WriteResource(assembly, MetadataResource, metadataPath); installed = true; }
            if (!resourcesExist) { WriteResource(assembly, ResourcesResource, resourcesPath); installed = true; }
            return dashboardPath;
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
