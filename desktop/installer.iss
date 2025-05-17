; installer.iss
[Setup]
AppName=PeopleTracking
AppVersion=1.0.0
DefaultDirName={pf}\PeopleTracking
DefaultGroupName=PeopleTracking
OutputBaseFilename=PeopleTrackingInstaller
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
AllowNoIcons=yes
DiskSpanning=yes
DiskSliceSize=max

[Files]
Source: "src-tauri\target\release\app.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "src-tauri\target\release\fastapi_server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\tracker\*"; DestDir: "{app}\tracker"; Flags: recursesubdirs createallsubdirs
Source: "..\yolov8n.pt"; DestDir: "{app}\tracker"; Flags: ignoreversion


[Icons]
Name: "{group}\PeopleTracking";       Filename: "{app}\app.exe"
Name: "{userdesktop}\PeopleTracking"; Filename: "{app}\app.exe"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Crear acceso directo en el Escritorio"; GroupDescription: "Opciones de accesos directos:"; Flags: unchecked

[Run]
; (Opcional) Comprueba e instala CUDA si es necesario
Filename: "{app}\python\python.exe"; \
  Parameters: "-c ""import subprocess,sys;sys.exit(0 if subprocess.call(['nvcc','--version'])==0 else 1)"""; \
  StatusMsg: "Comprobando instalación de CUDA…"; \
  Flags: runhidden waituntilterminated; \
  Check: not IsComponentInstalled('nvcc')
Filename: "cuda_installer.exe"; \
  Parameters: "--silent --toolkit"; \
  WorkingDir: "{tmp}"; \
  StatusMsg: "Instalando CUDA Toolkit…"; \
  Flags: shellexec runhidden waituntilterminated; \
  Check: not IsComponentInstalled('nvcc')

; Inicia el sidecar FastAPI
Filename: "{app}\fastapi_server.exe"; \
  WorkingDir: "{app}"; \
  Description: "Iniciando FastAPI sidecar…"; \
  Flags: nowait postinstall skipifsilent

; Luego lanza tu app principal
Filename: "{app}\app.exe"; \
  WorkingDir: "{app}"; \
  Description: "Iniciar PeopleTracking"; \
  Flags: nowait postinstall skipifsilent

[Code]
function IsComponentInstalled(const ComponentName: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd', '/C where '+ComponentName, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
            and (ResultCode = 0);
end;
