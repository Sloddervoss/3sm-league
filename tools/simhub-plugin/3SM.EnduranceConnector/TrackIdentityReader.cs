using System;
using System.Reflection;

namespace ThreeSM.EnduranceConnector
{
    // Fixed iRacing SDK path, verified against the installed iRacingSDK assembly.
    // Read the current snapshot each time; never retain an ID across track changes.
    public static class TrackIdentityReader
    {
        public static int? Read(object snapshot)
        {
            try
            {
                var raw = Member(snapshot, "RawData");
                var session = Member(raw, "SessionData");
                var weekend = Member(session, "WeekendInfo");
                var value = Member(weekend, "TrackID");
                if (!(value is long) && !(value is int)) return null;
                var id = Convert.ToInt64(value);
                return id > 0 && id <= int.MaxValue ? (int?)id : null;
            }
            catch { return null; }
        }

        private static object Member(object target, string name)
        {
            if (target == null) return null;
            var property = target.GetType().GetProperty(name, BindingFlags.Instance | BindingFlags.Public);
            return property != null && property.CanRead && property.GetIndexParameters().Length == 0
                ? property.GetValue(target, null) : null;
        }
    }
}
