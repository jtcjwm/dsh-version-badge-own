' ============================================================
' dsh-version-badge-own - auto update launcher (VBS)
' ------------------------------------------------------------
' Double-click launches a DETACHED hidden PowerShell process.
' Using WScript.Shell.Run with window style 0 avoids the
' cmd "start /b" quirk that silently did nothing.
' ============================================================

Option Explicit

Dim shell, fso, ps1, logDir, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ps1 = "D:\DSH\plugins\dsh-version-badge-own\scripts\auto-update.ps1"
logDir = "D:\DSH\_tmp\update-runner"

If Not fso.FolderExists(logDir) Then
  fso.CreateFolder logDir
End If

If Not fso.FileExists(ps1) Then
  MsgBox "Missing script: " & ps1, 16, "DSH auto-update"
  WScript.Quit 1
End If

cmd = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" & _
      " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"

' 0 = hidden window, False = do not wait for completion (detached)
shell.Run cmd, 0, False
