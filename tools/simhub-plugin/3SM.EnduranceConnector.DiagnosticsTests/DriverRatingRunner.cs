#if DRIVER_RATING_STANDALONE
using System;

internal static class DriverRatingRunner
{
    public static int Main()
    {
        int failed = 0;
        int count = DriverRatingTests.Run((id, passed, detail) => {
            Console.WriteLine((passed ? "PASS " : "FAIL ") + id + " " + detail);
            if (!passed) failed++;
        });
        Console.WriteLine("SUMMARY PASS=" + (count - failed) + " FAIL=" + failed);
        return failed == 0 ? 0 : 1;
    }
}
#endif
