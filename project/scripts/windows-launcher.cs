using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Fishing Cat 钓鱼桌宠")]
[assembly: AssemblyProduct("Fishing Cat 钓鱼桌宠")]
[assembly: AssemblyVersion("0.1.10.0")]
[assembly: AssemblyFileVersion("0.1.10.0")]

// Build as a WinExe: the release root contains only this entry point and the
// user's BGM folder; native runtime files stay together under project/runtime.
internal static class WindowsLauncher
{
    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string releaseRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        string runtimeDirectory = Path.Combine(releaseRoot, "project", "runtime");
        string runtimeExecutable = Path.Combine(runtimeDirectory, "fishing-codex.exe");

        if (!File.Exists(runtimeExecutable))
        {
            ShowError("未找到游戏运行文件：\n" + runtimeExecutable +
                "\n\n请完整解压发行包，并保留 project 文件夹后重新启动。");
            return 1;
        }

        try
        {
            var start = new ProcessStartInfo
            {
                FileName = runtimeExecutable,
                WorkingDirectory = runtimeDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            start.EnvironmentVariables["FISHING_BGM_DIR"] = Path.Combine(releaseRoot, "BGM");

            using (Process child = Process.Start(start))
            {
                if (child == null)
                    throw new InvalidOperationException("系统没有成功创建游戏进程。");
            }
            return 0;
        }
        catch (Exception error)
        {
            ShowError("游戏暂时无法启动。请确认发行包已完整解压，且 project\\runtime 中的文件齐全。" +
                "\n\n" + error.Message);
            return 2;
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "Fishing Codex", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
