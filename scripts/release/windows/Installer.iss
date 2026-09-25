[Setup]
AppId={{8A7B4E80-A650-4D47-9D05-8D4D7F13E67E}
AppName=Codex Connect
AppVersion={#ProductVersion}
AppPublisher=Codex Connect
DefaultDirName={localappdata}\Programs\codex-connect
DefaultGroupName=Codex Connect
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Codex Connect
SetupIconFile=..\..\..\crates\launcher\assets\codexhost.ico
UninstallDisplayIcon={app}\bin\codexhost-start.exe

#if Architecture == "x64"
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#else
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#endif

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\Codex Connect"; Filename: "{app}\bin\codexhost-start.exe"; WorkingDir: "{app}"

; Remove the Start menu shortcut left by an in-place upgrade from codexhost.
[InstallDelete]
Type: files; Name: "{userprograms}\codexhost.lnk"

[Dirs]
Name: "{app}"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
