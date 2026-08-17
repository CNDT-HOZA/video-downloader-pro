using System;
using System.Diagnostics;
using System.IO;

namespace ChromeNativeHostWrapper
{
    class Program
    {
        static void Main(string[] args)
        {
            string hostJsPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "host.js");
            
            // Tìm Node.js xách tay (nếu có) hoặc dùng Node.js hệ thống
            string portableNode = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "server", "bin", "node", "node.exe");
            string nodePath = File.Exists(portableNode) ? portableNode : "node.exe";

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = string.Format("\"{0}\" {1}", hostJsPath, args.Length > 0 ? args[0] : ""),
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            Process process = new Process { StartInfo = psi };
            process.Start();

            // Luồng đọc từ Chrome chuyển sang Node.js
            System.Threading.Thread inputThread = new System.Threading.Thread(() =>
            {
                using (Stream stdin = Console.OpenStandardInput())
                using (Stream pStdin = process.StandardInput.BaseStream)
                {
                    stdin.CopyTo(pStdin);
                }
            });

            // Luồng đọc từ Node.js chuyển sang Chrome
            System.Threading.Thread outputThread = new System.Threading.Thread(() =>
            {
                using (Stream pStdout = process.StandardOutput.BaseStream)
                using (Stream stdout = Console.OpenStandardOutput())
                {
                    pStdout.CopyTo(stdout);
                }
            });

            inputThread.Start();
            outputThread.Start();

            process.WaitForExit();
        }
    }
}
