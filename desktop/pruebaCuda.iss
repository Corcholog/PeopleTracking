#define AppName        "CUDA_Test"
#define AppVersion     "0.1"
#define CUDA_URL "https://developer.download.nvidia.com/compute/cuda/12.9.0/network_installers/cuda_12.9.0_windows_network.exe"
#define CUDA_TMPNAME   "cuda_installer.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=admin
Compression=none
SolidCompression=no


[Code]


function GetCudaURL(): String;
var
  WinVer: Cardinal;
begin
  WinVer := GetWindowsVersion;
  // Cualquier versión igual o superior a Windows 10
  if WinVer >= $0A000000 then
    Result := '{#CUDA_URL}'
  else
    Result := '';
end;

// Inicializa la descarga de CUDA antes de la instalación
function InitializeSetup(): Boolean;
var
  URL, Dest: String;
  Bytes: Int64;
begin
  Result := False;
  URL := GetCudaURL();
  if URL = '' then
  begin
    MsgBox('Solo Windows 10 o superior son soportados.', mbError, MB_OK);
    Exit;
  end;

  // Ruta destino en {tmp}
  Dest := ExpandConstant('{tmp}\') + '{#CUDA_TMPNAME}';
  // Intentar descarga
  try
    Bytes := DownloadTemporaryFile(URL, '{#CUDA_TMPNAME}', '', nil);
    if Bytes > 0 then
      Result := True
    else
      MsgBox('La descarga no devolvió datos (0 bytes).', mbError, MB_OK);
  except
    // Captura cualquier error y muestra su mensaje
      MsgBox(
      'Error descargando CUDA:' + #13#10 +
      URL + #13#10 +
      'Detalles: ' + GetExceptionMessage(),
      mbError, MB_OK
    );
    Result := False;
  end;
end;

[Run]
Filename: "{tmp}\{#CUDA_TMPNAME}"; \
Parameters: "-s --toolkit"; \
WorkingDir: "{tmp}"; \
Flags: shellexec runhidden waituntilterminated

