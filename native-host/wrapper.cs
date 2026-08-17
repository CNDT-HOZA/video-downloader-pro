using System;
using System.Diagnostics;
using System.Threading;
using System.IO;

class Program
{
    static void Main(string[] args)
    {
        Process p = new Process();
        // If portable node exists, use it, else use system node
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string portableNode = Path.Combine(dir, "..", "server", "bin", "node", "node.exe");
        
        p.StartInfo.FileName = File.Exists(portableNode) ? portableNode : "node.exe";
        
        // Pass host.js and any args from Chrome
        string hostJs = Path.Combine(dir, "host.js");
        p.StartInfo.Arguments = "\"" + hostJs + "\" " + string.Join(" ", args);
        
        p.StartInfo.UseShellExecute = false;
        p.StartInfo.CreateNoWindow = true;
        p.StartInfo.RedirectStandardInput = true;
        p.StartInfo.RedirectStandardOutput = true;
        p.StartInfo.WorkingDirectory = dir;
        
        try {
            p.Start();
        } catch {
            return;
        }

        Thread tIn = new Thread(() => {
            try {
                using (var sIn = Console.OpenStandardInput())
                using (var pIn = p.StandardInput.BaseStream)
                {
                    sIn.CopyTo(pIn);
                }
            } catch {}
        });
        
        Thread tOut = new Thread(() => {
            try {
                using (var pOut = p.StandardOutput.BaseStream)
                using (var sOut = Console.OpenStandardOutput())
                {
                    pOut.CopyTo(sOut);
                }
            } catch {}
        });

        tIn.Start();
        tOut.Start();
        p.WaitForExit();
    }
}
