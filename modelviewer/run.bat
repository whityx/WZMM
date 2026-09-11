@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "LOCAL_VENV=%LOCALAPPDATA%\wzmm\modelviewer_venv"
set "SCRIPT_VENV=%SCRIPT_DIR%.venv"
set "LOCAL_EMBED_PY=%LOCALAPPDATA%\wzmm\.python\python.exe"
set "EMBED_PY=%SCRIPT_DIR%.python\python.exe"
set "REQ=%SCRIPT_DIR%requirements.txt"
set "BOOTSTRAP=%SCRIPT_DIR%bootstrap.ps1"
set "LOG=%SCRIPT_DIR%viewer_launch.log"

echo [3D Viewer] Starting launcher... > "%LOG%"

if exist "%LOCAL_VENV%\Scripts\python.exe" (
    set "PYTHON=%LOCAL_VENV%\Scripts\python.exe"
    goto :RUN_VENV
)

if exist "%SCRIPT_VENV%\Scripts\python.exe" (
    set "PYTHON=%SCRIPT_VENV%\Scripts\python.exe"
    goto :RUN_VENV
)

if exist "%EMBED_PY%" (
    set "PYTHON=%EMBED_PY%"
    goto :RUN_EMBED
)

if exist "%LOCAL_EMBED_PY%" (
    set "PYTHON=%LOCAL_EMBED_PY%"
    goto :RUN_EMBED
)

set "FOUND_PYTHON="
for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
    "%PROGRAMFILES%\Python313\python.exe"
    "%PROGRAMFILES%\Python312\python.exe"
    "%PROGRAMFILES%\Python311\python.exe"
    "%PROGRAMFILES%\Python310\python.exe"
    "%PROGRAMFILES%\Python39\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
    "C:\Python310\python.exe"
    "C:\Python39\python.exe"
) do (
    if not defined FOUND_PYTHON if exist "%%~P" (
        set "FOUND_PYTHON=%%~P"
    )
)

if not defined FOUND_PYTHON (
    where python >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%I in ('where python 2^>nul') do (
            if not defined FOUND_PYTHON (
                set "FOUND_PYTHON=%%I"
            )
        )
    )
)

if not defined FOUND_PYTHON (
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -c "import sys; print(sys.executable)" > "%TEMP%\py_loc.txt" 2>nul
        if exist "%TEMP%\py_loc.txt" (
            set /p FOUND_PYTHON=<"%TEMP%\py_loc.txt"
            del "%TEMP%\py_loc.txt" >nul 2>&1
        )
    )
)

if defined FOUND_PYTHON (
    echo [3D Viewer] Found system Python: !FOUND_PYTHON! >> "%LOG%"
    "!FOUND_PYTHON!" -m venv "%LOCAL_VENV%" >> "%LOG%" 2>&1
    if exist "%LOCAL_VENV%\Scripts\python.exe" (
        set "PYTHON=%LOCAL_VENV%\Scripts\python.exe"
        goto :RUN_VENV
    )
)

echo [3D Viewer] Python is not installed. Bootstrapping portable environment... >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP%" -TargetDir "%LOCALAPPDATA%\wzmm\.python" -ReqFile "%REQ%" >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [3D Viewer] Failed to bootstrap portable Python. >> "%LOG%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Python 3 is required for 3D Viewer. Failed to auto-download portable Python. Please connect to the internet or install Python from python.org.', 'WZMM 3D Viewer', 0, 48);"
    exit /b 1
)

if exist "%LOCAL_EMBED_PY%" (
    set "PYTHON=%LOCAL_EMBED_PY%"
    goto :RUN_EMBED
)

if exist "%EMBED_PY%" (
    set "PYTHON=%EMBED_PY%"
    goto :RUN_EMBED
)

echo [3D Viewer] Python could not be initialized. >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Python 3 is required for 3D Viewer. Please install Python from python.org.', 'WZMM 3D Viewer', 0, 48);"
exit /b 1

:RUN_VENV
if not exist "%LOCAL_VENV%\.deps_installed" (
    echo [3D Viewer] Installing dependencies in venv... >> "%LOG%"
    "%PYTHON%" -m pip install --quiet -r "%REQ%" pythonnet >> "%LOG%" 2>&1
    if not errorlevel 1 type nul > "%LOCAL_VENV%\.deps_installed"
)
echo [3D Viewer] Launching viewer_app.py with venv... >> "%LOG%"
"%PYTHON%" "%SCRIPT_DIR%src\viewer_app.py" %* >> "%LOG%" 2>&1
exit /b %errorlevel%

:RUN_EMBED
if not exist "%LOCALAPPDATA%\wzmm\.python\.deps_installed" (
    echo [3D Viewer] Installing dependencies in portable Python... >> "%LOG%"
    "%PYTHON%" -m pip install --quiet -r "%REQ%" pythonnet >> "%LOG%" 2>&1
    if not errorlevel 1 type nul > "%LOCALAPPDATA%\wzmm\.python\.deps_installed"
)
echo [3D Viewer] Launching viewer_app.py with portable Python... >> "%LOG%"
"%PYTHON%" "%SCRIPT_DIR%src\viewer_app.py" %* >> "%LOG%" 2>&1
exit /b %errorlevel%
