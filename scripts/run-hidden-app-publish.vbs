' Run the phone-app auto-publish script with NO window at all.
'
' Why this wrapper exists: node.exe is a console program. When Task Scheduler
' starts it directly, Windows gives it a console window, so a black box flashes
' on the desktop once a minute. wscript.exe is a GUI-subsystem host (no console),
' and Run(..., 0, ...) hides the child window, so nothing flashes.
'
' Third arg False = do not wait; wscript exits at once and node keeps working.
' Keep this file ASCII-only: .vbs is read as ANSI, and a Chinese character whose
' second byte is 0x5C (backslash) would be parsed as a line continuation.
Option Explicit

Dim fso, sh, node, target
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

node = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
target = "D:\project\hnd_factory_UI\scripts\auto-publish-app.mjs"

If Not fso.FileExists(node) Then WScript.Quit 2
If Not fso.FileExists(target) Then WScript.Quit 3

sh.Run """" & node & """ """ & target & """", 0, False
