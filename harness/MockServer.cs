// Mock HTTP-server voor de 3SM download-failure-tests, draait op Beest localhost.
// Serveert scenario's via pad:
//   /ok/<n>          -> n bytes geldige data, Content-Length correct
//   /timeout         -> accept, lees niet (hangt)
//   /404             -> HTTP 404
//   /500             -> HTTP 500
//   /truncated       -> Content-Length klopt niet (meer dan body), verbreek na deel
//   /wronglen        -> Content-Length < werkelijke body (mismatch)
//   /abort/<n>       -> stuur deel dan sluit verbinding abrupt
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

public static class MockServer
{
    public static int Main(string[] args)
    {
        int port = 18999;
        var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        listener.Start();
        Console.WriteLine("MOCK_SERVER_READY port=" + port);
        while (true)
        {
            var ctx = listener.GetContext();
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        try
        {
            var path = ctx.Request.Url.AbsolutePath.ToLowerInvariant();
            Console.WriteLine("REQ " + path);
            if (path == "/timeout")
            {
                // accept en laat resterende body niet komen; wacht dan sluit context
                Thread.Sleep(TimeSpan.FromMinutes(5));
                return;
            }
            if (path == "/404")
            {
                ctx.Response.StatusCode = 404; ctx.Response.Close(); return;
            }
            if (path == "/500")
            {
                ctx.Response.StatusCode = 500; ctx.Response.Close(); return;
            }
            if (path == "/wronglen")
            {
                byte[] body = new byte[300000];
                new Random(1).NextBytes(body);
                ctx.Response.ContentLength64 = 100; // kleiner dan body -> mismatch
                ctx.Response.OutputStream.Write(body, 0, body.Length);
                ctx.Response.Close(); return;
            }
            if (path == "/truncated")
            {
                byte[] body = new byte[300000];
                new Random(2).NextBytes(body);
                ctx.Response.ContentLength64 = body.Length; // beloof volledige lengte
                ctx.Response.OutputStream.Write(body, 0, 80000); // maar stuur een deel
                try { ctx.Response.OutputStream.Flush(); } catch {}
                try { ctx.Response.Abort(); } catch {} // abrupt verbroken
                return;
            }
            if (path.StartsWith("/abort/"))
            {
                int n = 50000;
                byte[] body = new byte[300000];
                new Random(3).NextBytes(body);
                ctx.Response.ContentLength64 = body.Length;
                ctx.Response.OutputStream.Write(body, 0, n);
                try { ctx.Response.OutputStream.Flush(); } catch {}
                try { ctx.Response.Abort(); } catch {}
                return;
            }
            if (path.StartsWith("/ok/"))
            {
                int n = 300000;
                byte[] body = new byte[n];
                new Random(4).NextBytes(body);
                ctx.Response.ContentLength64 = body.Length;
                ctx.Response.OutputStream.Write(body, 0, body.Length);
                ctx.Response.Close(); return;
            }
            ctx.Response.StatusCode = 404; ctx.Response.Close();
        }
        catch { try { ctx.Response.Abort(); } catch { } }
    }
}