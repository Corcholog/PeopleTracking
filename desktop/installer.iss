#define MyAppName    "Followup"
#define MyAppVersion "1.1.0"
#define CUDA_URL "https://developer.download.nvidia.com/compute/cuda/12.9.0/network_installers/cuda_12.9.0_windows_network.exe"
#define CUDA_TMPNAME "cuda_installer.exe"
#define MUSIC_DLL    "MediaPlayer.dll"
#define MUSIC_FILE   "theme.wav"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputBaseFilename={#MyAppName}Installer
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
AllowNoIcons=yes
DiskSpanning=yes
DiskSliceSize=max
WizardImageFile=imagenes\banner.bmp
WizardSmallImageFile=imagenes\logo.bmp

[Files]
; — Archivos necesarios para la música (deben estar al principio)
Source: "libs\{#MUSIC_DLL}"; Flags: dontcopy deleteafterinstall
Source: "{#MUSIC_FILE}"; Flags: dontcopy deleteafterinstall

; — Ejecutables de la aplicación y servidor FastAPI
Source: "src-tauri\target\release\app.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "src-tauri\target\release\fastapi_server.exe"; DestDir: "{app}"; Flags: ignoreversion

; — Tracker y modelo YOLO
Source: "..\tracker\*"; DestDir: "{app}\tracker"; Flags: recursesubdirs createallsubdirs
Source: "..\yolov8n.pt"; DestDir: "{app}\tracker"; Flags: ignoreversion



[Code]
const
  EC_COMPLETE = $01;

type
  TDirectShowEventProc = procedure(EventCode, Param1, Param2: Integer);

function DSGetLastError(var ErrorText: WideString): HRESULT;
  external 'DSGetLastError@files:{#MUSIC_DLL} stdcall';
function DSPlayMediaFile: Boolean;
  external 'DSPlayMediaFile@files:{#MUSIC_DLL} stdcall';
function DSStopMediaPlay: Boolean;
  external 'DSStopMediaPlay@files:{#MUSIC_DLL} stdcall';
function DSSetVolume(Value: LongInt): Boolean;
  external 'DSSetVolume@files:{#MUSIC_DLL} stdcall';
function DSInitializeAudioFile(FileName: WideString; CallbackProc: TDirectShowEventProc): Boolean;
  external 'DSInitializeAudioFile@files:{#MUSIC_DLL} stdcall';

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
procedure SetElevationBit(Filename: String);
var
  LBuffer: AnsiString;
  LStream: TStream;
begin
  Filename := ExpandConstant(Filename);
  Log('Setting elevation bit for ' + Filename);
  LStream := TFileStream.Create(Filename, fmOpenReadWrite);
  try
    LStream.Position := 21;           // Posición del byte de elevación
    SetLength(LBuffer, 1);
    LStream.ReadBuffer(LBuffer, 1);
    LBuffer[1] := Chr(Ord(LBuffer[1]) or $20); // Activar el bit
    LStream.Position := LStream.Position - 1;
    LStream.WriteBuffer(LBuffer, 1);
  finally
    LStream.Free;
  end;
end;
function IsComponentInstalled(const Name: String): Boolean;
var
  Rc: Integer;
begin
  Result := Exec('cmd', '/C where ' + Name, '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0);
end;

procedure OnMediaPlayerEvent(EventCode, Param1, Param2: Integer);
begin
  if EventCode = EC_COMPLETE then
  begin
    // Reproducción finalizada; puedes reiniciar la música si lo deseas
  end;
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: HRESULT;
  ErrorText: WideString;
  MusicPath: String;

  Msg: String;
  URL, Dest: String;
  Bytes: Int64;
begin
  Result := True;
  
  
  // Extraer archivos necesarios
  ExtractTemporaryFile('{#MUSIC_FILE}');
  // Inicializar y reproducir música
  MusicPath := ExpandConstant('{tmp}\{#MUSIC_FILE}');
  if not FileExists(MusicPath) then
    MsgBox('¡¡No encuentro el fichero de música!!'#13#10 + MusicPath, mbError, MB_OK);
  if DSInitializeAudioFile(MusicPath, @OnMediaPlayerEvent) then
  begin
    DSSetVolume(-2500); // Volumen moderado
    DSPlayMediaFile;
  end
  else
  begin
    ErrorCode := DSGetLastError(ErrorText);
    MsgBox('Error en MediaPlayer.dll: ' + IntToStr(ErrorCode) + '; ' + ErrorText, mbError, MB_OK);
  end;

  // Verificar e instalar CUDA si es necesario
  if not IsComponentInstalled('nvcc') then
  begin
    Msg := 'Para usar aceleración por GPU necesitas una tarjeta NVIDIA con soporte CUDA.'#13#10 +
           '¿Descargar e instalar el CUDA Toolkit ahora?';
    if MsgBox(Msg, mbConfirmation, MB_YESNO) = idYes then
    begin
      
      URL := GetCudaURL();
        if URL = '' then
        begin
          MsgBox('Solo Windows 10 o superior son soportados.', mbError, MB_OK);
          Exit;
        end;
      
      // Ruta destino en {tmp}
      Dest := ExpandConstant('{tmp}\') + '{#CUDA_TMPNAME}';
      // Intentar descarga;
      
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
  end;
end;


procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpInstalling then
  begin
    ExtractTemporaryFile('{#MUSIC_FILE}');
    DSInitializeAudioFile(ExpandConstant('{tmp}\{#MUSIC_FILE}'), @OnMediaPlayerEvent);
    DSSetVolume(-2500);
    DSPlayMediaFile;
  end
  else if CurPageID = wpReady then
    DSStopMediaPlay;
end;

procedure DeinitializeSetup();
begin
  DSStopMediaPlay;
end;

[Run]
// Ejecuta el instalador de CUDA si aún no hay nvcc
Filename: "{tmp}\{#CUDA_TMPNAME}"; \
  Parameters: "-s --toolkit"; \
  WorkingDir: "{tmp}"; \
  StatusMsg: "Instalando CUDA Toolkit…"; \
  Flags: shellexec runhidden waituntilterminated; \
  Check: not IsComponentInstalled('nvcc')

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\app.exe"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\app.exe"; AfterInstall: SetElevationBit('{userdesktop}\{#MyAppName}.lnk')

[Tasks]
Name: desktopicon; Description: "Crear acceso directo en el Escritorio"; Flags: unchecked
