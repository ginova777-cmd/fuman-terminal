Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe"
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
Next
exitCode = shell.Run(cmd, 0, True)
WScript.Quit exitCode
